import { SystemSetting } from './db.js';
import { GDT_DEPENDENT_DEDUCTION_KHR } from './cambodiaSalaryTax.js';
import { refreshPayrollComplianceCache } from './payrollComplianceRuleService.js';

export const PAYROLL_EXCHANGE_RATE_SETTING_KEY = 'payroll.exchangeRateKhrPerUsd';
export const DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD = 4100;

export type PayrollExchangeRateDto = {
  /** Rate active for the current payroll month (engine). */
  exchangeRateKhrPerUsd: number;
  /** Most recently saved rate (settings card display). */
  latestExchangeRateKhrPerUsd?: number;
  dependentAllowanceUsd: number;
  dependentAllowanceKhr: number;
  isConfigured: boolean;
  effectiveFrom?: string | null;
  scheduledEffectiveFrom?: string | null;
  lastUpdatedAt?: string | null;
  lastUpdatedBy?: string | null;
};

function parseStoredRate(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'object' && raw !== null && 'rate' in raw) {
    const n = Number((raw as { rate?: unknown }).rate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const n = parseFloat(String(raw).replace(/"/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function dependentAllowanceUsdAtRate(exchangeRateKhrPerUsd: number): number {
  const ex = Math.max(1, Number(exchangeRateKhrPerUsd) || DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD);
  return Math.round((GDT_DEPENDENT_DEDUCTION_KHR / ex) * 100) / 100;
}

export { usdToKhr } from './usdToKhr.js';

/** Legacy system-settings reader — used for bootstrap only. */
export async function getLegacyPayrollExchangeRateFromSetting(): Promise<number> {
  try {
    const row = await SystemSetting.findOne({
      where: { key: PAYROLL_EXCHANGE_RATE_SETTING_KEY },
    });
    const parsed = parseStoredRate(row?.get('value'));
    if (parsed != null) return parsed;
  } catch {
    /* optional setting */
  }
  return DEFAULT_PAYROLL_EXCHANGE_RATE_KHR_PER_USD;
}

const exchangeCacheByMonth = new Map<string, number>();

/** Month rate from policy/history — finalized payslips keep their own `exchangeRateUsed`. */
export async function getPayrollExchangeRateKhrPerUsd(month?: string): Promise<number> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const hit = exchangeCacheByMonth.get(monthKey);
  if (hit != null) return hit;

  let rate: number | null = null;
  try {
    const { ensureInitialPayrollPolicyVersions } = await import(
      './payroll/payrollPolicyVersionBootstrap.js'
    );
    const { resolvePolicyPayloadForMonth } = await import('./payroll/payrollPolicyVersionService.js');
    await ensureInitialPayrollPolicyVersions();

    const resolved = await resolvePolicyPayloadForMonth<{ exchangeRateKhrPerUsd: number }>({
      policyType: 'exchange_rate',
      month: monthKey,
    });
    rate =
      resolved?.payload?.exchangeRateKhrPerUsd != null &&
      Number.isFinite(Number(resolved.payload.exchangeRateKhrPerUsd))
        ? Number(resolved.payload.exchangeRateKhrPerUsd)
        : null;
  } catch (err) {
    console.warn(
      '[payroll-exchange-rate] Policy rate lookup failed:',
      (err as Error)?.message || err
    );
  }

  if (rate == null) {
    try {
      const { getExchangeRateForDate } = await import('./exchangeRateService.js');
      const fromTable = await getExchangeRateForDate(`${monthKey}-01`);
      if (fromTable != null) rate = fromTable;
    } catch {
      /* optional table */
    }
  }

  if (rate == null) {
    rate = await getLegacyPayrollExchangeRateFromSetting();
  }

  exchangeCacheByMonth.set(monthKey, rate);
  return rate;
}

export async function getPayrollExchangeRateDetails(month?: string): Promise<PayrollExchangeRateDto> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);

  try {
    const { ensureInitialPayrollPolicyVersions } = await import(
      './payroll/payrollPolicyVersionBootstrap.js'
    );
    const {
      resolvePolicyPayloadForMonth,
      getPolicyVersionDisplayMeta,
      getLatestPolicyVersionPayload,
    } = await import('./payroll/payrollPolicyVersionService.js');
    await ensureInitialPayrollPolicyVersions();

    const resolved = await resolvePolicyPayloadForMonth<{ exchangeRateKhrPerUsd: number }>({
      policyType: 'exchange_rate',
      month: monthKey,
    });
    const meta = await getPolicyVersionDisplayMeta({ policyType: 'exchange_rate', month: monthKey });
    const latest = await getLatestPolicyVersionPayload<{ exchangeRateKhrPerUsd: number }>({
      policyType: 'exchange_rate',
    });

    const legacyConfigured = await SystemSetting.findOne({
      where: { key: PAYROLL_EXCHANGE_RATE_SETTING_KEY },
    });
    const legacyParsed = parseStoredRate(legacyConfigured?.get('value'));

    const activeRate = await getPayrollExchangeRateKhrPerUsd(monthKey);
    const latestRate =
      latest?.payload?.exchangeRateKhrPerUsd != null &&
      Number.isFinite(Number(latest.payload.exchangeRateKhrPerUsd))
        ? Number(latest.payload.exchangeRateKhrPerUsd)
        : null;
    const displayRate = latestRate ?? activeRate;
    const isConfigured = resolved != null || legacyParsed != null || latestRate != null;

    return {
      exchangeRateKhrPerUsd: activeRate,
      latestExchangeRateKhrPerUsd: displayRate,
      dependentAllowanceUsd: dependentAllowanceUsdAtRate(displayRate),
      dependentAllowanceKhr: GDT_DEPENDENT_DEDUCTION_KHR,
      isConfigured,
      effectiveFrom: meta.effectiveFrom,
      scheduledEffectiveFrom: meta.scheduledEffectiveFrom,
      lastUpdatedAt: meta.lastUpdatedAt,
      lastUpdatedBy: meta.lastUpdatedBy,
    };
  } catch (err) {
    console.warn(
      '[payroll-exchange-rate] Falling back to legacy/default rate:',
      (err as Error)?.message || err
    );
    const fallback = await getLegacyPayrollExchangeRateFromSetting();
    return {
      exchangeRateKhrPerUsd: fallback,
      latestExchangeRateKhrPerUsd: fallback,
      dependentAllowanceUsd: dependentAllowanceUsdAtRate(fallback),
      dependentAllowanceKhr: GDT_DEPENDENT_DEDUCTION_KHR,
      isConfigured: false,
      effectiveFrom: null,
      scheduledEffectiveFrom: null,
      lastUpdatedAt: null,
      lastUpdatedBy: null,
    };
  }
}

