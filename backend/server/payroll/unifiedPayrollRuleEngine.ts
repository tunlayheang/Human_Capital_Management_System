import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import type {
  AppliedUnifiedRule,
  UnifiedPayrollRuleRow,
  UnifiedRuleActionJson,
  UnifiedRuleCategory,
  UnifiedRuleCondition,
  UnifiedRuleConditionJson,
  UnifiedRuleEngineResult,
  UnifiedRuleMergeStrategy,
} from './unifiedPayrollRuleTypes.js';
import { UNIFIED_RULE_CATEGORY_ORDER } from './unifiedPayrollRuleTypes.js';

export type UnifiedRuleEvaluationContext = {
  month: string;
  employeeId: string;
  employeeDisplayId?: string;
  userId?: string;
  employeeStatus?: string;
  accessRole?: string;
  departmentId?: string | null;
  positionId?: string | null;
  positionTitle?: string | null;
  joinDate?: string | null;
  serviceYears?: number;
  baseSalary?: number;
  presentDays?: number;
  absentDays?: number;
  paidLeaveDays?: number;
  attendanceByDate: Array<{ date?: string; status?: string }>;
  leaveByDate: Map<string, LeaveDayInfo>;
  benefitCodes?: string[];
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function monthInRange(month: string, from?: string | null, to?: string | null): boolean {
  const m = month.slice(0, 7);
  if (from && m < from.slice(0, 7)) return false;
  if (to && m > to.slice(0, 7)) return false;
  return true;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getContextValue(ctx: UnifiedRuleEvaluationContext, field: string): unknown {
  const f = field.trim();
  if (f === 'employee.status') return ctx.employeeStatus;
  if (f === 'employee.role' || f === 'employee.accessRole') return ctx.accessRole;
  if (f === 'employee.departmentId') return ctx.departmentId;
  if (f === 'employee.positionId') return ctx.positionId;
  if (f === 'employee.positionTitle') return ctx.positionTitle;
  if (f === 'employee.joinDate') return ctx.joinDate;
  if (f === 'employee.serviceYears') return ctx.serviceYears ?? 0;
  if (f === 'contract.baseSalary') return ctx.baseSalary ?? 0;
  if (f === 'attendance.presentDays') return ctx.presentDays ?? 0;
  if (f === 'attendance.absentDays') return ctx.absentDays ?? 0;
  if (f === 'attendance.paidLeaveDays') return ctx.paidLeaveDays ?? 0;
  if (f.startsWith('leave.typeCode')) return f.split('=')[1]?.trim() ?? null;
  if (f.startsWith('leave.typeLabel')) return f.split('=')[1]?.trim() ?? null;
  if (f === 'leave.isPaid') return f;
  if (f.startsWith('attendance.status')) return f.split('=')[1]?.trim().toUpperCase() ?? null;
  if (f.startsWith('benefit.code')) return f.split('=')[1]?.trim() ?? null;
  return undefined;
}

function compareCondition(
  ctx: UnifiedRuleEvaluationContext,
  cond: UnifiedRuleCondition,
  leaveTypeKey?: string,
  attendanceStatus?: string
): boolean {
  let left: unknown;
  const field = cond.field.trim();

  if (field === 'leave.typeCode' || field === 'leave.typeLabel') {
    if (!leaveTypeKey) return false;
    const key = normalizeKey(leaveTypeKey);
    const want = normalizeKey(String(cond.value ?? ''));
    if (cond.op === 'eq') return key === want || key.includes(want);
    if (cond.op === 'neq') return key !== want;
    if (cond.op === 'contains') return key.includes(want);
    return false;
  }

  if (field === 'leave.isPaid') {
    const wantPaid = cond.value === true || cond.value === 'true';
    if (leaveTypeKey) {
      const key = normalizeKey(leaveTypeKey);
      const forType = [...ctx.leaveByDate.values()].filter(
        (x) => normalizeKey(x.typeCode ?? x.typeLabel) === key
      );
      if (!forType.length) return false;
      const typeIsPaid = forType.some((x) => x.isPaid);
      if (cond.op === 'eq') return wantPaid ? typeIsPaid : !typeIsPaid;
      return false;
    }
    const anyPaid = [...ctx.leaveByDate.values()].some((x) => x.isPaid);
    const anyUnpaid = [...ctx.leaveByDate.values()].some((x) => !x.isPaid);
    if (cond.op === 'eq') return wantPaid ? anyPaid : anyUnpaid;
    return false;
  }

  if (field === 'attendance.status') {
    const st = String(attendanceStatus ?? '').toUpperCase();
    const want = String(cond.value ?? '').toUpperCase();
    if (cond.op === 'eq') return st === want;
    if (cond.op === 'neq') return st !== want;
    if (cond.op === 'in') {
      const list = Array.isArray(cond.value) ? cond.value.map((v) => String(v).toUpperCase()) : [want];
      return list.includes(st);
    }
    return false;
  }

  if (field === 'benefit.code') {
    const codes = (ctx.benefitCodes ?? []).map((c) => normalizeKey(c));
    const want = normalizeKey(String(cond.value ?? ''));
    if (cond.op === 'eq' || cond.op === 'contains') return codes.some((c) => c === want || c.includes(want));
    return false;
  }

  left = getContextValue(ctx, field);
  const right = cond.value;

  switch (cond.op) {
    case 'exists':
      return left != null && left !== '';
    case 'eq':
      return String(left).toLowerCase() === String(right).toLowerCase();
    case 'neq':
      return String(left).toLowerCase() !== String(right).toLowerCase();
    case 'gt':
      return num(left) > num(right);
    case 'gte':
      return num(left) >= num(right);
    case 'lt':
      return num(left) < num(right);
    case 'lte':
      return num(left) <= num(right);
    case 'in': {
      const list = Array.isArray(right) ? right : [right];
      return list.map((v) => String(v).toLowerCase()).includes(String(left).toLowerCase());
    }
    case 'contains':
      return String(left).toLowerCase().includes(String(right).toLowerCase());
    case 'between':
      return num(left) >= num(right) && num(left) <= num(cond.valueTo);
    default:
      return false;
  }
}

export function evaluateRuleConditions(
  ctx: UnifiedRuleEvaluationContext,
  conditionJson: UnifiedRuleConditionJson,
  scope?: { leaveTypeKey?: string; attendanceStatus?: string }
): boolean {
  const conditions = conditionJson.conditions ?? [];
  if (!conditions.length) return true;
  const logic = conditionJson.logic ?? 'all';
  const results = conditions.map((c) =>
    compareCondition(ctx, c, scope?.leaveTypeKey, scope?.attendanceStatus)
  );
  return logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

function emptyResult(): UnifiedRuleEngineResult {
  return {
    appliedRules: [],
    leaveCategoryByTypeKey: new Map(),
    attendanceCategoryByStatus: new Map(),
    allowanceLines: [],
    deductionLines: [],
    seniorityAmount: null,
    conflicts: [],
  };
}

function resolveLeaveCategoryFromAction(
  action: UnifiedRuleActionJson
): 'payable' | 'deductible' | 'neutral' {
  if (action.type === 'set_payable_day') return 'payable';
  if (action.type === 'set_deduct_day') return 'deductible';
  const v = action.value;
  if (v === 'payable' || v === true || v === 'true') return 'payable';
  if (v === 'neutral') return 'neutral';
  return 'deductible';
}

function applyMerge<T>(
  current: T | undefined,
  next: T,
  strategy: UnifiedRuleMergeStrategy | undefined
): T {
  if (current === undefined || strategy === 'override') return next;
  if (strategy === 'stack' && typeof current === 'number' && typeof next === 'number') {
    return (current + next) as T;
  }
  return next;
}

function applyAction(
  result: UnifiedRuleEngineResult,
  action: UnifiedRuleActionJson,
  rule: UnifiedPayrollRuleRow,
  scope?: { leaveTypeKey?: string; attendanceStatus?: string }
): void {
  const merge = action.merge ?? 'override';
  const applied: AppliedUnifiedRule = {
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    priority: rule.priority,
    matched: true,
    action,
    result: {},
  };

  switch (action.type) {
    case 'set_payable_day':
    case 'set_leave_category': {
      const next = resolveLeaveCategoryFromAction(action);
      const key = normalizeKey(action.target ?? scope?.leaveTypeKey ?? '');
      if (key) {
        const prev = result.leaveCategoryByTypeKey.get(key);
        result.leaveCategoryByTypeKey.set(
          key,
          applyMerge(prev, next, merge) as 'payable' | 'deductible' | 'neutral'
        );
        applied.result = { leaveTypeKey: key, category: next };
      }
      break;
    }
    case 'set_deduct_day': {
      const key = normalizeKey(action.target ?? scope?.leaveTypeKey ?? '');
      if (key) {
        result.leaveCategoryByTypeKey.set(key, 'deductible');
        applied.result = { leaveTypeKey: key, category: 'deductible' };
      }
      break;
    }
    case 'set_attendance_category': {
      const st = String(action.target ?? scope?.attendanceStatus ?? '').toUpperCase();
      const cat = String(action.value ?? 'payable') as 'payable' | 'deductible' | 'neutral' | 'leave';
      if (st) {
        result.attendanceCategoryByStatus.set(st, cat);
        applied.result = { status: st, category: cat };
      }
      break;
    }
    case 'add_allowance': {
      const amount = num(action.amount ?? action.value, 0);
      if (amount > 0) {
        result.allowanceLines.push({
          code: String(action.code ?? 'RULE_ALLOWANCE'),
          name: String(action.name ?? rule.name),
          amount,
          ruleId: rule.id,
          prorate: action.prorate,
        });
        applied.result = { amount };
      }
      break;
    }
    case 'add_deduction': {
      const amount = num(action.amount ?? action.value, 0);
      if (amount > 0) {
        result.deductionLines.push({
          code: String(action.code ?? 'RULE_DEDUCTION'),
          name: String(action.name ?? rule.name),
          amount,
          ruleId: rule.id,
        });
        applied.result = { amount };
      }
      break;
    }
    case 'set_seniority_amount': {
      const amount = num(action.amount ?? action.value, 0);
      result.seniorityAmount = applyMerge(result.seniorityAmount ?? 0, amount, merge);
      applied.result = { seniorityAmount: result.seniorityAmount };
      break;
    }
    case 'convert_benefit_to_allowance': {
      const perDay = num(action.perDay ?? action.amount, 0);
      const days = num(ctx.presentDays, 0) + num(ctx.paidLeaveDays, 0);
      const amount = action.perDay ? perDay * days : perDay;
      if (amount > 0) {
        result.allowanceLines.push({
          code: String(action.code ?? `BENEFIT_${action.target ?? 'GENERIC'}`),
          name: String(action.name ?? rule.name),
          amount,
          ruleId: rule.id,
        });
        applied.result = { amount, benefit: action.target };
      }
      break;
    }
    case 'ignore':
    default:
      applied.matched = false;
      break;
  }

  if (applied.matched) result.appliedRules.push(applied);
}

export function evaluateUnifiedPayrollRules(
  rules: UnifiedPayrollRuleRow[],
  ctx: UnifiedRuleEvaluationContext
): UnifiedRuleEngineResult {
  const result = emptyResult();
  const month = ctx.month.slice(0, 7);

  const active = rules
    .filter((r) => r.active && monthInRange(month, r.effective_from, r.effective_to))
    .sort((a, b) => {
      const ca = UNIFIED_RULE_CATEGORY_ORDER.indexOf(a.category);
      const cb = UNIFIED_RULE_CATEGORY_ORDER.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.priority - b.priority;
    });

  const seenTargets = new Map<string, string>();

  for (const rule of active) {
    const condition = parseJson<UnifiedRuleConditionJson>(rule.condition_json, { conditions: [] });
    const action = parseJson<UnifiedRuleActionJson>(rule.action_json, { type: 'ignore' });

    if (rule.category === 'leave') {
      const typeKeys = new Set<string>();
      for (const info of ctx.leaveByDate.values()) {
        typeKeys.add(normalizeKey(info.typeCode ?? info.typeLabel));
      }
      if (action.target) typeKeys.add(normalizeKey(action.target));
      if (!typeKeys.size) {
        if (action.target) typeKeys.add(normalizeKey(action.target));
        else continue;
      }

      for (const typeKey of typeKeys) {
        if (!evaluateRuleConditions(ctx, condition, { leaveTypeKey: typeKey })) continue;
        const conflictKey = `leave:${typeKey}:${action.type}`;
        const prev = seenTargets.get(conflictKey);
        if (prev && prev !== rule.id && (action.merge ?? 'override') === 'override') {
          result.conflicts.push({
            ruleIds: [prev, rule.id],
            message: `Leave rule conflict on ${typeKey}`,
          });
        }
        seenTargets.set(conflictKey, rule.id);
        applyAction(result, action, rule, { leaveTypeKey: typeKey });
      }
      continue;
    }

    if (rule.category === 'attendance') {
      const statuses = new Set<string>();
      for (const row of ctx.attendanceByDate) {
        statuses.add(String(row.status ?? '').toUpperCase());
      }
      if (action.target) statuses.add(String(action.target).toUpperCase());
      if (!statuses.size) statuses.add('*');

      for (const status of statuses) {
        if (status === '*') {
          if (!evaluateRuleConditions(ctx, condition)) continue;
          applyAction(result, action, rule);
          continue;
        }
        if (!evaluateRuleConditions(ctx, condition, { attendanceStatus: status })) continue;
        const conflictKey = `attendance:${status}:${action.type}`;
        const prev = seenTargets.get(conflictKey);
        if (prev && prev !== rule.id) {
          result.conflicts.push({
            ruleIds: [prev, rule.id],
            message: `Attendance rule conflict on ${status}`,
          });
        }
        seenTargets.set(conflictKey, rule.id);
        applyAction(result, action, rule, { attendanceStatus: status });
      }
      continue;
    }

    if (!evaluateRuleConditions(ctx, condition)) continue;
    applyAction(result, action, rule);
  }

  return result;
}

export function categoryIndex(category: UnifiedRuleCategory): number {
  return UNIFIED_RULE_CATEGORY_ORDER.indexOf(category);
}
