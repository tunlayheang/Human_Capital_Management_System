import { AttendanceRecord } from '../db.js';
import { getAttendancePeriod } from './attendanceFinalizationService.js';
import {
  resolvePayrollCycleForMonth,
  resolveSalaryMonthForDate,
} from './payrollCalendarCycleService.js';
import {
  findLockedPayrollRunForMonth,
  PayrollPeriodFrozenError,
} from './payrollPeriodFreezeService.js';
import { isAttendanceCutoffReached } from './payrollAttendanceCutoff.js';
import type { AttendancePeriodStatus } from './hybridPayrollTypes.js';

export class AttendanceFrozenError extends Error {
  statusCode = 409;
  code = 'ATTENDANCE_FROZEN';
  constructor(message: string) {
    super(message);
    this.name = 'AttendanceFrozenError';
  }
}

export { PayrollPeriodFrozenError };

export type AttendanceFreezePolicy = {
  month: string;
  date: string;
  attendancePeriodStatus: AttendancePeriodStatus | 'OPEN';
  payPeriodStart: string;
  payPeriodEnd: string;
  frozenThroughDate: string;
  inFrozenCutoffRange: boolean;
  payrollMonthLocked: boolean;
  reviewFrozen: boolean;
  /** True only after ICT midnight on the cutoff date. */
  cutoffReached: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  readOnlyReason: string | null;
};

type AttendanceRowLike = {
  clockIn?: unknown;
  clockOut?: unknown;
  correctionAt?: unknown;
  status?: unknown;
};

/** Row already has payroll-relevant data (not a blank roster shell). */
export function attendanceRecordHasPersistedData(row: AttendanceRowLike | null | undefined): boolean {
  if (!row) return false;
  const hasClockIn = row.clockIn != null && String(row.clockIn).trim() !== '';
  const hasClockOut = row.clockOut != null && String(row.clockOut).trim() !== '';
  const hasCorrection = row.correctionAt != null && String(row.correctionAt).trim() !== '';
  const status = String(row.status ?? '').trim().toUpperCase();
  return hasClockIn || hasClockOut || hasCorrection || status.length > 0;
}

export function dateInInclusiveRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/**
 * Resolve whether attendance input is allowed for a calendar date.
 * - Lock applies only after ICT midnight on the yellow cutoff date.
 * - Only dates in the salary window through cutoff are blocked for HR edits.
 * - Dates after the cutoff stay editable (next salary period).
 * - Employee self-service clock-in / clock-out bypass these asserts (routes skip them).
 */
export async function resolveAttendanceFreezePolicy(
  recordDate: string,
  payrollGroupId = 'default'
): Promise<AttendanceFreezePolicy> {
  const date = recordDate.slice(0, 10);
  const salaryMonth = await resolveSalaryMonthForDate(date, payrollGroupId);
  const [period, cycle] = await Promise.all([
    getAttendancePeriod(salaryMonth, payrollGroupId),
    resolvePayrollCycleForMonth(salaryMonth, payrollGroupId),
  ]);

  const cutoffDate = (
    period.attendanceCutoffDate ??
    cycle.attendanceCutoffDate ??
    cycle.periodEnd
  ).slice(0, 10);
  const payPeriodStart = (period.payPeriodStart ?? cycle.periodStart).slice(0, 10);
  const payPeriodEnd = (period.payPeriodEnd ?? cycle.periodEnd).slice(0, 10);
  const frozenThroughDate = cutoffDate;
  const cutoffReached = isAttendanceCutoffReached(cutoffDate);
  const inFrozenCutoffRange = dateInInclusiveRange(date, payPeriodStart, frozenThroughDate);
  const reviewFrozen = period.status === 'LOCKED' || period.status === 'FINALIZED';
  const payrollMonthLocked = Boolean(await findLockedPayrollRunForMonth(salaryMonth, payrollGroupId));

  const base = {
    month: salaryMonth,
    date,
    attendancePeriodStatus: period.status,
    payPeriodStart,
    payPeriodEnd,
    frozenThroughDate,
    inFrozenCutoffRange,
    payrollMonthLocked,
    reviewFrozen,
    cutoffReached,
  };

  // Before midnight on cutoff: never lock (even if a freeze row or payroll run exists early).
  if (!cutoffReached || !inFrozenCutoffRange) {
    return {
      ...base,
      allowCreate: true,
      allowUpdate: true,
      readOnlyReason: null,
    };
  }

  // After midnight + payroll approved for this salary month: hard lock HR edits in-range dates only.
  // Employee self-service clock-in / clock-out intentionally bypass these asserts.
  if (payrollMonthLocked) {
    return {
      ...base,
      allowCreate: false,
      allowUpdate: false,
      readOnlyReason:
        `Payroll for ${salaryMonth} is approved. Attendance through ${frozenThroughDate} is view-only for HR edits — ` +
        'use payroll adjustment for corrections. Employee clock-in/out still works. Dates after the cutoff stay editable.',
    };
  }

  // After midnight + attendance period frozen for review:
  // HR edits of existing rows are locked; missing days can still be added.
  // Employee self-service clock-in / clock-out intentionally bypass these asserts.
  if (reviewFrozen) {
    return {
      ...base,
      allowCreate: true,
      allowUpdate: false,
      readOnlyReason:
        `Attendance through ${frozenThroughDate} is frozen for payroll review (locked after midnight ICT on the cutoff). ` +
        'HR edits to existing entries are view-only until reopened. Employee clock-in/out still works. ' +
        'Dates after the cutoff stay fully editable.',
    };
  }

  return {
    ...base,
    allowCreate: true,
    allowUpdate: true,
    readOnlyReason: null,
  };
}

