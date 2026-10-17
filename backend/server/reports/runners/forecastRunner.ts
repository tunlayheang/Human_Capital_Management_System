import { Op } from 'sequelize';
import {
  Department,
  Employee,
  LeaveBalance,
  LeaveType,
  PayrollRun,
  Payslip,
  PayslipBreakdown,
  SalaryStructure,
  Position,
} from '../../db.js';
import {
  buildDepartmentAttendanceRates,
  buildMonthlyAttendanceRateTrend,
  buildMonthlyOvertimeTrend,
  buildOrganizationAnalytics,
} from '../../organizationAnalyticsService.js';
import { resolveDashboardDateRange, startOfYear, todayYmd } from '../../dashboardDateRange.js';
import { monthKeysInRange } from '../../dashboardDateRange.js';
import type { ReportColumn, ReportRunner, ReportRow } from '../reportTypes.js';
import { num, resolveDateRangeFromFilters, round2, str } from '../reportFilterUtils.js';
import {
  addMonthsKey,
  formatMonthLabel,
  linearFit,
  projectNext,
  riskBand,
  round1,
  trendLabel,
} from '../reportForecastMath.js';

function horizonMonths(filters: Record<string, string>): number {
  const h = Math.floor(Number(filters.horizonMonths) || 3);
  return Math.min(6, Math.max(1, h));
}

function lookbackRange(filters: Record<string, string>) {
  if (filters.startDate && filters.endDate) return resolveDateRangeFromFilters(filters);
  const end = todayYmd();
  const start = startOfYear();
  return resolveDashboardDateRange(filters.startDate || start, filters.endDate || end);
}

/** Org KPI outlook — actual months + projected next N months. */
export const runKpiOutlook: ReportRunner = async (filters) => {
  const range = lookbackRange(filters);
  const horizon = horizonMonths(filters);
  const analytics = await buildOrganizationAnalytics(range);
  const charts = analytics.charts || {};

  const byMonth = new Map<string, ReportRow>();
  const ensure = (monthKey: string, monthLabel: string, kind: string) => {
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {
        monthKey,
        month: monthLabel,
        kind,
        attendanceRate: 0,
        leaveDays: 0,
        otHours: 0,
        separations: 0,
      });
    }
    return byMonth.get(monthKey)!;
  };

  for (const row of charts.monthlyAttendanceRate || []) {
    const r = ensure(str(row.monthKey), str(row.month), 'Actual');
    r.attendanceRate = num(row.attendanceRatePct);
  }
  for (const row of charts.monthlyLeaveUsage || []) {
    const r = ensure(str(row.monthKey), str(row.month), 'Actual');
    r.leaveDays = num(row.days);
  }
  for (const row of charts.monthlyOvertimeHours || []) {
    const r = ensure(str(row.monthKey), str(row.month), 'Actual');
    r.otHours = num(row.hours);
  }
  for (const row of charts.monthlySeparations || []) {
    const r = ensure(str(row.monthKey), str(row.month), 'Actual');
    r.separations = num(row.count);
  }

  const actualKeys = [...byMonth.keys()].sort();
  const attSeries = actualKeys.map((k) => num(byMonth.get(k)!.attendanceRate));
  const leaveSeries = actualKeys.map((k) => num(byMonth.get(k)!.leaveDays));
  const otSeries = actualKeys.map((k) => num(byMonth.get(k)!.otHours));
  const sepSeries = actualKeys.map((k) => num(byMonth.get(k)!.separations));

  const attProj = projectNext(attSeries, horizon, { minZero: true });
  const leaveProj = projectNext(leaveSeries, horizon, { minZero: true });
  const otProj = projectNext(otSeries, horizon, { minZero: true });
  const sepProj = projectNext(sepSeries, horizon, { minZero: true });

  const lastKey = actualKeys[actualKeys.length - 1] || todayYmd().slice(0, 7);
  for (let i = 0; i < horizon; i++) {
    const mk = addMonthsKey(lastKey, i + 1);
    byMonth.set(mk, {
      monthKey: mk,
      month: formatMonthLabel(mk),
      kind: 'Forecast',
      attendanceRate: round1(Math.min(100, attProj[i])),
      leaveDays: round1(leaveProj[i]),
      otHours: round1(otProj[i]),
      separations: round1(sepProj[i]),
    });
  }

  const rows = [...byMonth.values()].sort((a, b) =>
    str(a.monthKey).localeCompare(str(b.monthKey))
  );

  const attFit = linearFit(attSeries);
  const forecastRows = rows.filter((r) => r.kind === 'Forecast');
  const actualRows = rows.filter((r) => r.kind === 'Actual');
  return {
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'kind', label: 'Kind' },
      {
        key: 'attendanceRate',
        label: 'Attendance %',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'leaveDays', label: 'Leave days', align: 'right', format: 'number' },
      { key: 'otHours', label: 'OT hours', align: 'right', format: 'number' },
      { key: 'separations', label: 'Separations', align: 'right', format: 'number' },
    ] satisfies ReportColumn[],
    rows,
    note: `Blend of linear trend + 3-mo average. Attendance trend: ${trendLabel(attFit.slope)}. Horizon ${horizon} mo. Not a guarantee — planning estimate only.`,
    summaryCards: [
      {
        key: 'actualMonths',
        label: 'Actual months',
        value: actualRows.length,
        format: 'number',
      },
      {
        key: 'forecastMonths',
        label: 'Forecast months',
        value: forecastRows.length,
        format: 'number',
      },
      {
        key: 'fcLeave',
        label: 'Forecast leave days',
        value: Math.round(forecastRows.reduce((s, r) => s + num(r.leaveDays), 0) * 10) / 10,
        format: 'number',
      },
      {
        key: 'fcOt',
        label: 'Forecast OT hours',
        value: Math.round(forecastRows.reduce((s, r) => s + num(r.otHours), 0) * 10) / 10,
        format: 'number',
      },
    ],
  };
};

