import { SystemSetting } from '../db.js';
import {
  DEFAULT_PAYROLL_BASIS_DAYS,
  DEFAULT_PAYROLL_WORK_DAY_METHOD,
  normalizePayrollBasisDays,
  normalizePayrollWorkDayMethod,
  parseSettingJsonObject,
  type PayrollWorkDayMethod,
} from './payrollBasisDaysService.js';

export type ProrationMethod = 'working_days' | 'calendar_days' | 'scheduled_shift_days';

export type ProrationConfig = {
  method: ProrationMethod;
  /** Fallback divisor when calendar cannot resolve scheduled days (legacy / misconfiguration). */
  workDaysPerMonth: number;
  /** When true (default), payroll uses calendar scheduled working days instead of workDaysPerMonth. */
  useCalendarEngine?: boolean;
  /** Salary daily-rate divisor policy (default: per-employee payroll basis days). */
  workDayMethod?: PayrollWorkDayMethod;
  /** Company-wide basis days when workDayMethod = fixed_company_basis. */
  companyBasisDays?: number;
};

const DEFAULT: ProrationConfig = {
  /** Roster still drives attendance; salary divisor uses payroll basis days by default. */
  method: 'scheduled_shift_days',
  workDaysPerMonth: DEFAULT_PAYROLL_BASIS_DAYS,
  useCalendarEngine: true,
  workDayMethod: DEFAULT_PAYROLL_WORK_DAY_METHOD,
  companyBasisDays: DEFAULT_PAYROLL_BASIS_DAYS,
};

export async function getProrationConfig(): Promise<ProrationConfig> {
  const row = await SystemSetting.findOne({ where: { key: 'payroll.proration' } });
  if (!row) return DEFAULT;
  const o = parseSettingJsonObject(row.get('value'));
  if (!Object.keys(o).length) return DEFAULT;
  const method = String(o.method ?? 'working_days');
  const valid: ProrationMethod[] = ['working_days', 'calendar_days', 'scheduled_shift_days'];
  return {
    method: valid.includes(method as ProrationMethod) ? (method as ProrationMethod) : 'working_days',
    workDaysPerMonth:
      Number(o.workDaysPerMonth) > 0 ? Number(o.workDaysPerMonth) : DEFAULT.workDaysPerMonth,
    /** Paid-day engine uses payroll basis days + attendance records (roster excluded). */
    useCalendarEngine: true,
    workDayMethod: normalizePayrollWorkDayMethod(o.workDayMethod ?? DEFAULT.workDayMethod),
    companyBasisDays: normalizePayrollBasisDays(o.companyBasisDays ?? DEFAULT.companyBasisDays),
  };
}

export function computeProrationFactor(params: {
  config: ProrationConfig;
  periodStart: string;
  periodEnd: string;
  effectiveStart: string;
  effectiveEnd: string;
  scheduledShiftDaysInRange?: number;
}): { factor: number; eligibleDays: number; totalDays: number } {
  const { config, periodStart, periodEnd, effectiveStart, effectiveEnd } = params;
  const elig =
    Math.max(
      0,
      Math.floor(
        (new Date(`${effectiveEnd}T12:00:00`).getTime() -
          new Date(`${effectiveStart}T12:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      ) + 1
    ) || 0;

  let total: number;
  if (config.method === 'calendar_days') {
    total =
      Math.floor(
        (new Date(`${periodEnd}T12:00:00`).getTime() -
          new Date(`${periodStart}T12:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      ) + 1;
  } else if (config.method === 'scheduled_shift_days') {
    total = params.scheduledShiftDaysInRange ?? config.workDaysPerMonth;
  } else {
    total = config.workDaysPerMonth;
  }

  const factor = total > 0 ? Math.min(1, Math.round((elig / total) * 10000) / 10000) : 0;
  return { factor, eligibleDays: Math.min(elig, total), totalDays: total };
}
