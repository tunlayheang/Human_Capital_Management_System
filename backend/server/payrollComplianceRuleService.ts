import { PayrollComplianceRule } from './db.js';

export const COMPLIANCE_RULE_KEYS = [
  'minimum_wage',
  'nssf_occupational_risk',
  'nssf_healthcare',
  'nssf_pension',
  'seniority_indemnity',
  'overtime_multipliers',
] as const;

/** @deprecated Legacy key — migrated to nssf_occupational_risk + nssf_healthcare */
export const LEGACY_NSSF_HEALTH_KEY = 'nssf_health';

export type ComplianceRuleKey = (typeof COMPLIANCE_RULE_KEYS)[number];

export type PayrollComplianceRuleConfig = Record<string, number | string>;

export type PayrollComplianceRuleApiRow = {
  id: string;
  ruleKey: string;
  name: string;
  legalRef: string;
  description: string;
  config: PayrollComplianceRuleConfig;
  displayValue: string;
  sortOrder: number;
  effectiveFrom?: string | null;
  scheduledEffectiveFrom?: string | null;
  lastUpdatedAt?: string | null;
  lastUpdatedBy?: string | null;
};

export type PayrollComplianceEngineConfig = {
  minimumWageUsd: number;
  nssfOccupationalRiskEmployeePct: number;
  nssfOccupationalRiskEmployerPct: number;
  nssfHealthcareEmployeePct: number;
  nssfHealthcareEmployerPct: number;
  nssfPensionEmployeePct: number;
  nssfPensionEmployerPct: number;
  nssfPensionEmployeeCapKhr: number;
  nssfAssumedWageCapKhr: number;
  seniorityDaysPerYear: number;
  seniorityPayoutJuneDays: number;
  seniorityPayoutDecemberDays: number;
  otMultiplierNormal: number;
  otMultiplierPremium: number;
  exchangeRate: number;
};

export const DEFAULT_PAYROLL_COMPLIANCE_RULES: Array<{
  id: string;
  ruleKey: ComplianceRuleKey | typeof LEGACY_NSSF_HEALTH_KEY;
  name: string;
  legalRef: string;
  description: string;
  config: PayrollComplianceRuleConfig;
  sortOrder: number;
  isActive: boolean;
}> = [
  {
    id: 'pcr-minimum_wage',
    ruleKey: 'minimum_wage',
    name: 'Minimum Wage',
    legalRef: 'Prakas No. 222/23',
    description:
      'Applicable to garment, textile, footwear, and travel product sectors for 2024.',
    config: { amountUsd: 204, period: 'month' },
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'pcr-nssf_occupational_risk',
    ruleKey: 'nssf_occupational_risk',
    name: 'NSSF Occupational Risk',
    legalRef: 'NSSF / MLVT — Occupational Risk',
    description: '',
    config: { employeePct: 0, employerPct: 0.8 },
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 'pcr-nssf_healthcare',
    ruleKey: 'nssf_healthcare',
    name: 'NSSF Health Care',
    legalRef: 'NSSF / MLVT — Health Care',
    description: '',
    config: { employeePct: 0, employerPct: 2.6 },
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 'pcr-nssf_pension',
    ruleKey: 'nssf_pension',
    name: 'NSSF Pension Fund',
    legalRef: 'Sub-Decree No. 28',
    description: '',
    config: { employeePct: 2, employerPct: 2, employeeCapKhr: 24000, assumedWageCapKhr: 1200000 },
    sortOrder: 4,
    isActive: true,
  },
  {
    id: 'pcr-seniority_indemnity',
    ruleKey: 'seniority_indemnity',
    name: 'Seniority Indemnity',
    legalRef: 'Labor Law Art. 89',
    description:
      'Paid semi-annually (7.5 days in June, 7.5 days in December) for UDC employees per Labor Law Art. 89.',
    config: {
      enabled: true,
      daysPerYear: 15,
      payoutJuneDays: 7.5,
      payoutDecemberDays: 7.5,
      dailyRateMethod: 'scheduled_26',
      salaryBasis: ['base_salary'],
      eligibleContractTypes: ['UDC'],
      excludedEmploymentTypes: ['Intern', 'Consultant', 'Freelancer', 'Contract'],
      inclusionRule: 'immediate',
      inclusionMonths: 0,
    },
    sortOrder: 5,
    isActive: true,
  },
  {
    id: 'pcr-overtime_multipliers',
    ruleKey: 'overtime_multipliers',
    name: 'Overtime Multipliers',
    legalRef: 'Labor Law Art. 139',
    description:
      '1.5x when clock-out is after scheduled time out on working days; 2.0x for night (10 PM–5 AM), scheduled rest days (Planning roster), and public holidays.',
    config: { multiplierNormal: 1.5, multiplierPremium: 2 },
    sortOrder: 6,
    isActive: true,
  },
];

