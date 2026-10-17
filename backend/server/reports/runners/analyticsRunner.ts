import { Op } from 'sequelize';
import {
  Department,
  Employee,
  LeaveRequest,
  LeaveType,
  OvertimeRequest,
  SalaryStructure,
  User,
} from '../../db.js';
import { leaveOverlapDaysInRange } from '../../leaveDuration.js';
import {
  listHistoricalSalaryChanges,
} from '../../payroll/historicalRecordsService.js';
import type { ReportColumn, ReportRunner, ReportRow } from '../reportTypes.js';
import { num, resolveDateRangeFromFilters, round2, str, toYmd } from '../reportFilterUtils.js';

async function loadDeptNameMap(deptIds: string[]) {
  const ids = [...new Set(deptIds.filter(Boolean))];
  if (!ids.length) return new Map<string, string>();
  const depts = await Department.findAll({ where: { id: { [Op.in]: ids } } });
  return new Map(depts.map((d) => [str(d.get('id')), str(d.get('name'))]));
}

async function userEmployeeMaps() {
  const users = await User.findAll({
    attributes: ['id', 'employeeId', 'display_name', 'email'],
    limit: 10000,
  });
  const empPks = users.map((u) => str(u.get('employeeId'))).filter(Boolean);
  const employees = empPks.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: empPks } },
        attributes: ['id', 'employee_id', 'department_id', 'first_name', 'last_name'],
      })
    : [];
  const empByPk = new Map(
    employees.map((e) => [str(e.get('id')), e.get({ plain: true }) as Record<string, unknown>])
  );
  const deptName = await loadDeptNameMap(
    employees.map((e) => str(e.get('department_id')))
  );

  const byUserId = new Map<
    string,
    { departmentId: string; department: string; employeePk: string }
  >();
  for (const u of users) {
    const emp = empByPk.get(str(u.get('employeeId')));
    const departmentId = emp ? str(emp.department_id) : '';
    byUserId.set(str(u.get('id')), {
      departmentId,
      department: deptName.get(departmentId) || '(No department)',
      employeePk: emp ? str(emp.id) : '',
    });
  }
  return byUserId;
}

function tenureBand(joinDate: unknown, asOf = new Date()): string {
  const ymd = toYmd(joinDate);
  if (!ymd) return 'Unknown';
  const join = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(join.getTime())) return 'Unknown';
  const years = (asOf.getTime() - join.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 0) return 'Unknown';
  if (years < 1) return '< 1 year';
  if (years < 3) return '1–3 years';
  if (years < 5) return '3–5 years';
  return '5+ years';
}

function contractLabel(raw: unknown): string {
  const v = str(raw).trim();
  if (!v) return 'Not set';
  const upper = v.toUpperCase();
  if (upper === 'UDC' || upper === 'PERMANENT') return 'UDC / Permanent';
  if (upper === 'FDC' || upper === 'FIXED' || upper === 'FIXED-TERM' || upper === 'FIXED_TERM') {
    return 'FDC / Fixed-term';
  }
  return v;
}

function employmentLabel(raw: unknown): string {
  const v = str(raw).trim();
  return v || 'Not set';
}

