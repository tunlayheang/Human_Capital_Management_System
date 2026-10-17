/**
 * Payroll basis days — contractual salary divisor (22 / 24 / 26), independent of roster scheduling.
 */
import { SystemSetting } from '../db.js';
import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';

export type PayrollWorkDayMethod = 'fixed_employee_basis' | 'fixed_company_basis';

export const PAYROLL_BASIS_DAY_OPTIONS = [22, 24, 26] as const;
export type PayrollBasisDaysValue = (typeof PAYROLL_BASIS_DAY_OPTIONS)[number];

export const DEFAULT_PAYROLL_BASIS_DAYS: PayrollBasisDaysValue = 26;
export const DEFAULT_PAYROLL_WORK_DAY_METHOD: PayrollWorkDayMethod = 'fixed_employee_basis';

export const MIN_PAYROLL_BASIS_DAYS = 1;
export const MAX_PAYROLL_BASIS_DAYS = 31;

export type PayrollWorkDayPolicy = {
  method: PayrollWorkDayMethod;
  companyBasisDays: PayrollBasisDaysValue;
};

const VALID_METHODS: PayrollWorkDayMethod[] = ['fixed_employee_basis', 'fixed_company_basis'];

export function normalizePayrollBasisDays(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < MIN_PAYROLL_BASIS_DAYS || n > MAX_PAYROLL_BASIS_DAYS) {
    return DEFAULT_PAYROLL_BASIS_DAYS;
  }
  return n;
}

export function normalizePayrollWorkDayMethod(raw: unknown): PayrollWorkDayMethod {
  const s = String(raw ?? '').trim();
  if (s === 'roster_based') return DEFAULT_PAYROLL_WORK_DAY_METHOD;
  if (VALID_METHODS.includes(s as PayrollWorkDayMethod)) {
    return s as PayrollWorkDayMethod;
  }
  return DEFAULT_PAYROLL_WORK_DAY_METHOD;
}

function unwrapSettingValue(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.parse(t);
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

/** Parse SystemSetting JSON values (handles JSON columns stored as strings or double-encoded). */
export function parseSettingJsonObject(raw: unknown): Record<string, unknown> {
  let v: unknown = unwrapSettingValue(raw);
  for (let i = 0; i < 3; i++) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
        continue;
      } catch {
        break;
      }
    }
    break;
  }
  return {};
}

/** Company payroll work-day policy from system settings. */
let workDayPolicyCache: PayrollWorkDayPolicy | null = null;
let workDayPolicyLoadedAt = 0;
const WORK_DAY_POLICY_CACHE_MS = 60_000;

export function invalidatePayrollWorkDayPolicyCache(): void {
  workDayPolicyCache = null;
  workDayPolicyLoadedAt = 0;
}

/** Legacy system-settings reader — used for bootstrap and fallback only. */
export async function readPayrollWorkDayPolicyFromSystemSettings(): Promise<PayrollWorkDayPolicy> {
  const [methodRow, basisRow, prorationRow] = await Promise.all([
    SystemSetting.findOne({ where: { key: 'payroll.workDayMethod' } }),
    SystemSetting.findOne({ where: { key: 'payroll.companyBasisDays' } }),
    SystemSetting.findOne({ where: { key: 'payroll.proration' } }),
  ]);

  let method = normalizePayrollWorkDayMethod(unwrapSettingValue(methodRow?.get('value')));
  let companyBasisDays = normalizePayrollBasisDays(
    unwrapSettingValue(basisRow?.get('value'))
  ) as PayrollBasisDaysValue;

  const prorationRaw = unwrapSettingValue(prorationRow?.get('value'));
  const prorationObj = parseSettingJsonObject(prorationRaw);
  if (Object.keys(prorationObj).length > 0) {
    if (prorationObj.workDayMethod != null) {
      method = normalizePayrollWorkDayMethod(prorationObj.workDayMethod);
    }
    if (prorationObj.companyBasisDays != null) {
      companyBasisDays = normalizePayrollBasisDays(prorationObj.companyBasisDays) as PayrollBasisDaysValue;
    }
  }

  return { method, companyBasisDays };
}

export async function getPayrollWorkDayPolicy(month?: string): Promise<PayrollWorkDayPolicy> {
  if (
    !month &&
    workDayPolicyCache &&
    Date.now() - workDayPolicyLoadedAt < WORK_DAY_POLICY_CACHE_MS
  ) {
    return workDayPolicyCache;
  }

  try {
    const { getPayrollWorkDayPolicyForMonth } = await import('./payrollWorkDayPolicyVersionService.js');
    const versioned = await getPayrollWorkDayPolicyForMonth(month);
    if (!month) {
      workDayPolicyCache = versioned;
      workDayPolicyLoadedAt = Date.now();
    }
    return versioned;
  } catch {
    /* fall through to legacy settings */
  }

  const policy = await readPayrollWorkDayPolicyFromSystemSettings();
  if (!month) {
    workDayPolicyCache = policy;
    workDayPolicyLoadedAt = Date.now();
  }
  return policy;
}

export function resolveEmployeePayrollBasisDays(params: {
  policy: PayrollWorkDayPolicy;
  employeeBasisDays?: unknown;
}): number {
  const { policy } = params;
  if (policy.method === 'fixed_company_basis') {
    return policy.companyBasisDays;
  }
  return normalizePayrollBasisDays(params.employeeBasisDays);
}

export function resolveDailyRateDivisor(params: {
  payrollBasisDays: number;
}): number {
  return Math.max(
    MIN_PAYROLL_BASIS_DAYS,
    Math.round(Number(params.payrollBasisDays) || DEFAULT_PAYROLL_BASIS_DAYS)
  );
}

export type PayrollBasisAuditExtras = {
  payrollBasisDays: number;
  payrollWorkDayMethod: PayrollWorkDayMethod;
  dailyRateDivisor: number;
  dailyRateSource: 'employee_basis' | 'company_basis' | 'legacy';
};

export function buildPayrollBasisAuditExtras(params: {
  policy: PayrollWorkDayPolicy;
  payrollBasisDays: number;
}): PayrollBasisAuditExtras {
  const payrollBasisDays = resolveDailyRateDivisor({ payrollBasisDays: params.payrollBasisDays });
  const dailyRateDivisor = payrollBasisDays;
  let dailyRateSource: PayrollBasisAuditExtras['dailyRateSource'] = 'employee_basis';
  if (params.policy.method === 'fixed_company_basis') dailyRateSource = 'company_basis';
  else if (!params.payrollBasisDays) dailyRateSource = 'legacy';

  return {
    payrollBasisDays,
    payrollWorkDayMethod: params.policy.method,
    dailyRateDivisor,
    dailyRateSource,
  };
}

export function legacyFallbackBasisDays(): number {
  return LEGACY_WORK_DAYS_PER_MONTH;
}