const DEFAULT_ENGINE_CONFIG: PayrollComplianceEngineConfig = {
  minimumWageUsd: 204,
  nssfOccupationalRiskEmployeePct: 0,
  nssfOccupationalRiskEmployerPct: 0.8,
  nssfHealthcareEmployeePct: 0,
  nssfHealthcareEmployerPct: 2.6,
  nssfPensionEmployeePct: 2,
  nssfPensionEmployerPct: 2,
  nssfPensionEmployeeCapKhr: 24_000,
  nssfAssumedWageCapKhr: 1_200_000,
  seniorityDaysPerYear: 15,
  seniorityPayoutJuneDays: 7.5,
  seniorityPayoutDecemberDays: 7.5,
  otMultiplierNormal: 1.5,
  otMultiplierPremium: 2,
  exchangeRate: 4100,
};

function numConfig(config: PayrollComplianceRuleConfig, key: string, fallback: number): number {
  const v = config[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatNssfSplitDisplay(employeePct: number, employerPct: number): string {
  const emp = Math.round(employeePct * 10) / 10;
  const empr = Math.round(employerPct * 10) / 10;
  const total = Math.round((emp + empr) * 10) / 10;
  if (emp <= 0) {
    return `${total}% employer-only (0% Emp / ${empr}% Empr)`;
  }
  return `${total}% total (${emp}% Emp / ${empr}% Empr) — ${emp}% from pay`;
}

export function formatComplianceDisplayValue(
  ruleKey: string,
  config: PayrollComplianceRuleConfig
): string {
  switch (ruleKey) {
    case 'minimum_wage': {
      const amount = numConfig(config, 'amountUsd', 204);
      const period = String(config.period || 'month');
      return `$${amount}/${period}`;
    }
    case 'nssf_occupational_risk': {
      const emp = numConfig(config, 'employeePct', 0);
      const empr = numConfig(config, 'employerPct', 0.8);
      return formatNssfSplitDisplay(emp, empr);
    }
    case 'nssf_healthcare': {
      const emp = numConfig(config, 'employeePct', 0);
      const empr = numConfig(config, 'employerPct', 2.6);
      return formatNssfSplitDisplay(emp, empr);
    }
    case LEGACY_NSSF_HEALTH_KEY: {
      const empr = numConfig(config, 'employerPct', 1.3);
      const emp = numConfig(config, 'employeePct', 0);
      const total = Math.round((emp + empr) * 10) / 10;
      return `${total}% total (${emp}% Emp / ${empr}% Empr)`;
    }
    case 'nssf_pension': {
      const emp = numConfig(config, 'employeePct', 2);
      const empr = numConfig(config, 'employerPct', 2);
      const cap = numConfig(config, 'employeeCapKhr', 24_000);
      return `${emp + empr}% total — ${emp}% deducted from pay (max ${cap.toLocaleString()} KHR)`;
    }
    case 'seniority_indemnity': {
      const days = numConfig(config, 'daysPerYear', 15);
      const contracts = Array.isArray(config.eligibleContractTypes)
        ? (config.eligibleContractTypes as string[]).join(', ')
        : 'UDC';
      return `${days} days/yr · ${contracts || 'UDC'}`;
    }
    case 'overtime_multipliers': {
      const normal = numConfig(config, 'multiplierNormal', 1.5);
      const premium = numConfig(config, 'multiplierPremium', 2);
      return `${normal}x - ${premium}x`;
    }
    default:
      return '—';
  }
}

function parseConfig(raw: unknown): PayrollComplianceRuleConfig {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as PayrollComplianceRuleConfig;
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as PayrollComplianceRuleConfig;
    } catch {
      return {};
    }
  }
  return {};
}

