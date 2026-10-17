import { isInProbation } from './probationService.js';
import { normalizeJoinDateOnly, todayDateOnly } from './leaveAccrualRules.js';

export type AccrualEmployeeSnapshot = {
  status?: string | null;
  join_date?: string | Date | null;
  probation_period_months?: number | null;
  probation_confirmed_at?: string | Date | null;
  worker_type?: string | null;
  terminated_at?: string | Date | null;
  last_working_date?: string | Date | null;
  last_valid_working_date?: string | Date | null;
};

const ACCRUAL_BLOCKED_STATUSES = new Set([
  'draft',
  'profile_incomplete',
  'inactive',
  'terminated',
  'resigned',
  'suspended',
]);

function toDateOnly(value: string | Date | null | undefined): string | null {
  return normalizeJoinDateOnly(value);
}

/** Last calendar day of accrual month (YYYY-MM-DD). */
export function monthEndDate(accrualMonth: string): string {
  const year = Number.parseInt(accrualMonth.slice(0, 4), 10);
  const monthNum = Number.parseInt(accrualMonth.slice(5, 7), 10);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function isEmployeeEligibleForAccrualMonth(
  employee: AccrualEmployeeSnapshot,
  accrualMonth: string,
  options?: {
    blockAccrualDuringProbation?: boolean;
    /** YYYY-MM-DD; defaults to today. Accrual is blocked until join date. */
    asOfDate?: string | Date | null;
  }
): { eligible: boolean; reason?: string } {
  const status = String(employee.status ?? '')
    .trim()
    .toLowerCase();
  // Missing status must not be treated as Active.
  if (!status || ACCRUAL_BLOCKED_STATUSES.has(status)) {
    return { eligible: false, reason: status || 'missing_status' };
  }
  if (status !== 'active' && status !== 'pending_approval') {
    return { eligible: false, reason: status };
  }

  const monthEnd = monthEndDate(accrualMonth);
  const joinDate = normalizeJoinDateOnly(
    employee.join_date ??
      (employee as { joinDate?: string | Date | null }).joinDate
  );
  if (!joinDate) {
    return { eligible: false, reason: 'missing_join_date' };
  }
  if (joinDate > monthEnd) {
    return { eligible: false, reason: 'not_yet_joined' };
  }

  // Join later in the same month: do not accrue (or backfill) before the join day.
  const asOf = normalizeJoinDateOnly(options?.asOfDate) ?? todayDateOnly();
  if (joinDate > asOf) {
    return { eligible: false, reason: 'not_yet_joined' };
  }

  const separationDate =
    toDateOnly(employee.last_valid_working_date) ??
    toDateOnly(employee.last_working_date) ??
    toDateOnly(employee.terminated_at);

  if (separationDate && separationDate < monthEnd) {
    return { eligible: false, reason: 'separated_before_month_end' };
  }

  if (options?.blockAccrualDuringProbation) {
    if (isInProbation(employee, monthEnd)) {
      return { eligible: false, reason: 'probation' };
    }
  }

  return { eligible: true };
}
