import type { Position } from '../types';

export function formatUsd(n: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function positionSalaryBounds(pos: Pick<Position, 'salaryMin' | 'salaryMax' | 'salary'>): {
  min: number;
  max: number;
} {
  const hasExplicitMin = pos.salaryMin != null && !Number.isNaN(Number(pos.salaryMin));
  const hasExplicitMax = pos.salaryMax != null && !Number.isNaN(Number(pos.salaryMax));
  if (hasExplicitMin && hasExplicitMax) {
    const min = Number(pos.salaryMin);
    const max = Number(pos.salaryMax);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  const legacy = Number(pos.salary) || 0;
  const min = hasExplicitMin ? Number(pos.salaryMin) : legacy;
  const max = hasExplicitMax ? Number(pos.salaryMax) : legacy;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function formatPositionSalaryRange(pos: Pick<Position, 'salaryMin' | 'salaryMax' | 'salary'>): string {
  const { min, max } = positionSalaryBounds(pos);
  if (min <= 0 && max <= 0) return 'Not set';
  if (min === max) return formatUsd(min);
  return `${formatUsd(min)} – ${formatUsd(max)}`;
}

/** True when the position has a configured salary range to enforce. */
export function hasPositionSalaryRange(pos: Pick<Position, 'salaryMin' | 'salaryMax' | 'salary'>): boolean {
  const hasExplicitMin = pos.salaryMin != null && !Number.isNaN(Number(pos.salaryMin));
  const hasExplicitMax = pos.salaryMax != null && !Number.isNaN(Number(pos.salaryMax));
  if (hasExplicitMin && hasExplicitMax) {
    const { min, max } = positionSalaryBounds(pos);
    return max > 0 && max >= min;
  }
  const legacy = Number(pos.salary) || 0;
  return legacy > 0;
}

/** Returns an error message when salary is outside the position range; null if valid or no range. */
export function validateSalaryInPositionRange(
  salary: number,
  pos: PositionSalaryBoundsSource
): string | null {
  if (!hasPositionSalaryRange(pos)) return null;
  const { min, max } = positionSalaryBounds(pos);
  const amount = Number(salary);
  if (!Number.isFinite(amount)) return 'Salary must be a number';
  if (amount < min || amount > max) {
    const title = String(pos.title ?? '').trim();
    const role = title ? ` for ${title}` : ' for this position';
    return `Salary must be between ${formatUsd(min)} and ${formatUsd(max)}${role}.`;
  }
  return null;
}

export type PositionSalaryBoundsSource = Pick<Position, 'salaryMin' | 'salaryMax' | 'salary'> &
  Partial<Pick<Position, 'title'>>;

/** React-hook-form / zod validate callback — returns error string or true when valid. */
export function validatePositionSalaryValue(
  value: unknown,
  pos: PositionSalaryBoundsSource | undefined
): true | string {
  if (!pos || !hasPositionSalaryRange(pos)) return true;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return true;
  return validateSalaryInPositionRange(amount, pos) ?? true;
}

export const EMPTY_POSITION_SALARY = { salaryMin: 0, salaryMax: 0 };