/** Stable report column key for a leave type id / fallback name. */
function leaveTypeColumnKey(typeIdOrName: string): string {
  const safe = str(typeIdOrName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `lt_${safe || 'unknown'}`;
}

async function activeHeadcountByDept(departmentId?: string) {
  const employees = await Employee.findAll({
    attributes: ['id', 'department_id', 'status'],
    where: departmentId ? { department_id: departmentId } : undefined,
    limit: 8000,
  });
  const deptName = await loadDeptNameMap(employees.map((e) => str(e.get('department_id'))));
  const map = new Map<string, { department: string; headcount: number }>();
  for (const e of employees) {
    const status = str(e.get('status')).toLowerCase();
    if (status !== 'active' && status !== 'probation') continue;
    const deptId = str(e.get('department_id')) || '_none';
    const bucket = map.get(deptId) || {
      department: deptId === '_none' ? '(No department)' : deptName.get(deptId) || deptId,
      headcount: 0,
    };
    bucket.headcount += 1;
    map.set(deptId, bucket);
  }
  return map;
}

/** Leave report — by department; columns come from the live Leave Type catalog. */
export const runLeaveUtilization: ReportRunner = async (filters) => {
  const range = resolveDateRangeFromFilters(filters);
  const leaves = await LeaveRequest.findAll({
    where: {
      status: 'APPROVED',
      [Op.and]: [
        { startDate: { [Op.lte]: range.endDate } },
        { endDate: { [Op.gte]: range.startDate } },
      ],
    },
    limit: 10000,
  });
  const users = await userEmployeeMaps();
  // Always read the current leave-type list so newly added types appear as columns
  // on the next run — no hardcoded Annual/Sick/Other buckets.
  const types = await LeaveType.findAll({
    order: [
      ['name', 'ASC'],
      ['code', 'ASC'],
    ],
  });

  type LeaveTypeMeta = { id: string; name: string; columnKey: string; isActive: boolean };
  const typeById = new Map<string, LeaveTypeMeta>();
  const typeByName = new Map<string, LeaveTypeMeta>();
  /** Stable catalog order: every active leave type, including types added later. */
  const activeCatalog: LeaveTypeMeta[] = [];

  for (const t of types) {
    const id = str(t.get('id'));
    const name = str(t.get('name')).trim() || id || 'Unknown';
    const isActive = t.get('isActive') !== false && t.get('isActive') !== 0;
    const meta: LeaveTypeMeta = {
      id: id || leaveTypeColumnKey(name),
      name,
      columnKey: leaveTypeColumnKey(id || name),
      isActive,
    };
    if (id) typeById.set(id, meta);
    typeByName.set(name.toLowerCase(), meta);
    const code = str(t.get('code')).trim();
    if (code) typeByName.set(code.toLowerCase(), meta);
    if (isActive) activeCatalog.push(meta);
  }

  const resolveLeaveType = (rawType: string): LeaveTypeMeta => {
    const raw = str(rawType).trim();
    if (!raw) {
      return {
        id: 'unknown',
        name: 'Unknown',
        columnKey: leaveTypeColumnKey('unknown'),
        isActive: false,
      };
    }
    return (
      typeById.get(raw) ||
      typeByName.get(raw.toLowerCase()) || {
        id: raw,
        name: raw,
        columnKey: leaveTypeColumnKey(raw),
        isActive: false,
      }
    );
  };

  const headcounts = await activeHeadcountByDept(filters.departmentId || undefined);

  type Bucket = {
    department: string;
    employeesOnLeave: Set<string>;
    daysByType: Map<string, number>;
  };
  const map = new Map<string, Bucket>();
  /** columnKey → display name. Start with all active catalog types. */
  const catalogByKey = new Map<string, string>();
  for (const meta of activeCatalog) {
    catalogByKey.set(meta.columnKey, meta.name);
  }

  for (const [deptId, hc] of headcounts) {
    map.set(deptId, {
      department: hc.department,
      employeesOnLeave: new Set(),
      daysByType: new Map(),
    });
  }

  for (const leave of leaves) {
    const p = leave.get({ plain: true }) as Record<string, unknown>;
    const meta = users.get(str(p.userId));
    if (!meta) continue;
    if (filters.departmentId && meta.departmentId !== filters.departmentId) continue;
    const leaveType = resolveLeaveType(str(p.type));
    const days = leaveOverlapDaysInRange(
      {
        startDate: str(p.startDate),
        endDate: str(p.endDate),
        isHalfDay: Boolean(p.isHalfDay),
        halfDayPeriod: str(p.halfDayPeriod) || null,
      },
      range.startDate,
      range.endDate
    );
    if (days <= 0) continue;
    const key = meta.departmentId || '_none';
    const bucket = map.get(key) || {
      department: meta.department,
      employeesOnLeave: new Set(),
      daysByType: new Map(),
    };
    bucket.employeesOnLeave.add(meta.employeePk || str(p.userId));
    bucket.daysByType.set(
      leaveType.columnKey,
      (bucket.daysByType.get(leaveType.columnKey) || 0) + days
    );
    // Keep inactive / legacy labels visible when they still have usage in-range.
    if (!catalogByKey.has(leaveType.columnKey)) {
      catalogByKey.set(leaveType.columnKey, leaveType.name);
    }
    map.set(key, bucket);
  }

  // Active catalog types first (DB name order), then any orphan usage-only types A–Z.
  const activeKeys = new Set(activeCatalog.map((t) => t.columnKey));
  const orderedLeaveTypes = [
    ...activeCatalog.map((t) => ({ columnKey: t.columnKey, name: t.name })),
    ...[...catalogByKey.entries()]
      .filter(([columnKey]) => !activeKeys.has(columnKey))
      .map(([columnKey, name]) => ({ columnKey, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  ];

  const rows: ReportRow[] = [...map.entries()]
    .map(([deptId, b]) => {
      const headcount = headcounts.get(deptId)?.headcount || 0;
      const onLeave = b.employeesOnLeave.size;
      const row: ReportRow = {
        department: b.department,
        currentHeadcount: headcount,
        employeesOnLeave: onLeave,
        leaveRatePct: headcount > 0 ? Math.round((onLeave / headcount) * 1000) / 10 : 0,
      };
      let leaveDaysTotal = 0;
      for (const { columnKey } of orderedLeaveTypes) {
        const days = Math.round((b.daysByType.get(columnKey) || 0) * 100) / 100;
        row[columnKey] = days;
        leaveDaysTotal += days;
      }
      return { row, leaveDaysTotal };
    })
    .filter(
      ({ row, leaveDaysTotal }) =>
        num(row.currentHeadcount) > 0 ||
        num(row.employeesOnLeave) > 0 ||
        leaveDaysTotal > 0
    )
    .sort((a, b) => String(a.row.department).localeCompare(String(b.row.department)))
    .map(({ row }) => row);

  const leaveTypeDayTotals = orderedLeaveTypes.map(({ columnKey, name }) => {
    const total =
      Math.round(rows.reduce((s, r) => s + num(r[columnKey]), 0) * 100) / 100;
    return { columnKey, name, total };
  });
  const totalLeaveDays =
    Math.round(leaveTypeDayTotals.reduce((s, t) => s + t.total, 0) * 100) / 100;

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'currentHeadcount', label: 'Current Headcount', align: 'right', format: 'number' },
      { key: 'employeesOnLeave', label: 'Employees on Leave', align: 'right', format: 'number' },
      ...orderedLeaveTypes.map(
        ({ columnKey, name }) =>
          ({
            key: columnKey,
            label: name,
            align: 'right',
            format: 'number',
          }) satisfies ReportColumn
      ),
      {
        key: 'leaveRatePct',
        label: 'Leave Rate (%)',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
    ] satisfies ReportColumn[],
    rows,
    note: `Approved leave overlapping ${range.startDate} → ${range.endDate}. Columns mirror active Leave Types (plus any legacy types used in this period). Leave rate = employees on leave ÷ headcount.`,
    summaryCards: [
      {
        key: 'onLeave',
        label: 'Employees on leave',
        value: rows.reduce((s, r) => s + num(r.employeesOnLeave), 0),
        format: 'number',
      },
      {
        key: 'totalDays',
        label: 'Total leave days',
        value: totalLeaveDays,
        format: 'number',
      },
      ...leaveTypeDayTotals.map(({ columnKey, name, total }) => ({
        key: columnKey,
        label: `${name} days`,
        value: total,
        format: 'number' as const,
      })),
    ],
  };
};

/** OT report — by department. */
export const runOtByDepartment: ReportRunner = async (filters) => {
  const range = resolveDateRangeFromFilters(filters);
  const ots = await OvertimeRequest.findAll({
    where: {
      status: 'APPROVED',
      workDate: { [Op.between]: [range.startDate, range.endDate] },
    },
    limit: 5000,
  });
  const users = await userEmployeeMaps();
  const structures = await SalaryStructure.findAll({
    attributes: ['employee_id', 'base_salary'],
    limit: 5000,
  });
  const baseByEmp = new Map(
    structures.map((s) => [str(s.get('employee_id')), num(s.get('base_salary'))])
  );
  const bases = [...baseByEmp.values()].filter((n) => n > 0);
  const avgBase = bases.length ? bases.reduce((a, b) => a + b, 0) / bases.length : 0;
  const otMultiplier = 1.5;
  const headcounts = await activeHeadcountByDept(filters.departmentId || undefined);

  type Bucket = {
    department: string;
    employees: Set<string>;
    hours: number;
    cost: number;
  };
  const map = new Map<string, Bucket>();
  for (const [deptId, hc] of headcounts) {
    map.set(deptId, {
      department: hc.department,
      employees: new Set(),
      hours: 0,
      cost: 0,
    });
  }

  for (const ot of ots) {
    const p = ot.get({ plain: true }) as Record<string, unknown>;
    const meta = users.get(str(p.userId));
    if (!meta) continue;
    if (filters.departmentId && meta.departmentId !== filters.departmentId) continue;
    const hours = num(p.hours);
    const empBase = baseByEmp.get(meta.employeePk) || avgBase;
    const empHourly = empBase / (26 * 8);
    const cost = hours * empHourly * otMultiplier;
    const key = meta.departmentId || '_none';
    const bucket = map.get(key) || {
      department: meta.department,
      employees: new Set(),
      hours: 0,
      cost: 0,
    };
    bucket.employees.add(meta.employeePk || str(p.userId));
    bucket.hours += hours;
    bucket.cost += cost;
    map.set(key, bucket);
  }

  const rows: ReportRow[] = [...map.entries()]
    .map(([deptId, b]) => {
      const headcount = headcounts.get(deptId)?.headcount || 0;
      const withOt = b.employees.size;
      return {
        department: b.department,
        currentHeadcount: headcount,
        employeesWithOt: withOt,
        totalOtHours: Math.round(b.hours * 100) / 100,
        averageOtHours: withOt > 0 ? Math.round((b.hours / withOt) * 100) / 100 : 0,
        otCost: round2(b.cost),
      };
    })
    .filter((r) => num(r.currentHeadcount) > 0 || num(r.employeesWithOt) > 0)
    .sort((a, b) => String(a.department).localeCompare(String(b.department)));

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'currentHeadcount', label: 'Current Headcount', align: 'right', format: 'number' },
      { key: 'employeesWithOt', label: 'Employees with OT', align: 'right', format: 'number' },
      { key: 'totalOtHours', label: 'Total OT Hours', align: 'right', format: 'number' },
      {
        key: 'averageOtHours',
        label: 'Average OT Hours',
        align: 'right',
        format: 'number',
        aggregate: 'avg',
      },
      { key: 'otCost', label: 'OT Cost', align: 'right', format: 'currency' },
    ],
    rows,
    note: `Cost ≈ hours × (employee base÷208) × 1.5. Avg base $${round2(avgBase)}.`,
    summaryCards: [
      {
        key: 'hours',
        label: 'Total OT Hours',
        value: Math.round(rows.reduce((s, r) => s + num(r.totalOtHours), 0) * 100) / 100,
        format: 'number',
      },
      {
        key: 'cost',
        label: 'OT Cost',
        value: round2(rows.reduce((s, r) => s + num(r.otCost), 0)),
        format: 'currency',
      },
      {
        key: 'emps',
        label: 'Employees with OT',
        value: rows.reduce((s, r) => s + num(r.employeesWithOt), 0),
        format: 'number',
      },
    ],
  };
};

