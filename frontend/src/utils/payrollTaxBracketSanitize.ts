import type { PayrollTaxBracket } from '../types';
import { khrBracketRangeLabel } from './cambodiaSalaryTax';
import { CANONICAL_PAYROLL_TAX_BRACKETS_KHR } from './payrollTaxRate';

/** Open-ended GDT bracket ceiling (KHR). */
export const PAYROLL_TAX_OPEN_ENDED_MAX_KHR = 9_999_999_999;

export function isOpenEndedTaxBracketMax(max: number): boolean {
  return Number(max) >= PAYROLL_TAX_OPEN_ENDED_MAX_KHR;
}

export function parseKhrBracketField(raw: string, fallback: number): number {
  const trimmed = String(raw ?? '').trim();
  if (trimmed === '' || trimmed === '.') return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

function bracketRangeLabel(b: Pick<PayrollTaxBracket, 'min' | 'max' | 'rate' | 'deduction'>): string {
  return khrBracketRangeLabel({
    minKhr: b.min,
    maxKhr: isOpenEndedTaxBracketMax(b.max) ? null : b.max,
    rate: b.rate,
    deductionKhr: Math.round(Number(b.deduction ?? 0)),
  });
}

/** Repair invalid max/min and enforce continuity before save or after load. */
export function sanitizePayrollTaxBrackets(
  rows: PayrollTaxBracket[] | undefined | null
): PayrollTaxBracket[] {
  if (!rows?.length) return [...CANONICAL_PAYROLL_TAX_BRACKETS_KHR];

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

  if (sorted.length === CANONICAL_PAYROLL_TAX_BRACKETS_KHR.length) {
    sorted.forEach((b, i) => {
      const g = CANONICAL_PAYROLL_TAX_BRACKETS_KHR[i]!;
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
    range: bracketRangeLabel(b),
  }));
}

export function validatePayrollTaxBrackets(rows: PayrollTaxBracket[]): string[] {
  const errors: string[] = [];
  const sorted = [...rows].sort((a, b) => a.min - b.min);

  if (sorted.length === 0) {
    errors.push('At least one tax bracket is required.');
    return errors;
  }

  sorted.forEach((b, i) => {
    const label = `Bracket ${i + 1}`;
    if (b.min < 0) errors.push(`${label}: From (KHR) must be zero or positive.`);
    if (!isOpenEndedTaxBracketMax(b.max) && b.max < b.min) {
      errors.push(`${label}: To (KHR) must be at least ${b.min.toLocaleString()}.`);
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (!isOpenEndedTaxBracketMax(prev.max) && b.min !== prev.max + 1) {
        errors.push(
          `${label}: From should be ${(prev.max + 1).toLocaleString()} (previous To + 1).`
        );
      }
    }
  });

  const last = sorted[sorted.length - 1]!;
  if (!isOpenEndedTaxBracketMax(last.max)) {
    errors.push('Last bracket To (KHR) must be 9,999,999,999 for the open-ended top band.');
  }

  return errors;
}
