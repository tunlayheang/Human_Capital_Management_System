import type { AttendanceRecord, PayrollAttendancePeriod } from '../types';

export type AttendanceFreezePolicy = {
  month: string;
  date: string;
  attendancePeriodStatus: PayrollAttendancePeriod['status'] | 'OPEN';
  payPeriodStart: string;
  payPeriodEnd: string;
  frozenThroughDate: string;
  inFrozenCutoffRange: boolean;
  payrollMonthLocked: boolean;
  reviewFrozen: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  readOnlyReason: string | null;
};

function periodIsReviewFrozen(period: PayrollAttendancePeriod | null | undefined): boolean {
  if (!period) return false;
  if (period.reviewFrozen === true) return true;
  return period.status === 'FINALIZED' || period.status === 'LOCKED';
}

export function attendanceRecordHasPersistedData(rec: AttendanceRecord): boolean {
  const hasClockIn = Boolean(rec.clockIn && String(rec.clockIn).trim());
  const hasClockOut = Boolean(rec.clockOut && String(rec.clockOut).trim());
  const hasCorrection = Boolean(rec.correctionAt && String(rec.correctionAt).trim());
  const status = String(rec.status ?? '').trim().toUpperCase();
  return hasClockIn || hasClockOut || hasCorrection || status.length > 0;
}

/** Find the salary-month freeze period that owns this attendance date (handles cutoff spillover). */
function periodOwningDate(
  date: string,
  periodByMonth: Map<string, PayrollAttendancePeriod | null>
): PayrollAttendancePeriod | null {
  const d = date.slice(0, 10);
  for (const period of periodByMonth.values()) {
    if (!period) continue;
    const start = (period.payPeriodStart ?? '').slice(0, 10);
    const through = (
      period.frozenThroughDate ??
      period.attendanceCutoffDate ??
      period.payPeriodEnd ??
      ''
    ).slice(0, 10);
    if (start && through && d >= start && d <= through) {
      return period;
    }
  }
  // Fallback: calendar month key (legacy).
  return periodByMonth.get(d.slice(0, 7)) ?? null;
}

/** Whether HR time edits should be disabled for this row during payroll review freeze. */
export function isAttendanceRecordUpdateLocked(
  rec: AttendanceRecord,
  periodByMonth: Map<string, PayrollAttendancePeriod | null>
): boolean {
  if (isAttendanceGridPlaceholder(rec) || rec.persistedInDatabase === false) return false;
  const period = periodOwningDate(rec.date, periodByMonth);
  if (!periodIsReviewFrozen(period)) return false;
  // Only after midnight ICT on cutoff (server sets isCutoffReached).
  if (period?.isCutoffReached === false) return false;
  const start = (period?.payPeriodStart ?? '').slice(0, 10);
  const frozenThrough = (
    period?.frozenThroughDate ??
    period?.attendanceCutoffDate ??
    ''
  ).slice(0, 10);
  if (!frozenThrough) return false;
  const d = rec.date.slice(0, 10);
  if (start && d < start) return false;
  // Dates after the cutoff stay editable.
  if (d > frozenThrough) return false;
  if (period?.allowUpdatesInFrozenRange === true) return false;
  return attendanceRecordHasPersistedData(rec);
}

export function isAttendanceGridPlaceholder(rec: AttendanceRecord): boolean {
  return rec.isGridPlaceholder === true || rec.id.startsWith('grid-');
}

export function freezeBannerMessage(period: PayrollAttendancePeriod): string {
  const through = period.frozenThroughDate ?? period.attendanceCutoffDate ?? period.month;
  return (
    `Payroll review freeze is active for ${period.month}. ` +
    `HR edits to existing attendance through ${through} are view-only (locked after midnight ICT on the cutoff). ` +
    'Employee clock-in/out still works. Dates after the cutoff stay editable. Reopen attendance to correct frozen rows.'
  );
}
