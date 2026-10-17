/** Cambodian Labour Law Art. 89 (New), Prakas 443/2018, MLVT Instruction 058/19. */
export type SeniorityIndemnityDailyRateMethod = 'scheduled_26' | 'actual_working_days';

export type SeniorityIndemnityWorkingDaysDivisor = 22 | 24 | 26;

export type SeniorityIndemnityInclusionRule = 'after_probation' | 'after_months';

/** Resignation indemnity — default conservative (none). */
export type SeniorityIndemnityResignationPolicy = 'none' | 'employer_parity';

export type SeniorityIndemnitySemester = 'S1' | 'S2';

export type SeniorityIndemnitySalaryComponent =
  | 'base_salary'
  | 'position_allowance'
  | 'responsibility_allowance'
  | 'fixed_allowance'
  | 'commission'
  | 'other_recurring';

export type Pre2019BackPayScheduleEntry = {
  /** Calendar year the installment applies to. */
  year: number;
  days: number;
};

export type Pre2019BackPayConfig = {
  enabled: boolean;
  /** Cap expressed as days at 26 days/month × 6 months = 156. */
  capDays: number;
  capMonths: number;
  sectorKey: 'textile_garment_footwear' | 'other';
  schedule: Pre2019BackPayScheduleEntry[];
};

export type SeniorityIndemnityConfig = {
  enabled: boolean;
  daysPerYear: number;
  payoutJuneDays: number;
  payoutDecemberDays: number;
  /** @deprecated Use workingDaysDivisor — kept for legacy policy rows. */
  dailyRateMethod: SeniorityIndemnityDailyRateMethod;
  workingDaysDivisor: SeniorityIndemnityWorkingDaysDivisor;
  salaryBasis: SeniorityIndemnitySalaryComponent[];
  eligibleContractTypes: string[];
  excludedEmploymentTypes: string[];
  /** Always after_probation under Art. 89 — probation excluded from seniority. */
  inclusionRule: SeniorityIndemnityInclusionRule;
  inclusionMonths: number;
  /** Days worked in a calendar month to count as a full seniority month (default 21). */
  semesterMinDaysForFullMonth: number;
  /** Employer termination / retirement with 1–5 completed seniority months in semester. */
  terminationPartialSemesterDays: number;
  resignationIndemnityPolicy: SeniorityIndemnityResignationPolicy;
  pre2019BackPay: Pre2019BackPayConfig;
  /** FDC employees use separate 5% severance — not indemnity. */
  fdcSeveranceRuleEnabled: boolean;
};

export type ServiceLengthBreakdown = {
  years: number;
  months: number;
  days: number;
  totalMonths: number;
  label: string;
};

export type SeniorityIndemnityEligibility = {
  eligible: boolean;
  reason: string | null;
  /** FDC contract — route to 5% severance rule instead. */
  fdcSeveranceRequired?: boolean;
};

export type SeniorityIndemnitySemesterMonthInput = {
  month: string;
  /** Gross pre-tax wages + fringe for the month. */
  grossWagesUsd: number;
  /** Optional override when occupational/sick/maternity benefits excluded from basis. */
  basisWagesUsd?: number;
  daysWorked: number;
  excludeOccupationalBenefitsFromBasis?: boolean;
  /** Protected leave — counts toward seniority period (do not reduce day-count). */
  protectedLeaveDays?: number;
};

export type SeniorityIndemnityTerminationReason =
  | 'employer'
  | 'resignation'
  | 'misconduct'
  | 'retirement'
  | 'death'
  | 'contract_end';

export type SeniorityIndemnityTerminationContext = {
  reason: SeniorityIndemnityTerminationReason;
  seriousMisconduct?: boolean;
  pre2019BackPayUsd?: number;
};

export type SeniorityIndemnityCalculationInput = {
  payrollMonth: string;
  payrollPeriodEnd: string;
  joinDate: string | Date | null | undefined;
  contractType: string | null | undefined;
  employmentType: string | null | undefined;
  probationPeriodMonths?: number | null;
  probationConfirmedAt?: string | Date | null;
  workerType?: string | null;
  terminationDate?: string | Date | null;
  /** Current-period gross basis (fallback when semester history omitted). */
  salaryBasisUsd: number;
  scheduledWorkingDays: number;
  actualWorkingDays?: number;
  config: SeniorityIndemnityConfig;
  /** @deprecated Independent semesters — kept for audit only. */
  alreadyPaidThisCalendarYear?: number;
  alreadyPaidThisSemester?: boolean;
  isFinalSettlement?: boolean;
  termination?: SeniorityIndemnityTerminationContext;
  employedOnPayoutDate?: boolean;
  semesterMonthlyInputs?: SeniorityIndemnitySemesterMonthInput[];
};

export type SeniorityIndemnityCalculationResult = {
  eligible: boolean;
  ineligibleReason: string | null;
  payoutUsd: number;
  payoutDays: number;
  dailyRateUsd: number;
  salaryBasisUsd: number;
  avgMonthlyUsd: number;
  serviceLength: ServiceLengthBreakdown | null;
  calendarYearEntitlementDays: number;
  formula: string;
  paymentKind: 'june' | 'december' | 'settlement' | 'none';
  semester: SeniorityIndemnitySemester | null;
  pre2019BackPayUsd: number;
  audit: Record<string, unknown>;
};

export type SeniorityIndemnityPaymentStatus = 'draft' | 'pending' | 'approved' | 'paid' | 'cancelled';

export type SeniorityIndemnityPaymentRow = {
  id: string;
  employee_id: string;
  payroll_month: string;
  calendar_year: number;
  payment_kind: 'june' | 'december' | 'settlement';
  amount_usd: number;
  payout_days: number;
  daily_rate_usd: number;
  salary_basis_usd: number;
  status: SeniorityIndemnityPaymentStatus;
  formula: string;
  audit_json: Record<string, unknown>;
  payslip_id?: string | null;
  created_at?: string;
  approved_at?: string | null;
  approved_by?: string | null;
};

export type Pre2019BackPayLedgerRow = {
  id: string;
  employee_id: string;
  calendar_year: number;
  days_paid: number;
  amount_usd: number;
  status: SeniorityIndemnityPaymentStatus;
  formula: string;
  audit_json: Record<string, unknown>;
  created_at?: string;
};
