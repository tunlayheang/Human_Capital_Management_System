import type { SeniorityRule } from '../../types/seniority';
import type { UnifiedPayrollRule } from '../../types/unifiedPayrollRules';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';
import { formatRulesAmountFromUsd } from '../../utils/payrollRulesCurrency';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';

const ACCRUAL_LABELS: Record<string, string> = {
  fixed_monthly: 'Fixed monthly amount',
  percent_salary: 'Percent of basic salary',
  service_tiers: 'By years of service',
  hybrid: 'Base + service multiplier',
};

const PAY_FREQ_LABELS: Record<string, string> = {
  monthly: 'Paid each payroll',
  quarterly: 'Paid quarterly',
  semiannual: 'Paid every 6 months',
  yearly: 'Paid yearly',
  final_settlement_only: 'Paid on final settlement only',
  deferred: 'Accrued to ledger only',
};

const FIELD_LABELS: Record<string, string> = {
  'leave.typeCode': 'Leave type',
  'leave.isPaid': 'Leave is paid',
  'attendance.status': 'Attendance status',
  'attendance.presentDays': 'Present days (month)',
  'employee.status': 'Employee status',
  'contract.baseSalary': 'Base salary',
  'employee.serviceYears': 'Years of service',
  'attendance.absentDays': 'Absent days',
  'benefit.code': 'Benefit code',
};

const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
};

const ACTION_LABELS: Record<string, string> = {
  set_leave_category: 'Classify leave day',
  set_deduct_day: 'Treat as deductible day',
  set_attendance_category: 'Classify attendance day',
  add_allowance: 'Add allowance',
  add_deduction: 'Add deduction',
  set_seniority_amount: 'Set seniority amount',
  convert_benefit_to_allowance: 'Convert benefit to allowance',
  ignore: 'No change',
};

const LEAVE_VALUE_LABELS: Record<string, string> = {
  payable: 'Counts as payable day',
  deductible: 'Counts as deductible (unpaid) day',
};

