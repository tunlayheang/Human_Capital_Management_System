import { Op } from 'sequelize';
import {
  AttendanceRecord,
  Department,
  Employee,
  LeaveRequest,
  PayrollRun,
  Position,
  Project,
  SalaryStructure,
  sequelize,
} from './db.js';
import type { DashboardDateRange } from './dashboardDateRange.js';
import {
  defaultDashboardRange,
  formatPeriodLabel,
  monthKeysInRange,
} from './dashboardDateRange.js';
import { countAbsentOnDate } from './attendanceSnapshotCounts.js';
import { OFFBOARDED_STATUSES } from './employeeArchiveService.js';
import { positionLevelLabel } from './positionCatalog.js';

export const ACTIVE_EMPLOYEE_STATUS = { [Op.in]: ['active', 'ACTIVE', 'pending_approval'] };

/** Lifecycle statuses that count as separations for turnover. */
const SEPARATED_STATUSES = [
  ...OFFBOARDED_STATUSES,
  ...OFFBOARDED_STATUSES.map((s) => s.toUpperCase()),
];

const DRAFT_STATUSES = ['draft', 'profile_incomplete', 'DRAFT', 'PROFILE_INCOMPLETE'];

const COMPLETED_PAYROLL_STATUSES = ['COMPLETED', 'APPROVED', 'LOCKED', 'PAID', 'PAYMENT_PROCESSING'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toYmd(value: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatMonthShort(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || '').trim());
  if (!m) return String(monthKey || '').slice(0, 3);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short' });
}

/**
 * Employees employed on a given calendar date:
 * joined on/before that date, not a draft, and either still active
 * or separated with last working / termination after that date.
 */
function employmentWhereAt(asOfYmd: string): Record<string, unknown> {
  const asOfEnd = new Date(`${asOfYmd}T23:59:59.999`);
  return {
    join_date: { [Op.lte]: asOfYmd },
    status: { [Op.notIn]: DRAFT_STATUSES },
    [Op.or]: [
      { status: { [Op.notIn]: SEPARATED_STATUSES } },
      {
        status: { [Op.in]: SEPARATED_STATUSES },
        [Op.or]: [
          { last_working_date: { [Op.gt]: asOfYmd } },
          {
            last_working_date: null,
            terminated_at: { [Op.gt]: asOfEnd },
          },
        ],
      },
    ],
  };
}

export async function countEmployeesOnDate(asOf: Date | string): Promise<number> {
  return Employee.count({
    where: employmentWhereAt(toYmd(asOf)) as any,
    logging: false,
  });
}

/** Separations whose last working day (or termination timestamp) falls in the period. */
export async function countLeaversInPeriod(range: DashboardDateRange): Promise<number> {
  return Employee.count({
    where: {
      status: { [Op.in]: SEPARATED_STATUSES },
      [Op.or]: [
        {
          last_working_date: {
            [Op.gte]: range.startDate,
            [Op.lte]: range.endDate,
          },
        },
        {
          last_working_date: null,
          terminated_at: {
            [Op.gte]: range.start,
            [Op.lte]: range.end,
          },
        },
      ],
    },
    logging: false,
  });
}

/**
 * Total turnover rate for the selected dashboard period:
 * (leavers in period / average headcount) × 100
 * Average headcount = (headcount at period start + headcount at period end) / 2
 */
export async function computeTurnoverRatePercent(range: DashboardDateRange): Promise<{
  turnoverRate: number;
  leaversInPeriod: number;
  headcountStart: number;
  headcountEnd: number;
  avgHeadcount: number;
}> {
  const [headcountStart, headcountEnd, leaversInPeriod] = await Promise.all([
    countEmployeesOnDate(range.startDate),
    countEmployeesOnDate(range.endDate),
    countLeaversInPeriod(range),
  ]);

  const avgHeadcount = (headcountStart + headcountEnd) / 2;
  const turnoverRate =
    avgHeadcount > 0 ? Math.round((leaversInPeriod / avgHeadcount) * 1000) / 10 : 0;

  return {
    turnoverRate,
    leaversInPeriod,
    headcountStart,
    headcountEnd,
    avgHeadcount: Math.round(avgHeadcount * 10) / 10,
  };
}

