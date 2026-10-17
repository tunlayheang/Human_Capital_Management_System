import { resolveExchangeRateKhrPerUsd } from './payrollExchangeRateCache';
import { usdToKhr } from './payrollRulesCurrency';

export type PreferredCurrency = 'KHR' | 'USD';
/** @deprecated Use PreferredCurrency */
export type PayrollDisplayCurrency = PreferredCurrency;

const STORAGE_KEY = 'hcms.payroll.displayCurrency';

export function getPayrollDisplayCurrency(): PreferredCurrency {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'KHR' ? 'KHR' : 'USD';
  } catch {
    return 'USD';
  }
}

export function setPayrollDisplayCurrency(currency: PreferredCurrency): void {
  try {
    localStorage.setItem(STORAGE_KEY, currency);
  } catch {
    /* ignore */
  }
}

export function formatPayrollMoney(
  usd: number,
  options?: {
    currency?: PreferredCurrency;
    khr?: number | null;
    exchangeRate?: number;
  }
): string {
  const currency = options?.currency ?? getPayrollDisplayCurrency();
  const rate = resolveExchangeRateKhrPerUsd(options?.exchangeRate, 'configured');
  if (currency === 'KHR') {
    const khr = options?.khr != null ? Math.round(options.khr) : usdToKhr(usd, rate);
    return `${khr.toLocaleString()} KHR`;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}

/** Compact label for dashboard cards (e.g. 4.1M KHR or $4.1k). */
export function formatPayrollCompact(
  usd: number,
  options?: { currency?: PreferredCurrency; exchangeRate?: number }
): string {
  const currency = options?.currency ?? getPayrollDisplayCurrency();
  const rate = resolveExchangeRateKhrPerUsd(options?.exchangeRate, 'configured');
  const amount = Number(usd) || 0;
  if (amount <= 0) return '—';
  if (currency === 'KHR') {
    const khr = usdToKhr(amount, rate);
    if (khr >= 1_000_000) return `${(khr / 1_000_000).toFixed(1)}M KHR`;
    if (khr >= 1_000) return `${(khr / 1_000).toFixed(1)}k KHR`;
    return `${khr.toLocaleString()} KHR`;
  }
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}k`;
  return formatPayrollMoney(amount, { currency: 'USD', exchangeRate: rate });
}
