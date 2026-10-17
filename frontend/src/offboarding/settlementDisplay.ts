export const SETTLEMENT_STATUS_VARIANT: Record<
  string,
  'neutral' | 'warning' | 'info' | 'success' | 'danger'
> = {
  DRAFT: 'neutral',
  HR_REVIEW: 'warning',
  FINANCE_REVIEW: 'info',
  MANAGEMENT_APPROVAL: 'info',
  APPROVED: 'success',
  PAID: 'success',
  REJECTED: 'danger',
  PENDING_PAYROLL_OFFBOARD: 'warning',
  PENDING_REMOVAL_APPROVAL: 'warning',
  LOCKED: 'neutral',
};

export function formatSettlementUsd(n: unknown): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
