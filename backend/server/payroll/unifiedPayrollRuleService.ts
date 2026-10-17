import { Op } from 'sequelize';
import { UnifiedPayrollRule, UnifiedPayrollRuleLog } from '../db.js';
import { ensureUnifiedPayrollRuleSchema, ruleId } from './unifiedPayrollRuleSchema.js';
import {
  evaluateUnifiedPayrollRules,
  type UnifiedRuleEvaluationContext,
} from './unifiedPayrollRuleEngine.js';
import type {
  UnifiedPayrollRuleRow,
  UnifiedRuleCategory,
  UnifiedRuleConditionJson,
  UnifiedRuleActionJson,
} from './unifiedPayrollRuleTypes.js';
import { runUnifiedPayrollRulePipeline } from './unifiedPayrollRulePipeline.js';

function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function rowToDto(row: InstanceType<typeof UnifiedPayrollRule>): UnifiedPayrollRuleRow {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: String(p.id),
    name: String(p.name),
    description: p.description != null ? String(p.description) : null,
    category: String(p.category) as UnifiedPayrollRuleRow['category'],
    source: String(p.source) as UnifiedPayrollRuleRow['source'],
    mode: String(p.mode) as UnifiedPayrollRuleRow['mode'],
    condition_json: parseJsonColumn(p.condition_json, {
      mode: 'simple',
      logic: 'all',
      conditions: [],
    } as UnifiedRuleConditionJson),
    action_json: parseJsonColumn(p.action_json, { type: 'ignore' } as UnifiedRuleActionJson),
    priority: Number(p.priority) || 50,
    active: Boolean(p.active),
    is_template: Boolean(p.is_template),
    is_system: Boolean(p.is_system),
    effective_from: p.effective_from ? String(p.effective_from).slice(0, 10) : null,
    effective_to: p.effective_to ? String(p.effective_to).slice(0, 10) : null,
    created_at: p.created_at ? String(p.created_at) : undefined,
    updated_at: p.updated_at ? String(p.updated_at) : undefined,
  };
}