export function rowToComplianceApi(row: {
  id: string;
  ruleKey: string;
  name: string;
  legalRef: string;
  description: string;
  config?: unknown;
  sortOrder?: number;
}): PayrollComplianceRuleApiRow {
  const config = parseConfig(row.config);
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    name: row.name,
    legalRef: row.legalRef,
    description: row.description,
    config,
    displayValue: formatComplianceDisplayValue(row.ruleKey, config),
    sortOrder: Number(row.sortOrder) || 0,
  };
}

export function rulesToEngineConfig(
  rules: PayrollComplianceRuleApiRow[]
): PayrollComplianceEngineConfig {
  const active = rules.filter((r) => r.ruleKey !== LEGACY_NSSF_HEALTH_KEY);
  const byKey = new Map(active.map((r) => [r.ruleKey, r.config]));
  const min = byKey.get('minimum_wage') ?? {};
  const occupational = byKey.get('nssf_occupational_risk') ?? {};
  const healthcare = byKey.get('nssf_healthcare') ?? {};
  const pension = byKey.get('nssf_pension') ?? {};
  const seniority = byKey.get('seniority_indemnity') ?? {};
  const ot = byKey.get('overtime_multipliers') ?? {};

  return {
    minimumWageUsd: numConfig(min, 'amountUsd', DEFAULT_ENGINE_CONFIG.minimumWageUsd),
    nssfOccupationalRiskEmployeePct: numConfig(
      occupational,
      'employeePct',
      DEFAULT_ENGINE_CONFIG.nssfOccupationalRiskEmployeePct
    ),
    nssfOccupationalRiskEmployerPct: numConfig(
      occupational,
      'employerPct',
      DEFAULT_ENGINE_CONFIG.nssfOccupationalRiskEmployerPct
    ),
    nssfHealthcareEmployeePct: numConfig(
      healthcare,
      'employeePct',
      DEFAULT_ENGINE_CONFIG.nssfHealthcareEmployeePct
    ),
    nssfHealthcareEmployerPct: numConfig(
      healthcare,
      'employerPct',
      DEFAULT_ENGINE_CONFIG.nssfHealthcareEmployerPct
    ),
    nssfPensionEmployeePct: numConfig(
      pension,
      'employeePct',
      DEFAULT_ENGINE_CONFIG.nssfPensionEmployeePct
    ),
    nssfPensionEmployerPct: numConfig(
      pension,
      'employerPct',
      DEFAULT_ENGINE_CONFIG.nssfPensionEmployerPct
    ),
    nssfPensionEmployeeCapKhr: numConfig(
      pension,
      'employeeCapKhr',
      DEFAULT_ENGINE_CONFIG.nssfPensionEmployeeCapKhr
    ),
    nssfAssumedWageCapKhr: numConfig(
      pension,
      'assumedWageCapKhr',
      DEFAULT_ENGINE_CONFIG.nssfAssumedWageCapKhr
    ),
    seniorityDaysPerYear: numConfig(
      seniority,
      'daysPerYear',
      DEFAULT_ENGINE_CONFIG.seniorityDaysPerYear
    ),
    seniorityPayoutJuneDays: numConfig(
      seniority,
      'payoutJuneDays',
      DEFAULT_ENGINE_CONFIG.seniorityPayoutJuneDays
    ),
    seniorityPayoutDecemberDays: numConfig(
      seniority,
      'payoutDecemberDays',
      DEFAULT_ENGINE_CONFIG.seniorityPayoutDecemberDays
    ),
    otMultiplierNormal: numConfig(ot, 'multiplierNormal', DEFAULT_ENGINE_CONFIG.otMultiplierNormal),
    otMultiplierPremium: numConfig(ot, 'multiplierPremium', DEFAULT_ENGINE_CONFIG.otMultiplierPremium),
    exchangeRate: DEFAULT_ENGINE_CONFIG.exchangeRate,
  };
}

