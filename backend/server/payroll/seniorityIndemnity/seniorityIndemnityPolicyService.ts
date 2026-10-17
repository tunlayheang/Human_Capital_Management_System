import { SeniorityIndemnityPolicy } from '../../db.js';
import {
  DEFAULT_SENIORITY_INDEMNITY_CONFIG,
  parseSeniorityIndemnityConfig,
} from './seniorityIndemnityConfig.js';
import { ensureSeniorityIndemnityPolicySchema, seniorityIndemnityPolicyId } from './seniorityIndemnityPolicySchema.js';
import type {
  SeniorityIndemnityConfig,
  SeniorityIndemnityDailyRateMethod,
  SeniorityIndemnityInclusionRule,
  SeniorityIndemnitySalaryComponent,
} from './seniorityIndemnityTypes.js';

export type SeniorityIndemnityPolicyRow = {
  id: string;
  name: string;
  description?: string | null;
  legal_ref?: string | null;
  effective_from: string;
  effective_to?: string | null;
  days_per_year: number;
  payout_june_days: number;
  payout_december_days: number;
  daily_rate_method: SeniorityIndemnityDailyRateMethod;
  salary_basis: SeniorityIndemnitySalaryComponent[];
  eligible_contract_types: string[];
  excluded_employment_types: string[];
  inclusion_rule: SeniorityIndemnityInclusionRule;
  inclusion_months: number;
  working_days_divisor: number;
  extended_config: Record<string, unknown>;
  priority: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

function parseJsonArray(raw: unknown, fallback: string[]): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return fallback;
}