/** Headcount outlook from join vs separation rates. */
export const runHeadcountOutlook: ReportRunner = async (filters) => {
  const range = lookbackRange(filters);
  const horizon = horizonMonths(filters);
  const months = monthKeysInRange(range.startDate, range.endDate);

  const activeNow = await Employee.count({
    where: {
      status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] },
      ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
    },
  });

  const joinsByMonth: number[] = [];
  const exitsByMonth: number[] = [];
  for (const mk of months) {
    const y = Number(mk.slice(0, 4));
    const m = Number(mk.slice(5, 7));
    const start = `${mk}-01`;
    const endDay = new Date(y, m, 0).getDate();
    const end = `${mk}-${String(endDay).padStart(2, '0')}`;
    const joinWhere: Record<string, unknown> = {
      join_date: { [Op.between]: [start, end] },
    };
    if (filters.departmentId) joinWhere.department_id = filters.departmentId;
    const exitWhere: Record<string, unknown> = {
      status: { [Op.in]: ['terminated', 'resigned', 'TERMINATED', 'RESIGNED', 'absconded'] },
      terminated_at: { [Op.between]: [new Date(start), new Date(`${end}T23:59:59`)] },
    };
    if (filters.departmentId) exitWhere.department_id = filters.departmentId;
    const [joins, exits] = await Promise.all([
      Employee.count({ where: joinWhere }),
      Employee.count({ where: exitWhere }),
    ]);
    joinsByMonth.push(joins);
    exitsByMonth.push(exits);
  }

  const joinProj = projectNext(joinsByMonth, horizon, { minZero: true });
  const exitProj = projectNext(exitsByMonth, horizon, { minZero: true });
  const lastKey = months[months.length - 1] || todayYmd().slice(0, 7);

  let headcount = activeNow;
  const rows: ReportRow[] = [
    {
      month: formatMonthLabel(lastKey),
      monthKey: lastKey,
      kind: 'Actual',
      joins: joinsByMonth[joinsByMonth.length - 1] ?? 0,
      exits: exitsByMonth[exitsByMonth.length - 1] ?? 0,
      netChange: (joinsByMonth[joinsByMonth.length - 1] ?? 0) - (exitsByMonth[exitsByMonth.length - 1] ?? 0),
      projectedHeadcount: activeNow,
      attritionRatePct: activeNow
        ? round1(((exitsByMonth[exitsByMonth.length - 1] ?? 0) / activeNow) * 100)
        : 0,
    },
  ];

  for (let i = 0; i < horizon; i++) {
    const j = round1(joinProj[i]);
    const e = round1(exitProj[i]);
    headcount = Math.max(0, round1(headcount + j - e));
    const mk = addMonthsKey(lastKey, i + 1);
    rows.push({
      month: formatMonthLabel(mk),
      monthKey: mk,
      kind: 'Forecast',
      joins: j,
      exits: e,
      netChange: round1(j - e),
      projectedHeadcount: headcount,
      attritionRatePct: headcount ? round1((e / headcount) * 100) : 0,
    });
  }

  const openPositions = await Position.count({
    where: { isActive: { [Op.ne]: false } },
  }).catch(() => 0);

  const lastForecast = rows[rows.length - 1];
  const startHc = activeNow;
  const shaped: ReportRow[] = rows.map((r, idx) => {
    const hc = num(r.projectedHeadcount);
    const prev = idx === 0 ? startHc : num(rows[idx - 1].projectedHeadcount) || startHc;
    const growth = prev > 0 ? round1(((hc - prev) / prev) * 100) : 0;
    const gap = Math.max(0, openPositions - Math.round(hc));
    const risk =
      Math.abs(growth) >= 8 || gap > Math.max(3, openPositions * 0.25)
        ? 'High'
        : Math.abs(growth) >= 4 || gap > 0
          ? 'Medium'
          : 'Low';
    return {
      reportMonth: r.month,
      currentHeadcount: idx === 0 ? activeNow : prev,
      plannedNewHires: num(r.joins),
      plannedSeparations: num(r.exits),
      forecastHeadcount: hc,
      headcountGrowthRate: growth,
      openPositions,
      workforceGap: gap,
      criticalPositions: Math.min(openPositions, Math.max(0, Math.round(gap * 0.4))),
      workforceRiskLevel: risk,
    };
  });

  return {
    columns: [
      { key: 'reportMonth', label: 'Report Month' },
      {
        key: 'currentHeadcount',
        label: 'Current Headcount',
        align: 'right',
        format: 'number',
        aggregate: 'omit',
      },
      { key: 'plannedNewHires', label: 'Planned New Hires', align: 'right', format: 'number' },
      {
        key: 'plannedSeparations',
        label: 'Planned Separations',
        align: 'right',
        format: 'number',
      },
      {
        key: 'forecastHeadcount',
        label: 'Forecast Headcount',
        align: 'right',
        format: 'number',
        aggregate: 'omit',
      },
      {
        key: 'headcountGrowthRate',
        label: 'Headcount Growth Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'openPositions',
        label: 'Open Positions',
        align: 'right',
        format: 'number',
        aggregate: 'omit',
      },
      { key: 'workforceGap', label: 'Workforce Gap', align: 'right', format: 'number' },
      {
        key: 'criticalPositions',
        label: 'Critical Positions',
        align: 'right',
        format: 'number',
      },
      { key: 'workforceRiskLevel', label: 'Workforce Risk Level' },
    ],
    rows: shaped,
    note: `Starts from ${activeNow} active/probation staff. Joins/exits projected from lookback period rates.`,
    summaryCards: [
      { key: 'startHc', label: 'Starting headcount', value: activeNow, format: 'number' },
      {
        key: 'endHc',
        label: 'End-of-horizon headcount',
        value: num(lastForecast?.projectedHeadcount),
        format: 'number',
      },
      { key: 'open', label: 'Open positions', value: openPositions, format: 'number' },
    ],
  };
};

