import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../constants/payrollExchangeRate';

let configuredExchangeRateKhrPerUsd: number | null = null;
let activeExchangeRateKhrPerUsd: number | null = null;

export function setPayrollExchangeRateCache(details: {
  configured?: number | null;
  active?: number | null;
}): void {
  const configured = sanitizeRate(details.configured);
  const active = sanitizeRate(details.active);
  if (configured != null) configuredExchangeRateKhrPerUsd = configured;
  if (active != null) activeExchangeRateKhrPerUsd = active;
}

export function clearPayrollExchangeRateCache(): void {
  configuredExchangeRateKhrPerUsd = null;
  activeExchangeRateKhrPerUsd = null;
}

function sanitizeRate(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000 || n > 20_000) return null;
  return Math.round(n);
}

/** Configured rate from Payroll Rules (latest saved, else active month). */
export function getConfiguredExchangeRateKhrPerUsd(): number {
  return (
    configuredExchangeRateKhrPerUsd ??
    activeExchangeRateKhrPerUsd ??
    PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
  );
}

/** Rate active for the current payroll month (engine). */
export function getActiveExchangeRateKhrPerUsd(): number {
  return (
    activeExchangeRateKhrPerUsd ??
    configuredExchangeRateKhrPerUsd ??
    PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
  );
}

export function resolveExchangeRateKhrPerUsd(
  explicit?: number | null,
  mode: 'configured' | 'active' = 'configured'
): number {
  const sanitized = sanitizeRate(explicit);
  if (sanitized != null) return sanitized;
  return mode === 'active'
    ? getActiveExchangeRateKhrPerUsd()
    : getConfiguredExchangeRateKhrPerUsd();
}