let cachedEngineConfig: PayrollComplianceEngineConfig | null = null;
const complianceCacheByMonth = new Map<string, PayrollComplianceEngineConfig>();

async function resolveComplianceRuleRow(
  ruleKey: string,
  month: string
): Promise<PayrollComplianceRuleApiRow | null> {
  const { ensureInitialPayrollPolicyVersions } = await import(
    './payroll/payrollPolicyVersionBootstrap.js'
  );
  const { resolvePolicyPayloadForMonth, getPolicyVersionDisplayMeta } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  await ensureInitialPayrollPolicyVersions();

  type CompliancePayload = {
    name: string;
    legalRef: string;
    description: string;
    config: PayrollComplianceRuleConfig;
  };

  const resolved = await resolvePolicyPayloadForMonth<CompliancePayload>({
    policyType: 'compliance_rule',
    policyKey: ruleKey,
    month,
  });

  const defaults = DEFAULT_PAYROLL_COMPLIANCE_RULES.find((d) => d.ruleKey === ruleKey);
  const meta = await getPolicyVersionDisplayMeta({
    policyType: 'compliance_rule',
    policyKey: ruleKey,
    month: month.slice(0, 7),
  });

  if (!resolved && !defaults) return null;

  const payload = resolved?.payload;
  const config = payload?.config ?? defaults?.config ?? {};
  return {
    id: defaults?.id ?? `pcr-${ruleKey}`,
    ruleKey,
    name: payload?.name ?? defaults?.name ?? ruleKey,
    legalRef: payload?.legalRef ?? defaults?.legalRef ?? '',
    description: payload?.description ?? defaults?.description ?? '',
    config,
    displayValue: formatComplianceDisplayValue(ruleKey, config),
    sortOrder: defaults?.sortOrder ?? 99,
    effectiveFrom: meta.effectiveFrom,
    scheduledEffectiveFrom: meta.scheduledEffectiveFrom,
    lastUpdatedAt: meta.lastUpdatedAt,
    lastUpdatedBy: meta.lastUpdatedBy,
  };
}

export async function refreshPayrollComplianceCache(
  month?: string
): Promise<PayrollComplianceEngineConfig> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const apiRows = await listPayrollComplianceRules(monthKey);
  const base = apiRows.length > 0 ? rulesToEngineConfig(apiRows) : { ...DEFAULT_ENGINE_CONFIG };
  const { getPayrollExchangeRateKhrPerUsd } = await import('./payrollExchangeRateService.js');
  const exchangeRate = await getPayrollExchangeRateKhrPerUsd(monthKey);
  const merged = { ...base, exchangeRate };
  complianceCacheByMonth.set(monthKey, merged);
  if (!month) cachedEngineConfig = merged;
  return merged;
}

export async function getPayrollComplianceEngineConfig(
  month?: string
): Promise<PayrollComplianceEngineConfig> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const hit = complianceCacheByMonth.get(monthKey);
  if (hit) return hit;
  return refreshPayrollComplianceCache(monthKey);
}