/** Payroll cost outlook from recent run gross totals + base-salary mass. */
export const runPayrollCostOutlook: ReportRunner = async (filters) => {
  const horizon = horizonMonths(filters);
  const runs = await PayrollRun.findAll({
    order: [['createdAt', 'DESC']],
    limit: 24,
  });

  // Unique by month (latest run wins).
  const byMonth = new Map<string, { month: string; gross: number; net: number; headcount: number }>();
  for (const run of runs) {
    const month = str(run.get('month')).slice(0, 7);
    if (!month || byMonth.has(month)) continue;
    const runId = str(run.get('id'));
    const payslips = await Payslip.findAll({
      where: { payrollRunId: runId },
      attributes: ['id'],
      limit: 5000,
    });
    const payslipIds = payslips.map((p) => str(p.get('id'))).filter(Boolean);
    let gross = 0;
    let net = 0;
    if (payslipIds.length) {
      const breakdowns = await PayslipBreakdown.findAll({
        where: { payslipId: { [Op.in]: payslipIds } },
        attributes: ['grossSalary', 'netSalary'],
      });
      for (const b of breakdowns) {
        gross += num(b.get('grossSalary'));
        net += num(b.get('netSalary'));
      }
    }
    byMonth.set(month, {
      month,
      gross: round2(gross),
      net: round2(net),
      headcount: payslips.length,
    });
  }

  const keys = [...byMonth.keys()].sort();
  const grossSeries = keys.map((k) => byMonth.get(k)!.gross);
  const netSeries = keys.map((k) => byMonth.get(k)!.net);
  const hcSeries = keys.map((k) => byMonth.get(k)!.headcount);

  const activeSalary = await SalaryStructure.findAll({
    attributes: ['employee_id', 'base_salary'],
    limit: 5000,
  });
  const salaryMass = round2(
    activeSalary.reduce((s, e) => s + num(e.get('base_salary')), 0)
  );

  const rows: ReportRow[] = keys.map((k) => {
    const row = byMonth.get(k)!;
    return {
      month: formatMonthLabel(k),
      kind: 'Actual',
      headcount: row.headcount,
      grossPayroll: row.gross,
      netPayroll: row.net,
      avgGross: row.headcount ? round2(row.gross / row.headcount) : 0,
    };
  });

  const grossProj = projectNext(grossSeries.length ? grossSeries : [salaryMass], horizon, {
    minZero: true,
  });
  const netProj = projectNext(netSeries.length ? netSeries : [salaryMass * 0.85], horizon, {
    minZero: true,
  });
  const hcProj = projectNext(hcSeries.length ? hcSeries : [activeSalary.length], horizon, {
    minZero: true,
  });
  const lastKey = keys[keys.length - 1] || todayYmd().slice(0, 7);

  for (let i = 0; i < horizon; i++) {
    const mk = addMonthsKey(lastKey, i + 1);
    const hc = Math.max(1, round1(hcProj[i]));
    // Anchor toward current salary mass if history is thin.
    const gross = round2(0.7 * grossProj[i] + 0.3 * salaryMass);
    const net = round2(0.7 * netProj[i] + 0.3 * salaryMass * 0.85);
    rows.push({
      month: formatMonthLabel(mk),
      kind: 'Forecast',
      headcount: hc,
      grossPayroll: gross,
      netPayroll: net,
      avgGross: round2(gross / hc),
    });
  }

  const forecast = rows.filter((r) => r.kind === 'Forecast');
  const lastActual = [...rows].reverse().find((r) => r.kind === 'Actual');
  const currentCost = num(lastActual?.grossPayroll) || salaryMass;
  const shaped: ReportRow[] = forecast.map((r, idx) => {
    const fc = num(r.grossPayroll);
    const prev = idx === 0 ? currentCost : num(forecast[idx - 1].grossPayroll) || currentCost;
    const growth = prev > 0 ? round1(((fc - prev) / prev) * 100) : 0;
    const allowanceCost = round2(fc * 0.08);
    const bonusCost = round2(fc * 0.03);
    const overtimeCost = round2(fc * 0.04);
    const newHireCost = round2(num(r.avgGross) * Math.max(0, num(r.headcount) - (num(lastActual?.headcount) || 0)) * 0.2);
    const totalLabor = round2(fc + allowanceCost + bonusCost + overtimeCost);
    const risk = growth >= 8 ? 'High' : growth >= 4 ? 'Medium' : 'Low';
    return {
      reportMonth: r.month,
      currentPayrollCost: currentCost,
      forecastPayrollCost: fc,
      payrollGrowthRate: growth,
      newHireCost,
      salaryIncrementPct: round1(Math.max(0, growth * 0.4)),
      allowanceCost,
      bonusCost,
      overtimeCost,
      totalLaborCost: totalLabor,
      costRiskLevel: risk,
    };
  });

  // Include current month anchor row
  if (lastActual) {
    shaped.unshift({
      reportMonth: lastActual.month,
      currentPayrollCost: currentCost,
      forecastPayrollCost: currentCost,
      payrollGrowthRate: 0,
      newHireCost: 0,
      salaryIncrementPct: 0,
      allowanceCost: round2(currentCost * 0.08),
      bonusCost: round2(currentCost * 0.03),
      overtimeCost: round2(currentCost * 0.04),
      totalLaborCost: round2(currentCost * 1.15),
      costRiskLevel: 'Low',
    });
  }

  return {
    columns: [
      { key: 'reportMonth', label: 'Report Month' },
      {
        key: 'currentPayrollCost',
        label: 'Current Payroll Cost',
        align: 'right',
        format: 'currency',
        aggregate: 'omit',
      },
      {
        key: 'forecastPayrollCost',
        label: 'Forecast Payroll Cost',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'payrollGrowthRate',
        label: 'Payroll Growth Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'newHireCost', label: 'New Hire Cost', align: 'right', format: 'currency' },
      {
        key: 'salaryIncrementPct',
        label: 'Salary Increment (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'allowanceCost', label: 'Allowance Cost', align: 'right', format: 'currency' },
      { key: 'bonusCost', label: 'Bonus Cost', align: 'right', format: 'currency' },
      { key: 'overtimeCost', label: 'Overtime Cost', align: 'right', format: 'currency' },
      { key: 'totalLaborCost', label: 'Total Labor Cost', align: 'right', format: 'currency' },
      { key: 'costRiskLevel', label: 'Cost Risk Level' },
    ],
    rows: shaped,
    note: `Current base-salary mass ≈ $${salaryMass.toLocaleString()}. Allowance/bonus/OT shares are planning estimates from gross. Forecast blends run history with salary mass.`,
    summaryCards: [
      { key: 'salaryMass', label: 'Current salary mass', value: salaryMass, format: 'currency' },
      {
        key: 'fcGross',
        label: 'Forecast payroll (sum)',
        value: round2(forecast.reduce((s, r) => s + num(r.grossPayroll), 0)),
        format: 'currency',
      },
    ],
  };
};

/** Leave balance outlook — projected year-end remaining & depletion risk. */
export const runLeaveBalanceOutlook: ReportRunner = async (filters) => {
  const year = Number(filters.year) || new Date().getFullYear();
  const monthNow = new Date().getMonth() + 1;
  const monthsLeft = Math.max(1, 12 - monthNow + 1);

  const balances = await LeaveBalance.findAll({ where: { year }, limit: 5000 });
  const empIds = [...new Set(balances.map((b) => str(b.get('employeeId'))))];
  const employees = empIds.length
    ? await Employee.findAll({
        where: {
          id: { [Op.in]: empIds },
          status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] },
          ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
        },
        attributes: ['id', 'employee_id', 'department_id', 'first_name', 'last_name'],
      })
    : [];
  const empByPk = new Map(
    employees.map((e) => [str(e.get('id')), e.get({ plain: true }) as Record<string, unknown>])
  );
  const typeIds = [...new Set(balances.map((b) => str(b.get('leaveTypeId'))))];
  const types = typeIds.length
    ? await LeaveType.findAll({ where: { id: { [Op.in]: typeIds } } })
    : [];
  const typeName = new Map(types.map((t) => [str(t.get('id')), str(t.get('name'))]));
  const deptIds = [...new Set(employees.map((e) => str(e.get('department_id'))).filter(Boolean))];
  const depts = deptIds.length
    ? await Department.findAll({ where: { id: { [Op.in]: deptIds } } })
    : [];
  const deptName = new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));

  const rows: ReportRow[] = [];
  for (const bal of balances) {
    const p = bal.get({ plain: true }) as Record<string, unknown>;
    const emp = empByPk.get(str(p.employeeId));
    if (!emp) continue;
    const used = num(p.used);
    const opening = num(p.openingBalance);
    const accrued = num(p.accrued);
    const carried = num(p.carriedOver);
    const entitlement = num(p.entitlement);
    const available = opening + accrued + carried + entitlement - used;
    const monthsElapsed = Math.max(1, monthNow);
    const burnPerMonth = used / monthsElapsed;
    const projectedAdditional = burnPerMonth * monthsLeft;
    const yearEnd = round1(available - projectedAdditional);
    const riskScore = Math.min(
      100,
      Math.round((burnPerMonth > 0 ? (projectedAdditional / Math.max(available, 0.1)) * 80 : 0) +
        (available < 2 ? 25 : 0))
    );
    rows.push({
      employeeId: str(emp.employee_id),
      name: [str(emp.first_name), str(emp.last_name)].filter(Boolean).join(' '),
      department: deptName.get(str(emp.department_id)) || '',
      leaveType: typeName.get(str(p.leaveTypeId)) || str(p.leaveTypeId),
      availableNow: round1(available),
      usedYtd: round1(used),
      burnPerMonth: round1(burnPerMonth),
      projectedYearEnd: yearEnd,
      risk: riskBand(riskScore),
      riskScore,
    });
  }

  rows.sort((a, b) => num(b.riskScore) - num(a.riskScore));
  const limited = rows.slice(0, 500);
  const high = limited.filter((r) => String(r.risk).toLowerCase() === 'high').length;
  const med = limited.filter((r) => String(r.risk).toLowerCase() === 'medium').length;

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'leaveType', label: 'Leave type' },
      { key: 'availableNow', label: 'Available now', align: 'right', format: 'number' },
      { key: 'usedYtd', label: 'Used YTD', align: 'right', format: 'number' },
      { key: 'burnPerMonth', label: 'Burn / mo', align: 'right', format: 'number', aggregate: 'avg' },
      { key: 'projectedYearEnd', label: 'Proj. year-end', align: 'right', format: 'number' },
      { key: 'risk', label: 'Depletion risk' },
    ],
    rows: limited,
    note: `Assumes YTD burn rate continues for the remaining ${monthsLeft} month(s) of ${year}. High risk = likely to exhaust or go negative.`,
    summaryCards: [
      { key: 'high', label: 'High risk', value: high, format: 'number' },
      { key: 'medium', label: 'Medium risk', value: med, format: 'number' },
      {
        key: 'avail',
        label: 'Available now (sum)',
        value: round1(limited.reduce((s, r) => s + num(r.availableNow), 0)),
        format: 'number',
      },
      {
        key: 'yearEnd',
        label: 'Proj. year-end (sum)',
        value: round1(limited.reduce((s, r) => s + num(r.projectedYearEnd), 0)),
        format: 'number',
      },
    ],
  };
};

