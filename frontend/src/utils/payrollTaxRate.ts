import type { PayrollTaxBracket } from '../types';
import {
  computeGdtSalaryTaxUsd,
  computeSalaryTaxDual,
  computeSalaryTaxFromUsdBrackets,
  dependentDeductionUsd,
  gdtBracketsToUsd,
  GDT_DEPENDENT_DEDUCTION_KHR,
  GDT_TAX_BRACKETS_KHR,
  khrBracketRangeLabel,
  usdBracketsToKhr,
  type SalaryTaxBracketUsd,
} from './cambodiaSalaryTax';
import { sanitizePayrollTaxBrackets } from './payrollTaxBracketSanitize';

import {
  getConfiguredExchangeRateKhrPerUsd,
  resolveExchangeRateKhrPerUsd,
} from './payrollExchangeRateCache';
import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../constants/payrollExchangeRate';
import { usdToKhr } from './payrollRulesCurrency';

/** GDT monthly ToS (KHR) — primary policy input. */
export const CANONICAL_PAYROLL_TAX_BRACKETS_KHR: PayrollTaxBracket[] = GDT_TAX_BRACKETS_KHR.map(
  (b) => ({
    min: b.minKhr,
    max: b.maxKhr ?? 9_999_999_999,
    rate: b.rate,
    deduction: b.deductionKhr,
    range: khrBracketRangeLabel(b),
    currency: 'KHR' as const,
  })
);

/** GDT monthly ToS (USD @ 4,100 KHR/USD) — display reference only. */
export const CANONICAL_PAYROLL_TAX_BRACKETS_USD: PayrollTaxBracket[] = gdtBracketsToUsd(
  PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD
).map((b) => ({
  min: b.min,
  max: b.max,
  rate: b.rate,
  deduction: b.deduction,
  range: b.range ?? '',
  currency: 'USD' as const,
}));

function rowLooksKhr(b: Pick<PayrollTaxBracket, 'currency' | 'min' | 'max'>): boolean {
  if (b.currency === 'KHR') return true;
  if (b.currency === 'USD') return false;
  return Number(b.min) > 500_000 || Number(b.max) > 500_000;
}

export function normalizePayrollTaxBrackets(
  rows: PayrollTaxBracket[] | undefined | null,
  exchangeRateKhrPerUsd?: number
): PayrollTaxBracket[] {
  if (!rows?.length) return CANONICAL_PAYROLL_TAX_BRACKETS_KHR;
  const ex = resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured');
  const likelyUsd = rows.every((b) => !rowLooksKhr(b));
  const normalized = likelyUsd
    ? usdBracketsToKhr(
        rows.map((b) => ({
          min: b.min,
          max: b.max,
          rate: b.rate,
          deduction: Number(b.deduction ?? 0),
        })),
        ex
      ).map((b) => ({
        min: b.minKhr,
        max: b.maxKhr ?? 9_999_999_999,
        rate: b.rate,
        deduction: b.deductionKhr,
        range: khrBracketRangeLabel(b),
        currency: 'KHR' as const,
      }))
    : rows.map((b) => ({
        ...b,
        currency: 'KHR' as const,
      }));
  return sanitizePayrollTaxBrackets(normalized);
}

function toSalaryTaxBracketUsd(rows: PayrollTaxBracket[]): SalaryTaxBracketUsd[] {
  return rows.map((b) => ({
    min: b.min,
    max: b.max,
    rate: b.rate,
    deduction: Number(b.deduction ?? 0),
    range: b.range,
  }));
}

/** Monthly Tax on Salary — calculated in KHR, returns USD deduction amount. */
export function computeTaxOnSalary(
  monthlyGrossUsd: number,
  taxDependents: number,
  options?: {
    exchangeRateKhrPerUsd?: number;
    brackets?: PayrollTaxBracket[];
  }
): number {
  const ex = options?.exchangeRateKhrPerUsd ?? getConfiguredExchangeRateKhrPerUsd();
  const khrBrackets = options?.brackets
    ? normalizePayrollTaxBrackets(options.brackets).map((b) => ({
        minKhr: b.min,
        maxKhr: b.max >= 9_999_999_999 ? null : b.max,
        rate: b.rate,
        deductionKhr: Number(b.deduction ?? 0),
      }))
    : undefined;
  return computeSalaryTaxDual({
    monthlyGrossUsd,
    taxDependents,
    exchangeRateKhrPerUsd: ex,
    bracketsKhr: khrBrackets,
  }).taxOnSalaryUsd;
}

export { computeSalaryTaxDual };

