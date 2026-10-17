import { Op, QueryTypes } from 'sequelize';
import {
  AttendanceRecord,
  Employee,
  LeaveRequest,
  OvertimeRequest,
  sequelize,
} from './db.js';
import type { DashboardDateRange } from './dashboardDateRange.js';
import {
  formatPeriodLabel,
  monthKeysInRange,
} from './dashboardDateRange.js';
import { formatMonthShort } from './dashboardChartStats.js';
import { leaveOverlapDaysInRange, type LeaveDurationFields } from './leaveDuration.js';

const SEPARATED_STATUSES = ['terminated', 'resigned', 'TERMINATED', 'RESIGNED'];

function monthBounds(
  monthKey: string,
  range: DashboardDateRange
): { start: string; end: string } | null {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  let start = `${monthKey}-01`;
  let end = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  if (end < range.startDate || start > range.endDate) return null;
  if (start < range.startDate) start = range.startDate;
  if (end > range.endDate) end = range.endDate;
  return { start, end };
}

export async function buildMonthlyAttendanceRateTrend(range: DashboardDateRange) {
  const months = monthKeysInRange(range.startDate, range.endDate);

  const monthPoints = await Promise.all(
    months.map(async (monthKey) => {
      const bounds = monthBounds(monthKey, range);
      if (!bounds) return null;

      const baseWhere = { date: { [Op.between]: [bounds.start, bounds.end] } };
      const [present, absent, late] = await Promise.all([
        AttendanceRecord.count({
          where: { ...baseWhere, status: { [Op.in]: ['PRESENT', 'LATE'] } },
          logging: false,
        }),
        AttendanceRecord.count({
          where: { ...baseWhere, status: 'ABSENT' },
          logging: false,
        }),
        AttendanceRecord.count({
          where: { ...baseWhere, status: 'LATE' },
          logging: false,
        }),
      ]);

      const denom = present + absent;
      const attendanceRatePct =
        denom > 0 ? Math.round((present / denom) * 1000) / 10 : 0;

      return {
        month: formatMonthShort(monthKey),
        monthKey,
        present,
        absent,
        late,
        attendanceRatePct,
      };
    })
  );

  return monthPoints.filter((row): row is NonNullable<typeof row> => row != null);
}

export async function buildMonthlyLeaveUsageTrend(range: DashboardDateRange) {
  const rows = await LeaveRequest.findAll({
    where: {
      status: 'APPROVED',
      startDate: { [Op.lte]: range.endDate },
      endDate: { [Op.gte]: range.startDate },
    },
    attributes: ['startDate', 'endDate', 'isHalfDay', 'halfDayPeriod'],
    logging: false,
  });

  return monthKeysInRange(range.startDate, range.endDate).map((mk) => {
    const bounds = monthBounds(mk, range);
    if (!bounds) {
      return { month: formatMonthShort(mk), monthKey: mk, days: 0 };
    }

    let days = 0;
    for (const row of rows) {
      const fields = row.get({ plain: true }) as LeaveDurationFields;
      days += leaveOverlapDaysInRange(fields, bounds.start, bounds.end);
    }

    return {
      month: formatMonthShort(mk),
      monthKey: mk,
      days: Math.round(days * 10) / 10,
    };
  });
}

export async function buildMonthlyOvertimeTrend(range: DashboardDateRange) {
  const rows = (await OvertimeRequest.findAll({
    where: {
      status: 'APPROVED',
      workDate: { [Op.between]: [range.startDate, range.endDate] },
    },
    attributes: ['workDate', 'hours'],
    logging: false,
  })) as Array<{ workDate?: string; hours?: number }>;

  const byMonth = new Map<string, number>();
  for (const row of rows) {
    const mk = String(row.workDate ?? '').slice(0, 7);
    if (!mk) continue;
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + Number(row.hours ?? 0));
  }

  return monthKeysInRange(range.startDate, range.endDate).map((mk) => ({
    month: formatMonthShort(mk),
    monthKey: mk,
    hours: Math.round((byMonth.get(mk) ?? 0) * 10) / 10,
  }));
}

export async function buildMonthlySeparationTrend(range: DashboardDateRange) {
  const rows = (await Employee.findAll({
    where: {
      status: { [Op.in]: SEPARATED_STATUSES },
      terminated_at: { [Op.between]: [range.start, range.end] },
    },
    attributes: ['terminated_at'],
    logging: false,
  })) as Array<{ terminated_at?: Date | string }>;

  const byMonth = new Map<string, number>();
  for (const row of rows) {
    const raw = row.terminated_at;
    if (!raw) continue;
    const d = raw instanceof Date ? raw.toISOString().slice(0, 7) : String(raw).slice(0, 7);
    if (!d) continue;
    byMonth.set(d, (byMonth.get(d) ?? 0) + 1);
  }

  return monthKeysInRange(range.startDate, range.endDate).map((mk) => ({
    month: formatMonthShort(mk),
    monthKey: mk,
    count: byMonth.get(mk) ?? 0,
  }));
}

export async function buildDepartmentAttendanceRates(range: DashboardDateRange) {
  type Row = { name: string; present: string | number; absent: string | number };
  const rows = (await sequelize.query(
    `
    SELECT COALESCE(d.name, 'Unassigned') AS name,
           SUM(CASE WHEN ar.status IN ('PRESENT', 'LATE') THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN ar.status = 'ABSENT' THEN 1 ELSE 0 END) AS absent
    FROM attendancerecords ar
    INNER JOIN users u ON u.id = ar.userId
    LEFT JOIN employees e ON e.id = u.employeeId
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE ar.date BETWEEN :startDate AND :endDate
    GROUP BY COALESCE(d.name, 'Unassigned')
    ORDER BY present DESC
    `,
    {
      replacements: { startDate: range.startDate, endDate: range.endDate },
      type: QueryTypes.SELECT,
      logging: false,
    }
  )) as Row[];

  return rows
    .map((row) => {
      const present = parseInt(String(row.present), 10) || 0;
      const absent = parseInt(String(row.absent), 10) || 0;
      const denom = present + absent;
      const ratePct = denom > 0 ? Math.round((present / denom) * 1000) / 10 : 0;
      return { name: String(row.name || 'Unassigned'), present, absent, ratePct };
    })
    .filter((row) => row.present + row.absent > 0);
}

export async function buildOrganizationAnalytics(range: DashboardDateRange) {
  const [
    monthlyAttendanceRate,
    monthlyLeaveUsage,
    monthlyOvertimeHours,
    monthlySeparations,
    departmentAttendanceRates,
  ] = await Promise.all([
    buildMonthlyAttendanceRateTrend(range),
    buildMonthlyLeaveUsageTrend(range),
    buildMonthlyOvertimeTrend(range),
    buildMonthlySeparationTrend(range),
    buildDepartmentAttendanceRates(range),
  ]);

  const monthlyLateTrend = monthlyAttendanceRate.map(({ month, late }) => ({ month, late }));

  return {
    period: {
      startDate: range.startDate,
      endDate: range.endDate,
      label: formatPeriodLabel(range),
    },
    charts: {
      monthlyAttendanceRate,
      monthlyLateTrend,
      monthlyLeaveUsage,
      monthlyOvertimeHours,
      monthlySeparations,
      departmentAttendanceRates,
    },
  };
}