export async function listUnifiedPayrollRules(filters?: {
  category?: UnifiedRuleCategory;
  templatesOnly?: boolean;
  activeOnly?: boolean;
}): Promise<UnifiedPayrollRuleRow[]> {
  await ensureUnifiedPayrollRuleSchema();
  const where: Record<string, unknown> = {};
  if (filters?.category) where.category = filters.category;
  if (filters?.templatesOnly) where.is_template = true;
  if (filters?.activeOnly) where.active = true;

  const rows = await UnifiedPayrollRule.findAll({
    where,
    order: [
      ['category', 'ASC'],
      ['priority', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  return rows.map(rowToDto);
}

export async function getUnifiedPayrollRule(id: string): Promise<UnifiedPayrollRuleRow | null> {
  await ensureUnifiedPayrollRuleSchema();
  const row = await UnifiedPayrollRule.findByPk(id);
  return row ? rowToDto(row) : null;
}

export async function upsertUnifiedPayrollRule(
  body: Partial<UnifiedPayrollRuleRow> & { name: string; category: UnifiedRuleCategory },
  userId?: string
): Promise<UnifiedPayrollRuleRow> {
  await ensureUnifiedPayrollRuleSchema();
  const id = body.id ?? ruleId();
  const existing = await UnifiedPayrollRule.findByPk(id);
  if (existing?.get('is_system') && body.is_system !== false) {
    throw new Error('System rules cannot be replaced; clone as a new rule or deactivate.');
  }

  const isSystemRule = Boolean(body.is_system) || Boolean(existing?.get('is_system'));
  let effectiveFrom: string | null = body.effective_from ?? null;
  if (!isSystemRule) {
    const { parseEffectiveFrom } = await import('./payrollPolicyVersionService.js');
    effectiveFrom = parseEffectiveFrom(body.effective_from);
  } else if (effectiveFrom) {
    effectiveFrom = String(effectiveFrom).slice(0, 10);
  }

  const payload = {
    id,
    name: String(body.name).trim(),
    description: body.description ?? null,
    category: body.category,
    source: body.source ?? 'employee',
    mode: body.mode ?? 'simple',
    condition_json: body.condition_json ?? { mode: 'simple', logic: 'all', conditions: [] },
    action_json: body.action_json ?? { type: 'ignore' },
    priority: Math.max(1, Math.min(100, Number(body.priority) || 50)),
    active: body.active !== false,
    is_template: Boolean(body.is_template),
    is_system: Boolean(body.is_system),
    effective_from: effectiveFrom,
    effective_to: body.effective_to ?? null,
  };

  if (!isSystemRule && effectiveFrom) {
    const { assertPayrollMasterDataEditableForEffectiveDate } = await import(
      './payrollMasterDataGuard.js'
    );
    await assertPayrollMasterDataEditableForEffectiveDate(effectiveFrom);
  }

  if (existing) {
    await existing.update(payload);
    const dto = rowToDto(existing);
    const { writeDomainAudit, pickAuditFields } = await import('../domainAuditService.js');
    await writeDomainAudit({
      entityType: 'payroll_rule',
      entityId: id,
      action: 'UPDATE',
      performedBy: userId ?? null,
      newValue: pickAuditFields(dto as unknown as Record<string, unknown>),
      reason: 'Payroll rule updated',
    });
    return dto;
  }

  const created = await UnifiedPayrollRule.create(payload);
  const dto = rowToDto(created);
  const { writeDomainAudit, pickAuditFields } = await import('../domainAuditService.js');
  await writeDomainAudit({
    entityType: 'payroll_rule',
    entityId: id,
    action: 'CREATE',
    performedBy: userId ?? null,
    newValue: pickAuditFields(dto as unknown as Record<string, unknown>),
    reason: 'Payroll rule created',
  });
  return dto;
}

export async function deleteUnifiedPayrollRule(id: string): Promise<void> {
  const row = await UnifiedPayrollRule.findByPk(id);
  if (!row) return;
  if (row.get('is_system')) {
    throw new Error('System rules cannot be deleted; deactivate instead.');
  }
  const { writeDomainAudit, pickAuditFields } = await import('../domainAuditService.js');
  await writeDomainAudit({
    entityType: 'payroll_rule',
    entityId: id,
    action: 'DELETE',
    oldValue: pickAuditFields(rowToDto(row) as unknown as Record<string, unknown>),
    reason: 'Payroll rule deleted',
  });
  await row.destroy();
}

export async function evaluateUnifiedRulesPreview(params: {
  month: string;
  employeeId: string;
  context?: Partial<UnifiedRuleEvaluationContext>;
  ruleIds?: string[];
}): Promise<ReturnType<typeof evaluateUnifiedPayrollRules>> {
  await ensureUnifiedPayrollRuleSchema();
  let rules = await listUnifiedPayrollRules({ activeOnly: true });
  if (params.ruleIds?.length) {
    const set = new Set(params.ruleIds);
    rules = rules.filter((r) => set.has(r.id));
  }

  const ctx: UnifiedRuleEvaluationContext = {
    month: params.month,
    employeeId: params.employeeId,
    employeeStatus: 'ACTIVE',
    attendanceByDate: [],
    leaveByDate: new Map(),
    ...params.context,
  } as UnifiedRuleEvaluationContext;

  return evaluateUnifiedPayrollRules(rules, ctx);
}

/** Sample leave days from configured leave types (for payroll rules preview). */
export async function buildSampleLeaveContextForPreview(month: string): Promise<{
  leaveByDate: Map<string, import('../approvedLeaveDayMap.js').LeaveDayInfo>;
  paidLeaveDates: Set<string>;
  unpaidLeaveDates: Set<string>;
}> {
  const { loadLeaveTypeLookup } = await import('../approvedLeaveDayMap.js');
  const lookup = await loadLeaveTypeLookup();
  const paid = [...lookup.values()].find((e) => e.isPaid);
  const unpaid = [...lookup.values()].find((e) => !e.isPaid);
  const leaveByDate = new Map<string, import('../approvedLeaveDayMap.js').LeaveDayInfo>();
  const paidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  const m = month.slice(0, 7);

  if (paid) {
    const d = `${m}-10`;
    leaveByDate.set(d, {
      typeLabel: paid.name,
      typeCode: paid.code,
      isPaid: true,
      payrollCategory: paid.payrollCategory,
    });
    paidLeaveDates.add(d);
  }
  if (unpaid) {
    const d = `${m}-11`;
    leaveByDate.set(d, {
      typeLabel: unpaid.name,
      typeCode: unpaid.code,
      isPaid: false,
      payrollCategory: unpaid.payrollCategory,
    });
    unpaidLeaveDates.add(d);
  }

  return { leaveByDate, paidLeaveDates, unpaidLeaveDates };
}

export async function previewPayrollRuleImpact(params: {
  month: string;
  employeeId: string;
  userId?: string;
  baseSalary?: number;
  attendance?: Array<{ date?: string; status?: string }>;
  presentDays?: number;
  absentDays?: number;
  /** When true (default), simulate one paid + one unpaid day from leave type config. */
  simulateLeave?: boolean;
}): Promise<Awaited<ReturnType<typeof runUnifiedPayrollRulePipeline>>> {
  const simulateLeave = params.simulateLeave !== false;
  let leaveByDate = new Map<string, import('../approvedLeaveDayMap.js').LeaveDayInfo>();
  let paidLeaveDates = new Set<string>();
  let unpaidLeaveDates = new Set<string>();

  if (simulateLeave) {
    const sample = await buildSampleLeaveContextForPreview(params.month);
    leaveByDate = sample.leaveByDate;
    paidLeaveDates = sample.paidLeaveDates;
    unpaidLeaveDates = sample.unpaidLeaveDates;
  }

  return runUnifiedPayrollRulePipeline({
    month: params.month,
    employeeId: params.employeeId,
    userId: params.userId,
    baseSalary: params.baseSalary ?? 0,
    attendance: params.attendance ?? [],
    leaveByDate,
    paidLeaveDates,
    unpaidLeaveDates,
    presentDays: params.presentDays ?? 22,
    absentDays: params.absentDays ?? 0,
    paidLeaveDays: paidLeaveDates.size,
    persistLogs: false,
  });
}

export async function listUnifiedRuleLogsForEmployee(
  employeeId: string,
  opts?: { month?: string; limit?: number }
): Promise<Array<Record<string, unknown>>> {
  await ensureUnifiedPayrollRuleSchema();
  const where: Record<string, unknown> = { employee_id: employeeId };
  if (opts?.month) where.payroll_month = opts.month.slice(0, 7);

  const rows = await UnifiedPayrollRuleLog.findAll({
    where,
    order: [['triggered_at', 'DESC']],
    limit: opts?.limit ?? 100,
  });
  return rows.map((r) => r.get({ plain: true }) as Record<string, unknown>);
}

export async function detectUnifiedRuleConflicts(): Promise<
  Array<{ category: string; rules: string[]; message: string }>
> {
  const rules = await listUnifiedPayrollRules({ activeOnly: true });
  const warnings: Array<{ category: string; rules: string[]; message: string }> = [];
  const byTarget = new Map<string, string[]>();

  for (const r of rules) {
    const action = r.action_json;
    const target = `${r.category}:${action.target ?? '*'}:${action.type}`;
    const list = byTarget.get(target) ?? [];
    list.push(r.id);
    byTarget.set(target, list);
  }

  for (const [target, ids] of byTarget) {
    if (ids.length > 1) {
      const prio = rules
        .filter((r) => ids.includes(r.id))
        .map((r) => r.priority)
        .sort((a, b) => a - b);
      if (prio[0] === prio[prio.length - 1]) {
        warnings.push({
          category: target.split(':')[0] ?? 'unknown',
          rules: ids,
          message: `Same priority (${prio[0]}) on overlapping target — highest priority wins by rule order.`,
        });
      }
    }
  }
  return warnings;
}
