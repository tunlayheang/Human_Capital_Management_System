/** Unified payroll rule engine — IF condition → THEN payroll action */

export type UnifiedRuleCategory =
  | 'leave'
  | 'attendance'
  | 'benefit'
  | 'allowance'
  | 'seniority'
  | 'deduction';

export type UnifiedRuleSource =
  | 'benefit'
  | 'leave'
  | 'attendance'
  | 'employee'
  | 'contract'
  | 'allowance';

export type UnifiedRuleMode = 'simple' | 'medium' | 'advanced';

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'between'
  | 'exists';

export type UnifiedRuleCondition = {
  field: string;
  op: ConditionOperator;
  value?: unknown;
  valueTo?: unknown;
};

export type UnifiedRuleConditionJson = {
  mode?: UnifiedRuleMode;
  /** all = AND, any = OR */
  logic?: 'all' | 'any';
  conditions: UnifiedRuleCondition[];
};

export type UnifiedRuleMergeStrategy = 'override' | 'stack' | 'merge';

export type UnifiedPayrollActionType =
  | 'set_payable_day'
  | 'set_deduct_day'
  | 'set_leave_category'
  | 'set_attendance_category'
  | 'add_allowance'
  | 'add_deduction'
  | 'set_seniority_amount'
  | 'convert_benefit_to_allowance'
  | 'ignore';

export type UnifiedRuleActionJson = {
  type: UnifiedPayrollActionType;
  merge?: UnifiedRuleMergeStrategy;
  /** leave type code/id, allowance code, benefit code, etc. */
  target?: string;
  value?: unknown;
  amount?: number;
  code?: string;
  name?: string;
  prorate?: boolean;
  perDay?: boolean;
};

export type UnifiedPayrollRuleRow = {
  id: string;
  name: string;
  description?: string | null;
  category: UnifiedRuleCategory;
  source: UnifiedRuleSource;
  mode: UnifiedRuleMode;
  condition_json: UnifiedRuleConditionJson;
  action_json: UnifiedRuleActionJson;
  priority: number;
  active: boolean;
  is_template: boolean;
  is_system: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const UNIFIED_RULE_CATEGORY_ORDER: UnifiedRuleCategory[] = [
  'leave',
  'attendance',
  'benefit',
  'allowance',
  'seniority',
  'deduction',
];

export type AppliedUnifiedRule = {
  ruleId: string;
  ruleName: string;
  category: UnifiedRuleCategory;
  priority: number;
  matched: boolean;
  action: UnifiedRuleActionJson;
  result: Record<string, unknown>;
};

export type UnifiedRuleEngineResult = {
  appliedRules: AppliedUnifiedRule[];
  leaveCategoryByTypeKey: Map<string, 'payable' | 'deductible' | 'neutral'>;
  attendanceCategoryByStatus: Map<string, 'payable' | 'deductible' | 'neutral' | 'leave'>;
  allowanceLines: Array<{
    code: string;
    name: string;
    amount: number;
    ruleId: string;
    prorate?: boolean;
  }>;
  deductionLines: Array<{
    code: string;
    name: string;
    amount: number;
    ruleId: string;
  }>;
  seniorityAmount: number | null;
  conflicts: Array<{ ruleIds: string[]; message: string }>;
};
