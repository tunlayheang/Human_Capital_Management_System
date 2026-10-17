import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';

export type PayrollContractRates = {
  /** For OT and grid — contract ÷ (work days × std hours), rounded. */
  hourlyRate: number;
  /** For grid display — hourly × std hours (always reconciles with hourly column). */
  dailyRate: number;
  /** Exact contract ÷ work days — leave/absence deductions (round per line item). */
  dailyRateExact: number;
};

/**
 * Single source for contract hourly/daily rates.
 * Display daily = hourly × std hours; deductions use exact daily (contract ÷ days).
 */
export function resolvePayrollContractRates(params: {
  contractBaseSalary: number;
  scheduledWorkingDays: number;
  standardHoursPerDay?: number;
}): PayrollContractRates {
  const days =
    params.scheduledWorkingDays > 0
      ? params.scheduledWorkingDays
      : LEGACY_WORK_DAYS_PER_MONTH;
  const std =
    params.standardHoursPerDay && params.standardHoursPerDay > 0
      ? params.standardHoursPerDay
      : 8;
  const contract = Number(params.contractBaseSalary) || 0;
  if (contract <= 0 || days <= 0) {
    return { hourlyRate: 0, dailyRate: 0, dailyRateExact: 0 };
  }
  const dailyRateExact = contract / days;
  const hourlyRate = Math.round((contract / (days * std)) * 100) / 100;
  const dailyRate = Math.round(hourlyRate * std * 100) / 100;
  return { hourlyRate, dailyRate, dailyRateExact };
}
