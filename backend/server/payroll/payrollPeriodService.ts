import { resolvePayrollCycleForMonth } from './payrollCalendarCycleService.js';
import type { PayrollPeriodBounds } from './hybridPayrollTypes.js';
import type { ResolvedPayrollCycle } from './payrollCalendarCycleTypes.js';

/** Legacy fixed divisor — only for historical snapshots and explicit fallback. */
export const LEGACY_WORK_DAYS_PER_MONTH = 26;

/** @deprecated Use calendar `totalScheduledWorkingDays` from payroll audit. */
export const WORK_DAYS_PER_MONTH = LEGACY_WORK_DAYS_PER_MONTH;

/** Calendar-driven pay period bounds (single source of truth). */
export async function resolvePayrollPeriod(
  month: string,
  payrollGroupId = 'default'
): Promise<PayrollPeriodBounds & { cycle: ResolvedPayrollCycle }> {
  const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
  return {
    month: cycle.month,
    payPeriodStart: cycle.periodStart,
    payPeriodEnd: cycle.periodEnd,
    attendanceCutoffDate: cycle.attendanceCutoffDate,
    cycle,
  };
}

/** Attendance rows included in payroll for this period (respects cutoff-to-cutoff window). */
export function filterAttendanceForPayroll<T extends { date?: string }>(
  records: T[],
  monthPrefix: string,
  attendanceCutoffDate: string | null,
  periodBounds?: { periodStart?: string | null; periodEnd?: string | null }
): T[] {
  const periodStart = periodBounds?.periodStart?.slice(0, 10) || null;
  const periodEnd =
    periodBounds?.periodEnd?.slice(0, 10) ||
    attendanceCutoffDate?.slice(0, 10) ||
    null;
  return records.filter((r) => {
    const d = String(r.date ?? '').slice(0, 10);
    if (!d) return false;
    if (periodStart && periodEnd) {
      if (d < periodStart || d > periodEnd) return false;
      if (attendanceCutoffDate && d > attendanceCutoffDate.slice(0, 10)) return false;
      return true;
    }
    // Legacy fallback: calendar-month prefix + cutoff.
    if (!d.startsWith(monthPrefix)) return false;
    if (attendanceCutoffDate && d > attendanceCutoffDate.slice(0, 10)) return false;
    return true;
  });
}
