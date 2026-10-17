import { SeniorityRule } from '../../db.js';
import {
  applySeniorityProration,
  computeFullMonthSeniorityAccrual,
  roundUsd,
  serviceDaysFromJoin,
  serviceYearsFromJoin,
} from './seniorityAccrualEngine.js';
import { computeSeniorityPayoutForCycle } from './seniorityPayoutEngine.js';
import {
  evaluateSeniorityEligibility,
  ruleAppliesToEmployee,
  type SeniorityEligibilityContext,
} from './seniorityEligibilityEngine.js';
import {
  appendLedgerEntry,
  getLedgerBalance,
  getOrCreateSeniorityProfile,
  hasAccrualForMonth,
  hasPaymentForMonth,
} from './seniorityLedgerService.js';
import { ensureSeniorityEngineSchema, seniorityRuleId } from './seniorityRuleSchema.js';
import type {
  SeniorityAccrualConfig,
  SeniorityApplicableGroups,
  SeniorityCalculationSnapshot,
  SeniorityEligibilityRules,
  SeniorityPayrollResult,
  SeniorityProrationRules,
  SeniorityRuleRow,
} from './seniorityTypes.js';
import type { AllowanceEngineResult } from '../../allowanceRuleEngine.js';
import {
  buildAccrualConfigForType,
  jsonFieldsNeedRepair,
  normalizeApplicableGroups,
  normalizeEligibilityRules,
  normalizeProrationRules,
} from './seniorityJsonUtils.js';

function parseRule(row: InstanceType<typeof SeniorityRule>): SeniorityRuleRow {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  const accrualType = String(p.accrual_type) as SeniorityRuleRow['accrual_type'];
  return {
    id: String(p.id),
    name: String(p.name),
    description: p.description != null ? String(p.description) : null,
    effective_from: String(p.effective_from).slice(0, 10),
    effective_to: p.effective_to ? String(p.effective_to).slice(0, 10) : null,
    accrual_type: accrualType,
    accrual_config: buildAccrualConfigForType(accrualType, p.accrual_config),
    calculation_base: (p.calculation_base as SeniorityRuleRow['calculation_base']) ?? 'basic_salary',
    eligibility_rules: normalizeEligibilityRules(p.eligibility_rules),
    proration_rules: normalizeProrationRules(p.proration_rules),
    payment_frequency: String(p.payment_frequency) as SeniorityRuleRow['payment_frequency'],
    applicable_groups: normalizeApplicableGroups(p.applicable_groups),
    priority: Number(p.priority) || 100,
    active: Boolean(p.active),
    created_at: p.created_at ? String(p.created_at) : undefined,
    updated_at: p.updated_at ? String(p.updated_at) : undefined,
  };
}

async function repairRuleJsonFields(row: InstanceType<typeof SeniorityRule>): Promise<void> {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const accrualType = String(plain.accrual_type) as SeniorityRuleRow['accrual_type'];
  if (!jsonFieldsNeedRepair(accrualType, plain)) return;

  await row.update({
    accrual_config: buildAccrualConfigForType(accrualType, plain.accrual_config),
    eligibility_rules: normalizeEligibilityRules(plain.eligibility_rules),
    proration_rules: normalizeProrationRules(plain.proration_rules),
    applicable_groups: normalizeApplicableGroups(plain.applicable_groups),
  });
}

function monthInRange(month: string, from: string, to?: string | null): boolean {
  const m = month.slice(0, 7);
  if (m < from.slice(0, 7)) return false;
  if (to && m > to.slice(0, 7)) return false;
  return true;
}

export async function countActiveSeniorityRules(): Promise<number> {
  await ensureSeniorityEngineSchema();
  return SeniorityRule.count({ where: { active: true } });
}

