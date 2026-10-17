import { combineDateAndTimeIct, formatClockLabelIct } from '../attendanceTimeZone.js';

/**
 * Attendance freeze wall-clock in Asia/Phnom_Penh.
 * 00:00 = 12:00 midnight — Manual and automatic freeze share this same instant
 * on the yellow cutoff date so locking does not happen mid-shift during the workday.
 */
export const ATTENDANCE_CUTOFF_FREEZE_HM = '00:00';

/** Instant when freeze becomes allowed (ICT midnight on the cutoff date). */
export function attendanceCutoffFreezeInstant(cutoffDate: string): Date {
  const day = String(cutoffDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new Date(NaN);
  }
  return new Date(combineDateAndTimeIct(day, ATTENDANCE_CUTOFF_FREEZE_HM));
}

/** True when now is on/after ICT midnight on the yellow cutoff date. */
export function isAttendanceCutoffReached(cutoffDate: string, now = new Date()): boolean {
  const instant = attendanceCutoffFreezeInstant(cutoffDate);
  if (Number.isNaN(instant.getTime())) return false;
  return now.getTime() >= instant.getTime();
}

/** Human label for errors / UI (e.g. "2026-01-25 12:00 AM ICT"). */
export function formatAttendanceCutoffFreezeLabel(cutoffDate: string): string {
  const instant = attendanceCutoffFreezeInstant(cutoffDate);
  if (Number.isNaN(instant.getTime())) return String(cutoffDate ?? '').slice(0, 10);
  const day = String(cutoffDate).slice(0, 10);
  return `${day} ${formatClockLabelIct(instant.toISOString())} ICT (midnight)`;
}
