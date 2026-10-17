import { khrBracketRangeLabel, GDT_TAX_BRACKETS_KHR } from '../cambodiaSalaryTax.js';

export type PayrollTaxBracketApiRow = {
  min: number;
  max: number;
  rate: number;
  deduction: number;
  range: string;
  currency: 'KHR';
};

export const PAYROLL_TAX_OPEN_ENDED_MAX_KHR = 9_999_999_999;

export function isOpenEndedTaxBracketMax(max: number): boolean {
  return Number(max) >= PAYROLL_TAX_OPEN_ENDED_MAX_KHR;
}

function defaultKhrRows(): PayrollTaxBracketApiRow[] {
  return GDT_TAX_BRACKETS_KHR.map((b) => ({
    min: b.minKhr,
    max: b.maxKhr ?? PAYROLL_TAX_OPEN_ENDED_MAX_KHR,
    rate: b.rate,
    deduction: b.deductionKhr,
    range: khrBracketRangeLabel(b),
    currency: 'KHR' as const,
  }));
}

/** Repair invalid max/min and enforce continuity on policy load/save. */
export function sanitizeTaxBracketApiRows(
  rows: PayrollTaxBracketApiRow[] | undefined | null
): PayrollTaxBracketApiRow[] {
  if (!rows?.length) return defaultKhrRows();

  const gdtDefaults = defaultKhrRows();
  const sorted = [...rows]
    .map((b) => ({
      ...b,
      min: Math.max(0, Math.round(Number(b.min) || 0)),
      max: Math.round(Number(b.max) || 0),
      rate: Number(b.rate) || 0,
      deduction: Math.max(0, Math.round(Number(b.deduction ?? 0))),
      currency: 'KHR' as const,
    }))
    .sort((a, b) => a.min - b.min);

  if (sorted.length === gdtDefaults.length) {
    sorted.forEach((b, i) => {
      const g = gdtDefaults[i]!;
      if (b.rate !== g.rate) return;
      const badMax =
        b.max <= 0 || b.max < b.min || (!isOpenEndedTaxBracketMax(b.max) && b.max !== g.max);
      const badMin = b.min !== g.min;
      const badDeduction = b.deduction !== g.deduction;
      if (badMax) {
        b.min = g.min;
        b.max = g.max;
        b.deduction = g.deduction;
      } else if (badMin) {
        b.min = g.min;
        if (badDeduction) b.deduction = g.deduction;
      }
    });
  }

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    const isLast = i === sorted.length - 1;

    if (isOpenEndedTaxBracketMax(b.max)) {
      b.max = PAYROLL_TAX_OPEN_ENDED_MAX_KHR;
    } else if (b.max <= 0 || b.max < b.min) {
      const next = sorted[i + 1];
      if (!isLast && next && next.min > b.min) {
        b.max = next.min - 1;
      } else if (isLast) {
        b.max = PAYROLL_TAX_OPEN_ENDED_MAX_KHR;
      } else {
        b.max = b.min;
      }
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const b = sorted[i]!;
    if (!isOpenEndedTaxBracketMax(prev.max)) {
      b.min = prev.max + 1;
    }
  }

  return sorted.map((b) => ({
    ...b,
    max: isOpenEndedTaxBracketMax(b.max) ? PAYROLL_TAX_OPEN_ENDED_MAX_KHR : b.max,
    range: khrBracketRangeLabel({
      minKhr: b.min,
      maxKhr: isOpenEndedTaxBracketMax(b.max) ? null : b.max,
      rate: b.rate,
      deductionKhr: b.deduction,
    }),
  }));
}