/** Department attendance risk — declining rates projected below threshold. */
export const runAttendanceRiskOutlook: ReportRunner = async (filters) => {
  const range = lookbackRange(filters);
  const threshold = Math.max(50, Math.min(100, Number(filters.thresholdPct) || 90));
  const horizon = horizonMonths(filters);

  // Build per-department monthly rates via raw attendance + employee map (simplified: use overall trend + current dept rates).
  let deptRates = await buildDepartmentAttendanceRates(range);
  if (filters.departmentId) {
    const dept = await Department.findByPk(filters.departmentId, { attributes: ['name'] });
    const name = str(dept?.get('name'));
    if (name) deptRates = deptRates.filter((d) => d.name === name);
  }
  const monthly = await buildMonthlyAttendanceRateTrend(range);
  const series = monthly.map((m) => num(m.attendanceRatePct));
  const fit = linearFit(series);
  const proj = projectNext(series, horizon, { minZero: true });
  const lastProjected = proj.length ? Math.min(100, proj[proj.length - 1]) : 0;
  const orgTrend = trendLabel(fit.slope);

  const rows: ReportRow[] = deptRates.map((d) => {
    const rate = num(d.ratePct);
    // Scale department rate by org projected delta.
    const lastActual = series.length ? series[series.length - 1] : rate;
    const delta = lastProjected - lastActual;
    const projected = round1(Math.max(0, Math.min(100, rate + delta)));
    const riskScore = Math.min(
      100,
      Math.round(
        (projected < threshold ? 50 : 0) +
          (rate < threshold ? 25 : 0) +
          (fit.slope < -0.3 ? 25 : fit.slope < 0 ? 10 : 0)
      )
    );
    return {
      department: d.name,
      currentRate: rate,
      projectedRate: projected,
      threshold,
      gapToThreshold: round1(projected - threshold),
      trend: orgTrend,
      risk: riskBand(riskScore),
      present: num(d.present),
      absent: num(d.absent),
    };
  });

  rows.sort((a, b) => num(a.projectedRate) - num(b.projectedRate));

  const reportMonth = formatMonthLabel(todayYmd().slice(0, 7));
  const shaped: ReportRow[] = rows.map((r) => {
    const current = num(r.currentRate);
    const projected = num(r.projectedRate);
    const absenceTrend = round1(Math.max(0, current - projected));
    const risk = String(r.risk);
    const lateTrend = orgTrend === 'down' ? 'Improving' : orgTrend === 'up' ? 'Worsening' : 'Stable';
    return {
      reportMonth,
      department: r.department,
      currentAttendanceRate: current,
      forecastAttendanceRate: projected,
      absenceTrend,
      lateArrivalTrend: lateTrend,
      sickLeaveForecast: round1(num(r.absent) * 0.35),
      leaveUtilizationRate: round1(Math.min(100, num(r.absent) > 0 ? (num(r.absent) / Math.max(1, num(r.present) + num(r.absent))) * 100 : 0)),
      highRiskEmployees: risk.toLowerCase() === 'high' ? Math.max(1, Math.round(num(r.absent) * 0.1)) : 0,
      recommendedAction:
        risk.toLowerCase() === 'high'
          ? 'Escalate attendance coaching and schedule review'
          : risk.toLowerCase() === 'medium'
            ? 'Monitor late/absence patterns weekly'
            : 'Maintain current attendance controls',
      attendanceRiskLevel: riskBand(
        Math.min(
          100,
          Math.round(
            (projected < threshold ? 50 : 0) +
              (current < threshold ? 25 : 0) +
              (fit.slope < -0.3 ? 25 : fit.slope < 0 ? 10 : 0)
          )
        )
      ),
    };
  });

  return {
    columns: [
      { key: 'reportMonth', label: 'Report Month', aggregate: 'omit' },
      { key: 'department', label: 'Department' },
      {
        key: 'currentAttendanceRate',
        label: 'Current Attendance Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'forecastAttendanceRate',
        label: 'Forecast Attendance Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'absenceTrend',
        label: 'Absence Trend (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'lateArrivalTrend', label: 'Late Arrival Trend' },
      {
        key: 'sickLeaveForecast',
        label: 'Sick Leave Forecast',
        align: 'right',
        format: 'number',
      },
      {
        key: 'leaveUtilizationRate',
        label: 'Leave Utilization Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'highRiskEmployees',
        label: 'High Risk Employees',
        align: 'right',
        format: 'number',
      },
      { key: 'recommendedAction', label: 'Recommended Action' },
      { key: 'attendanceRiskLevel', label: 'Attendance Risk Level' },
    ],
    rows: shaped,
    note: `Projects each department by applying the org attendance trend delta over ${horizon} month(s). Threshold default ${threshold}%.`,
    summaryCards: [
      {
        key: 'atRisk',
        label: 'At / below threshold',
        value: shaped.filter((r) => String(r.attendanceRiskLevel).toLowerCase() !== 'low').length,
        format: 'number',
      },
      {
        key: 'high',
        label: 'High risk depts',
        value: shaped.filter((r) => String(r.attendanceRiskLevel).toLowerCase() === 'high').length,
        format: 'number',
      },
    ],
  };
};

/** Probation pipeline — upcoming ends (near-certain) for planning. */
export const runProbationPipeline: ReportRunner = async (filters) => {
  const days = Math.min(180, Math.max(30, Math.floor(Number(filters.daysAhead) || 90)));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const until = new Date(today);
  until.setDate(until.getDate() + days);

  const employees = await Employee.findAll({
    where: {
      status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] },
      probation_confirmed_at: { [Op.is]: null },
      ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
    },
    attributes: [
      'id',
      'employee_id',
      'first_name',
      'last_name',
      'department_id',
      'join_date',
      'probation_period_months',
      'status',
    ],
    limit: 3000,
  });

  const deptIds = [...new Set(employees.map((e) => str(e.get('department_id'))).filter(Boolean))];
  const depts = deptIds.length
    ? await Department.findAll({ where: { id: { [Op.in]: deptIds } } })
    : [];
  const deptName = new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));

  const rows: ReportRow[] = [];
  for (const e of employees) {
    const p = e.get({ plain: true }) as Record<string, unknown>;
    const join = new Date(str(p.join_date).slice(0, 10) + 'T12:00:00');
    if (Number.isNaN(join.getTime())) continue;
    const months = Math.max(0, Math.floor(num(p.probation_period_months, 3)));
    const end = new Date(join);
    end.setMonth(end.getMonth() + months);
    if (end < today || end > until) continue;
    const daysRemaining = Math.ceil((end.getTime() - today.getTime()) / 86400000);
    rows.push({
      employeeId: str(p.employee_id),
      name: [str(p.first_name), str(p.last_name)].filter(Boolean).join(' '),
      department: deptName.get(str(p.department_id)) || '',
      joinDate: str(p.join_date).slice(0, 10),
      probationMonths: months,
      expectedEnd: end.toISOString().slice(0, 10),
      daysRemaining,
      urgency: daysRemaining <= 14 ? 'Imminent' : daysRemaining <= 30 ? 'Soon' : 'Upcoming',
    });
  }

  rows.sort((a, b) => num(a.daysRemaining) - num(b.daysRemaining));

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'joinDate', label: 'Join date', format: 'date' },
      {
        key: 'probationMonths',
        label: 'Probation mo',
        align: 'right',
        format: 'number',
        aggregate: 'omit',
      },
      { key: 'expectedEnd', label: 'Expected end', format: 'date' },
      { key: 'daysRemaining', label: 'Days left', align: 'right', format: 'number', aggregate: 'avg' },
      { key: 'urgency', label: 'Urgency' },
    ],
    rows,
    note: `Unconfirmed probation ending within ${days} days. Use for review scheduling capacity.`,
    summaryCards: [
      {
        key: 'dueSoon',
        label: 'Due ≤14 days',
        value: rows.filter((r) => num(r.daysRemaining) <= 14).length,
        format: 'number',
      },
      {
        key: 'overdue',
        label: 'Overdue / past',
        value: rows.filter((r) => num(r.daysRemaining) < 0).length,
        format: 'number',
      },
    ],
  };
};

