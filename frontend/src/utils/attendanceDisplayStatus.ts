import { AttendanceRecord, AttendanceStatus } from '../types';
import { DEFAULT_ATTENDANCE_RULES, type AttendanceClockRules } from '../types/attendance';
import { HCMS_ATTENDANCE_TZ, parseAttendanceTimestamp } from './attendanceRecordApi';

function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time || typeof time !== 'string') return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since midnight in Cambodia office timezone (not the browser/server local TZ). */
function minutesSinceMidnightIct(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HCMS_ATTENDANCE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

const ENRICHED_ABSENCE = new Set<AttendanceStatus>([
  AttendanceStatus.ON_LEAVE,
  AttendanceStatus.PAID_LEAVE,
  AttendanceStatus.UNPAID_LEAVE,
  AttendanceStatus.DAY_OFF,
  AttendanceStatus.PH,
  AttendanceStatus.MISSION,
  AttendanceStatus.ABSENT,
]);

/** Keep DAY_OFF / PH / MISSION when employee clocks (times still shown). */
export function resolveAttendanceListStatus(
  record: Pick<AttendanceRecord, 'clockIn' | 'status' | 'workedOnDayOff' | 'lateMinutes'>,
  shiftStart?: string | null,
  rules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES
): AttendanceStatus {
  if (record.workedOnDayOff || record.status === AttendanceStatus.DAY_OFF) {
    return AttendanceStatus.DAY_OFF;
  }
  if (record.status === AttendanceStatus.PH) return AttendanceStatus.PH;
  if (record.status === AttendanceStatus.MISSION) return AttendanceStatus.MISSION;
  return resolveAttendanceDisplayStatus(record, shiftStart, rules);
}

/** Match backend: roster + approved leave when absent; late/present from clock-in in ICT. */
export function resolveAttendanceDisplayStatus(
  record: Pick<AttendanceRecord, 'clockIn' | 'status' | 'lateMinutes'>,
  shiftStart?: string | null,
  rules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES
): AttendanceStatus {
  const stored = String(record.status ?? '').toUpperCase();
  if (stored === AttendanceStatus.ON_LEAVE) return AttendanceStatus.ON_LEAVE;
  if (stored === AttendanceStatus.PAID_LEAVE) return AttendanceStatus.PAID_LEAVE;
  if (stored === AttendanceStatus.UNPAID_LEAVE) return AttendanceStatus.UNPAID_LEAVE;
  if (stored === AttendanceStatus.DAY_OFF) return AttendanceStatus.DAY_OFF;
  if (stored === AttendanceStatus.PH) return AttendanceStatus.PH;
  if (stored === AttendanceStatus.MISSION) return AttendanceStatus.MISSION;

  if (!record.clockIn) {
    if (ENRICHED_ABSENCE.has(stored as AttendanceStatus)) {
      return stored as AttendanceStatus;
    }
    return AttendanceStatus.ABSENT;
  }

  const clockIn = parseAttendanceTimestamp(record.clockIn);
  if (!clockIn) {
    if (ENRICHED_ABSENCE.has(stored as AttendanceStatus)) {
      return stored as AttendanceStatus;
    }
    return AttendanceStatus.ABSENT;
  }

  // Prefer server lateMinutes (ICT) when present — avoids browser TZ and legacy label bugs.
  if (
    (stored === AttendanceStatus.LATE || stored === AttendanceStatus.PRESENT) &&
    record.lateMinutes != null
  ) {
    return Number(record.lateMinutes) > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
  }

  const fallbackIn = `${String(rules.lateAfterHour).padStart(2, '0')}:${String(rules.lateAfterMinute).padStart(2, '0')}`;
  const timeIn = shiftStart?.trim() || fallbackIn;
  const startMinutes = parseTimeToMinutes(timeIn);
  const nowMinutes = minutesSinceMidnightIct(clockIn);

  if (startMinutes == null) {
    const cutoff =
      rules.lateAfterHour * 60 + rules.lateAfterMinute + rules.gracePeriodMinutes;
    return nowMinutes > cutoff ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
  }

  const cutoff = startMinutes + rules.gracePeriodMinutes;
  return nowMinutes > cutoff ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
}