function marginalRateForAmount(
  amount: number,
  brackets: PayrollTaxBracket[],
  exchangeRateKhrPerUsd: number
): number {
  const value = Math.max(0, Number(amount) || 0);
  const ex = resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured');
  const likelyUsd = brackets.length > 0 && brackets.every((b) => !rowLooksKhr(b));

  if (likelyUsd) {
    const sorted = brackets
      .map((b) => ({ min: b.min, max: b.max, rate: b.rate }))
      .sort((a, b) => a.min - b.min);
    for (const b of sorted) {
      const max = b.max >= 9_999_999 ? Infinity : b.max;
      if (value >= b.min && value <= max) return b.rate;
    }
    return sorted[sorted.length - 1]?.rate ?? 0;
  }

  const baseKhr = usdToKhr(value, ex);
  const sorted = normalizePayrollTaxBrackets(brackets, ex);
  for (const b of sorted) {
    const max = b.max >= 9_999_999 ? Infinity : b.max;
    if (baseKhr >= b.min && baseKhr <= max) return b.rate;
  }
  return sorted[sorted.length - 1]?.rate ?? 0;
}

/** Marginal bracket rate (%) for an already-dependent-adjusted taxable base (USD). */
export function marginalTaxRateForTaxableBase(
  taxableBaseUsd: number,
  brackets: PayrollTaxBracket[] = CANONICAL_PAYROLL_TAX_BRACKETS_USD,
  exchangeRateKhrPerUsd = getConfiguredExchangeRateKhrPerUsd()
): number {
  const rows =
    brackets === CANONICAL_PAYROLL_TAX_BRACKETS_USD || brackets.length === 0
      ? gdtBracketsToUsd(exchangeRateKhrPerUsd).map((b) => ({
          min: b.min,
          max: b.max,
          rate: b.rate,
          deduction: b.deduction,
          range: b.range ?? '',
          currency: 'USD' as const,
        }))
      : brackets;
  return marginalRateForAmount(taxableBaseUsd, rows, exchangeRateKhrPerUsd);
}

/** Marginal bracket rate (%) for a monthly taxable income amount (after dependent deductions). */
export function marginalTaxRateForIncome(
  income: number,
  brackets: PayrollTaxBracket[] = CANONICAL_PAYROLL_TAX_BRACKETS_USD,
  taxDependents = 0,
  exchangeRateKhrPerUsd = getConfiguredExchangeRateKhrPerUsd()
): number {
  const dep = dependentDeductionUsd(taxDependents, exchangeRateKhrPerUsd);
  const amount = Math.max(0, Number(income) || 0) - dep;
  return marginalTaxRateForTaxableBase(amount, brackets, exchangeRateKhrPerUsd);
}

export function taxBracketRangeForIncome(
  income: number,
  brackets: PayrollTaxBracket[] = CANONICAL_PAYROLL_TAX_BRACKETS_USD,
  taxDependents = 0,
  exchangeRateKhrPerUsd = getConfiguredExchangeRateKhrPerUsd()
): string {
  const dep = dependentDeductionUsd(taxDependents, exchangeRateKhrPerUsd);
  const amount = Math.max(0, Number(income) || 0) - dep;
  const ex = resolveExchangeRateKhrPerUsd(exchangeRateKhrPerUsd, 'configured');
  const rows =
    brackets === CANONICAL_PAYROLL_TAX_BRACKETS_USD || brackets.length === 0
      ? gdtBracketsToUsd(ex).map((b) => ({
          min: b.min,
          max: b.max,
          rate: b.rate,
          deduction: b.deduction,
          range: b.range ?? '',
          currency: 'USD' as const,
        }))
      : brackets;
  const likelyUsd = rows.every((b) => !rowLooksKhr(b));
  const lookup = likelyUsd ? amount : usdToKhr(amount, ex);
  const sorted = likelyUsd
    ? rows.map((b) => ({ min: b.min, max: b.max, range: b.range })).sort((a, b) => a.min - b.min)
    : normalizePayrollTaxBrackets(rows, ex);
  for (const b of sorted) {
    const max = b.max >= 9_999_999 ? Infinity : b.max;
    if (lookup >= b.min && lookup <= max) return b.range ?? '—';
  }
  return sorted[sorted.length - 1]?.range ?? '—';
}

export function formatTaxRateForStorage(rate: number): string {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}

export function formatTaxRateLabel(rate: number): string {
  return `${formatTaxRateForStorage(rate)}%`;
}

export function formatDependentAllowanceUsd(exchangeRateKhrPerUsd?: number): string {
  const usd = dependentDeductionUsd(1, exchangeRateKhrPerUsd ?? getConfiguredExchangeRateKhrPerUsd());
  return `$${usd.toFixed(2)} (${GDT_DEPENDENT_DEDUCTION_KHR.toLocaleString()} KHR)`;
}

/** GDT taxable base after dependent allowance (USD). */
export function taxableSalaryBaseUsd(
  monthlyGrossUsd: number,
  taxDependents: number,
  exchangeRateKhrPerUsd = getConfiguredExchangeRateKhrPerUsd()
): number {
  const dep = dependentDeductionUsd(taxDependents, exchangeRateKhrPerUsd);
  return Math.max(0, Math.round(((Number(monthlyGrossUsd) || 0) - dep) * 100) / 100);
}

export { dependentDeductionUsd };