function parseSalaryBasis(raw: unknown): SeniorityIndemnitySalaryComponent[] {
  const allowed = new Set<SeniorityIndemnitySalaryComponent>([
    'base_salary',
    'position_allowance',
    'responsibility_allowance',
    'fixed_allowance',
    'commission',
    'other_recurring',
  ]);
  const parsed = parseJsonArray(raw, DEFAULT_SENIORITY_INDEMNITY_CONFIG.salaryBasis);
  const filtered = parsed.filter((v) => allowed.has(v as SeniorityIndemnitySalaryComponent));
  return filtered.length
    ? (filtered as SeniorityIndemnitySalaryComponent[])
    : DEFAULT_SENIORITY_INDEMNITY_CONFIG.salaryBasis;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parsePolicyRow(row: InstanceType<typeof SeniorityIndemnityPolicy>): SeniorityIndemnityPolicyRow {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const rateRaw = String(p.daily_rate_method ?? 'scheduled_26').toLowerCase();
  const daily_rate_method: SeniorityIndemnityDailyRateMethod =
    rateRaw === 'actual_working_days' ? 'actual_working_days' : 'scheduled_26';
  const inclusionRaw = String(p.inclusion_rule ?? 'after_probation').toLowerCase();
  const inclusion_rule: SeniorityIndemnityInclusionRule =
    inclusionRaw === 'after_months' ? 'after_months' : 'after_probation';
  const extended =
    p.extended_config && typeof p.extended_config === 'object'
      ? (p.extended_config as Record<string, unknown>)
      : {};

  return {
    id: String(p.id),
    name: String(p.name),
    description: p.description != null ? String(p.description) : null,
    legal_ref: p.legal_ref != null ? String(p.legal_ref) : null,
    effective_from: String(p.effective_from).slice(0, 10),
    effective_to: p.effective_to ? String(p.effective_to).slice(0, 10) : null,
    days_per_year: num(p.days_per_year, DEFAULT_SENIORITY_INDEMNITY_CONFIG.daysPerYear),
    payout_june_days: num(p.payout_june_days, DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutJuneDays),
    payout_december_days: num(
      p.payout_december_days,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutDecemberDays
    ),
    daily_rate_method,
    salary_basis: parseSalaryBasis(p.salary_basis),
    eligible_contract_types: parseJsonArray(
      p.eligible_contract_types,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.eligibleContractTypes
    ),
    excluded_employment_types: parseJsonArray(
      p.excluded_employment_types,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.excludedEmploymentTypes
    ),
    inclusion_rule,
    inclusion_months: Math.max(0, Math.floor(num(p.inclusion_months, 0))),
    working_days_divisor: num(p.working_days_divisor, 26),
    extended_config: extended,
    priority: Math.max(1, Math.floor(num(p.priority, 100))),
    active: Boolean(p.active),
    created_at: p.created_at ? String(p.created_at) : undefined,
    updated_at: p.updated_at ? String(p.updated_at) : undefined,
  };
}

export function policyRowToConfig(row: SeniorityIndemnityPolicyRow): SeniorityIndemnityConfig {
  return parseSeniorityIndemnityConfig({
    enabled: row.active,
    daysPerYear: row.days_per_year,
    payoutJuneDays: row.payout_june_days,
    payoutDecemberDays: row.payout_december_days,
    dailyRateMethod: row.daily_rate_method,
    workingDaysDivisor: row.working_days_divisor,
    salaryBasis: row.salary_basis,
    eligibleContractTypes: row.eligible_contract_types,
    excludedEmploymentTypes: row.excluded_employment_types,
    inclusionRule: row.inclusion_rule,
    inclusionMonths: row.inclusion_months,
    ...row.extended_config,
  });
}

function monthInRange(month: string, from: string, to?: string | null): boolean {
  const m = month.slice(0, 7);
  if (m < from.slice(0, 7)) return false;
  if (to && m > to.slice(0, 7)) return false;
  return true;
}

export function pickSeniorityIndemnityPolicyForMonth(
  policies: SeniorityIndemnityPolicyRow[],
  month: string
): SeniorityIndemnityPolicyRow | null {
  const sorted = [...policies]
    .filter((p) => p.active === true)
    .sort((a, b) => {
      const pa = Number(a.priority) || 100;
      const pb = Number(b.priority) || 100;
      if (pa !== pb) return pa - pb;
      const byDate = String(b.effective_from).localeCompare(String(a.effective_from));
      if (byDate !== 0) return byDate;
      return String(a.id).localeCompare(String(b.id));
    });

  for (const policy of sorted) {
    if (monthInRange(month, policy.effective_from, policy.effective_to)) return policy;
  }
  return null;
}

export async function countActiveSeniorityIndemnityPolicies(): Promise<number> {
  await ensureSeniorityIndemnityPolicySchema();
  return SeniorityIndemnityPolicy.count({ where: { active: true } });
}

export async function listSeniorityIndemnityPolicies(filters?: {
  activeOnly?: boolean;
}): Promise<SeniorityIndemnityPolicyRow[]> {
  await ensureSeniorityIndemnityPolicySchema();
  const where: Record<string, unknown> = {};
  if (filters?.activeOnly) where.active = true;
  const rows = await SeniorityIndemnityPolicy.findAll({
    where,
    order: [
      ['priority', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  return rows.map(parsePolicyRow);
}

export async function getSeniorityIndemnityPolicy(
  id: string
): Promise<SeniorityIndemnityPolicyRow | null> {
  await ensureSeniorityIndemnityPolicySchema();
  const row = await SeniorityIndemnityPolicy.findByPk(id);
  return row ? parsePolicyRow(row) : null;
}

export async function resolveSeniorityIndemnityPolicyForMonth(
  month: string
): Promise<SeniorityIndemnityPolicyRow | null> {
  const policies = await listSeniorityIndemnityPolicies({ activeOnly: true });
  return pickSeniorityIndemnityPolicyForMonth(policies, month);
}

export async function loadSeniorityIndemnityConfigForMonth(
  month: string
): Promise<SeniorityIndemnityConfig> {
  const policy = await resolveSeniorityIndemnityPolicyForMonth(month);
  if (!policy) return parseSeniorityIndemnityConfig({ enabled: false });
  return policyRowToConfig(policy);
}

function validatePolicy(body: Partial<SeniorityIndemnityPolicyRow>): void {
  if (!String(body.name ?? '').trim()) throw new Error('Policy name is required.');
  if (!body.effective_from) throw new Error('Effective from date is required.');
  if (num(body.days_per_year, 0) <= 0) throw new Error('Days per year must be greater than zero.');
  if (num(body.payout_june_days, 0) < 0 || num(body.payout_december_days, 0) < 0) {
    throw new Error('June and December payout days cannot be negative.');
  }
}

export async function upsertSeniorityIndemnityPolicy(
  body: Partial<SeniorityIndemnityPolicyRow> & { name: string; effective_from: string }
): Promise<SeniorityIndemnityPolicyRow> {
  await ensureSeniorityIndemnityPolicySchema();
  validatePolicy(body);
  const id = body.id ?? seniorityIndemnityPolicyId();
  const existing = await SeniorityIndemnityPolicy.findByPk(id);

  const payload = {
    id,
    name: String(body.name).trim(),
    description: body.description ?? null,
    legal_ref: body.legal_ref ?? 'Labor Law Art. 89',
    effective_from: body.effective_from.slice(0, 10),
    effective_to: body.effective_to?.slice(0, 10) ?? null,
    days_per_year: num(body.days_per_year, DEFAULT_SENIORITY_INDEMNITY_CONFIG.daysPerYear),
    payout_june_days: num(body.payout_june_days, DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutJuneDays),
    payout_december_days: num(
      body.payout_december_days,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.payoutDecemberDays
    ),
    daily_rate_method: (body.daily_rate_method ??
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.dailyRateMethod) as SeniorityIndemnityDailyRateMethod,
    salary_basis: parseSalaryBasis(
      body.salary_basis ?? DEFAULT_SENIORITY_INDEMNITY_CONFIG.salaryBasis
    ),
    eligible_contract_types: parseJsonArray(
      body.eligible_contract_types,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.eligibleContractTypes
    ),
    excluded_employment_types: parseJsonArray(
      body.excluded_employment_types,
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.excludedEmploymentTypes
    ),
    inclusion_rule: (body.inclusion_rule ??
      DEFAULT_SENIORITY_INDEMNITY_CONFIG.inclusionRule) as SeniorityIndemnityInclusionRule,
    inclusion_months: Math.max(0, Math.floor(num(body.inclusion_months, 0))),
    working_days_divisor: num(body.working_days_divisor, DEFAULT_SENIORITY_INDEMNITY_CONFIG.workingDaysDivisor),
    extended_config: body.extended_config ?? {},
    priority: Math.max(1, Math.min(500, Number(body.priority) || 100)),
    active:
      typeof body.active === 'boolean'
        ? body.active
        : existing
          ? Boolean(existing.get('active'))
          : body.active === true,
  };

  if (existing) {
    await existing.update(payload);
    await existing.reload();
    return parsePolicyRow(existing);
  }
  const created = await SeniorityIndemnityPolicy.create(payload);
  return parsePolicyRow(created);
}

export async function deleteSeniorityIndemnityPolicy(id: string): Promise<void> {
  const row = await SeniorityIndemnityPolicy.findByPk(id);
  if (row) await row.destroy();
}
