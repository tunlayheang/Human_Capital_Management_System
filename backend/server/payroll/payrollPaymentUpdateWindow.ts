import { businessDateKey } from '../payrollRunNotificationService.js';

/**
 * After a payroll run is approved/locked, Payment disbursement (Paid / Holding / Pending)
 * and related payment-batch mutations stay editable for one calendar month (ICT), then are
 * permanently blocked.
 *
 * Anchor priority: lockedAt → calculatedAt → createdAt.
 */

export class PayrollPaymentUpdateWindowClosedError extends Error {
  statusCode = 409;
  code = 'PAYROLL_PAYMENT_WINDOW_CLOSED';
  editableUntil: string | null;

  constructor(month: string, editableUntil: string | null) {
    const untilLabel = editableUntil || 'the grace period';
    super(
      `Payment updates for ${month || 'this payroll run'} are closed. ` +
        `Changes were allowed only until ${untilLabel} (1 month after approval).`
    );
    this.name = 'PayrollPaymentUpdateWindowClosedError';
    this.editableUntil = editableUntil;
  }
}

function parseIsoDate(raw: unknown): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Add one calendar month in ICT calendar date space (YYYY-MM-DD). */
export function addOneCalendarMonthIct(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? '').trim());
  if (!m) return dateKey;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const day = Number(m[3]);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

export type PayrollPaymentUpdateWindow = {
  /** When false, Paid / Holding / Pending (and payment batches) must not change. */
  paymentUpdatesAllowed: boolean;
  /** ICT date the run was approved/locked (or fallback). */
  paymentUpdateAnchorDate: string | null;
  /** Last ICT date inclusive when updates are allowed (anchor + 1 calendar month). */
  paymentEditableUntil: string | null;
};

export function resolvePayrollPaymentUpdateWindow(
  run: {
    lockedAt?: unknown;
    calculatedAt?: unknown;
    createdAt?: unknown;
    month?: unknown;
  },
  now = new Date()
): PayrollPaymentUpdateWindow {
  const anchorInstant =
    parseIsoDate(run.lockedAt) ||
    parseIsoDate(run.calculatedAt) ||
    parseIsoDate(run.createdAt);

  if (!anchorInstant) {
    // Legacy rows with no timestamps — keep editable so ops can finish payment once.
    return {
      paymentUpdatesAllowed: true,
      paymentUpdateAnchorDate: null,
      paymentEditableUntil: null,
    };
  }

  const anchorDate = businessDateKey(anchorInstant);
  const editableUntil = addOneCalendarMonthIct(anchorDate);
  const today = businessDateKey(now);
  return {
    paymentUpdatesAllowed: today <= editableUntil,
    paymentUpdateAnchorDate: anchorDate,
    paymentEditableUntil: editableUntil,
  };
}

export function assertPayrollPaymentUpdatesAllowed(
  run: {
    lockedAt?: unknown;
    calculatedAt?: unknown;
    createdAt?: unknown;
    month?: unknown;
  },
  now = new Date()
): PayrollPaymentUpdateWindow {
  const window = resolvePayrollPaymentUpdateWindow(run, now);
  if (!window.paymentUpdatesAllowed) {
    throw new PayrollPaymentUpdateWindowClosedError(
      String(run.month ?? ''),
      window.paymentEditableUntil
    );
  }
  return window;
}
