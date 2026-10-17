import {
  DEFAULT_ATTENDANCE_RULES,
  getAttendanceGeofenceConfig,
  type AttendanceClockRules,
} from './attendanceSettings';
import {
  attendanceLateStatusForClockIn,
  getEmployeeSchedulesForUsers,
  type EmployeeAttendanceSchedule,
} from './employeeAttendanceSchedule';
import {
  buildAttendanceStatusContextMap,
  resolveAbsentAttendanceStatus,
  type AttendanceStatusContext,
} from './attendanceStatusContext.js';
import {
  normalizeStoredLeaveStatus,
  resolveLeaveAttendanceStatus,
  shouldApplyLeaveAttendanceStatus,
  type LeaveAttendanceStatus,
} from './attendanceLeaveStatus.js';
import {
  attachDayOffWorkMeta,
  isScheduledDayOff,
  isScheduledMission,
  isScheduledPublicHoliday,
} from './attendanceDayOffWork.js';

export type AttendanceDisplayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'PAID_LEAVE'
  | 'UNPAID_LEAVE'
  | 'DAY_OFF'
  | 'PH'
  | 'MISSION';

function resolveLeaveDisplayStatus(
  dateKey: string,
  ctx: AttendanceStatusContext,
  hasClockIn: boolean
): LeaveAttendanceStatus | null {
  if (!shouldApplyLeaveAttendanceStatus(dateKey, ctx, hasClockIn)) return null;
  return resolveLeaveAttendanceStatus(dateKey, ctx);
}

/** Derive status from clock-in, schedule, approved leave, and planning roster. */
export function resolveAttendanceDisplayStatus(
  record: {
    clockIn?: string | Date | null;
    status?: string | null;
    date?: string | null;
    userId?: string | null;
  },
  schedule: EmployeeAttendanceSchedule | null,
  rules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES,
  ctx?: AttendanceStatusContext
): AttendanceDisplayStatus {
  const stored = String(record.status ?? '').toUpperCase();
  const dateKey = String(record.date ?? '').slice(0, 10);
  const hasClockIn =
    record.clockIn != null && String(record.clockIn).trim() !== '';

  const leaveStatus = ctx && dateKey ? resolveLeaveDisplayStatus(dateKey, ctx, hasClockIn) : null;
  if (leaveStatus) return leaveStatus;

  if (ctx && dateKey && isScheduledPublicHoliday(ctx, dateKey)) {
    return 'PH';
  }

  if (ctx && dateKey && isScheduledDayOff(ctx, dateKey)) {
    return 'DAY_OFF';
  }

  if (ctx && dateKey && isScheduledMission(ctx, dateKey)) {
    return 'MISSION';
  }

  if (!record.clockIn) {
    if (ctx && dateKey) return resolveAbsentAttendanceStatus(dateKey, ctx);
    if (stored === 'PAID_LEAVE' || stored === 'UNPAID_LEAVE' || stored === 'ON_LEAVE') {
      return stored as AttendanceDisplayStatus;
    }
    if (stored === 'DAY_OFF') return 'DAY_OFF';
    if (stored === 'PH') return 'PH';
    if (stored === 'MISSION') return 'MISSION';
    return 'ABSENT';
  }

  if (stored === 'PAID_LEAVE' || stored === 'UNPAID_LEAVE' || stored === 'ON_LEAVE') {
    return stored as AttendanceDisplayStatus;
  }
  if (stored === 'DAY_OFF') return 'DAY_OFF';
  if (stored === 'PH') return 'PH';
  if (stored === 'MISSION') return 'MISSION';

  const clockIn =
    record.clockIn instanceof Date ? record.clockIn : new Date(String(record.clockIn));
  if (Number.isNaN(clockIn.getTime())) {
    const dateKey = String(record.date ?? '').slice(0, 10);
    if (ctx && dateKey) return resolveAbsentAttendanceStatus(dateKey, ctx);
    return 'ABSENT';
  }

  return attendanceLateStatusForClockIn(clockIn, schedule, rules);
}

export async function enrichAttendanceRecords(
  records: unknown[],
  options?: { attachLeave?: boolean }
): Promise<Record<string, unknown>[]> {
  if (!records.length) return [];

  const settings = await getAttendanceGeofenceConfig();
  const rules = settings?.rules ?? DEFAULT_ATTENDANCE_RULES;

  const plainRows = records.map((row) => {
    return (
      (row as { get?: (o: { plain: boolean }) => Record<string, unknown> })?.get?.({
        plain: true,
      }) ?? (row as Record<string, unknown>)
    );
  });

  const contextMap = await buildAttendanceStatusContextMap(
    plainRows.map((plain) => ({
      userId: String(plain.userId ?? ''),
      date: String(plain.date ?? ''),
    }))
  );

  const userIds = [...new Set(plainRows.map((p) => String(p.userId ?? '')).filter(Boolean))];
  const scheduleByUser = await getEmployeeSchedulesForUsers(userIds);

  const { attachLeaveDetailsToRecords } = await import('./approvedLeaveDayMap.js');

  const withStatus = plainRows.map((plain) => {
    const userId = String(plain.userId ?? '');
    const ctx = contextMap.get(userId);
    const status = resolveAttendanceDisplayStatus(
      {
        clockIn: plain.clockIn as string | Date | null | undefined,
        status: plain.status as string | null | undefined,
        date: plain.date as string | null | undefined,
        userId,
      },
      scheduleByUser.get(userId) ?? null,
      rules,
      ctx
    );
    return attachDayOffWorkMeta({ ...plain, status }, ctx);
  });

  const withLeave =
    options?.attachLeave === false
      ? withStatus
      : await attachLeaveDetailsToRecords(withStatus);

  return withLeave.map((row) => {
    const status = normalizeStoredLeaveStatus(
      String(row.status ?? ''),
      row.leaveIsPaid as boolean | null | undefined
    );
    return status === row.status ? row : { ...row, status };
  });
}
