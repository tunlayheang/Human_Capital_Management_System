import type { LeaveCategory } from './leaveTypeCategory.js';

export type LeaveBalanceComponents = {
  openingBalance: number;
  accrued: number;
  entitlement: number;
  carriedOver: number;
  used: number;
};

export function roundLeaveDays(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Snap to 0.5-day steps (0.5, 1, 1.5, …) — never values like 1.2 or 0.4. */
export function roundLeaveDaysToHalf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 2) / 2;
}

/**
 * Remaining days by category:
 * - accrual_based: Opening + Accrued + CF − Used (monthly earn limit)
 * - join_date_based / fixed_allocation: Entitlement + CF − Used (full yearly remaining;
 *   join-date types are not limited to this month’s accrual)
 */
export function computeLeaveRemaining(
  components: LeaveBalanceComponents,
  category: LeaveCategory
): number {
  const opening = roundLeaveDays(Number(components.openingBalance ?? 0));
  const accrued = roundLeaveDays(Number(components.accrued ?? 0));
  const entitlement = roundLeaveDays(Number(components.entitlement ?? 0));
  const carriedOver = roundLeaveDays(Number(components.carriedOver ?? 0));
  const used = roundLeaveDays(Number(components.used ?? 0));

  let total = 0;
  if (category === 'accrual_based') {
    total = opening + accrued + carriedOver - used;
  } else if (category === 'fixed_allocation' || category === 'join_date_based') {
    total = entitlement + carriedOver - used;
  }
  return roundLeaveDays(Math.max(0, total));
}

export function computeCarryForwardAmount(
  remaining: number,
  maxCarryForward: number,
  allowCarryForward: boolean
): number {
  if (!allowCarryForward || remaining <= 0) return 0;
  const cap = Math.max(0, Number(maxCarryForward ?? 0));
  return roundLeaveDays(cap > 0 ? Math.min(remaining, cap) : remaining);
}