function parseJsonObject<T extends object>(raw: unknown, fallback: T): T {
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

export function normalizeUnifiedRule(rule: UnifiedPayrollRule): UnifiedPayrollRule {
  return {
    ...rule,
    condition_json: parseJsonObject(rule.condition_json as unknown, {
      mode: 'simple',
      logic: 'all',
      conditions: [],
    }),
    action_json: parseJsonObject(rule.action_json as unknown, { type: 'ignore' }),
  };
}

export function describeUnifiedRule(rule: UnifiedPayrollRule): string {
  const r = normalizeUnifiedRule(rule);
  if (r.description?.trim()) return r.description.trim();

  const conditions = r.condition_json?.conditions ?? [];
  const action = r.action_json;
  const actionType = action?.type ?? 'ignore';

  if (conditions.length === 0 && r.category === 'leave') {
    const v = String(action?.value ?? action?.target ?? '');
    if (actionType === 'set_leave_category' && v === 'payable') {
      return 'Paid leave counts toward payable days in payroll.';
    }
    if (actionType === 'set_leave_category' && v === 'deductible') {
      return 'Unpaid leave reduces payable days (salary deduction).';
    }
  }

  if (conditions.length === 1) {
    const c = conditions[0];
    const field = FIELD_LABELS[c.field] ?? c.field;
    const op = OP_LABELS[c.op] ?? c.op;
    const val =
      c.value === true ? 'yes' : c.value === false ? 'no' : String(c.value ?? '');
    const actionLabel = ACTION_LABELS[actionType] ?? actionType;
    const extra =
      actionType === 'set_leave_category' && action?.value
        ? ` → ${LEAVE_VALUE_LABELS[String(action.value)] ?? String(action.value)}`
        : action?.amount != null
          ? ` → $${action.amount}`
          : '';
    return `When ${field} ${op} ${val}, then ${actionLabel}${extra}.`;
  }

  const actionLabel = ACTION_LABELS[actionType] ?? actionType;
  return `${conditions.length} conditions → ${actionLabel}`;
}

export function describeSeniorityRule(
  rule: SeniorityRule,
  options?: { currency?: PreferredCurrency; exchangeRateKhrPerUsd?: number }
): string {
  const currency = options?.currency ?? 'USD';
  const rate = resolveExchangeRateKhrPerUsd(options?.exchangeRateKhrPerUsd, 'configured');
  const money = (usd: number) => formatRulesAmountFromUsd(usd, currency, rate);
  const accrual = ACCRUAL_LABELS[rule.accrual_type] ?? rule.accrual_type;
  const pay = PAY_FREQ_LABELS[rule.payment_frequency] ?? rule.payment_frequency;
  const prorate =
    rule.proration_rules?.enabled !== false ? 'Prorated by days worked' : 'Full month amount';
  const probation = (rule.eligibility_rules as { excludeProbation?: boolean })?.excludeProbation
    ? 'No probation'
    : null;

  const accrualTiers = (rule.accrual_config as { tiers?: unknown[] } | undefined)?.tiers;
  if (rule.accrual_type === 'service_tiers' && Array.isArray(accrualTiers) && accrualTiers.length) {
    const tiers = accrualTiers as Array<{
      yearsMin: number;
      yearsMax: number;
      amountUsd: number;
    }>;
    const tierText = tiers
      .filter((t) => t.amountUsd > 0)
      .map((t) => {
        const max =
          t.yearsMax >= 99 ? `${t.yearsMin}+ yrs` : `${t.yearsMin}–${t.yearsMax} yrs`;
        return `${max}: ${money(t.amountUsd)}/mo`;
      })
      .join(' · ');
    return [accrual, tierText || pay, prorate, probation].filter(Boolean).join(' · ');
  }

  if (rule.accrual_type === 'fixed_monthly' && rule.accrual_config?.amountUsd != null) {
    return [`${money(Number(rule.accrual_config.amountUsd))}/month`, pay, prorate, probation]
      .filter(Boolean)
      .join(' · ');
  }

  if (rule.accrual_type === 'percent_salary' && rule.accrual_config?.percent != null) {
    return [`${rule.accrual_config.percent}% of salary`, pay, prorate, probation]
      .filter(Boolean)
      .join(' · ');
  }

  return [accrual, pay, prorate, probation].filter(Boolean).join(' · ');
}

const DAILY_RATE_LABELS: Record<string, string> = {
  scheduled_26: 'Salary ÷ 26 scheduled days',
  actual_working_days: 'Salary ÷ actual working days',
};

const INCLUSION_LABELS: Record<string, string> = {
  after_probation: 'After probation',
  after_months: 'After waiting period',
};

export function describeIndemnityPolicy(
  policy: import('../../types/seniorityIndemnityPolicy').SeniorityIndemnityPolicy
): string {
  const contracts = policy.eligible_contract_types?.length
    ? policy.eligible_contract_types.join(', ')
    : 'UDC';
  const june = Number(policy.payout_june_days);
  const dec = Number(policy.payout_december_days);
  const divisor = policy.working_days_divisor ?? 26;
  const rate =
    policy.daily_rate_method === 'actual_working_days'
      ? 'Actual working days'
      : `÷ ${divisor} days`;
  const inclusion =
    policy.inclusion_rule === 'after_months' && policy.inclusion_months > 0
      ? `After ${policy.inclusion_months} mo`
      : INCLUSION_LABELS[policy.inclusion_rule] ?? policy.inclusion_rule;
  return `${policy.days_per_year} days/yr · Jun ${june} + Dec ${dec} · ${contracts} · ${rate} · ${inclusion}`;
}

export type UnifiedRulesView = 'leave' | 'attendance' | 'other';

export function leaveTypePayrollEffect(isPaid: boolean): string {
  return isPaid
    ? 'Payable day (counts toward paid days)'
    : 'Deductible day (reduces pay)';
}

export function unifiedRuleMatchesView(
  rule: UnifiedPayrollRule,
  view: UnifiedRulesView
): boolean {
  if (view === 'leave') return rule.category === 'leave';
  if (view === 'attendance') return rule.category === 'attendance';
  return !['leave', 'attendance', 'seniority'].includes(rule.category);
}
