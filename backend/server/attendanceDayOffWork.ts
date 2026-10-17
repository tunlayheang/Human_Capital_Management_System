import type { AttendanceStatusContext } from './attendanceStatusContext.js';
import {
  attendanceLateStatusForClockIn,
  type EmployeeAttendanceSchedule,
} from './employeeAttendanceSchedule.js';
import type { AttendanceClockRules } from './attendanceSettings.js';

/** True when planning roster marks this calendar day as a scheduled day off. */
export function isScheduledDayOff(
  ctx: AttendanceStatusContext | undefined,
  dateKey: string
): boolean {
  const d = String(dateKey ?? '').slice(0, 10);
  if (!d || !ctx) return false;
  return ctx.offDates.has(d);
}

/** True when planning roster marks this calendar day as a public holiday (PH). */
export function isScheduledPublicHoliday(
  ctx: AttendanceStatusContext | undefined,
  dateKey: string
): boolean {
  const d = String(dateKey ?? '').slice(0, 10);
  if (!d || !ctx) return false;
  return ctx.holidayDates.has(d);
}

/** True when planning roster marks this calendar day as Mission. */
export function isScheduledMission(
  ctx: AttendanceStatusContext | undefined,
  dateKey: string
): boolean {
  const d = String(dateKey ?? '').slice(0, 10);
  if (!d || !ctx) return false;
  return ctx.missionDates.has(d);
}

export function calcWorkHoursFromClock(
  clockIn: string | Date | null | undefined,
  clockOut: string | Date | null | undefined
): number | null {
  if (clockIn == null || clockOut == null) return null;
  const inMs = new Date(clockIn).getTime();
  const outMs = new Date(clockOut).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) return null;
  return Math.round(((outMs - inMs) / 3600000) * 100) / 100;
}

/** Stored row status on clock-in: day off / PH / mission stay; otherwise present/late from schedule. */
export function resolveStoredStatusForClockIn(
  clockIn: Date,
  dateKey: string,
  ctx: AttendanceStatusContext | undefined,
  schedule: EmployeeAttendanceSchedule | null,
  rules: AttendanceClockRules
): 'DAY_OFF' | 'PH' | 'MISSION' | 'PRESENT' | 'LATE' {
  if (isScheduledPublicHoliday(ctx, dateKey)) return 'PH';
  if (isScheduledDayOff(ctx, dateKey)) return 'DAY_OFF';
  if (isScheduledMission(ctx, dateKey)) return 'MISSION';
  return attendanceLateStatusForClockIn(clockIn, schedule, rules);
}

export function attachDayOffWorkMeta(
  row: Record<string, unknown>,
  ctx: AttendanceStatusContext | undefined
): Record<string, unknown> {
  const dateKey = String(row.date ?? '').slice(0, 10);
  const hasClockIn = row.clockIn != null && String(row.clockIn).trim() !== '';
  const workedOnDayOff = isScheduledDayOff(ctx, dateKey) && hasClockIn;
  const workHours =
    row.workHours != null && row.workHours !== ''
      ? Number(row.workHours)
      : calcWorkHoursFromClock(
          row.clockIn as string | Date | null | undefined,
          row.clockOut as string | Date | null | undefined
        );
  const otEligibleHours =
    workedOnDayOff && workHours != null && Number.isFinite(workHours) && workHours > 0
      ? workHours
      : null;

  return {
    ...row,
    workedOnDayOff,
    requiresOvertimeRequest: workedOnDayOff,
    otEligibleHours,
  };
}
