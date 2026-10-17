import { AttendanceStatus } from '../types';
import { translateAttendanceStatus } from './localizedLabels';
import { isRosterMission } from './rosterOffDays';

/** Matches backend rosterOffDays / planning roster types. */
export function isDayOffLeaveType(type: string | null | undefined): boolean {
  if (!type) return false;
  const n = String(type).trim().toLowerCase();
  return (
    n === 'day off' ||
    n === 'dayoff' ||
    n === 'day-off' ||
    n === 'do' ||
    n === 'off' ||
    /\bday\s*off\b/.test(n)
  );
}

export function isPlannedLeaveType(type: string | null | undefined): boolean {
  if (!type || isDayOffLeaveType(type)) return false;
  const n = String(type).trim().toLowerCase();
  if (n === 'working' || n === 'w') return false;
  if (n === 'mission' || n === 'm' || n === 'business trip' || n.includes('business trip')) {
    return false;
  }
  if (n === 'holiday' || n === 'h' || n === 'ph' || n === 'public holiday' || n.includes('public holiday')) {
    return false;
  }
  return true;
}

type TFn = (path: string, vars?: Record<string, string | number>) => string;

/** Human-readable status for attendance list and calendar tooltips. */
export function attendanceStatusLabel(
  status: AttendanceStatus | string,
  t?: TFn
): string {
  if (t) return translateAttendanceStatus(status, t);
  const s = String(status).toUpperCase();
  switch (s) {
    case AttendanceStatus.PRESENT:
      return 'Present';
    case AttendanceStatus.LATE:
      return 'Late';
    case AttendanceStatus.DAY_OFF:
      return 'Day off';
    case AttendanceStatus.PH:
      return 'Public Holiday';
    case AttendanceStatus.MISSION:
      return 'Mission';
    case AttendanceStatus.PAID_LEAVE:
      return 'Paid leave';
    case AttendanceStatus.UNPAID_LEAVE:
      return 'Unpaid leave';
    case AttendanceStatus.ON_LEAVE:
      return 'On leave';
    case AttendanceStatus.ABSENT:
      return 'Absent';
    case AttendanceStatus.AWAITING:
      return 'Absent';
    default:
      return String(status);
  }
}

/** Short label for planning calendar chips (synced with attendance rules). */
export function planningEntryChipLabel(
  type: string,
  isFixedRoster?: boolean,
  t?: TFn
): string {
  if (isDayOffLeaveType(type)) return t ? t('attendance.status.dayOff') : 'Day off';
  if (isRosterMission(type)) return t ? t('attendance.status.mission') : 'Mission';
  if (isFixedRoster && isPlannedLeaveType(type)) {
    return t ? t('attendance.status.onLeave') : 'On Leave';
  }
  if (!isFixedRoster) return t ? t('attendance.status.onLeave') : 'On Leave';
  return type;
}
