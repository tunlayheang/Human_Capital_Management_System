import type { OvertimeRateTier } from '../overtimeTypes.js';
import { resolvePayrollContractRates } from './payrollContractRates.js';

export type ApprovedOvertimeHours = {
  hours100: number;
  hours150: number;
  hours200: number;
};

export type OvertimePayBreakdown = ApprovedOvertimeHours & {
  amount100: number;
  amount150: number;
  amount200: number;
  total: number;
  hourlyRate: number;
  multiplier100: number;
  multiplier150: number;
  multiplier200: number;
};

export function emptyApprovedOvertimeHours(): ApprovedOvertimeHours {
  return { hours100: 0, hours150: 0, hours200: 0 };
}

/** Map approved OT request rate tier → payroll buckets (1× / 1.5× / 2×). */
export function bucketOvertimeHoursByRateTier(
  rateTier: unknown,
  hours: unknown,
  into: ApprovedOvertimeHours
): void {
  const h = Number(hours) || 0;
  if (h <= 0) return;
  const tier = String(rateTier ?? '').trim() as OvertimeRateTier;
  if (tier === 'regular_100') {
    into.hours100 += h;
    return;
  }
  if (tier === 'daytime_150') {
    into.hours150 += h;
    return;
  }
  if (tier === 'rest_holiday_200' || tier === 'night_200') {
    into.hours200 += h;
    return;
  }
  // Legacy / missing tier defaults to weekday 150%.
  into.hours150 += h;
}

export function roundOvertimeHours(h: ApprovedOvertimeHours): ApprovedOvertimeHours {
  return {
    hours100: Math.round((h.hours100 ?? 0) * 100) / 100,
    hours150: Math.round(h.hours150 * 100) / 100,
    hours200: Math.round(h.hours200 * 100) / 100,
  };
}

/**
 * OT pay from approved request hours only (never attendance-inferred OT).
 * Hourly rate = contract base ÷ (scheduled work days × standard hours per day).
 */
export function computeOvertimePayUsd(params: {
  hours100?: number;
  hours150: number;
  hours200: number;
  contractBaseSalary: number;
  scheduledWorkingDays: number;
  standardHoursPerDay: number;
  multiplier100?: number;
  multiplier150?: number;
  multiplier200?: number;
}): OvertimePayBreakdown {
  const mult100 = params.multiplier100 ?? 1;
  const mult150 = params.multiplier150 ?? 1.5;
  const mult200 = params.multiplier200 ?? 2;
  const rates = resolvePayrollContractRates({
    contractBaseSalary: params.contractBaseSalary,
    scheduledWorkingDays: params.scheduledWorkingDays,
    standardHoursPerDay: params.standardHoursPerDay,
  });
  const hourlyRate = rates.hourlyRate;

  const hours100 = Math.max(0, params.hours100 ?? 0);
  const hours150 = Math.max(0, params.hours150);
  const hours200 = Math.max(0, params.hours200);
  const amount100 = Math.round(hours100 * hourlyRate * mult100 * 100) / 100;
  const amount150 = Math.round(hours150 * hourlyRate * mult150 * 100) / 100;
  const amount200 = Math.round(hours200 * hourlyRate * mult200 * 100) / 100;

  return {
    hours100,
    hours150,
    hours200,
    amount100,
    amount150,
    amount200,
    total: Math.round((amount100 + amount150 + amount200) * 100) / 100,
    hourlyRate,
    multiplier100: mult100,
    multiplier150: mult150,
    multiplier200: mult200,
  };
}