function freezeError(policy: AttendanceFreezePolicy, mode: 'create' | 'update'): AttendanceFrozenError {
  if (policy.readOnlyReason) {
    return new AttendanceFrozenError(policy.readOnlyReason);
  }
  const verb = mode === 'create' ? 'create' : 'update';
  return new AttendanceFrozenError(
    `Cannot ${verb} attendance for ${policy.date} while payroll review inputs are locked.`
  );
}

/** Block edits to attendance when payroll is approved or the cutoff range is frozen for review. */
export async function assertAttendanceRecordEditable(
  recordDate: string,
  payrollGroupId = 'default'
): Promise<void> {
  const policy = await resolveAttendanceFreezePolicy(recordDate, payrollGroupId);
  if (!policy.allowUpdate) {
    throw freezeError(policy, 'update');
  }
}

/** Allow first-time attendance capture during review freeze; block changes to existing rows. */
export async function assertAttendanceRecordCreatable(
  recordDate: string,
  existingRow?: AttendanceRowLike | null,
  payrollGroupId = 'default'
): Promise<void> {
  const policy = await resolveAttendanceFreezePolicy(recordDate, payrollGroupId);
  if (!policy.allowCreate) {
    throw freezeError(policy, 'create');
  }
  if (
    policy.cutoffReached &&
    policy.reviewFrozen &&
    policy.inFrozenCutoffRange &&
    attendanceRecordHasPersistedData(existingRow)
  ) {
    throw freezeError(policy, 'update');
  }
}

export async function assertAttendanceRecordUpdatable(
  recordDate: string,
  existingRow?: AttendanceRowLike | null,
  payrollGroupId = 'default'
): Promise<void> {
  const policy = await resolveAttendanceFreezePolicy(recordDate, payrollGroupId);
  if (!policy.allowUpdate) {
    throw freezeError(policy, 'update');
  }
  if (
    policy.cutoffReached &&
    policy.reviewFrozen &&
    policy.inFrozenCutoffRange &&
    attendanceRecordHasPersistedData(existingRow)
  ) {
    throw freezeError(policy, 'update');
  }
}

export async function loadAttendanceRowForFreezeCheck(
  userId: string,
  dateKey: string
): Promise<AttendanceRowLike | null> {
  const row: any = await AttendanceRecord.findOne({
    where: { userId, date: dateKey },
  });
  return row ? (row.get({ plain: true }) as AttendanceRowLike) : null;
}

export async function isAttendanceDateFrozen(
  recordDate: string,
  payrollGroupId = 'default'
): Promise<boolean> {
  const policy = await resolveAttendanceFreezePolicy(recordDate, payrollGroupId);
  return !policy.allowUpdate;
}

/** True when an existing saved row in the cutoff range cannot be edited during review freeze. */
export async function isAttendanceRecordUpdateLocked(
  recordDate: string,
  existingRow?: AttendanceRowLike | null,
  payrollGroupId = 'default'
): Promise<boolean> {
  try {
    await assertAttendanceRecordUpdatable(recordDate, existingRow, payrollGroupId);
    return false;
  } catch (e) {
    if (e instanceof AttendanceFrozenError) return true;
    throw e;
  }
}
