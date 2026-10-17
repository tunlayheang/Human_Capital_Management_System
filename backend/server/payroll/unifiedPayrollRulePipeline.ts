/**
 * Payroll rule execution pipeline (strict order per product spec).
 * 1 Profile → 2 Attendance → 3 Leave → 4 Leave rules → 5 Attendance rules →
 * 6 Benefit → 7 Allowance → 8 Seniority → 9 Deductions → output
 */
import { UnifiedPayrollRule, UnifiedPayrollRuleLog } from '../db.js';
import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import { deriveLeavePayrollCategory } from '../approvedLeaveDayMap.js';
import {
  evaluateUnifiedPayrollRules,
  type UnifiedRuleEvaluationContext,
} from './unifiedPayrollRuleEngine.js';
import type { UnifiedPayrollRuleRow, UnifiedRuleEngineResult } from './unifiedPayrollRuleTypes.js';
import { loadStatusClassificationConfig } from '../payrollStatusClassificationConfig.js';
import crypto from 'crypto';

export type UnifiedPayrollPipelineInput = {
  month: string;
  employeeId: string;
  employeeDisplayId?: string;
  userId?: string;
  employeeStatus?: string;
  accessRole?: string;
  departmentId?: string | null;
  positionId?: string | null;
  positionTitle?: string | null;
  joinDate?: string | Date | null;
  baseSalary?: number;
  attendance: Array<{ date?: string; status?: string; clockIn?: unknown }>;
  leaveByDate: Map<string, LeaveDayInfo>;
  paidLeaveDates: Set<string>;
  unpaidLeaveDates: Set<string>;
  presentDays?: number;
  absentDays?: number;
  paidLeaveDays?: number;
  benefitCodes?: string[];
  persistLogs?: boolean;
};

export type UnifiedPayrollPipelineOutput = {
  engineResult: UnifiedRuleEngineResult;
  /** Effective leave category per date after rules */
  leaveCategoryByDate: Map<string, 'payable' | 'deductible' | 'neutral'>;
  /** Merged attendance status → category (rules override system setting) */
  attendanceCategoryOverrides: Map<string, 'payable' | 'deductible' | 'neutral' | 'leave'>;
  adjustedPaidLeaveDates: Set<string>;
  adjustedUnpaidLeaveDates: Set<string>;
  extraAllowanceTotal: number;
  extraDeductionTotal: number;
  seniorityOverride: number | null;
};

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

function parseRuleRow(row: { get: (opts?: { plain: boolean }) => Record<string, unknown> }): UnifiedPayrollRuleRow {
  const p = row.get({ plain: true });
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
    } as UnifiedPayrollRuleRow['condition_json']),
    action_json: parseJsonColumn(p.action_json, { type: 'ignore' } as UnifiedPayrollRuleRow['action_json']),
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

function serviceYears(joinDate?: string | Date | null, asOf = Date.now()): number {
  if (!joinDate) return 0;
  const d = new Date(joinDate);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, (asOf - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function loadActiveUnifiedPayrollRules(): Promise<UnifiedPayrollRuleRow[]> {
  const rows = await UnifiedPayrollRule.findAll({
    where: { active: true },
    order: [
      ['category', 'ASC'],
      ['priority', 'ASC'],
    ],
  });
  return rows.map(parseRuleRow);
}

export async function runUnifiedPayrollRulePipeline(
  input: UnifiedPayrollPipelineInput
): Promise<UnifiedPayrollPipelineOutput> {
  const rules = await loadActiveUnifiedPayrollRules();
  const join =
    input.joinDate != null
      ? String(input.joinDate).slice(0, 10)
      : null;

  const ctx: UnifiedRuleEvaluationContext = {
    month: input.month,
    employeeId: input.employeeId,
    employeeDisplayId: input.employeeDisplayId,
    userId: input.userId,
    employeeStatus: input.employeeStatus ?? 'ACTIVE',
    accessRole: input.accessRole,
    departmentId: input.departmentId,
    positionId: input.positionId,
    positionTitle: input.positionTitle,
    joinDate: join,
    serviceYears: serviceYears(input.joinDate),
    baseSalary: input.baseSalary ?? 0,
    presentDays: input.presentDays,
    absentDays: input.absentDays,
    paidLeaveDays: input.paidLeaveDays,
    attendanceByDate: input.attendance,
    leaveByDate: input.leaveByDate,
    benefitCodes: input.benefitCodes ?? [],
  };

  const engineResult = evaluateUnifiedPayrollRules(rules, ctx);
  const statusConfig = await loadStatusClassificationConfig();

  const leaveCategoryByDate = new Map<string, 'payable' | 'deductible' | 'neutral'>();
  const adjustedPaid = new Set(input.paidLeaveDates);
  const adjustedUnpaid = new Set(input.unpaidLeaveDates);

  for (const [dateKey, info] of input.leaveByDate) {
    const typeKey = normalizeKey(info.typeCode ?? info.typeLabel);
    const override = engineResult.leaveCategoryByTypeKey.get(typeKey);
    let category = override ?? info.payrollCategory;
    if (!override) {
      category = deriveLeavePayrollCategory({
        payrollCategory: info.payrollCategory,
        isPaid: info.isPaid,
      });
    }
    leaveCategoryByDate.set(dateKey, category);
    adjustedPaid.delete(dateKey);
    adjustedUnpaid.delete(dateKey);
    if (category === 'payable') adjustedPaid.add(dateKey);
    else if (category === 'deductible') adjustedUnpaid.add(dateKey);
  }

  const attendanceCategoryOverrides = new Map<
    string,
    'payable' | 'deductible' | 'neutral' | 'leave'
  >();
  for (const [status, cat] of engineResult.attendanceCategoryByStatus) {
    attendanceCategoryOverrides.set(status, cat);
  }
  for (const [status, cat] of Object.entries(statusConfig)) {
    if (!attendanceCategoryOverrides.has(status)) {
      attendanceCategoryOverrides.set(status, cat);
    }
  }

  const extraAllowanceTotal = engineResult.allowanceLines.reduce((s, l) => s + l.amount, 0);
  const extraDeductionTotal = engineResult.deductionLines.reduce((s, l) => s + l.amount, 0);

  if (input.persistLogs && engineResult.appliedRules.length) {
    const now = new Date();
    const snapshot = {
      month: input.month,
      employeeId: input.employeeId,
      presentDays: input.presentDays,
      absentDays: input.absentDays,
    };
    for (const applied of engineResult.appliedRules) {
      await UnifiedPayrollRuleLog.create({
        id: `uprl-${crypto.randomBytes(10).toString('hex')}`,
        employee_id: input.employeeId,
        payroll_month: input.month.slice(0, 7),
        rule_id: applied.ruleId,
        triggered_at: now,
        input_snapshot: snapshot,
        output_result: applied.result,
        created_at: now,
      });
    }
  }

  return {
    engineResult,
    leaveCategoryByDate,
    attendanceCategoryOverrides,
    adjustedPaidLeaveDates: adjustedPaid,
    adjustedUnpaidLeaveDates: adjustedUnpaid,
    extraAllowanceTotal,
    extraDeductionTotal,
    seniorityOverride: engineResult.seniorityAmount,
  };
}
