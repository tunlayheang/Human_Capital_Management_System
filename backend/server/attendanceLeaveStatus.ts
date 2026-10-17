import type { AttendanceStatusContext } from './attendanceStatusContext.js';

export type LeaveAttendanceStatus = 'PAID_LEAVE' | 'UNPAID_LEAVE';

/** Resolve paid vs unpaid leave for a calendar day from attendance context. */
export function resolveLeaveAttendanceStatus(
  dateKey: string,
  ctx: AttendanceStatusContext
): LeaveAttendanceStatus | null {
  const d = dateKey.slice(0, 10);
  if (ctx.approvedPaidLeaveDates.has(d)) return 'PAID_LEAVE';
  if (ctx.approvedUnpaidLeaveDates.has(d)) return 'UNPAID_LEAVE';
  if (ctx.rosterPaidLeaveDates.has(d)) return 'PAID_LEAVE';
  if (ctx.rosterUnpaidLeaveDates.has(d)) return 'UNPAID_LEAVE';
  return null;
}

/** Whether leave status should override clock-in / stored row status. */
export function shouldApplyLeaveAttendanceStatus(
  dateKey: string,
  ctx: AttendanceStatusContext,
  hasClockIn: boolean
): boolean {
  if (!resolveLeaveAttendanceStatus(dateKey, ctx)) return false;
  if (hasClockIn && ctx.approvedHalfDayLeaveDates.has(dateKey.slice(0, 10))) return false;
  return true;
}

/** Map legacy ON_LEAVE + leave paid flag to explicit status. */
export function normalizeStoredLeaveStatus(
  status: string,
  leaveIsPaid?: boolean | null
): string {
  const st = String(status ?? '').toUpperCase();
  if (st === 'PAID_LEAVE' || st === 'UNPAID_LEAVE') return st;
  if (st !== 'ON_LEAVE') return st;
  if (leaveIsPaid === false) return 'UNPAID_LEAVE';
  if (leaveIsPaid === true) return 'PAID_LEAVE';
  return st;
}