/** Leaving by Department (attendance) — catalog still uses attrition-by-department id. */
export const runAttritionByDepartment: ReportRunner = async (filters) => {
  const { runLeavingByDepartment } = await import('./attendanceLeaveOtRunner.js');
  return runLeavingByDepartment(filters);
};

/** Contract / employment type / tenure mix with avg base. */
export const runWorkforceComposition: ReportRunner = async (filters) => {
  const where: Record<string, unknown> = {
    status: { [Op.in]: ['active', 'Active', 'probation', 'PROBATION'] },
  };
  if (filters.departmentId) where.department_id = filters.departmentId;

  const employees = await Employee.findAll({
    where,
    attributes: [
      'id',
      'department_id',
      'employment_type',
      'contract_type',
      'join_date',
      'status',
    ],
    limit: 5000,
  });
  const structures = await SalaryStructure.findAll({
    attributes: ['employee_id', 'base_salary'],
    limit: 5000,
  });
  const baseByEmp = new Map(
    structures.map((s) => [str(s.get('employee_id')), num(s.get('base_salary'))])
  );

  type Comp = { headcount: number; salarySum: number };
  const buckets = new Map<string, Comp & { dimension: string; label: string }>();

  const bump = (dimension: string, label: string, salary: number) => {
    const key = `${dimension}||${label}`;
    const cur = buckets.get(key) || { dimension, label, headcount: 0, salarySum: 0 };
    cur.headcount += 1;
    cur.salarySum += salary;
    buckets.set(key, cur);
  };

  for (const e of employees) {
    const pk = str(e.get('id'));
    const salary = baseByEmp.get(pk) || 0;
    const employment = employmentLabel(e.get('employment_type'));
    const contract = contractLabel(e.get('contract_type'));
    const tenure = tenureBand(e.get('join_date'));
    bump('Employment type', employment, salary);
    bump('Contract', contract, salary);
    bump('Tenure', tenure, salary);
  }

  const dimOrder = ['Employment type', 'Contract', 'Tenure'];
  const rows: ReportRow[] = [...buckets.values()]
    .map((b) => ({
      dimension: b.dimension,
      label: b.label,
      headcount: b.headcount,
      avgBaseSalary: b.headcount ? round2(b.salarySum / b.headcount) : 0,
      sharePct: employees.length
        ? Math.round((b.headcount / employees.length) * 1000) / 10
        : 0,
    }))
    .sort(
      (a, b) =>
        dimOrder.indexOf(String(a.dimension)) - dimOrder.indexOf(String(b.dimension)) ||
        num(b.headcount) - num(a.headcount)
    );

  return {
    columns: [
      { key: 'dimension', label: 'Dimension' },
      { key: 'label', label: 'Label' },
      { key: 'headcount', label: 'Headcount', align: 'right', format: 'number', aggregate: 'omit' },
      {
        key: 'avgBaseSalary',
        label: 'Avg base',
        align: 'right',
        format: 'currency',
        aggregate: 'omit',
      },
      {
        key: 'sharePct',
        label: 'Share %',
        align: 'right',
        format: 'percent',
        aggregate: 'omit',
      },
    ],
    rows,
    totalsRow: {
      dimension: 'Total',
      label: 'Active / probation',
      headcount: employees.length,
      avgBaseSalary: employees.length
        ? round2(
            employees.reduce((s, e) => s + (baseByEmp.get(str(e.get('id'))) || 0), 0) /
              employees.length
          )
        : 0,
      sharePct: 100,
    },
    note:
      'Active and probation only. Each dimension is a separate breakdown (rows under Employment type sum to 100%, separately from Contract and Tenure). Tenure uses join date. Contract “Not set” means employees.contract_type is empty.',
    summaryCards: [
      { key: 'hc', label: 'Active / probation', value: employees.length, format: 'number' },
      {
        key: 'avg',
        label: 'Avg base',
        value: employees.length
          ? round2(
              employees.reduce((s, e) => s + (baseByEmp.get(str(e.get('id'))) || 0), 0) /
                employees.length
            )
          : 0,
        format: 'currency',
      },
      {
        key: 'tenureUnknown',
        label: 'Missing join date',
        value: employees.filter((e) => !toYmd(e.get('join_date'))).length,
        format: 'number',
      },
      {
        key: 'contractBlank',
        label: 'Contract not set',
        value: employees.filter((e) => !str(e.get('contract_type')).trim()).length,
        format: 'number',
      },
    ],
  };
};

