import {
  DEFAULT_ATTENDANCE_RULES,
  type AttendanceSettingsPayload,
} from '../types/attendance';

/** Grace period (minutes) from GET /attendance/settings. */
export function gracePeriodFromAttendanceSettings(settings: unknown): number {
  const rules = (settings as AttendanceSettingsPayload | null)?.rules;
  const n = Number(rules?.gracePeriodMinutes);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_ATTENDANCE_RULES.gracePeriodMinutes;
}
