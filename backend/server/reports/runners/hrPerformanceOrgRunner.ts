import { Op } from 'sequelize';
import { Department, Employee, PayrollRun, Payslip, PayslipBreakdown, Position } from '../../db.js';
import { reportConsecutiveAbsenceAlerts } from '../../payroll/abandonmentReports.js';
import { buildOrganizationAnalytics } from '../../organizationAnalyticsService.js';
import type { ReportColumn, ReportRunner, ReportRow } from '../reportTypes.js';
import { num, resolveDateRangeFromFilters, round2, str } from '../reportFilterUtils.js';
import { todayYmd } from '../../dashboardDateRange.js';

function riskFromRate(absenceRate: number): string {
  if (absenceRate >= 15) return 'High';
  if (absenceRate >= 8) return 'Medium';
  return 'Low';
}

function hrRiskFromKpis(turnover: number, attendance: number): string {
  if (turnover >= 10 || attendance < 85) return 'High';
  if (turnover >= 5 || attendance < 90) return 'Medium';
  return 'Low';
}

/** Absence Risk Report — department roll-up of consecutive-absence cases. */
export const runAbandonmentAbsenceAlerts: ReportRunner = async (filters) => {
  const hasRange = Boolean(filters.startDate && filters.endDate);
  const range = hasRange
    ? resolveDateRangeFromFilters(filters)
    : { startDate: `${todayYmd().slice(0, 4)}-01-01`, endDate: todayYmd() };
  const periodLabel = `${range.startDate} → ${range.endDate}`;

  const cases = await reportConsecutiveAbsenceAlerts();
  const empPks = [
    ...new Set(
      cases
        .map((c) => {
          const p = c as Record<string, unknown>;
          return str(p.employee_id || p.employeeId);
        })
        .filter(Boolean)
    ),
  ];
  const employees = empPks.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: empPks } },
        attributes: ['id', 'employee_id', 'department_id', 'first_name', 'last_name'],
      })
    : [];
  const empByPk = new Map(
    employees.map((e) => [str(e.get('id')), e.get({ plain: true }) as Record<string, unknown>])
  );
  const deptIds = [...new Set(employees.map((e) => str(e.get('department_id'))).filter(Boolean))];
  const depts = deptIds.length
    ? await Department.findAll({ where: { id: { [Op.in]: deptIds } } })
    : [];
  const deptName = new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));

  const activeByDept = new Map<string, number>();
  const allActive = await Employee.findAll({
    attributes: ['department_id', 'status'],
    where: { status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] } },
    limit: 8000,
  });
  for (const e of allActive) {
    const id = str(e.get('department_id')) || '_none';
    activeByDept.set(id, (activeByDept.get(id) || 0) + 1);
  }

  type Bucket = {
    department: string;
    cases: number;
    days: number;
    statuses: Set<string>;
  };
  const map = new Map<string, Bucket>();

  for (const c of cases) {
    const p = c as Record<string, unknown>;
    const empPk = str(p.employee_id || p.employeeId);
    const emp = empByPk.get(empPk);
    const deptId = emp ? str(emp.department_id) : '_none';
    const flaggedAt = str(p.flaggedAt || p.flagged_at).slice(0, 10);
    if (flaggedAt && (flaggedAt < range.startDate || flaggedAt > range.endDate)) continue;

    const bucket = map.get(deptId) || {
      department: emp ? deptName.get(deptId) || deptId : '(No department)',
      cases: 0,
      days: 0,
      statuses: new Set(),
    };
    bucket.cases += 1;
    bucket.days += num(p.consecutiveAbsenceDays || p.consecutive_absence_days);
    bucket.statuses.add(str(p.caseStatus || p.case_status) || 'OPEN');
    map.set(deptId, bucket);
  }

  const rows: ReportRow[] = [...map.entries()].map(([deptId, b]) => {
    const hc = activeByDept.get(deptId) || 0;
    const absenceRate = hc > 0 ? Math.round((b.cases / hc) * 1000) / 10 : 0;
    const statuses = [...b.statuses];
    return {
      reportPeriod: periodLabel,
      department: b.department,
      absenceCases: b.cases,
      absenceDays: Math.round(b.days * 10) / 10,
      absenceRate,
      riskLevel: riskFromRate(absenceRate),
      actionStatus: statuses.length ? statuses.join(', ') : '—',
    };
  });

  rows.sort((a, b) => num(b.absenceCases) - num(a.absenceCases));

  return {
    columns: [
      { key: 'reportPeriod', label: 'Report Period', aggregate: 'omit' },
      { key: 'department', label: 'Department' },
      { key: 'absenceCases', label: 'Absence Cases', align: 'right', format: 'number' },
      { key: 'absenceDays', label: 'Absence Days', align: 'right', format: 'number' },
      {
        key: 'absenceRate',
        label: 'Absence Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'riskLevel', label: 'Risk Level' },
      { key: 'actionStatus', label: 'Action Status' },
    ],
    rows,
    note: `Open abandonment / consecutive-absence cases flagged in ${periodLabel}. Absence rate = cases ÷ department headcount.`,
    summaryCards: [
      {
        key: 'cases',
        label: 'Absence Cases',
        value: rows.reduce((s, r) => s + num(r.absenceCases), 0),
        format: 'number',
      },
      {
        key: 'high',
        label: 'High risk depts',
        value: rows.filter((r) => String(r.riskLevel) === 'High').length,
        format: 'number',
      },
    ],
  };
};

