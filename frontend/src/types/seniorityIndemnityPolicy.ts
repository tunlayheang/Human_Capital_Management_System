export type SeniorityIndemnityDailyRateMethod = 'scheduled_26' | 'actual_working_days';
export type SeniorityIndemnityInclusionRule = 'after_probation' | 'after_months';
export type SeniorityIndemnityWorkingDaysDivisor = 22 | 24 | 26;
export type SeniorityIndemnityResignationPolicy = 'none' | 'employer_parity';

export type SeniorityIndemnitySalaryComponent =
  | 'base_salary'
  | 'position_allowance'
  | 'responsibility_allowance'
  | 'fixed_allowance'
  | 'commission'
  | 'other_recurring';

export type Pre2019BackPayScheduleEntry = {
  year: number;
  days: number;
};

export type Pre2019BackPayConfig = {
  enabled: boolean;
  capDays: number;
  capMonths: number;
  sectorKey: 'textile_garment_footwear' | 'other';
  schedule: Pre2019BackPayScheduleEntry[];
};

export type SeniorityIndemnityExtendedConfig = {
  semesterMinDaysForFullMonth?: number;
  terminationPartialSemesterDays?: number;
  resignationIndemnityPolicy?: SeniorityIndemnityResignationPolicy;
  fdcSeveranceRuleEnabled?: boolean;
  pre2019BackPay?: Pre2019BackPayConfig;
};

export type SeniorityIndemnityPolicy = {
  id: string;
  name: string;
  description?: string | null;
  legal_ref?: string | null;
  effective_from: string;
  effective_to?: string | null;
  days_per_year: number;
  payout_june_days: number;
  payout_december_days: number;
  daily_rate_method: SeniorityIndemnityDailyRateMethod;
  working_days_divisor?: SeniorityIndemnityWorkingDaysDivisor;
  salary_basis: SeniorityIndemnitySalaryComponent[];
  eligible_contract_types: string[];
  excluded_employment_types: string[];
  inclusion_rule: SeniorityIndemnityInclusionRule;
  inclusion_months: number;
  extended_config?: SeniorityIndemnityExtendedConfig;
  priority: number;
  active: boolean;
};