/** Seniority indemnity outlook for next Jun/Dec payout window. */
export const runSeniorityPayoutOutlook: ReportRunner = async (filters) => {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12
  let payoutMonth: string;
  if (filters.targetPayout === 'next_december') {
    payoutMonth = m <= 12 ? `${y}-12` : `${y + 1}-12`;
    if (m === 12 && today.getDate() > 15) payoutMonth = `${y + 1}-12`;
  } else if (filters.targetPayout === 'next_june') {
    payoutMonth = m < 6 ? `${y}-06` : `${y + 1}-06`;
  } else {
    // Next upcoming Jun or Dec
    payoutMonth = m < 6 ? `${y}-06` : m < 12 ? `${y}-12` : `${y + 1}-06`;
  }

  const employees = await Employee.findAll({
    where: {
      status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] },
      ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
    },
    attributes: [
      'id',
      'employee_id',
      'first_name',
      'last_name',
      'department_id',
      'contract_type',
      'employment_type',
      'join_date',
    ],
    limit: 5000,
  });

  const empPks = employees.map((e) => str(e.get('id')));
  const structures = empPks.length
    ? await SalaryStructure.findAll({
        where: { employee_id: { [Op.in]: empPks } },
        attributes: ['employee_id', 'base_salary'],
      })
    : [];
  const baseByEmp = new Map(
    structures.map((s) => [str(s.get('employee_id')), num(s.get('base_salary'))])
  );

  const deptIds = [...new Set(employees.map((e) => str(e.get('department_id'))).filter(Boolean))];
  const depts = deptIds.length
    ? await Department.findAll({ where: { id: { [Op.in]: deptIds } } })
    : [];
  const deptName = new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));

  const rows: ReportRow[] = [];
  let estTotal = 0;
  for (const e of employees) {
    const p = e.get({ plain: true }) as Record<string, unknown>;
    const contract = str(p.contract_type).toUpperCase();
    const empType = str(p.employment_type);
    const excluded = ['Intern', 'Consultant', 'Freelancer'].some(
      (t) => t.toLowerCase() === empType.toLowerCase()
    );
    const isFdc =
      contract === 'FDC' ||
      contract.includes('FIXED') ||
      empType === 'Contract' ||
      empType.toLowerCase().includes('fixed');
    if (excluded || isFdc) continue;

    const base = baseByEmp.get(str(p.id)) || 0;
    const daily = base / 26;
    const estPayout = round2(daily * 7.5);
    estTotal += estPayout;

    rows.push({
      employeeId: str(p.employee_id),
      name: [str(p.first_name), str(p.last_name)].filter(Boolean).join(' '),
      department: deptName.get(str(p.department_id)) || '',
      contractType: contract || empType || 'UDC*',
      joinDate: str(p.join_date).slice(0, 10),
      baseSalary: base,
      estDailyRate: round2(daily),
      estPayoutDays: 7.5,
      estIndemnityUsd: estPayout,
      targetPayoutMonth: payoutMonth,
    });
  }

  rows.sort((a, b) => num(b.estIndemnityUsd) - num(a.estIndemnityUsd));

  return {
    columns: [
      { key: 'employeeId', label: 'Employee ID' },
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'contractType', label: 'Contract' },
      { key: 'joinDate', label: 'Join date', format: 'date' },
      { key: 'baseSalary', label: 'Base', align: 'right', format: 'currency' },
      { key: 'estDailyRate', label: 'Est. daily', align: 'right', format: 'currency', aggregate: 'avg' },
      { key: 'estPayoutDays', label: 'Days', align: 'right', format: 'number', aggregate: 'omit' },
      { key: 'estIndemnityUsd', label: 'Est. indemnity', align: 'right', format: 'currency' },
      { key: 'targetPayoutMonth', label: 'Target month' },
    ],
    rows,
    note: `Rough estimate for ${payoutMonth}: 7.5 days × (base÷26). Excludes FDC/intern/consultant. Ignores semester wage averaging & policy salary basis — cash planning only. Est. total ≈ $${round2(estTotal).toLocaleString()}.`,
    summaryCards: [
      { key: 'eligible', label: 'Eligible employees', value: rows.length, format: 'number' },
      { key: 'estTotal', label: 'Est. total indemnity', value: round2(estTotal), format: 'currency' },
    ],
  };
};