/** Monthly Workforce KPI. */
export const runOrgMonthlyKpis: ReportRunner = async (filters) => {
  const range = resolveDateRangeFromFilters(filters);
  const analytics = await buildOrganizationAnalytics(range);
  const charts = analytics.charts || {};

  const openPositions = await Position.count({
    where: { isActive: { [Op.ne]: false } },
  });

  const runs = await PayrollRun.findAll({
    order: [['createdAt', 'DESC']],
    limit: 36,
  });
  const payrollByMonth = new Map<string, number>();
  for (const run of runs) {
    const month = str(run.get('month')).slice(0, 7);
    if (!month || payrollByMonth.has(month)) continue;
    const payslips = await Payslip.findAll({
      where: { payrollRunId: str(run.get('id')) },
      attributes: ['id'],
      limit: 5000,
    });
    const payslipIds = payslips.map((p) => str(p.get('id'))).filter(Boolean);
    if (!payslipIds.length) {
      payrollByMonth.set(month, 0);
      continue;
    }
    const breakdowns = await PayslipBreakdown.findAll({
      where: { payslipId: { [Op.in]: payslipIds } },
      attributes: ['grossSalary'],
    });
    const gross = breakdowns.reduce((s, b) => s + num(b.get('grossSalary')), 0);
    payrollByMonth.set(month, round2(gross));
  }

  const employees = await Employee.findAll({
    attributes: ['join_date', 'terminated_at', 'status', 'created_at'],
    limit: 8000,
  });

  const byMonth = new Map<string, ReportRow>();
  const ensure = (monthKey: string, monthLabel: string) => {
    let row = byMonth.get(monthKey);
    if (!row) {
      row = {
        monthKey,
        reportMonth: monthLabel || monthKey,
        totalHeadcount: 0,
        newHires: 0,
        separations: 0,
        turnoverRate: 0,
        attendanceRate: 0,
        totalLeaveDays: 0,
        overtimeHours: 0,
        totalPayrollCost: payrollByMonth.get(monthKey) || 0,
        openPositions,
        hrRiskLevel: 'Low',
      };
      byMonth.set(monthKey, row);
    }
    return row;
  };

  for (const row of charts.monthlyAttendanceRate || []) {
    const r = ensure(str(row.monthKey), str(row.month));
    r.attendanceRate = num(row.attendanceRatePct ?? row.ratePct);
  }
  for (const row of charts.monthlyLeaveUsage || []) {
    const r = ensure(str(row.monthKey), str(row.month));
    r.totalLeaveDays = num(row.days);
  }
  for (const row of charts.monthlyOvertimeHours || []) {
    const r = ensure(str(row.monthKey), str(row.month));
    r.overtimeHours = num(row.hours);
  }
  for (const row of charts.monthlySeparations || []) {
    const r = ensure(str(row.monthKey), str(row.month));
    r.separations = num(row.count);
  }

  // New hires + approximate headcount at month end from join/term dates
  for (const [monthKey, row] of byMonth) {
    const y = Number(monthKey.slice(0, 4));
    const m = Number(monthKey.slice(5, 7));
    const start = `${monthKey}-01`;
    const end = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    let hires = 0;
    let hc = 0;
    for (const e of employees) {
      const join = str(e.get('join_date')).slice(0, 10);
      const term = str(e.get('terminated_at')).slice(0, 10);
      const status = str(e.get('status')).toLowerCase();
      if (join && join >= start && join <= end) hires += 1;
      const joinedByEnd = !join || join <= end;
      const stillActive =
        (!term || term > end) &&
        (status === 'active' || status === 'probation' || !term);
      // Approximate: count if joined on/before end and not terminated on/before end
      if (joinedByEnd && (!term || term > end)) {
        if (status === 'active' || status === 'probation' || status === 'terminated' || status === 'resigned' || status === 'absconded') {
          // If currently separated but term after end, or currently active
          if (!term || term > end) hc += 1;
        }
      }
      void stillActive;
    }
    // Simpler headcount: active/probation now as proxy when month is current; else join-based estimate
    row.newHires = hires;
    row.totalHeadcount = hc || num(row.totalHeadcount);
    const denom = num(row.totalHeadcount) || 1;
    row.turnoverRate =
      Math.round((num(row.separations) / denom) * 1000) / 10;
    row.hrRiskLevel = hrRiskFromKpis(num(row.turnoverRate), num(row.attendanceRate));
    if (!row.totalPayrollCost) row.totalPayrollCost = payrollByMonth.get(monthKey) || 0;
  }

  // Fallback headcount: current active count on latest month if all zero
  const activeNow = await Employee.count({
    where: { status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] } },
  });
  const rows = [...byMonth.values()]
    .map((r) => {
      if (!num(r.totalHeadcount)) r.totalHeadcount = activeNow;
      const denom = num(r.totalHeadcount) || 1;
      r.turnoverRate = Math.round((num(r.separations) / denom) * 1000) / 10;
      r.hrRiskLevel = hrRiskFromKpis(num(r.turnoverRate), num(r.attendanceRate));
      return r;
    })
    .sort((a, b) => str(a.monthKey).localeCompare(str(b.monthKey)));

  return {
    columns: [
      { key: 'reportMonth', label: 'Report Month' },
      { key: 'totalHeadcount', label: 'Total Headcount', align: 'right', format: 'number', aggregate: 'omit' },
      { key: 'newHires', label: 'New Hires', align: 'right', format: 'number' },
      { key: 'separations', label: 'Separations', align: 'right', format: 'number' },
      {
        key: 'turnoverRate',
        label: 'Turnover Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      {
        key: 'attendanceRate',
        label: 'Attendance Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
      { key: 'totalLeaveDays', label: 'Total Leave Days', align: 'right', format: 'number' },
      { key: 'overtimeHours', label: 'Overtime Hours', align: 'right', format: 'number' },
      {
        key: 'totalPayrollCost',
        label: 'Total Payroll Cost',
        align: 'right',
        format: 'currency',
      },
      {
        key: 'openPositions',
        label: 'Open Positions',
        align: 'right',
        format: 'number',
        aggregate: 'omit',
      },
      { key: 'hrRiskLevel', label: 'HR Risk Level' },
    ] satisfies ReportColumn[],
    rows,
    note: analytics.period
      ? `Period ${analytics.period.startDate} → ${analytics.period.endDate}. Open positions = active position records.`
      : 'Open positions = active position records.',
    summaryCards: [
      { key: 'months', label: 'Months', value: rows.length, format: 'number' },
      {
        key: 'hires',
        label: 'New Hires (sum)',
        value: rows.reduce((s, r) => s + num(r.newHires), 0),
        format: 'number',
      },
      {
        key: 'sep',
        label: 'Separations (sum)',
        value: rows.reduce((s, r) => s + num(r.separations), 0),
        format: 'number',
      },
    ],
  };
};
