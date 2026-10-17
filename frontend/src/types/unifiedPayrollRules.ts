export type UnifiedRuleCategory =
  | 'leave'
  | 'attendance'
  | 'benefit'
  | 'allowance'
  | 'seniority'
  | 'deduction';

export type UnifiedRuleMode = 'simple' | 'medium' | 'advanced';

export type UnifiedRuleCondition = {
  field: string;
  op: string;
  value?: unknown;
  valueTo?: unknown;
};

export type UnifiedRuleConditionJson = {
  mode?: UnifiedRuleMode;
  logic?: 'all' | 'any';
  conditions: UnifiedRuleCondition[];
};

export type UnifiedRuleActionJson = {
  type: string;
  merge?: 'override' | 'stack' | 'merge';
  target?: string;
  value?: unknown;
  amount?: number;
  code?: string;
  name?: string;
  prorate?: boolean;
  perDay?: boolean;
};

export type UnifiedPayrollRule = {
  id: string;
  name: string;
  description?: string | null;
  category: UnifiedRuleCategory;
  source: string;
  mode: UnifiedRuleMode;
  condition_json: UnifiedRuleConditionJson;
  action_json: UnifiedRuleActionJson;
  priority: number;
  active: boolean;
  is_template: boolean;
  is_system: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
};

export type UnifiedRuleConflict = {
  category: string;
  rules: string[];
  message: string;
};

export type UnifiedRulePreviewResult = {
  engineResult: {
    appliedRules: Array<{
      ruleId: string;
      ruleName: string;
      category: string;
      result: Record<string, unknown>;
    }>;
    conflicts: Array<{ ruleIds: string[]; message: string }>;
    allowanceLines: Array<{ code: string; name: string; amount: number }>;
    deductionLines: Array<{ code: string; name: string; amount: number }>;
    seniorityAmount: number | null;
  };
  extraAllowanceTotal: number;
  extraDeductionTotal: number;
};
