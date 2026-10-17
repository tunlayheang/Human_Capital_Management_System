/** Payroll calendar cycle — source of truth for payroll timing per group. */

export type PayrollPeriodType = 'monthly' | 'biweekly' | 'weekly';

export type PayrollGroupConfig = {
  id: string;
  name: string;
  companyId?: string | null;
  branchId?: string | null;
  departmentIds?: string[];
  periodType: PayrollPeriodType;
  defaultAttendanceCutoffDay: number;
  defaultPayrollCalculationDay: number;
  defaultPayrollApprovalDay: number;
  defaultPaymentDay?: number;
  active?: boolean;
};

export type PayrollCycleDefinition = {
  /** YYYY-MM */
  month: string;
  periodStart: string;
  periodEnd: string;
  attendanceCutoffDate: string;
  payrollCalculationDate: string;
  payrollApprovalDate: string;
  paymentDate?: string;
};

export type ResolvedPayrollCycle = PayrollCycleDefinition & {
  cycleId: string;
  calendarId: string;
  year: number;
  payrollGroupId: string;
  payrollGroupName: string;
};

export type PayrollCalendarCycleConfig = {
  groups: PayrollGroupConfig[];
  /** groupId → month (YYYY-MM) → cycle override */
  cyclesByGroup: Record<string, Record<string, PayrollCycleDefinition>>;
};

export type PayrollCycleFreezeStatus = 'OPEN' | 'FINALIZED' | 'LOCKED';

export type PayrollCalendarStatusSnapshot = {
  businessDate: string;
  calendarId: string;
  year: number;
  groups: Array<{
    groupId: string;
    groupName: string;
    activeCycle: ResolvedPayrollCycle | null;
    nextCycle: ResolvedPayrollCycle | null;
    attendanceStatus: PayrollCycleFreezeStatus;
    attendanceFrozenAt: string | null;
    freezeTrigger: string | null;
    daysUntilCutoff: number | null;
    daysUntilCalculation: number | null;
    isCutoffReached: boolean;
    isAttendanceLocked: boolean;
  }>;
};

/** Months with an approved/locked payroll run — calendar milestones must not change. */
export type PayrollCalendarMonthLock = {
  month: string;
  status: string;
};

/** groupId → locked months for that payroll group. */
export type PayrollCalendarMonthLocks = Record<string, PayrollCalendarMonthLock[]>;
