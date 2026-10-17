/** Enterprise hybrid payroll: fixed monthly components vs attendance-driven variables. */

export type PayrollRunStatus =
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'LOCKED'
  | 'PAYMENT_PROCESSING'
  | 'PAID'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'COMPLETED'; // legacy alias → treated as APPROVED

export type AttendancePeriodStatus = 'OPEN' | 'FINALIZED' | 'LOCKED';

export type PayrollAdjustmentStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'APPLIED';

export type PayrollAdjustmentType =
  | 'RETROACTIVE_OT'
  | 'ATTENDANCE_CORRECTION'
  | 'MISSED_ALLOWANCE'
  | 'SALARY_AMENDMENT'
  | 'PAYROLL_CORRECTION'
  | 'FINAL_SETTLEMENT'
  | 'OTHER';

export type PayrollRunType = 'MONTHLY' | 'FINAL_SETTLEMENT';

export type PaymentBatchStatus = 'DRAFT' | 'EXPORTED' | 'PROCESSING' | 'PAID' | 'RECONCILED' | 'CANCELLED';

export type HybridFixedComponents = {
  contractBaseSalary: number;
  /** Amount actually paid after hire/resign proration only. */
  fixedBaseSalary: number;
  prorationFactor: number;
  prorationReason?: string | null;
  positionAllowance: number;
  seniorityAllowance: number;
  seniorityIndemnity: number;
  transportAllowance: number;
  mealAllowance: number;
  otherFixedAllowances: number;
  total: number;
};

export type HybridVariableAdditions = {
  overtime: {
    hours100?: number;
    amount100?: number;
    hours150: number;
    amount150: number;
    hours200: number;
    amount200: number;
    total: number;
  };
  attendanceIncentive: number;
  commission: number;
  shiftAllowance: number;
  attendanceAllowance: number;
  otMeal: number;
  other: number;
  total: number;
};

export type HybridVariableDeductions = {
  unpaidLeave: number;
  unexcusedAbsence: number;
  latePenalty: number;
  advances: number;
  other: number;
  total: number;
};

export type PayrollLeaveBreakdownLine = {
  code: string | null;
  name: string;
  paid: boolean;
  category: 'payable' | 'deductible' | 'neutral';
  days: number;
};

/** Attendance- and leave-driven day classification exposed for audit. */
export type PayrollDayClassificationAudit = {
  employmentEligiblePeriod: { start: string; end: string } | null;
  totalScheduledWorkingDays: number;
  scheduledWorkingDays: number;
  payableDays: number;
  deductibleDays: number;
  neutralDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unexcusedAbsentDays: number;
  attendanceBreakdown: Record<string, number>;
  leaveBreakdown: PayrollLeaveBreakdownLine[];
  finalized: boolean;
};

export type PayrollCalculationAudit = {
  engineVersion: string;
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  totalCalendarDays: number;
  totalScheduledWorkingDays: number;
  eligibleWorkingDays: number;
  calculationMethod: string;
  dailyRateDivisor: number;
  dailyRateUsed?: number;
  payrollBasisDays?: number;
  payrollWorkDayMethod?: string;
  dailyRateSource?: 'employee_basis' | 'company_basis' | 'roster' | 'legacy';
  prorationFactor: number;
  payrollProcessingType: 'MONTHLY' | 'FINAL_SETTLEMENT';
  usedLegacyFallback?: boolean;
  rosterBased?: boolean;
  planningNonWorkingDaysInPeriod?: number;
  /** Eligible employment window (trimmed by join / last working date). */
  employmentEligiblePeriodStart?: string;
  employmentEligiblePeriodEnd?: string;
  payableDays?: number;
  deductibleDays?: number;
  neutralDays?: number;
};

export type HybridPayrollComponents = {
  model: 'hybrid_enterprise_v1';
  periodMonth: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  attendanceCutoffDate: string | null;
  attendancePeriodStatus: AttendancePeriodStatus | 'OPEN';
  fixed: HybridFixedComponents;
  variableAdditions: HybridVariableAdditions;
  variableDeductions: HybridVariableDeductions;
  /** fixed.total + variableAdditions.total */
  earningsBeforeStatutory: number;
  adjustmentTotal: number;
  notes: string[];
  /** Calendar-driven payroll audit (new runs only). */
  payrollAudit?: PayrollCalculationAudit;
  /** Attendance- and leave-driven day classification (payable / deductible / neutral). */
  dayClassification?: PayrollDayClassificationAudit;
  standardDays: number;
  eligibleDays: number;
  /** GDT tax dependents (spouse + children without paid work) used for salary tax. */
  taxDependents?: number;
  /** Monthly GDT dependent allowance in USD (150,000 KHR × count ÷ FX). */
  taxDependentReliefUsd?: number;
  /** Gross minus dependent relief — ToS taxable base. */
  taxableBaseUsd?: number;
};

import type { ResolvedPayrollCycle } from './payrollCalendarCycleTypes.js';

export type PayrollPeriodBounds = {
  month: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  attendanceCutoffDate: string | null;
  cycle?: ResolvedPayrollCycle;
};