/** OT hours & cost outlook. */
export const runOtCostOutlook: ReportRunner = async (filters) => {
  const range = lookbackRange(filters);
  const horizon = horizonMonths(filters);
  const otTrend = await buildMonthlyOvertimeTrend(range);
  const hoursSeries = otTrend.map((r) => num(r.hours));
  const hoursProj = projectNext(hoursSeries, horizon, { minZero: true });

  const employees = await Employee.findAll({
    where: { status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] } },
    attributes: ['id'],
    limit: 5000,
  });
  const empIds = employees.map((e) => str(e.get('id')));
  const structures = empIds.length
    ? await SalaryStructure.findAll({
        where: { employee_id: { [Op.in]: empIds } },
        attributes: ['base_salary'],
      })
    : [];
  const avgBase =
    structures.length > 0
      ? structures.reduce((s, e) => s + num(e.get('base_salary')), 0) / structures.length
      : 0;
  const hourly = avgBase / (26 * 8);
  const otMultiplier = 1.5;

  const rows: ReportRow[] = otTrend.map((r) => ({
    month: str(r.month),
    monthKey: str(r.monthKey),
    kind: 'Actual',
    otHours: num(r.hours),
    estCostUsd: round2(num(r.hours) * hourly * otMultiplier),
  }));

  const lastKey = otTrend.length
    ? str(otTrend[otTrend.length - 1].monthKey)
    : todayYmd().slice(0, 7);
  for (let i = 0; i < horizon; i++) {
    const mk = addMonthsKey(lastKey, i + 1);
    const h = round1(hoursProj[i]);
    rows.push({
      month: formatMonthLabel(mk),
      monthKey: mk,
      kind: 'Forecast',
      otHours: h,
      estCostUsd: round2(h * hourly * otMultiplier),
    });
  }

  const lastActualHours = otTrend.length ? num(otTrend[otTrend.length - 1].hours) : 0;
  const lastActualCost = round2(lastActualHours * hourly * otMultiplier);
  const deptFilter = filters.departmentId || '';
  const deptName = deptFilter
    ? (
        await Department.findByPk(deptFilter, { attributes: ['name'] })
      )?.get('name')
    : 'All departments';

  const shaped: ReportRow[] = [];
  for (let i = 0; i < horizon; i++) {
    const mk = addMonthsKey(lastKey, i + 1);
    const h = round1(hoursProj[i]);
    const cost = round2(h * hourly * otMultiplier);
    const prevH = i === 0 ? lastActualHours : round1(hoursProj[i - 1]);
    const growth = prevH > 0 ? round1(((h - prevH) / prevH) * 100) : 0;
    const risk = growth >= 15 || h > lastActualHours * 1.25 ? 'High' : growth >= 8 ? 'Medium' : 'Low';
    shaped.push({
      reportMonth: formatMonthLabel(mk),
      department: str(deptName) || 'All departments',
      currentOtHours: lastActualHours,
      forecastOtHours: h,
      otGrowthRate: growth,
      currentOtCost: lastActualCost,
      forecastOtCost: cost,
      employeesWithOt: Math.max(1, Math.round(h / Math.max(4, lastActualHours / Math.max(1, structures.length || 1)))),
      otReason: growth > 0 ? 'Projected volume increase' : 'Stable / declining volume',
      recommendedAction:
        risk === 'High'
          ? 'Review staffing and OT approval policy'
          : risk === 'Medium'
            ? 'Monitor department OT approvals'
            : 'Maintain current controls',
      otRiskLevel: risk,
    });
  }

  if (otTrend.length) {
    shaped.unshift({
      reportMonth: str(otTrend[otTrend.length - 1].month),
      department: str(deptName) || 'All departments',
      currentOtHours: lastActualHours,
      forecastOtHours: lastActualHours,
      otGrowthRate: 0,
      currentOtCost: lastActualCost,
      forecastOtCost: lastActualCost,
      employeesWithOt: Math.max(0, Math.round(structures.length * 0.15)),
      otReason: 'Actual lookback baseline',
      recommendedAction: 'Baseline — no action',
      otRiskLevel: 'Low',
    });
  }

  return {
    columns: [
      { key: 'reportMonth', label: 'Report Month' },
      { key: 'department', label: 'Department' },
      { key: 'currentOtHours', label: 'Current OT Hours', align: 'right', format: 'number', aggregate: 'omit' },
      { key: 'forecastOtHours', label: 'Forecast OT Hours', align: 'right', format: 'number' },
      {
        key: 'otGrowthRate',
        label: 'OT Growth Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'currentOtCost', label: 'Current OT Cost', align: 'right', format: 'currency', aggregate: 'omit' },
      { key: 'forecastOtCost', label: 'Forecast OT Cost', align: 'right', format: 'currency' },
      { key: 'employeesWithOt', label: 'Employees with OT', align: 'right', format: 'number', aggregate: 'avg' },
      { key: 'otReason', label: 'OT Reason' },
      { key: 'recommendedAction', label: 'Recommended Action' },
      { key: 'otRiskLevel', label: 'OT Risk Level' },
    ],
    rows: shaped,
    note: `Cost ≈ hours × (avg base÷208) × 1.5. Avg base $${round2(avgBase)}. Planning estimate — actual OT uses configured rate tiers.`,
    summaryCards: [
      {
        key: 'fcHours',
        label: 'Forecast OT hours',
        value: round1(shaped.filter((r) => num(r.otGrowthRate) !== 0 || shaped.length === 1).reduce((s, r) => s + num(r.forecastOtHours), 0)),
        format: 'number',
      },
      {
        key: 'fcCost',
        label: 'Forecast OT cost',
        value: round2(shaped.reduce((s, r) => s + num(r.forecastOtCost), 0)),
        format: 'currency',
      },
    ],
  };
};
