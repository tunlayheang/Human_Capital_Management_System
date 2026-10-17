import type { AllowanceRule, AllowanceType } from '../../types';
import type { RulesConfigHelpId } from '../../content/rulesConfigHelpContent';

export function parseConditionJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function isRecordActive(active: unknown): boolean {
  return active === true || active === 1 || active === '1';
}

export function normalizeAllowanceRule(row: AllowanceRule): AllowanceRule {
  return {
    ...row,
    active: isRecordActive(row.active),
    fixed_amount: Number(row.fixed_amount) || 0,
    percentage_rate: Number(row.percentage_rate) || 0,
    priority: Number(row.priority) || 100,
    stackable: row.stackable !== false,
    condition_json: parseConditionJson(row.condition_json),
  };
}

export function normalizeAllowanceType(row: AllowanceType): AllowanceType {
  return {
    ...row,
    active: isRecordActive(row.active),
    taxable: row.taxable !== false,
  };
}

/** Amount shown on templates comes from the linked Rule Builder rule (fixed_amount). */
export function resolveAmountFromRule(
  typeId: string,
  ruleId: string,
  rules: AllowanceRule[]
): { ruleId: string; amount: number; ruleName: string } {
  const activeForType = rules
    .filter((r) => r.allowance_type_id === typeId && isRecordActive(r.active))
    .sort((a, b) => Number(b.priority) - Number(a.priority));

  const rule = ruleId
    ? rules.find((r) => r.id === ruleId && r.allowance_type_id === typeId)
    : activeForType[0];

  if (!rule) {
    return { ruleId: ruleId || '', amount: 0, ruleName: 'No active rule' };
  }

  return {
    ruleId: rule.id,
    amount: Number(rule.fixed_amount) || 0,
    ruleName: rule.rule_name,
  };
}

/** Modal (!) help for New/Edit allowance rule — swaps with Rule type. */
export function allowanceRuleTypeHelpId(triggerType: string): RulesConfigHelpId {
  switch (triggerType) {
    case 'attendance':
      return 'payroll.allowanceRuleAttendance';
    case 'position':
      return 'payroll.allowanceRulePosition';
    case 'commission':
      return 'payroll.allowanceCommission';
    case 'conditional':
      return 'payroll.allowanceRuleConditional';
    default:
      return 'payroll.allowanceRuleFixed';
  }
}