/** @deprecated Use computeTurnoverRatePercent with explicit range. */
export async function computeAnnualTurnoverRatePercent(): Promise<number> {
  const result = await computeTurnoverRatePercent(defaultDashboardRange());
  return result.turnoverRate;
}

export async function buildLeaveDistribution(
  range: DashboardDateRange
): Promise<Array<{ name: string; value: number }>> {
  const rows = (await LeaveRequest.findAll({
    attributes: ['type', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where: {
      startDate: { [Op.lte]: range.endDate },
      endDate: { [Op.gte]: range.startDate },
    },
    group: ['type'],
    raw: true,
    logging: false,
  })) as Array<{ type: string; count: string | number }>;

  return rows
    .map((row) => ({
      name: String(row.type || 'Other').trim() || 'Other',
      value: parseInt(String(row.count), 10) || 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

export async function buildPayrollHistory(
  range: DashboardDateRange
): Promise<Array<{ month: string; amount: number }>> {
  const months = monthKeysInRange(range.startDate, range.endDate);
  if (!months.length) return [];

  const runs = (await PayrollRun.findAll({
    where: {
      status: { [Op.in]: COMPLETED_PAYROLL_STATUSES },
      month: { [Op.in]: months },
    },
    attributes: ['month', 'totalNetPay'],
    order: [['month', 'ASC']],
    logging: false,
  })) as Array<{ month: string; totalNetPay: number }>;

  return runs.map((run) => ({
    month: formatMonthShort(run.month),
    amount: Math.round(Number(run.totalNetPay) || 0),
  }));
}

export async function buildHeadcountHistory(
  range: DashboardDateRange
): Promise<Array<{ month: string; count: number }>> {
  const months = monthKeysInRange(range.startDate, range.endDate);

  const points = await Promise.all(
    months.map(async (monthKey) => {
      const [y, m] = monthKey.split('-').map(Number);
      const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999);
      const asOf = endOfMonth.getTime() > range.end.getTime() ? range.end : endOfMonth;
      const count = await countEmployeesOnDate(asOf);
      return { month: formatMonthShort(monthKey), count };
    })
  );
  return points;
}

/** Weekday attendance totals within the selected period (up to 10 most recent weekdays). */
export async function buildAttendanceHistory(
  range: DashboardDateRange,
  userIds?: string[]
): Promise<Array<{ day: string; date: string; present: number; absent: number }>> {
  const rows: Array<{ day: string; date: string; present: number; absent: number }> = [];
  const cursor = new Date(range.end);
  const userFilter =
    userIds && userIds.length > 0 ? { userId: { [Op.in]: userIds } } : {};

  while (cursor.getTime() >= range.start.getTime() && rows.length < 10) {
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) {
      const dateStr = cursor.toISOString().split('T')[0];
      const baseWhere = { date: dateStr, ...userFilter };
      const [present, absent] = await Promise.all([
        AttendanceRecord.count({ where: { ...baseWhere, status: 'PRESENT' }, logging: false }),
        countAbsentOnDate(dateStr, userIds),
      ]);
      rows.unshift({
        day: `${WEEKDAY_LABELS[dow]} ${dateStr.slice(5)}`,
        date: dateStr,
        present,
        absent,
      });
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return rows;
}

export async function buildDepartmentDistribution(
  range: DashboardDateRange
): Promise<Array<{ name: string; value: number }>> {
  const departments = await Department.findAll({ attributes: ['id', 'name'], logging: false });
  const deptIds = departments.map((d) => d.id);
  if (!deptIds.length) return [];

  const asOfYmd = range.endDate;
  const asOfEnd = new Date(`${asOfYmd}T23:59:59.999`);

  const empCounts = (await Employee.findAll({
    attributes: ['department_id', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    where: {
      department_id: { [Op.in]: deptIds },
      join_date: { [Op.lte]: asOfYmd },
      status: { [Op.notIn]: DRAFT_STATUSES },
      [Op.or]: [
        { status: { [Op.notIn]: SEPARATED_STATUSES } },
        {
          status: { [Op.in]: SEPARATED_STATUSES },
          [Op.or]: [
            { last_working_date: { [Op.gt]: asOfYmd } },
            {
              last_working_date: null,
              terminated_at: { [Op.gt]: asOfEnd },
            },
          ],
        },
      ],
    },
    group: ['department_id'],
    raw: true,
    logging: false,
  })) as Array<{ department_id: string; count: string | number }>;

  const countMap = new Map(
    empCounts.map((row) => [row.department_id, parseInt(String(row.count), 10) || 0])
  );

  return departments
    .map((dept) => ({
      name: String((dept as { name?: string }).name || '—'),
      value: countMap.get(String(dept.id)) || 0,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

export async function sumCompletedPayrollInRange(range: DashboardDateRange): Promise<number> {
  const months = monthKeysInRange(range.startDate, range.endDate);
  if (!months.length) return 0;

  const runs = (await PayrollRun.findAll({
    where: {
      month: { [Op.in]: months },
      status: { [Op.in]: COMPLETED_PAYROLL_STATUSES },
    },
    attributes: ['totalNetPay'],
    logging: false,
  })) as Array<{ totalNetPay?: number }>;

  return runs.reduce((sum, r) => sum + Math.round(Number(r.totalNetPay) || 0), 0);
}

async function sumPayrollForMonth(monthKey: string): Promise<number> {
  const runs = (await PayrollRun.findAll({
    where: {
      month: monthKey,
      status: { [Op.in]: COMPLETED_PAYROLL_STATUSES },
    },
    attributes: ['totalNetPay'],
    logging: false,
  })) as Array<{ totalNetPay?: number }>;
  return runs.reduce((sum, r) => sum + Math.round(Number(r.totalNetPay) || 0), 0);
}

function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function endOfMonthYmd(monthKey: string, capYmd?: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const last = toYmd(new Date(y, m, 0));
  if (capYmd && capYmd < last) return capYmd;
  return last;
}

function isPhnomPenhLocation(city: unknown, province: unknown): boolean {
  const blob = `${String(city ?? '')} ${String(province ?? '')}`.toLowerCase();
  return (
    blob.includes('phnom penh') ||
    blob.includes('phnompenh') ||
    blob.includes('pnh') ||
    /\bpp\b/.test(blob)
  );
}

async function buildMasterlistHeadcountMetrics(asOfYmd: string): Promise<{
  maleCount: number;
  femaleCount: number;
  phnomPenhCount: number;
  provinceCount: number;
}> {
  const rows = (await Employee.findAll({
    where: employmentWhereAt(asOfYmd) as any,
    attributes: ['gender', 'city', 'state_province'],
    raw: true,
    logging: false,
  })) as Array<{ gender?: string; city?: string; state_province?: string }>;

  let maleCount = 0;
  let femaleCount = 0;
  let phnomPenhCount = 0;
  let provinceCount = 0;

  for (const row of rows) {
    const g = String(row.gender ?? '')
      .trim()
      .toLowerCase();
    if (g === 'male' || g === 'm') maleCount += 1;
    else if (g === 'female' || g === 'f') femaleCount += 1;

    if (isPhnomPenhLocation(row.city, row.state_province)) phnomPenhCount += 1;
    else provinceCount += 1;
  }

  return { maleCount, femaleCount, phnomPenhCount, provinceCount };
}

async function buildAttendanceRatesInRange(range: DashboardDateRange): Promise<{
  lateRate: number;
  absenceRate: number;
  presentRate: number;
  attendanceRate: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  attendanceDays: number;
}> {
  const [presentDays, lateDays, absentDays] = await Promise.all([
    AttendanceRecord.count({
      where: {
        date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate },
        status: 'PRESENT',
      },
      logging: false,
    }),
    AttendanceRecord.count({
      where: {
        date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate },
        status: 'LATE',
      },
      logging: false,
    }),
    AttendanceRecord.count({
      where: {
        date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate },
        status: 'ABSENT',
      },
      logging: false,
    }),
  ]);

  const attendedDays = presentDays + lateDays;
  const attendanceDays = attendedDays + absentDays;
  const lateRate =
    attendanceDays > 0 ? Math.round((lateDays / attendanceDays) * 1000) / 10 : 0;
  const absenceRate =
    attendanceDays > 0 ? Math.round((absentDays / attendanceDays) * 1000) / 10 : 0;
  const presentRate =
    attendanceDays > 0 ? Math.round((attendedDays / attendanceDays) * 1000) / 10 : 0;
  const attendanceRate = presentRate;

  return {
    lateRate,
    absenceRate,
    presentRate,
    attendanceRate,
    presentDays: attendedDays,
    lateDays,
    absentDays,
    attendanceDays,
  };
}

export async function buildDashboardStats(range: DashboardDateRange) {
  const snapshotDate = range.endDate;
  const currentMonthKey = snapshotDate.slice(0, 7);
  const lastMonthKey = previousMonthKey(currentMonthKey);
  const currentMonthAsOf = endOfMonthYmd(currentMonthKey, snapshotDate);
  const lastMonthAsOf = endOfMonthYmd(lastMonthKey);

  const [
    totalEmployees,
    totalDepartments,
    presentOnSnapshot,
    absentOnSnapshot,
    lateOnSnapshot,
    pendingLeaves,
    activeProjects,
    turnover,
    payrollInPeriod,
    masterlist,
    attendanceRates,
    currentMonthSalary,
    lastMonthSalary,
    currentMonthStaff,
    lastMonthStaff,
  ] = await Promise.all([
    countEmployeesOnDate(range.endDate),
    Department.count({ logging: false }),
    AttendanceRecord.count({
      where: { date: snapshotDate, status: 'PRESENT' },
      logging: false,
    }),
    countAbsentOnDate(snapshotDate),
    AttendanceRecord.count({
      where: { date: snapshotDate, status: 'LATE' },
      logging: false,
    }),
    LeaveRequest.count({
      where: {
        status: 'PENDING',
        startDate: { [Op.lte]: range.endDate },
        endDate: { [Op.gte]: range.startDate },
      },
      logging: false,
    }),
    Project.count({ where: { status: 'ACTIVE' }, logging: false }),
    computeTurnoverRatePercent(range),
    sumCompletedPayrollInRange(range),
    buildMasterlistHeadcountMetrics(range.endDate),
    buildAttendanceRatesInRange(range),
    sumPayrollForMonth(currentMonthKey),
    sumPayrollForMonth(lastMonthKey),
    countEmployeesOnDate(currentMonthAsOf),
    countEmployeesOnDate(lastMonthAsOf),
  ]);

  const retentionRate =
    Math.round(Math.max(0, 100 - turnover.turnoverRate) * 10) / 10;

  return {
    totalEmployees,
    totalDepartments,
    presentToday: presentOnSnapshot,
    absentToday: absentOnSnapshot,
    lateToday: lateOnSnapshot,
    pendingLeaveRequests: pendingLeaves,
    activeProjects,
    turnoverRate: turnover.turnoverRate,
    turnoverLeavers: turnover.leaversInPeriod,
    turnoverHeadcountStart: turnover.headcountStart,
    turnoverHeadcountEnd: turnover.headcountEnd,
    turnoverAvgHeadcount: turnover.avgHeadcount,
    retentionRate,
    lateRate: attendanceRates.lateRate,
    absenceRate: attendanceRates.absenceRate,
    presentRate: attendanceRates.presentRate,
    attendanceRate: attendanceRates.attendanceRate,
    presentDays: attendanceRates.presentDays,
    absentDays: attendanceRates.absentDays,
    lateDays: attendanceRates.lateDays,
    attendanceDays: attendanceRates.attendanceDays,
    maleCount: masterlist.maleCount,
    femaleCount: masterlist.femaleCount,
    phnomPenhCount: masterlist.phnomPenhCount,
    provinceCount: masterlist.provinceCount,
    currentMonthSalary,
    lastMonthSalary,
    currentMonthStaff,
    lastMonthStaff,
    currentMonthKey,
    lastMonthKey,
    payrollInPeriod,
  };
}

type NamedCount = { name: string; value: number };

function roleLabelFromEmployee(row: {
  job_position?: string | null;
  position?: { title?: string | null; level?: string | null } | null;
}): string {
  const level = row.position?.level;
  if (level) {
    const label = positionLevelLabel(level);
    if (label) return label;
  }
  const jobPos = String(row.job_position ?? '').trim();
  if (jobPos) return jobPos;
  const title = String(row.position?.title ?? '').trim();
  if (title) return title;
  return 'Unassigned';
}

function yearsOfService(joinDate: unknown, asOfYmd: string): number {
  const joinYmd = toYmd(String(joinDate ?? asOfYmd));
  const join = new Date(`${joinYmd}T00:00:00`);
  const asOf = new Date(`${asOfYmd}T00:00:00`);
  if (Number.isNaN(join.getTime()) || Number.isNaN(asOf.getTime())) return 0;
  return Math.max(0, (asOf.getTime() - join.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function tenureBucketLabel(years: number): string {
  if (years >= 5) return '5+ years';
  if (years >= 3) return '3–5 years';
  if (years >= 1) return '1–3 years';
  return 'Under 1 year';
}

const TENURE_BUCKET_ORDER = ['5+ years', '3–5 years', '1–3 years', 'Under 1 year'];

async function loadEmployedWithRoleAndSalary(asOfYmd: string) {
  return Employee.findAll({
    where: employmentWhereAt(asOfYmd) as any,
    attributes: ['id', 'join_date', 'job_position', 'position_id'],
    include: [
      {
        model: Position,
        as: 'position',
        attributes: ['id', 'title', 'level'],
        required: false,
      },
      {
        model: SalaryStructure,
        as: 'salaryStructure',
        attributes: ['base_salary'],
        required: false,
      },
    ],
    logging: false,
  });
}

/** Active vs inactive headcount as of period end. */
export async function buildEmploymentStatusChart(
  range: DashboardDateRange
): Promise<NamedCount[]> {
  const asOfYmd = range.endDate;
  const asOfEnd = new Date(`${asOfYmd}T23:59:59.999`);

  const [active, inactive] = await Promise.all([
    countEmployeesOnDate(asOfYmd),
    Employee.count({
      where: {
        status: { [Op.in]: SEPARATED_STATUSES },
        join_date: { [Op.lte]: asOfYmd },
        [Op.or]: [
          { last_working_date: { [Op.lte]: asOfYmd } },
          {
            last_working_date: null,
            terminated_at: { [Op.lte]: asOfEnd },
          },
        ],
      },
      logging: false,
    }),
  ]);

  return [
    { name: 'Active', value: active },
    { name: 'Inactive', value: inactive },
  ];
}

/** Total base salary by role / position level for employed staff at period end. */
export async function buildSalaryByRoleChart(
  range: DashboardDateRange
): Promise<NamedCount[]> {
  const rows = await loadEmployedWithRoleAndSalary(range.endDate);
  const totals = new Map<string, number>();

  for (const emp of rows) {
    const plain = emp.get({ plain: true }) as {
      job_position?: string | null;
      position?: { title?: string | null; level?: string | null } | null;
      salaryStructure?: { base_salary?: number | string | null } | null;
    };
    const role = roleLabelFromEmployee(plain);
    const salary = Math.round(Number(plain.salaryStructure?.base_salary) || 0);
    totals.set(role, (totals.get(role) || 0) + salary);
  }

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Staff count by role / position level at period end. */
export async function buildStaffByRoleChart(
  range: DashboardDateRange
): Promise<NamedCount[]> {
  const rows = await loadEmployedWithRoleAndSalary(range.endDate);
  const totals = new Map<string, number>();

  for (const emp of rows) {
    const plain = emp.get({ plain: true }) as {
      job_position?: string | null;
      position?: { title?: string | null; level?: string | null } | null;
    };
    const role = roleLabelFromEmployee(plain);
    totals.set(role, (totals.get(role) || 0) + 1);
  }

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Tenure bands for employed staff at period end. */
export async function buildLengthOfEmploymentChart(
  range: DashboardDateRange
): Promise<NamedCount[]> {
  const rows = (await Employee.findAll({
    where: employmentWhereAt(range.endDate) as any,
    attributes: ['join_date'],
    raw: true,
    logging: false,
  })) as Array<{ join_date?: string | Date }>;

  const counts = new Map<string, number>(TENURE_BUCKET_ORDER.map((k) => [k, 0]));
  for (const row of rows) {
    const label = tenureBucketLabel(yearsOfService(row.join_date, range.endDate));
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return TENURE_BUCKET_ORDER.map((name) => ({ name, value: counts.get(name) || 0 }));
}

/** Termination reasons for separations in the selected period. */
export async function buildReasonToLeaveChart(
  range: DashboardDateRange
): Promise<NamedCount[]> {
  const rows = (await Employee.findAll({
    where: {
      status: { [Op.in]: SEPARATED_STATUSES },
      [Op.or]: [
        {
          last_working_date: {
            [Op.gte]: range.startDate,
            [Op.lte]: range.endDate,
          },
        },
        {
          last_working_date: null,
          terminated_at: {
            [Op.gte]: range.start,
            [Op.lte]: range.end,
          },
        },
      ],
    },
    attributes: ['termination_reason'],
    raw: true,
    logging: false,
  })) as Array<{ termination_reason?: string | null }>;

  const totals = new Map<string, number>();
  for (const row of rows) {
    const reason = String(row.termination_reason ?? '').trim() || 'Others';
    totals.set(reason, (totals.get(reason) || 0) + 1);
  }

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export async function buildDashboardAnalytics(range: DashboardDateRange = defaultDashboardRange()) {
  const [
    stats,
    departmentDistribution,
    leaveDistribution,
    payrollHistory,
    headcountHistory,
    attendanceHistory,
    employmentStatus,
    salaryByRole,
    reasonToLeave,
    lengthOfEmployment,
    staffByRole,
  ] = await Promise.all([
    buildDashboardStats(range),
    buildDepartmentDistribution(range),
    buildLeaveDistribution(range),
    buildPayrollHistory(range),
    buildHeadcountHistory(range),
    buildAttendanceHistory(range),
    buildEmploymentStatusChart(range),
    buildSalaryByRoleChart(range),
    buildReasonToLeaveChart(range),
    buildLengthOfEmploymentChart(range),
    buildStaffByRoleChart(range),
  ]);

  return {
    period: {
      startDate: range.startDate,
      endDate: range.endDate,
      label: formatPeriodLabel(range),
    },
    stats: {
      ...stats,
      payrollRun: {
        inPeriod: stats.payrollInPeriod,
        thisMonth: stats.payrollInPeriod,
        lastMonth: 0,
      },
    },
    charts: {
      summary: {
        totalEmployees: stats.totalEmployees,
        presentToday: stats.presentToday,
        pendingLeaves: stats.pendingLeaveRequests,
      },
      departmentDistribution,
      leaveDistribution,
      payrollHistory,
      headcountHistory,
      attendanceHistory,
      employmentStatus,
      salaryByRole,
      reasonToLeave,
      lengthOfEmployment,
      staffByRole,
    },
  };
}
