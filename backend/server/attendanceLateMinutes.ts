import type { AttendanceClockRules } from './attendanceSettings.js';
import { DEFAULT_ATTENDANCE_RULES } from './attendanceSettings.js';
import {
  parseTimeToMinutes,
  type EmployeeAttendanceSchedule,
} from './employeeAttendanceSchedule.js';
import { minutesFromIsoIct } from './attendanceTimeZone.js';

/** Minutes late after grace period; 0 when on time or early. */
export function computeLateMinutes(
  clockIn: Date | string,
  schedule: EmployeeAttendanceSchedule | null,
  globalRules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES
): number {
  const clockDate = typeof clockIn === 'string' ? new Date(clockIn) : clockIn;
  if (Number.isNaN(clockDate.getTime())) return 0;

  const fallbackIn = `${String(globalRules.lateAfterHour).padStart(2, '0')}:${String(globalRules.lateAfterMinute).padStart(2, '0')}`;
  const timeIn = schedule?.timeIn ?? fallbackIn;
  const startMinutes = parseTimeToMinutes(timeIn);
  const grace =
    schedule?.gracePeriodMinutes != null
      ? schedule.gracePeriodMinutes
      : globalRules.gracePeriodMinutes;

  const cutoff =
    startMinutes != null
      ? startMinutes + grace
      : globalRules.lateAfterHour * 60 + globalRules.lateAfterMinute + grace;

  const nowMinutes = minutesFromIsoIct(clockDate);
  const late = nowMinutes - cutoff;
  return late > 0 ? late : 0;
}

export function resolveLateAttendanceFields(
  clockIn: Date | string | null | undefined,
  schedule: EmployeeAttendanceSchedule | null,
  rules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES
): { status: 'PRESENT' | 'LATE'; lateMinutes: number } {
  if (!clockIn) return { status: 'PRESENT', lateMinutes: 0 };
  const clockDate = typeof clockIn === 'string' ? new Date(clockIn) : clockIn;
  if (Number.isNaN(clockDate.getTime())) return { status: 'PRESENT', lateMinutes: 0 };
  const lateMinutes = computeLateMinutes(clockDate, schedule, rules);
  // Single source of truth: late minutes already use ICT; do not OR with a separate status path.
  return {
    status: lateMinutes > 0 ? 'LATE' : 'PRESENT',
    lateMinutes,
  };
}
