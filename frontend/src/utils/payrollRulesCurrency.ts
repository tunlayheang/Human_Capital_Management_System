import type { PreferredCurrency } from './payrollCurrencyDisplay';
import { resolveExchangeRateKhrPerUsd } from './payrollExchangeRateCache';

export const PAYROLL_OPEN_ENDED_MAX_KHR = 9_999_999_999;
export const PAYROLL_OPEN_ENDED_MAX_USD = 9_999_999;

export function khrToUsd(khr: number, exchangeRateKhrPerUsd?: number): number {
  const ex = resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured');
  return Math.round((Number(khr) / ex) * 100) / 100;
}

/**
 * Convert USD → whole KHR by always rounding UP (ceiling).
 * Fractional riels after FX never short the employee/display amount.
 * Exact integers stay exact (tiny epsilon guards float noise).
 */
export function usdToKhr(usd: number, exchangeRateKhrPerUsd?: number): number {
  const u = Number(usd);
  const ex = resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured');
  if (!Number.isFinite(u) || !Number.isFinite(ex) || u <= 0 || ex <= 0) return 0;
  return Math.ceil(u * ex - 1e-9);
}

export function isOpenEndedKhrMax(max: number): boolean {
  return Number(max) >= PAYROLL_OPEN_ENDED_MAX_KHR;
}

export function formatUsdAmount(usd: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(usd) || 0);
}

export function formatKhrAmount(khr: number): string {
  return `${Math.round(Number(khr) || 0).toLocaleString()} KHR`;
}

/** Format a KHR-authoritative amount for rules UI. */
export function formatRulesAmountFromKhr(
  khr: number,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): string {
  if (currency === 'USD') return formatUsdAmount(khrToUsd(khr, exchangeRateKhrPerUsd));
  return formatKhrAmount(khr);
}

/** Format a USD-authoritative amount for rules UI. */
export function formatRulesAmountFromUsd(
  usd: number,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): string {
  if (currency === 'KHR') return formatKhrAmount(usdToKhr(usd, exchangeRateKhrPerUsd));
  return formatUsdAmount(usd);
}

export function formatTaxBracketRange(
  minKhr: number,
  maxKhr: number,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): string {
  if (currency === 'USD') {
    const min = khrToUsd(minKhr, exchangeRateKhrPerUsd);
    if (isOpenEndedKhrMax(maxKhr)) return `> ${formatUsdAmount(min)}`;
    const max = khrToUsd(maxKhr, exchangeRateKhrPerUsd);
    return `${formatUsdAmount(min)} – ${formatUsdAmount(max)}`;
  }
  const minLabel = Math.round(minKhr).toLocaleString();
  if (isOpenEndedKhrMax(maxKhr)) return `> ${minLabel} KHR`;
  return `${minLabel} – ${Math.round(maxKhr).toLocaleString()} KHR`;
}

export function formatNssfWageRangeDisplay(
  wageMinKhr: number,
  wageMaxKhr: number | null,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): string {
  if (currency === 'USD') {
    const min = formatUsdAmount(khrToUsd(wageMinKhr, exchangeRateKhrPerUsd));
    if (wageMaxKhr == null || wageMaxKhr >= PAYROLL_OPEN_ENDED_MAX_KHR) {
      return `${min} and above`;
    }
    if (wageMinKhr <= 0) {
      return `Below ${formatUsdAmount(khrToUsd(wageMaxKhr, exchangeRateKhrPerUsd))}`;
    }
    return `${min} – ${formatUsdAmount(khrToUsd(wageMaxKhr, exchangeRateKhrPerUsd))}`;
  }
  if (wageMaxKhr == null || wageMaxKhr >= PAYROLL_OPEN_ENDED_MAX_KHR) {
    return `${Math.round(wageMinKhr).toLocaleString()} Up`;
  }
  if (wageMinKhr <= 0) {
    return `Below ${Math.round(wageMaxKhr).toLocaleString()}`;
  }
  return `${Math.round(wageMinKhr).toLocaleString()} - ${Math.round(wageMaxKhr).toLocaleString()}`;
}

export function khrFieldLabel(base: string, currency: PreferredCurrency): string {
  return `${base} (${currency})`;
}

/** Display value for a KHR-backed input field. */
export function khrStorageToDisplayValue(
  khr: number,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): number | string {
  if (currency === 'USD') return khrToUsd(khr, exchangeRateKhrPerUsd);
  return Math.round(khr);
}

/** Parse user input for a KHR-backed field back to KHR storage. */
export function displayValueToKhrStorage(
  raw: string,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number,
  fallbackKhr: number
): number {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '' || trimmed === '.') return fallbackKhr;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallbackKhr;
  if (currency === 'USD') return usdToKhr(n, exchangeRateKhrPerUsd);
  return Math.round(n);
}

/** Display value for a USD-backed input field. */
export function usdStorageToDisplayValue(
  usd: number,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number
): number | string {
  if (currency === 'KHR') return usdToKhr(usd, exchangeRateKhrPerUsd);
  return Math.round(usd * 100) / 100;
}

/** Parse user input for a USD-backed field back to USD storage. */
export function displayValueToUsdStorage(
  raw: string,
  currency: PreferredCurrency,
  exchangeRateKhrPerUsd: number,
  fallbackUsd: number
): number {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '' || trimmed === '.') return fallbackUsd;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallbackUsd;
  if (currency === 'KHR') return khrToUsd(n, exchangeRateKhrPerUsd);
  return Math.round(n * 100) / 100;
}
