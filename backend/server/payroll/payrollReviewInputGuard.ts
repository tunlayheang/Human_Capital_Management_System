import { getAttendancePeriod } from './attendanceFinalizationService.js';
import { resolvePayrollCycleForMonth } from './payrollCalendarCycleService.js';
import {
  assertPayrollDateRangeInputsEditable,
  PayrollPeriodFrozenError,
} from './payrollPeriodFreezeService.js';
import { isAttendanceCutoffReached } from './payrollAttendanceCutoff.js';

export class PayrollReviewFrozenError extends Error {
  statusCode = 409;
  code = 'PAYROLL_REVIEW_FROZEN';
  constructor(message: string) {
    super(message);
    this.name = 'PayrollReviewFrozenError';
  }
}

function monthsInRange(start: string, end: string): string[] {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (e < s) return [];
  const out: string[] = [];
  let y = Number(s.slice(0, 4));
  let m = Number(s.slice(5, 7));
  const endY = Number(e.slice(0, 4));
  const endM = Number(e.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Block updates to leave / overtime / attendance corrections that touch a payroll-review
 * frozen cutoff range. New submissions remain allowed via the create paths.
 * Lock applies only after ICT midnight on the cutoff date; dates after cutoff stay editable.
 */
export async function assertPayrollReviewInputsUpdatableForRange(
  startDate: string,
  endDate: string,
  payrollGroupId = 'default'
): Promise<void> {
  const start = startDate.slice(0, 10);
  const end = (endDate || startDate).slice(0, 10);
  try {
    await assertPayrollDateRangeInputsEditable(start, end, payrollGroupId);
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError) {
      throw new PayrollReviewFrozenError(e.message);
    }
    throw e;
  }

  for (const month of monthsInRange(start, end)) {
    const period = await getAttendancePeriod(month, payrollGroupId);
    if (period.status !== 'FINALIZED' && period.status !== 'LOCKED') continue;
    const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
    const frozenThrough = (
      period.attendanceCutoffDate ??
      cycle.attendanceCutoffDate ??
      cycle.periodEnd
    ).slice(0, 10);
    if (!isAttendanceCutoffReached(frozenThrough)) continue;
    const rangeStart = (period.payPeriodStart ?? cycle.periodStart).slice(0, 10);
    if (rangesOverlap(start, end, rangeStart, frozenThrough)) {
      throw new PayrollReviewFrozenError(
        `Payroll review is in progress for ${month}. Data through ${frozenThrough} is view-only ` +
          'until attendance is reopened (locked after midnight ICT on the cutoff). ' +
          'Dates after the cutoff remain editable.'
      );
    }
  }
}
