/**
 * Cambodia GDT monthly Tax on Salary (ToS) — resident employees.
 * Official brackets are in KHR; payroll displays and stores USD at the active exchange rate.
 * Formula: Tax = (Taxable base × Rate%) − Deduction amount
 */

import { usdToKhr } from './usdToKhr.js';

export const GDT_DEPENDENT_DEDUCTION_KHR = 150_000;

export type GdtTaxBracketKhr = {
  minKhr: number;
  maxKhr: number | null;
  rate: number;
  deductionKhr: number;
};

/** GDT 2024+ monthly ToS table (KHR). */
export const GDT_TAX_BRACKETS_KHR: GdtTaxBracketKhr[] = [
  { minKhr: 0, maxKhr: 1_500_000, rate: 0, deductionKhr: 0 },
  { minKhr: 1_500_001, maxKhr: 2_000_000, rate: 5, deductionKhr: 75_000 },
  { minKhr: 2_000_001, maxKhr: 8_500_000, rate: 10, deductionKhr: 175_000 },
  { minKhr: 8_500_001, maxKhr: 12_500_000, rate: 15, deductionKhr: 600_000 },
  { minKhr: 12_500_001, maxKhr: null, rate: 20, deductionKhr: 1_225_000 },
];

export type SalaryTaxBracketUsd = {
  min: number;
  max: number;
  rate: number;
  deduction: number;
  range?: string;
};

export function gdtBracketsToUsd(
  exchangeRateKhrPerUsd: number
): SalaryTaxBracketUsd[] {
  const ex = Math.max(1, Number(exchangeRateKhrPerUsd) || 4100);
  return GDT_TAX_BRACKETS_KHR.map((b) => {
    const min = Math.round((b.minKhr / ex) * 100) / 100;
    const max =
      b.maxKhr == null ? 9_999_999 : Math.round((b.maxKhr / ex) * 100) / 100;
    const deduction = Math.round((b.deductionKhr / ex) * 100) / 100;
    const range =
      b.maxKhr == null
        ? `> $${min.toLocaleString()}`
        : `$${min.toLocaleString()} – $${max.toLocaleString()}`;
    return { min, max, rate: b.rate, deduction, range };
  });
}

export function dependentDeductionUsd(
  taxDependents: number,
  exchangeRateKhrPerUsd: number
): number {
  const ex = Math.max(1, Number(exchangeRateKhrPerUsd) || 4100);
  const n = Math.max(0, Math.floor(Number(taxDependents)) || 0);
  return Math.round(((n * GDT_DEPENDENT_DEDUCTION_KHR) / ex) * 100) / 100;
}

export type SalaryTaxBracketKhr = {
  minKhr: number;
  maxKhr: number | null;
  rate: number;
  deductionKhr: number;
};

export type SalaryTaxDualResult = {
  grossSalaryKhr: number;
  grossSalaryUsd: number;
  taxableIncomeKhr: number;
  taxableIncomeUsd: number;
  taxAmountKhr: number;
  taxAmountUsd: number;
  exchangeRateUsed: number;
  /** USD tax for deductions (alias of taxAmountUsd). */
  taxOnSalaryUsd: number;
};

function findBracketKhr(
  taxableBaseKhr: number,
  brackets: SalaryTaxBracketKhr[] = GDT_TAX_BRACKETS_KHR
): SalaryTaxBracketKhr {
  const base = Math.max(0, Math.round(taxableBaseKhr));
  const sorted = [...brackets].sort((a, b) => b.minKhr - a.minKhr);
  for (const b of sorted) {
    const max = b.maxKhr ?? Number.MAX_SAFE_INTEGER;
    if (base >= b.minKhr && base <= max) return b;
  }
  const fallback = [...brackets].sort((a, b) => a.minKhr - b.minKhr);
  return fallback[fallback.length - 1] ?? GDT_TAX_BRACKETS_KHR[GDT_TAX_BRACKETS_KHR.length - 1];
}

export function usdBracketsToKhr(
  brackets: SalaryTaxBracketUsd[],
  exchangeRateKhrPerUsd: number
): SalaryTaxBracketKhr[] {
  const ex = Math.max(1, Number(exchangeRateKhrPerUsd) || 4100);
  return brackets.map((b) => ({
    minKhr: usdToKhr(b.min, ex),
    maxKhr: b.max >= 9_999_999 ? null : usdToKhr(b.max, ex),
    rate: b.rate,
    deductionKhr: usdToKhr(b.deduction ?? 0, ex),
  }));
}

export function khrBracketRangeLabel(b: SalaryTaxBracketKhr): string {
  const min = b.minKhr.toLocaleString();
  if (b.maxKhr == null) return `> ${min} KHR`;
  return `${min} – ${b.maxKhr.toLocaleString()} KHR`;
}

