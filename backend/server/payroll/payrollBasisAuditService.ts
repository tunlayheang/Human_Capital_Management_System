/**
 * Payroll basis-days audit — employment proration and daily-rate divisor without roster data.
 */
import { computeFixedSalaryProration } from './hybridPayrollEngine.js';
import {
  buildPayrollBasisAuditExtras,
  getPayrollWorkDayPolicy,
  resolveEmployeePayrollBasisDays,
  type PayrollWorkDayPolicy,
} from './payrollBasisDaysService.js';
import type { ProrationMethod } from './prorationConfigService.js';
import { toDateKey } from './dateKey.js';

export const PAYROLL_BASIS_ENGINE_VERSION = 'basis_days_v1';

export type PayrollBasisAudit = {
  engineVersion: typeof PAYROLL_BASIS_ENGINE_VERSION;
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  totalCalendarDays: number;
  totalScheduledWorkingDays: number;
  eligibleWorkingDays: number;
  calculationMethod: ProrationMethod;
  dailyRateDivisor: number;
  payrollBasisDays: number;
  payrollWorkDayMethod: string;
  dailyRateSource: 'employee_basis' | 'company_basis' | 'legacy';
  prorationFactor: number;
  prorationReason: string | null;
  notEmployed: boolean;
  payrollProcessingType: 'MONTHLY' | 'FINAL_SETTLEMENT';
};

function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysInclusive(start: string, end: string): number {
  const a = parseYmd(start).getTime();
  const b = parseYmd(end).getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

export async function resolvePayrollBasisAuditForEmployee(params: {
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  terminationDate?: unknown;
  employeeBasisDays?: unknown;
  prorationMethod?: ProrationMethod;
  payrollProcessingType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
  workDayPolicy?: PayrollWorkDayPolicy;
}): Promise<PayrollBasisAudit> {
  const policy = params.workDayPolicy ?? (await getPayrollWorkDayPolicy());
  const payrollBasisDays = resolveEmployeePayrollBasisDays({
    policy,
    employeeBasisDays: params.employeeBasisDays,
  });
  const basisExtras = buildPayrollBasisAuditExtras({ policy, payrollBasisDays });
  const proration = computeFixedSalaryProration({
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    joinDate: params.joinDate,
    lastWorkingDate: params.lastWorkingDate,
    terminationDate: params.terminationDate,
    workDaysPerMonth: payrollBasisDays,
    prorationMethod: params.prorationMethod,
  });

  const periodStart = toDateKey(params.periodStart) ?? params.periodStart.slice(0, 10);
  const periodEnd = toDateKey(params.periodEnd) ?? params.periodEnd.slice(0, 10);

  return {
    engineVersion: PAYROLL_BASIS_ENGINE_VERSION,
    payrollPeriodStart: periodStart,
    payrollPeriodEnd: periodEnd,
    totalCalendarDays: daysInclusive(periodStart, periodEnd),
    totalScheduledWorkingDays: payrollBasisDays,
    eligibleWorkingDays: proration.eligibleDays,
    calculationMethod: params.prorationMethod ?? 'scheduled_shift_days',
    dailyRateDivisor: basisExtras.dailyRateDivisor,
    payrollBasisDays: basisExtras.payrollBasisDays,
    payrollWorkDayMethod: basisExtras.payrollWorkDayMethod,
    dailyRateSource:
      basisExtras.dailyRateSource === 'roster' ? 'legacy' : basisExtras.dailyRateSource,
    prorationFactor: proration.factor,
    prorationReason: proration.reason,
    notEmployed: proration.factor <= 0,
    payrollProcessingType: params.payrollProcessingType ?? 'MONTHLY',
  };
}
