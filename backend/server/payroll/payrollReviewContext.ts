/** Payroll register / review metadata snapshotted on each payslip calculation. */

export type EmploymentReviewFlag =
  | 'new_hire'
  | 'mid_month_join'
  | 'resigning'
  | 'final_settlement_overlap';

export type PayrollReviewSnapshot = {
  positionTitle: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  paymentMethod: string;
};

export type PayrollReviewContext = PayrollReviewSnapshot & {
  departmentId: string | null;
  departmentName: string;
  contractBaseUsd: number;
  proratedPayUsd: number;
  payableDays: number;
  scheduledWorkingDays: number;
  prorationPct: number;
  prorationLabel: string;
  exchangeRate: number;
  employmentFlags: EmploymentReviewFlag[];
  priorMonthNetUsd: number | null;
  priorMonth: string | null;
  netChangeVsPriorMonthUsd: number | null;
  netChangeVsPriorMonthPct: number | null;
  previousRunNetUsd: number | null;
  netChangeVsPreviousRunUsd: number | null;
  netChangedSincePreviousRun: boolean;
  attendancePeriodStatus: string | null;
  attendanceFinalized: boolean;
  /** Employee NSSF registration number (compliance register). */
  nssfId: string | null;
  /** GDT tax identification number. */
  taxId: string | null;
  /** NSSF contributory assumed wage in KHR (may differ from gross). */
  nssfAssumedWageKhr: number | null;
  /** Gross + employer NSSF — total payroll cost for finance. */
  totalEmployerCostUsd: number;
  /** Marginal GDT bracket (%) for taxable base — survives payslip persistence. */
  taxMarginalRatePct?: number;
};
