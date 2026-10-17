import { SystemSetting } from '../db.js';
import {
  invalidatePayrollWorkDayPolicyCache,
  normalizePayrollBasisDays,
  normalizePayrollWorkDayMethod,
  readPayrollWorkDayPolicyFromSystemSettings,
  type PayrollWorkDayPolicy,
} from './payrollBasisDaysService.js';
import { createPolicyVersion, getPolicyVersionDisplayMeta, listPolicyVersions, resolvePolicyPayloadForMonth } from './payrollPolicyVersionService.js';

export type PayrollWorkDayPolicyDetails = PayrollWorkDayPolicy & {
  effectiveFrom: string | null;
  scheduledEffectiveFrom: string | null;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

const LEGACY_EFFECTIVE_FROM = '2020-01-01';


export async function ensureWorkDayPolicyVersionBootstrap(): Promise<void> {
  const { ensureInitialPayrollPolicyVersions } = await import('./payrollPolicyVersionBootstrap.js');
  await ensureInitialPayrollPolicyVersions();

  const existing = await listPolicyVersions({ policyType: 'work_day_policy' });
  if (existing.length > 0) return;

  const legacy = await readPayrollWorkDayPolicyFromSystemSettings();
  await createPolicyVersion({
    policyType: 'work_day_policy',
    effectiveFrom: LEGACY_EFFECTIVE_FROM,
    payload: legacy,
    notes: 'Migrated from legacy payroll work-day system settings',
    createdBy: 'system-bootstrap',
  });
}

export async function getPayrollWorkDayPolicyForMonth(month?: string): Promise<PayrollWorkDayPolicy> {
  try {
    await ensureWorkDayPolicyVersionBootstrap();
    const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
    const resolved = await resolvePolicyPayloadForMonth<PayrollWorkDayPolicy>({
      policyType: 'work_day_policy',
      month: monthKey,
    });
    if (resolved?.payload) {
      return {
        method: normalizePayrollWorkDayMethod(resolved.payload.method),
        companyBasisDays: normalizePayrollBasisDays(
          resolved.payload.companyBasisDays
        ) as PayrollWorkDayPolicy['companyBasisDays'],
      };
    }
  } catch (err) {
    console.warn(
      '[payroll] Work-day policy version lookup failed; using system settings:',
      (err as Error)?.message || err
    );
  }
  return readPayrollWorkDayPolicyFromSystemSettings();
}

export async function getPayrollWorkDayPolicyDetails(month?: string): Promise<PayrollWorkDayPolicyDetails> {
  await ensureWorkDayPolicyVersionBootstrap();
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const resolved = await resolvePolicyPayloadForMonth<PayrollWorkDayPolicy>({
    policyType: 'work_day_policy',
    month: monthKey,
  });
  const meta = await getPolicyVersionDisplayMeta({ policyType: 'work_day_policy', month: monthKey });
  const policy = resolved?.payload
    ? {
        method: normalizePayrollWorkDayMethod(resolved.payload.method),
        companyBasisDays: normalizePayrollBasisDays(
          resolved.payload.companyBasisDays
        ) as PayrollWorkDayPolicy['companyBasisDays'],
      }
    : await readPayrollWorkDayPolicyFromSystemSettings();

  return {
    ...policy,
    effectiveFrom: meta.effectiveFrom,
    scheduledEffectiveFrom: meta.scheduledEffectiveFrom,
    lastUpdatedAt: meta.lastUpdatedAt,
    lastUpdatedBy: meta.lastUpdatedBy,
  };
}

export async function savePayrollWorkDayPolicyVersion(
  policy: PayrollWorkDayPolicy,
  effectiveFrom: string,
  createdBy?: string | null
): Promise<PayrollWorkDayPolicyDetails> {
  const { parseEffectiveFrom } = await import('./payrollPolicyVersionService.js');
  const effective_from = parseEffectiveFrom(effectiveFrom);
  const payload: PayrollWorkDayPolicy = {
    method: normalizePayrollWorkDayMethod(policy.method),
    companyBasisDays: normalizePayrollBasisDays(policy.companyBasisDays) as PayrollWorkDayPolicy['companyBasisDays'],
  };

  invalidatePayrollWorkDayPolicyCache();

  await createPolicyVersion({
    policyType: 'work_day_policy',
    effectiveFrom: effective_from,
    payload,
    notes: 'Payroll work-day policy update',
    createdBy: createdBy ?? null,
  });

  // Keep legacy settings in sync for older code paths until fully migrated.
  const upsert = async (key: string, value: unknown) => {
    const row = await SystemSetting.findOne({ where: { key } });
    if (row) await row.update({ value });
    else {
      await SystemSetting.create({
        id: `ss-${Date.now()}-${key}`,
        key,
        value,
        category: 'payroll',
      });
    }
  };
  await upsert('payroll.workDayMethod', payload.method);
  await upsert('payroll.companyBasisDays', payload.companyBasisDays);

  // Keep payroll.proration blob aligned — hybrid engine historically read work-day
  // fields from here and could lag behind the versioned policy card.
  const prorationRow = await SystemSetting.findOne({ where: { key: 'payroll.proration' } });
  const { parseSettingJsonObject } = await import('./payrollBasisDaysService.js');
  const prorationObj = prorationRow
    ? parseSettingJsonObject(prorationRow.get('value'))
    : {};
  const nextProration = {
    ...prorationObj,
    workDayMethod: payload.method,
    companyBasisDays: payload.companyBasisDays,
  };
  if (prorationRow) await prorationRow.update({ value: nextProration });
  else {
    await SystemSetting.create({
      id: `ss-${Date.now()}-payroll.proration`,
      key: 'payroll.proration',
      value: nextProration,
      category: 'payroll',
    });
  }

  // Fixed company basis applies to every employee (new + existing). Employee-basis
  // keeps each staff member’s own payroll_basis_days unchanged.
  if (payload.method === 'fixed_company_basis') {
    const { Employee } = await import('../db.js');
    await Employee.update(
      { payroll_basis_days: payload.companyBasisDays },
      { where: {} }
    );
  }

  return getPayrollWorkDayPolicyDetails(effective_from.slice(0, 7));
}