export async function listSeniorityRules(filters?: {
  activeOnly?: boolean;
}): Promise<SeniorityRuleRow[]> {
  await ensureSeniorityEngineSchema();
  const where: Record<string, unknown> = {};
  if (filters?.activeOnly) where.active = true;
  const rows = await SeniorityRule.findAll({
    where,
    order: [
      ['priority', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  for (const row of rows) {
    await repairRuleJsonFields(row);
  }
  const refreshed = rows.length
    ? await SeniorityRule.findAll({
        where,
        order: [
          ['priority', 'ASC'],
          ['name', 'ASC'],
        ],
      })
    : rows;
  return refreshed.map(parseRule);
}

export async function getSeniorityRule(id: string): Promise<SeniorityRuleRow | null> {
  await ensureSeniorityEngineSchema();
  const row = await SeniorityRule.findByPk(id);
  return row ? parseRule(row) : null;
}

function validateAccrualConfig(
  accrualType: SeniorityRuleRow['accrual_type'],
  accrualConfig: SeniorityAccrualConfig
): void {
  if (accrualType === 'service_tiers') {
    const tiers = Array.isArray(accrualConfig.tiers) ? accrualConfig.tiers : [];
    if (!tiers.length) {
      throw new Error('Service tiers: add at least one years-of-service band with an amount.');
    }
    const hasPositive = tiers.some((t) => {
      const raw = t as Record<string, unknown>;
      return Number(raw.amountUsd ?? raw.amount_usd) > 0;
    });
    if (!hasPositive) {
      throw new Error('Service tiers: at least one band must have amount greater than zero.');
    }
  }
  if (accrualType === 'fixed_monthly' && Number(accrualConfig.amountUsd ?? 0) <= 0) {
    throw new Error('Fixed monthly accrual requires amount greater than zero.');
  }
  if (accrualType === 'percent_salary' && Number(accrualConfig.percent ?? 0) <= 0) {
    throw new Error('Percent of salary requires percent greater than zero.');
  }
}

export async function upsertSeniorityRule(
  body: Partial<SeniorityRuleRow> & { name: string; effective_from: string; accrual_type: SeniorityRuleRow['accrual_type'] }
): Promise<SeniorityRuleRow> {
  await ensureSeniorityEngineSchema();
  validateAccrualConfig(body.accrual_type, body.accrual_config ?? {});
  const id = body.id ?? seniorityRuleId();
  const existing = await SeniorityRule.findByPk(id);
  const payload = {
    id,
    name: String(body.name).trim(),
    description: body.description ?? null,
    effective_from: body.effective_from.slice(0, 10),
    effective_to: body.effective_to?.slice(0, 10) ?? null,
    accrual_type: body.accrual_type,
    accrual_config: buildAccrualConfigForType(body.accrual_type, body.accrual_config ?? {}),
    calculation_base: body.calculation_base ?? 'basic_salary',
    eligibility_rules: normalizeEligibilityRules(body.eligibility_rules ?? { employeeStatuses: ['active'] }),
    proration_rules: normalizeProrationRules(body.proration_rules ?? { enabled: true, basis: 'eligible_payroll_days' }),
    payment_frequency: body.payment_frequency ?? 'monthly',
    applicable_groups: normalizeApplicableGroups(body.applicable_groups ?? { allEmployees: true }),
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
    return parseRule(existing);
  }
  const created = await SeniorityRule.create(payload);
  return parseRule(created);
}

export async function deleteSeniorityRule(id: string): Promise<void> {
  const row = await SeniorityRule.findByPk(id);
  if (row) await row.destroy();
}

/** Deterministic policy pick: priority (low wins) → newer effective_from → id. */
export function pickSeniorityRuleForMonth(
  rules: SeniorityRuleRow[],
  month: string,
  ctx: SeniorityEligibilityContext
): SeniorityRuleRow | null {
  const sorted = [...rules]
    .filter((r) => r.active === true)
    .sort((a, b) => {
      const pa = Number(a.priority) || 100;
      const pb = Number(b.priority) || 100;
      if (pa !== pb) return pa - pb;
      const byDate = String(b.effective_from).localeCompare(String(a.effective_from));
      if (byDate !== 0) return byDate;
      return String(a.id).localeCompare(String(b.id));
    });

  for (const rule of sorted) {
    if (!monthInRange(month, rule.effective_from, rule.effective_to)) continue;
    if (!ruleAppliesToEmployee(rule.applicable_groups, ctx)) continue;
    return rule;
  }
  return null;
}

export async function resolveSeniorityRuleForEmployee(
  month: string,
  ctx: SeniorityEligibilityContext
): Promise<SeniorityRuleRow | null> {
  const rules = await listSeniorityRules({ activeOnly: true });
  return pickSeniorityRuleForMonth(rules, month, ctx);
}

export type SeniorityPayrollInput = {
  employeeId: string;
  month: string;
  baseSalary: number;
  joinDate?: string | Date | null;
  employeeStatus?: string;
  employmentType?: string;
  departmentId?: string | null;
  accessRole?: string;
  probationPeriodMonths?: number;
  probationConfirmedAt?: string | Date | null;
  workerType?: string | null;
  presentDays?: number;
  unpaidLeaveDays?: number;
  eligiblePayrollDays?: number;
  totalPayrollDays?: number;
  payrollRunType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
  persistLedger?: boolean;
  referenceId?: string;
};

export async function calculateSeniorityForPayroll(
  input: SeniorityPayrollInput
): Promise<SeniorityPayrollResult> {
  await ensureSeniorityEngineSchema();
  const month = input.month.slice(0, 7);
  const asOf = Date.now();
  const eligCtx: SeniorityEligibilityContext = {
    employeeStatus: input.employeeStatus,
    employmentType: input.employmentType,
    departmentId: input.departmentId,
    accessRole: input.accessRole,
    joinDate: input.joinDate,
    probationPeriodMonths: input.probationPeriodMonths,
    probationConfirmedAt: input.probationConfirmedAt,
    workerType: input.workerType,
    presentDays: input.presentDays,
    unpaidLeaveDays: input.unpaidLeaveDays,
    asOf,
  };

  const balanceBefore = await getLedgerBalance(input.employeeId);

  const emptySnapshot = (rule: SeniorityRuleRow | null, reason: string): SeniorityCalculationSnapshot => ({
    ruleId: rule?.id ?? '',
    ruleName: rule?.name ?? 'None',
    accrualType: rule?.accrual_type ?? 'fixed_monthly',
    paymentFrequency: rule?.payment_frequency ?? 'monthly',
    eligible: false,
    ineligibleReason: reason,
    serviceYears: serviceYearsFromJoin(input.joinDate, asOf),
    serviceDays: serviceDaysFromJoin(input.joinDate, asOf),
    fullMonthAccrualUsd: 0,
    proratedAccrualUsd: 0,
    payoutUsd: 0,
    prorationFactor: 0,
    eligiblePayrollDays: input.eligiblePayrollDays ?? 0,
    totalPayrollDays: input.totalPayrollDays ?? 0,
    balanceBeforeUsd: balanceBefore,
    balanceAfterUsd: balanceBefore,
    yearlyProjectionUsd: 0,
  });

  const rule = await resolveSeniorityRuleForEmployee(month, eligCtx);
  if (!rule) {
    const snap = emptySnapshot(null, 'no_rule');
    return { payoutUsd: 0, accrualUsd: 0, snapshot: snap };
  }

  const eligibility = evaluateSeniorityEligibility(rule.eligibility_rules, eligCtx);

  if (!eligibility.eligible) {
    const snap = emptySnapshot(rule, eligibility.reason ?? 'ineligible');
    snap.ruleId = rule.id;
    snap.ruleName = rule.name;
    return { payoutUsd: 0, accrualUsd: 0, snapshot: snap };
  }

  const serviceYears = serviceYearsFromJoin(input.joinDate, asOf);
  const fullMonth = computeFullMonthSeniorityAccrual({
    accrualType: rule.accrual_type,
    accrualConfig: rule.accrual_config,
    baseSalary: input.baseSalary,
    serviceYears,
  });

  const totalDays = Math.max(1, input.totalPayrollDays ?? 26);
  const eligibleDays = Math.max(0, Math.min(input.eligiblePayrollDays ?? totalDays, totalDays));
  const { proratedUsd, factor } = applySeniorityProration({
    fullMonthAccrualUsd: fullMonth,
    prorationEnabled: rule.proration_rules?.enabled !== false,
    eligiblePayrollDays: eligibleDays,
    totalPayrollDays: totalDays,
  });

  const monthIndex = parseInt(month.split('-')[1] ?? '1', 10) - 1;
  const payoutPlan = computeSeniorityPayoutForCycle({
    paymentFrequency: rule.payment_frequency,
    proratedAccrualUsd: proratedUsd,
    ledgerBalanceUsd: balanceBefore,
    payrollRunType: input.payrollRunType,
    monthIndex,
  });

  let payoutUsd = payoutPlan.payoutUsd;
  if (payoutPlan.payLedgerBalance && input.payrollRunType !== 'FINAL_SETTLEMENT') {
    payoutUsd = roundUsd(balanceBefore + (payoutPlan.accrueOnly ? 0 : proratedUsd));
  }

  const snapshot: SeniorityCalculationSnapshot = {
    ruleId: rule.id,
    ruleName: rule.name,
    accrualType: rule.accrual_type,
    paymentFrequency: rule.payment_frequency,
    eligible: true,
    ineligibleReason: null,
    serviceYears,
    serviceDays: serviceDaysFromJoin(input.joinDate, asOf),
    fullMonthAccrualUsd: fullMonth,
    proratedAccrualUsd: proratedUsd,
    payoutUsd,
    prorationFactor: factor,
    eligiblePayrollDays: eligibleDays,
    totalPayrollDays: totalDays,
    balanceBeforeUsd: balanceBefore,
    balanceAfterUsd: balanceBefore,
    yearlyProjectionUsd: roundUsd(fullMonth * 12),
  };

  let ledgerAccrualId: string | undefined;
  let ledgerPaymentId: string | undefined;

  if (input.persistLedger && proratedUsd > 0) {
    const already = await hasAccrualForMonth(input.employeeId, month);
    if (!already) {
      const acc = await appendLedgerEntry({
        employeeId: input.employeeId,
        type: 'accrual',
        amountUsd: proratedUsd,
        payrollMonth: month,
        referenceId: input.referenceId,
        reason: `Accrual ${month}`,
        ruleId: rule.id,
        snapshot,
      });
      ledgerAccrualId = acc.id;
      snapshot.balanceAfterUsd = acc.balanceAfter;
    } else {
      snapshot.balanceAfterUsd = await getLedgerBalance(input.employeeId);
    }

    if (payoutUsd > 0) {
      const alreadyPaid = await hasPaymentForMonth(input.employeeId, month);
      if (!alreadyPaid) {
        const pay = await appendLedgerEntry({
          employeeId: input.employeeId,
          type: 'payment',
          amountUsd: payoutUsd,
          payrollMonth: month,
          referenceId: input.referenceId,
          reason:
            input.payrollRunType === 'FINAL_SETTLEMENT'
              ? 'Final settlement seniority payout'
              : `Payment ${month}`,
          ruleId: rule.id,
          snapshot: { payoutUsd, accrualUsd: proratedUsd },
        });
        ledgerPaymentId = pay.id;
        snapshot.balanceAfterUsd = pay.balanceAfter;
      } else {
        snapshot.balanceAfterUsd = await getLedgerBalance(input.employeeId);
      }
    } else {
      snapshot.balanceAfterUsd = await getLedgerBalance(input.employeeId);
    }
  } else {
    snapshot.balanceAfterUsd = roundUsd(
      balanceBefore + proratedUsd - (payoutUsd > 0 ? payoutUsd : 0)
    );
  }

  const profile = await getOrCreateSeniorityProfile(input.employeeId);
  await profile.update({
    active_rule_id: rule.id,
    total_service_days: serviceDaysFromJoin(input.joinDate, asOf),
    last_calculated_date: new Date().toISOString().slice(0, 10),
    updated_at: new Date(),
  });

  return {
    payoutUsd,
    accrualUsd: proratedUsd,
    snapshot,
    ledgerAccrualId,
    ledgerPaymentId,
  };
}

/** Remove seniority from allowance engine output — seniority is a separate component. */
export function stripSeniorityFromAllowanceEngine(
  engine: AllowanceEngineResult | undefined
): AllowanceEngineResult | undefined {
  if (!engine) return engine;
  const lines = engine.lines.filter((l) => String(l.code).toUpperCase() !== 'SENIORITY');
  const removed = engine.lines
    .filter((l) => String(l.code).toUpperCase() === 'SENIORITY')
    .reduce((s, l) => s + l.amount, 0);
  return {
    ...engine,
    lines,
    legacy: { ...engine.legacy, seniority: 0 },
    total: roundUsd(engine.total - removed),
    audit: lines,
  };
}

export async function previewSeniorityCalculation(
  input: SeniorityPayrollInput
): Promise<SeniorityPayrollResult> {
  return calculateSeniorityForPayroll({ ...input, persistLedger: false });
}

export async function accrueSeniorityForMonth(
  input: SeniorityPayrollInput
): Promise<SeniorityPayrollResult> {
  return calculateSeniorityForPayroll({ ...input, persistLedger: true });
}

export async function payoutSeniorityBalance(params: {
  employeeId: string;
  amountUsd?: number;
  reason?: string;
  referenceId?: string;
}): Promise<{ paymentId: string; balanceAfter: number }> {
  const balance = await getLedgerBalance(params.employeeId);
  const pay = roundUsd(params.amountUsd ?? balance);
  if (pay <= 0) throw new Error('No seniority balance to pay out');
  const entry = await appendLedgerEntry({
    employeeId: params.employeeId,
    type: 'payment',
    amountUsd: pay,
    reason: params.reason ?? 'Manual seniority payout',
    referenceId: params.referenceId,
  });
  return { paymentId: entry.id, balanceAfter: entry.balanceAfter };
}