export async function listPayrollComplianceRules(
  month?: string
): Promise<PayrollComplianceRuleApiRow[]> {
  await migrateLegacyNssfRules();
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const keys = DEFAULT_PAYROLL_COMPLIANCE_RULES.filter(
    (r) => r.ruleKey !== LEGACY_NSSF_HEALTH_KEY
  ).map((r) => r.ruleKey as ComplianceRuleKey);

  const resolved = (
    await Promise.all(keys.map((ruleKey) => resolveComplianceRuleRow(ruleKey, monthKey)))
  ).filter((r): r is PayrollComplianceRuleApiRow => r != null);

  return resolved.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function savePayrollComplianceRules(
  updates: Array<{
    ruleKey: string;
    name?: string;
    legalRef?: string;
    description?: string;
    config?: PayrollComplianceRuleConfig;
  }>,
  effectiveFrom: string,
  createdBy?: string | null
): Promise<PayrollComplianceRuleApiRow[]> {
  const { createPolicyVersion, parseEffectiveFrom } = await import(
    './payroll/payrollPolicyVersionService.js'
  );
  const effective_from = parseEffectiveFrom(effectiveFrom);
  complianceCacheByMonth.clear();
  cachedEngineConfig = null;

  for (const patch of updates) {
    if (patch.ruleKey === LEGACY_NSSF_HEALTH_KEY) continue;
    const defaults = DEFAULT_PAYROLL_COMPLIANCE_RULES.find((d) => d.ruleKey === patch.ruleKey);
    if (!defaults) continue;

    const current = await resolveComplianceRuleRow(patch.ruleKey, effective_from.slice(0, 7));
    const mergedConfig = {
      ...(current?.config ?? defaults.config),
      ...(patch.config ?? {}),
    };

    await createPolicyVersion({
      policyType: 'compliance_rule',
      policyKey: patch.ruleKey,
      effectiveFrom: effective_from,
      payload: {
        name: patch.name ?? current?.name ?? defaults.name,
        legalRef: patch.legalRef ?? current?.legalRef ?? defaults.legalRef,
        description: patch.description ?? current?.description ?? defaults.description,
        config: mergedConfig,
      },
      notes: `Compliance rule ${patch.ruleKey} update`,
      createdBy: createdBy ?? null,
    });
  }

  await refreshPayrollComplianceCache();
  return listPayrollComplianceRules();
}

async function migrateLegacyNssfRules(): Promise<void> {
  const legacy = await PayrollComplianceRule.findOne({
    where: { ruleKey: LEGACY_NSSF_HEALTH_KEY, isActive: true },
  });
  if (!legacy) return;

  const defaults = DEFAULT_PAYROLL_COMPLIANCE_RULES.filter(
    (r) => r.ruleKey === 'nssf_occupational_risk' || r.ruleKey === 'nssf_healthcare'
  );
  for (const d of defaults) {
    const exists = await PayrollComplianceRule.findOne({ where: { ruleKey: d.ruleKey } });
    if (!exists) {
      await PayrollComplianceRule.create({
        ...d,
        config: d.config,
      });
    }
  }
  await legacy.update({ isActive: false });
  console.log('[db] Migrated legacy nssf_health → occupational risk + health care rules.');
}

export async function ensurePayrollComplianceRulesSchema(): Promise<void> {
  await PayrollComplianceRule.sync();

  const count = await PayrollComplianceRule.count();
  if (count === 0) {
    await PayrollComplianceRule.bulkCreate(
      DEFAULT_PAYROLL_COMPLIANCE_RULES.filter((r) => r.ruleKey !== LEGACY_NSSF_HEALTH_KEY).map(
        (r) => ({
          ...r,
          config: r.config,
        })
      )
    );
    console.log('[db] Seeded payrollcompliancerules.');
  } else {
    await migrateLegacyNssfRules();
    for (const d of DEFAULT_PAYROLL_COMPLIANCE_RULES) {
      if (d.ruleKey === LEGACY_NSSF_HEALTH_KEY) continue;
      const exists = await PayrollComplianceRule.findOne({ where: { ruleKey: d.ruleKey } });
      if (!exists) {
        await PayrollComplianceRule.create({ ...d, config: d.config });
        console.log(`[db] Added missing compliance rule: ${d.ruleKey}`);
      }
    }
  }

  await refreshPayrollComplianceCache();
}
