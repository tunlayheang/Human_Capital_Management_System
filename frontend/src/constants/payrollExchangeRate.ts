/** Last-resort fallback when configured rate is not loaded yet (matches backend default). */
export const PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD = 4100;

export const PAYROLL_EXCHANGE_RATE_UPDATED_EVENT = 'hcms:payroll-exchange-rate-updated';

export function notifyPayrollExchangeRateUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PAYROLL_EXCHANGE_RATE_UPDATED_EVENT));
  }
}
