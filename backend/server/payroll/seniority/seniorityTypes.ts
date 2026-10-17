/** Dedicated seniority entitlement engine — not allowance / benefit / base salary. */

export type SeniorityAccrualType =
  | 'fixed_monthly'
  | 'percent_salary'
  | 'service_tiers'
  | 'hybrid';

export type SeniorityPaymentFrequency =
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'yearly'
  | 'final_settlement_only'
  | 'deferred';

export type SeniorityServiceTier = {
  yearsMin: number;
  yearsMax: number;
  amountUsd: number;
};

export type SeniorityAccrualConfig = {
  amountUsd?: number;
  percent?: number;
  tiers?: SeniorityServiceTier[];
  baseAmountUsd?: number;
  serviceMultiplierPerYear?: number;
  maxMultiplier?: number;
};

export type SeniorityEligibilityRules = {
  employeeStatuses?: string[];
  employmentTypes?: string[];
  excludeProbation?: boolean;
  minWorkingDaysInMonth?: number;
  minServiceDays?: number;
  excludeUnpaidLeaveDays?: boolean;
  excludeSuspension?: boolean;
  departmentIds?: string[];
  accessRoles?: string[];
};

export type SeniorityProrationRules = {
  enabled?: boolean;
  basis?: 'eligible_payroll_days';
};

export type SeniorityApplicableGroups = {
  allEmployees?: boolean;
  departmentIds?: string[];
  accessRoles?: string[];
};

export type SeniorityRuleRow = {
  id: string;
  name: string;
  description?: string | null;
  effective_from: string;
  effective_to?: string | null;
  accrual_type: SeniorityAccrualType;
  accrual_config: SeniorityAccrualConfig;
  calculation_base?: 'basic_salary' | 'contract_base';
  eligibility_rules: SeniorityEligibilityRules;
  proration_rules: SeniorityProrationRules;
  payment_frequency: SeniorityPaymentFrequency;
  applicable_groups: SeniorityApplicableGroups;
  priority: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type SeniorityLedgerType = 'accrual' | 'payment' | 'adjustment';

export type SeniorityCalculationSnapshot = {
  ruleId: string;
  ruleName: string;
  accrualType: SeniorityAccrualType;
  paymentFrequency: SeniorityPaymentFrequency;
  eligible: boolean;
  ineligibleReason?: string | null;
  serviceYears: number;
  serviceDays: number;
  fullMonthAccrualUsd: number;
  proratedAccrualUsd: number;
  payoutUsd: number;
  prorationFactor: number;
  eligiblePayrollDays: number;
  totalPayrollDays: number;
  balanceBeforeUsd: number;
  balanceAfterUsd: number;
  yearlyProjectionUsd?: number;
};

export type SeniorityPayrollResult = {
  payoutUsd: number;
  accrualUsd: number;
  snapshot: SeniorityCalculationSnapshot;
  ledgerAccrualId?: string;
  ledgerPaymentId?: string;
};