/** Primary ToS calculation — always in KHR, stores both currencies. */
export function computeSalaryTaxDual(params: {
  monthlyGrossUsd: number;
  taxDependents: number;
  exchangeRateKhrPerUsd: number;
  bracketsKhr?: SalaryTaxBracketKhr[];
}): SalaryTaxDualResult {
  const ex = Math.max(1, Number(params.exchangeRateKhrPerUsd) || 4100);
  const grossUsd = Math.max(0, Number(params.monthlyGrossUsd) || 0);
  const grossKhr = usdToKhr(grossUsd, ex);
  const depKhr =
    Math.max(0, Math.floor(Number(params.taxDependents)) || 0) * GDT_DEPENDENT_DEDUCTION_KHR;
  const taxableIncomeKhr = Math.max(0, grossKhr - depKhr);
  const brackets = params.bracketsKhr?.length ? params.bracketsKhr : GDT_TAX_BRACKETS_KHR;
  const bracket = findBracketKhr(taxableIncomeKhr, brackets);
  const taxAmountKhr = Math.max(
    0,
    Math.round((taxableIncomeKhr * bracket.rate) / 100 - bracket.deductionKhr)
  );
  const taxableIncomeUsd = Math.round((taxableIncomeKhr / ex) * 100) / 100;
  const taxAmountUsd = Math.round((taxAmountKhr / ex) * 100) / 100;
  const grossSalaryUsd = Math.round(grossUsd * 100) / 100;

  return {
    grossSalaryKhr: grossKhr,
    grossSalaryUsd,
    taxableIncomeKhr,
    taxableIncomeUsd,
    taxAmountKhr,
    taxAmountUsd,
    exchangeRateUsed: ex,
    taxOnSalaryUsd: taxAmountUsd,
  };
}

function findBracketUsd(
  taxableBaseUsd: number,
  brackets: SalaryTaxBracketUsd[]
): SalaryTaxBracketUsd | null {
  const base = Math.max(0, Number(taxableBaseUsd) || 0);
  const sorted = [...brackets].sort((a, b) => b.min - a.min);
  for (const b of sorted) {
    const max = b.max >= 9_999_999 ? Infinity : b.max;
    if (base >= b.min && base <= max) return b;
  }
  const fallback = [...brackets].sort((a, b) => a.min - b.min);
  return fallback[fallback.length - 1] ?? null;
}

/** Compute monthly ToS in USD using official GDT KHR brackets. */
export function computeGdtSalaryTaxUsd(
  monthlyGrossUsd: number,
  taxDependents: number,
  exchangeRateKhrPerUsd: number
): number {
  return computeSalaryTaxDual({
    monthlyGrossUsd,
    taxDependents,
    exchangeRateKhrPerUsd,
  }).taxOnSalaryUsd;
}

/** Marginal GDT bracket rate (%) for an already-dependent-adjusted taxable base (USD). */
export function marginalTaxRateForTaxableBaseUsd(
  taxableBaseUsd: number,
  brackets?: SalaryTaxBracketUsd[],
  exchangeRateKhrPerUsd = 4100
): number {
  const base = Math.max(0, Number(taxableBaseUsd) || 0);
  const sorted = (brackets?.length ? brackets : gdtBracketsToUsd(exchangeRateKhrPerUsd))
    .slice()
    .sort((a, b) => a.min - b.min);
  for (const b of sorted) {
    const max = b.max >= 9_999_999 ? Infinity : b.max;
    if (base >= b.min && base <= max) return b.rate;
  }
  return sorted[sorted.length - 1]?.rate ?? 0;
}

/** Compute ToS using editable bracket rows — converts legacy USD rows to KHR, never taxes in USD. */
export function computeSalaryTaxFromUsdBrackets(
  monthlyGrossUsd: number,
  taxDependents: number,
  brackets: SalaryTaxBracketUsd[],
  exchangeRateKhrPerUsd: number
): number {
  const bracketsKhr = brackets.length
    ? usdBracketsToKhr(brackets, exchangeRateKhrPerUsd)
    : undefined;
  return computeSalaryTaxDual({
    monthlyGrossUsd,
    taxDependents,
    exchangeRateKhrPerUsd,
    bracketsKhr,
  }).taxOnSalaryUsd;
}

/** Dual-currency ToS from KHR bracket policy rows. */
export function computeSalaryTaxFromKhrBrackets(
  monthlyGrossUsd: number,
  taxDependents: number,
  bracketsKhr: SalaryTaxBracketKhr[],
  exchangeRateKhrPerUsd: number
): SalaryTaxDualResult {
  return computeSalaryTaxDual({
    monthlyGrossUsd,
    taxDependents,
    exchangeRateKhrPerUsd,
    bracketsKhr: bracketsKhr.length ? bracketsKhr : undefined,
  });
}