/** Salary change analytics by department (not a history dump). */
export const runSalaryMovementSummary: ReportRunner = async (filters) => {
  const range = resolveDateRangeFromFilters(filters);
  const changes = await listHistoricalSalaryChanges(500);
  const start = range.startDate;
  const end = range.endDate;

  const empPks = [...new Set(changes.map((c) => str(c.employeePk)).filter(Boolean))];
  const employees = empPks.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: empPks } },
        attributes: ['id', 'department_id'],
      })
    : [];
  const empDept = new Map(employees.map((e) => [str(e.get('id')), str(e.get('department_id'))]));
  const deptName = await loadDeptNameMap([...empDept.values()]);

  type Bucket = {
    department: string;
    changes: number;
    pctSum: number;
    pctCount: number;
    raises: number;
    cuts: number;
  };
  const map = new Map<string, Bucket>();

  for (const c of changes) {
    const effective = str(c.effectiveFrom).slice(0, 10);
    if (!effective || effective < start || effective > end) continue;
    const deptId = empDept.get(str(c.employeePk)) || '';
    if (filters.departmentId && deptId !== filters.departmentId) continue;
    const prev = num(c.previousBaseSalary);
    const next = num(c.baseSalary);
    const pct = prev > 0 ? ((next - prev) / prev) * 100 : 0;
    const key = deptId || '_none';
    const bucket = map.get(key) || {
      department: deptId ? deptName.get(deptId) || deptId : '(No department)',
      changes: 0,
      pctSum: 0,
      pctCount: 0,
      raises: 0,
      cuts: 0,
    };
    bucket.changes += 1;
    if (prev > 0) {
      bucket.pctSum += pct;
      bucket.pctCount += 1;
    }
    if (next > prev) bucket.raises += 1;
    else if (next < prev) bucket.cuts += 1;
    map.set(key, bucket);
  }

  const rows: ReportRow[] = [...map.values()]
    .map((b) => ({
      department: b.department,
      changes: b.changes,
      raises: b.raises,
      cuts: b.cuts,
      avgChangePct:
        b.pctCount > 0 ? Math.round((b.pctSum / b.pctCount) * 100) / 100 : 0,
    }))
    .sort((a, b) => num(b.changes) - num(a.changes));

  const totalChanges = rows.reduce((s, r) => s + num(r.changes), 0);

  return {
    columns: [
      { key: 'department', label: 'Department' },
      { key: 'changes', label: 'Changes', align: 'right', format: 'number' },
      { key: 'raises', label: 'Raises', align: 'right', format: 'number' },
      { key: 'cuts', label: 'Decreases', align: 'right', format: 'number' },
      {
        key: 'avgChangePct',
        label: 'Avg change %',
        align: 'right',
        format: 'percent',
        aggregate: 'avg',
      },
    ],
    rows,
    note: `Base salary structure changes with effective date in ${start} → ${end}. See Historical Records for the full change log.`,
    summaryCards: [
      { key: 'changes', label: 'Changes', value: totalChanges, format: 'number' },
      {
        key: 'raises',
        label: 'Raises',
        value: rows.reduce((s, r) => s + num(r.raises), 0),
        format: 'number',
      },
      {
        key: 'cuts',
        label: 'Decreases',
        value: rows.reduce((s, r) => s + num(r.cuts), 0),
        format: 'number',
      },
    ],
  };
};
