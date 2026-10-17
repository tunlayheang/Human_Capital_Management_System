import {
  formatKhrAmount,
  formatRulesAmountFromUsd,
  formatUsdAmount,
  khrToUsd,
  usdToKhr,
} from './payrollRulesCurrency';
import { resolveExchangeRateKhrPerUsd } from './payrollExchangeRateCache';

export type ContractCurrency = 'USD' | 'KHR';

/** Normalize salary / movement currency — defaults to USD. */
export function normalizeContractCurrency(raw: unknown): ContractCurrency {
  return String(raw ?? 'USD').trim().toUpperCase() === 'KHR' ? 'KHR' : 'USD';
}

/** Convert a user-entered contract amount to USD for payroll engine + range checks. */
export function contractInputToUsd(
  amount: number,
  currency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (currency === 'KHR') return khrToUsd(n, exchangeRateKhrPerUsd);
  return Math.round(n * 100) / 100;
}

/** Format a USD-authoritative engine amount for the selected contract currency only. */
export function formatContractMoneyFromUsd(
  usd: number,
  currency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): string {
  return formatRulesAmountFromUsd(usd, currency, exchangeRateKhrPerUsd);
}

/** Format a stored contract amount in its native currency (no dual display). */
export function formatContractMoneyAmount(
  amount: number,
  currency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): string {
  const c = normalizeContractCurrency(currency);
  if (c === 'KHR') return formatKhrAmount(Math.round(amount));
  return formatUsdAmount(amount);
}

/** Convert an amount between contract currencies via USD. */
export function convertContractAmount(
  amount: number,
  fromCurrency: ContractCurrency,
  toCurrency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): number {
  const from = normalizeContractCurrency(fromCurrency);
  const to = normalizeContractCurrency(toCurrency);
  if (from === to) return amount;
  const usd = contractInputToUsd(amount, from, exchangeRateKhrPerUsd);
  if (to === 'KHR') return usdToKhr(usd, exchangeRateKhrPerUsd);
  return usd;
}

/** Whether two contract amounts represent the same pay (compared in USD). */
export function contractAmountsEqual(
  a: number,
  aCurrency: ContractCurrency,
  b: number,
  bCurrency: ContractCurrency,
  exchangeRateKhrPerUsd: number,
  toleranceUsd = 0.005
): boolean {
  const usdA = contractInputToUsd(a, normalizeContractCurrency(aCurrency), exchangeRateKhrPerUsd);
  const usdB = contractInputToUsd(b, normalizeContractCurrency(bCurrency), exchangeRateKhrPerUsd);
  return Math.abs(usdA - usdB) < toleranceUsd;
}

/** Format a stored amount for display in a different contract currency. */
export function formatContractMoneyInCurrency(
  amount: number,
  amountCurrency: ContractCurrency,
  displayCurrency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): string {
  const stored = normalizeContractCurrency(amountCurrency);
  const display = normalizeContractCurrency(displayCurrency);
  if (stored === display) {
    return formatContractMoneyAmount(amount, stored, exchangeRateKhrPerUsd);
  }
  const usd = contractInputToUsd(amount, stored, exchangeRateKhrPerUsd);
  return formatContractMoneyFromUsd(usd, display, exchangeRateKhrPerUsd);
}

/** String for a salary input after converting between currencies. */
export function formatContractAmountForInput(
  amount: number,
  currency: ContractCurrency
): string {
  const c = normalizeContractCurrency(currency);
  if (c === 'KHR') return String(Math.round(amount));
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Format a pay change delta with an explicit + or - prefix. */
export function formatSignedContractMoneyDelta(
  deltaUsd: number,
  displayCurrency: ContractCurrency,
  exchangeRateKhrPerUsd: number
): string {
  const n = Number(deltaUsd);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '';
  const sign = n > 0 ? '+' : '-';
  const absFormatted = formatContractMoneyFromUsd(
    Math.abs(n),
    normalizeContractCurrency(displayCurrency),
    exchangeRateKhrPerUsd
  );
  return `${sign}${absFormatted}`;
}

/** Format a signed percentage for pay-change summaries. */
export function formatSignedPercentChange(percent: number): string {
  const n = Number(percent);
  if (!Number.isFinite(n) || Math.abs(n) < 0.05) return '0%';
  const rounded = Math.round(n * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const body = abs % 1 === 0 ? String(abs.toFixed(0)) : abs.toFixed(1);
  return `${sign}${body}%`;
}

/**
 * Pay change as (new − old) / old, compared in USD when currencies differ.
 * Returns null when unchanged; "New" when there is no prior base salary.
 */
export function formatSalaryChangePercent(params: {
  fromAmount: number;
  fromCurrency: unknown;
  toAmount: number;
  toCurrency: unknown;
  exchangeRateKhrPerUsd?: number;
}): string | null {
  const rate = resolveExchangeRateKhrPerUsd(params.exchangeRateKhrPerUsd, 'configured');
  const fromCur = normalizeContractCurrency(params.fromCurrency);
  const toCur = normalizeContractCurrency(params.toCurrency);
  const from = Number(params.fromAmount);
  const to = Number(params.toAmount);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  const fromUsd = from > 0 ? contractInputToUsd(from, fromCur, rate) : 0;
  const toUsd = to > 0 ? contractInputToUsd(to, toCur, rate) : 0;
  if (Math.abs(toUsd - fromUsd) < 0.005) return null;
  if (fromUsd < 0.005) return 'New';

  return formatSignedPercentChange(((toUsd - fromUsd) / fromUsd) * 100);
}

export { formatUsdAmount, formatKhrAmount, khrToUsd, usdToKhr };
