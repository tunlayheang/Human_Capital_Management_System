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

export type SeniorityRule = {
  id: string;
  name: string;
  description?: string | null;
  effective_from: string;
  effective_to?: string | null;
  accrual_type: SeniorityAccrualType;
  accrual_config: Record<string, unknown>;
  calculation_base?: string;
  eligibility_rules: Record<string, unknown>;
  proration_rules: Record<string, unknown>;
  payment_frequency: SeniorityPaymentFrequency;
  applicable_groups: Record<string, unknown>;
  priority: number;
  active: boolean;
};

export type SeniorityLedgerEntry = {
  id: string;
  employee_id: string;
  type: 'accrual' | 'payment' | 'adjustment';
  amount: number;
  balance_after: number;
  payroll_month?: string | null;
  reason?: string | null;
  created_at: string;
};

export type SeniorityPreview = {
  payoutUsd: number;
  accrualUsd: number;
  snapshot: {
    ruleName: string;
    eligible: boolean;
    ineligibleReason?: string | null;
    fullMonthAccrualUsd: number;
    proratedAccrualUsd: number;
    yearlyProjectionUsd?: number;
    serviceYears: number;
    prorationFactor: number;
    balanceBeforeUsd: number;
    balanceAfterUsd: number;
  };
};
