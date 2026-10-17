/**
 * Employment-type period options aligned with Cambodia Labour Law:
 * - Full-Time / Part-Time → probation (Art. 68, max 3 months)
 * - Intern → internship / apprenticeship period (general max 2 years)
 * - Contract → fixed-duration contract (Art. 67, initial max 2 years)
 */

import {
  probationEndDate,
  type WorkerType,
} from './employeeProbation';

export type EmploymentType = 'Full-Time' | 'Part-Time' | 'Contract' | 'Intern';

export const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'Full-Time', label: 'Full-Time' },
  { value: 'Part-Time', label: 'Part-Time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Intern', label: 'Intern' },
];

/** Art. 68 — probation for undetermined-duration / regular employment. */
const PROBATION_MONTH_OPTIONS = [0, 1, 2, 3];
/** Apprenticeship / internship practice — general max 2 years. */
const INTERNSHIP_MONTH_OPTIONS = [1, 2, 3, 6, 12, 18, 24];
/** Art. 67 — fixed-duration contract initial term max 2 years. */
const CONTRACT_MONTH_OPTIONS = [1, 3, 6, 12, 18, 24];

export function normalizeEmploymentType(raw: unknown): EmploymentType {
  const s = String(raw ?? 'Full-Time')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (s === 'part-time' || s === 'parttime') return 'Part-Time';
  if (s === 'contract') return 'Contract';
  if (s === 'intern' || s === 'internship') return 'Intern';
  return 'Full-Time';
}

export function usesProbationPeriod(employmentType: unknown): boolean {
  const t = normalizeEmploymentType(employmentType);
  return t === 'Full-Time' || t === 'Part-Time';
}

export function maxPeriodMonthsForEmploymentType(employmentType: unknown): number {
  const t = normalizeEmploymentType(employmentType);
  if (t === 'Full-Time' || t === 'Part-Time') return 3;
  return 24;
}

export function defaultPeriodMonthsForEmploymentType(employmentType: unknown): number {
  const t = normalizeEmploymentType(employmentType);
  if (t === 'Full-Time' || t === 'Part-Time') return 3;
  if (t === 'Intern') return 6;
  return 12;
}

export function periodMonthOptionsForEmploymentType(
  employmentType: unknown
): { value: number; label: string }[] {
  const t = normalizeEmploymentType(employmentType);
  const months =
    t === 'Full-Time' || t === 'Part-Time'
      ? PROBATION_MONTH_OPTIONS
      : t === 'Intern'
        ? INTERNSHIP_MONTH_OPTIONS
        : CONTRACT_MONTH_OPTIONS;

  return months.map((m) => ({
    value: m,
    label:
      m === 0
        ? 'No probation'
        : m === 1
          ? '1 month'
          : `${m} months`,
  }));
}

export function periodFieldLabels(employmentType: unknown): {
  lengthLabel: string;
  endLabel: string;
  hint: string;
  endHint: string;
} {
  const t = normalizeEmploymentType(employmentType);
  if (t === 'Intern') {
    return {
      lengthLabel: 'Internship period',
      endLabel: 'Internship end',
      hint: 'Cambodia Labour Law — apprenticeship/internship generally max 2 years.',
      endHint: 'Auto-calculated from join date + internship period.',
    };
  }
  if (t === 'Contract') {
    return {
      lengthLabel: 'Contract period',
      endLabel: 'Contract end',
      hint: 'Cambodia Labour Law Art. 67 — fixed-duration contract max 2 years (initial term).',
      endHint: 'Auto-calculated from join date + contract period.',
    };
  }
  return {
    lengthLabel: 'Probation period',
    endLabel: 'Probation end',
    hint: 'Cambodia Labour Law Art. 68 — probation max 3 months for regular employees.',
    endHint: 'Auto-calculated from join date + probation period.',
  };
}

export function capPeriodMonthsForEmploymentType(
  months: number,
  employmentType: unknown
): number {
  const max = maxPeriodMonthsForEmploymentType(employmentType);
  const allowed = new Set(
    periodMonthOptionsForEmploymentType(employmentType).map((o) => o.value)
  );
  const n = Math.min(Math.max(0, Math.floor(Number(months) || 0)), max);
  if (allowed.has(n)) return n;
  // Snap to nearest allowed option at or below n.
  const descending = [...allowed].sort((a, b) => b - a);
  return descending.find((v) => v <= n) ?? defaultPeriodMonthsForEmploymentType(employmentType);
}

/**
 * Derive Art. 68 worker_type from selected probation months so backend caps stay valid
 * without a separate Worker Type control.
 */
export function workerTypeFromProbationMonths(months: number): WorkerType {
  const m = Math.max(0, Math.floor(Number(months) || 0));
  if (m <= 1) return 'non_specialized';
  if (m === 2) return 'specialized';
  return 'regular';
}

export function resolveWorkerTypeForEmployment(
  employmentType: unknown,
  periodMonths: number
): WorkerType {
  if (usesProbationPeriod(employmentType)) {
    return workerTypeFromProbationMonths(periodMonths);
  }
  // Contract / Intern are not Art. 68 probation — keep a neutral stored value.
  return 'regular';
}

export function engagementEndDate(
  joinDateRaw: unknown,
  periodMonths: number
): string | null {
  return probationEndDate(joinDateRaw, periodMonths);
}
