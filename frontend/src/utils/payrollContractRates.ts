const LEGACY_WORK_DAYS_PER_MONTH = 26;

export type PayrollContractRates = {
  hourlyRate: number;
  dailyRate: number;
  dailyRateExact: number;
};

/** Mirrors backend payrollContractRates.ts */
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
