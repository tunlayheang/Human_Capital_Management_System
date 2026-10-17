import { AttendanceRecord, AttendanceStatus } from '../types';

/** Normalize API status (incl. legacy ON_LEAVE) for filters and badges. */
export function effectiveAttendanceStatus(rec: AttendanceRecord): AttendanceStatus | string {
  const s = String(rec.status ?? '').toUpperCase();
  if (s === AttendanceStatus.PAID_LEAVE || s === AttendanceStatus.UNPAID_LEAVE) {
    return s as AttendanceStatus;
  }
  if (s === AttendanceStatus.ON_LEAVE) {
    if (rec.leaveIsPaid === false) return AttendanceStatus.UNPAID_LEAVE;
    if (rec.leaveIsPaid === true) return AttendanceStatus.PAID_LEAVE;
    return AttendanceStatus.ON_LEAVE;
  }
  if (s === AttendanceStatus.AWAITING) return AttendanceStatus.ABSENT;
  // Prefer ICT lateMinutes over a stale LATE/PRESENT label (legacy UTC getHours bug).
  if (
    rec.clockIn &&
    (s === AttendanceStatus.LATE || s === AttendanceStatus.PRESENT) &&
    rec.lateMinutes != null
  ) {
    return Number(rec.lateMinutes) > 0 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
  }
  return s as AttendanceStatus;
}

export function recordMatchesStatusFilter(
  rec: AttendanceRecord,
  filter: 'all' | AttendanceStatus
): boolean {
  if (filter === 'all') return true;
  return effectiveAttendanceStatus(rec) === filter;
}