export async function setPayrollExchangeRateKhrPerUsd(
  nextRate: number,
  effectiveFrom: string,
  updatedBy?: string
): Promise<PayrollExchangeRateDto> {
  const rate = Number(nextRate);
  if (!Number.isFinite(rate) || rate < 1000 || rate > 20000) {
    throw Object.assign(
      new Error('Exchange rate must be between 1,000 and 20,000 KHR per USD.'),
      { statusCode: 400 }
    );
  }
  const rounded = Math.round(rate);
  const { createPolicyVersion, parseEffectiveFrom } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  const effective_from = parseEffectiveFrom(effectiveFrom);
  exchangeCacheByMonth.clear();

  await createPolicyVersion({
    policyType: 'exchange_rate',
    effectiveFrom: effective_from,
    payload: { exchangeRateKhrPerUsd: rounded },
    notes: 'Payroll exchange rate update',
    createdBy: updatedBy ?? null,
  });

  try {
    const { appendExchangeRate } = await import('./exchangeRateService.js');
    await appendExchangeRate({
      effectiveDate: effective_from.slice(0, 10),
      khrPerUsd: rounded,
      createdBy: updatedBy ?? null,
    });
  } catch {
    /* exchange_rates table optional until migrated */
  }

  try {
    await refreshPayrollComplianceCache();
  } catch (cacheErr) {
    console.error('[payroll-exchange-rate] Compliance cache refresh failed:', cacheErr);
  }

  return getPayrollExchangeRateDetails(effective_from.slice(0, 7));
}
