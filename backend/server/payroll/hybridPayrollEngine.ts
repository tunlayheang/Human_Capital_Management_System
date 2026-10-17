import type { PayrollBreakdown } from '../payrollCalculation.js';
import {
  calculatePayrollForPortalUser,
  reconcilePayrollBreakdown,
} from '../payrollCalculation.js';
import {
  computeNssfDual,
} from '../nssfAssumedWage.js';
import {
  computeSalaryTaxDual,
  dependentDeductionUsd,
  usdBracketsToKhr,
} from '../cambodiaSalaryTax.js';
import { usdToKhr } from '../usdToKhr.js';
import type {
  HybridPayrollComponents,
  PayrollPeriodBounds,
  AttendancePeriodStatus,
} from './hybridPayrollTypes.js';
import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';
import { resolveLastWorkingDate } from './employeePayrollEligibility.js';
import type { ProrationConfig } from './prorationConfigService.js';
import {
  computeAbsenceDeductionUsd,
  resolveAbsenceDeductionDayCounts,
} from './payrollAbsenceDeductions.js';
import { resolvePayrollContractRates } from './payrollContractRates.js';
import { buildPayrollAttendanceSnapshot } from './payrollAttendanceSnapshot.js';
import type { PayrollRunType } from './hybridPayrollTypes.js';
import type { PayrollCalculationAudit } from './hybridPayrollTypes.js';
import type { PayrollBasisAudit } from './payrollBasisAuditService.js';
import {
  buildPayrollBasisAuditExtras,
  resolveEmployeePayrollBasisDays,
  type PayrollWorkDayPolicy,
} from './payrollBasisDaysService.js';
import { computePayrollAttendanceMetrics } from './payrollAttendanceMetrics.js';
import { toDateKey } from './dateKey.js';
import {
  classifyPayrollDays,
  type PayrollDayClassification,
} from './payrollDayClassificationService.js';
import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import type { PayrollDayClassificationAudit } from './hybridPayrollTypes.js';

export type ProrationResult = {
  factor: number;
  eligibleDays: number;
  standardDays: number;
  reason: string | null;
};

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysInclusive(start: string, end: string): number {
  const a = parseYmd(start).getTime();
  const b = parseYmd(end).getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Roster employment window bounds (join/LWD) and legacy estimates.
 * When `calendarWorkingDays` is set, `factor` / `eligibleDays` are roster-eligibility only —
 * monthly pay uses paid-day proration (`computeMonthlyAttendancePresentDayProration`), not this factor.
 */
export function computeFixedSalaryProration(params: {
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  /** Last working date takes precedence over generic termination. */
  lastWorkingDate?: unknown;
  terminationDate?: unknown;
  workDaysPerMonth?: number;
  prorationMethod?: 'working_days' | 'calendar_days' | 'scheduled_shift_days';
  /** Calendar engine snapshot — when set, overrides proportional calendar estimate. */
  calendarWorkingDays?: Pick<
    PayrollWorkingDaysAudit,
    'totalScheduledWorkingDays' | 'eligibleWorkingDays' | 'prorationFactor' | 'prorationReason' | 'notEmployed'
  >;
}): ProrationResult {
  const legacyStandard = params.workDaysPerMonth ?? LEGACY_WORK_DAYS_PER_MONTH;

  if (params.calendarWorkingDays) {
    const cal = params.calendarWorkingDays;
    if (cal.notEmployed) {
      return {
        factor: 0,
        eligibleDays: 0,
        standardDays: cal.totalScheduledWorkingDays || legacyStandard,
        reason: cal.prorationReason ?? 'not_employed',
      };
    }
    return {
      factor: cal.prorationFactor,
      eligibleDays: cal.eligibleWorkingDays,
      standardDays: cal.totalScheduledWorkingDays || legacyStandard,
      reason: cal.prorationReason,
    };
  }

  const standardDays = legacyStandard;
  const periodStart = toDateKey(params.periodStart) ?? params.periodStart.slice(0, 10);
  const periodEnd = toDateKey(params.periodEnd) ?? params.periodEnd.slice(0, 10);
  let effectiveStart = periodStart;
  let effectiveEnd = periodEnd;
  const reasons: string[] = [];

  const join = toDateKey(params.joinDate);
  if (join) {
    if (join > effectiveStart && join <= effectiveEnd) {
      effectiveStart = join;
      reasons.push('mid_month_join');
    } else if (join > effectiveEnd) {
      return { factor: 0, eligibleDays: 0, standardDays, reason: 'not_yet_joined' };
    }
  }

  const boundary = toDateKey(params.lastWorkingDate) ?? toDateKey(params.terminationDate);
  if (boundary) {
    const term = boundary;
    if (term < effectiveEnd && term >= effectiveStart) {
      effectiveEnd = term;
      reasons.push(params.lastWorkingDate ? 'last_working_date' : 'mid_month_resign');
    } else if (term < effectiveStart) {
      return { factor: 0, eligibleDays: 0, standardDays, reason: 'terminated_before_period' };
    }
  }

  const calendarDays = daysInclusive(effectiveStart, effectiveEnd);
  const periodCalendarDays = daysInclusive(periodStart, periodEnd);

  let eligibleDays: number;
  if (params.prorationMethod === 'calendar_days') {
    eligibleDays = calendarDays;
  } else {
    eligibleDays = Math.min(
      standardDays,
      Math.max(
        0,
        Math.round((calendarDays / Math.max(periodCalendarDays, 1)) * standardDays)
      )
    );
  }
  const factor =
    eligibleDays >= standardDays ? 1 : Math.round((eligibleDays / standardDays) * 10000) / 10000;

  return {
    factor,
    eligibleDays,
    standardDays,
    reason: reasons.length ? reasons.join(',') : null,
  };
}

export function buildHybridComponentsFromBreakdown(
  breakdown: PayrollBreakdown,
  opts: {
    period: PayrollPeriodBounds;
    contractBaseSalary: number;
    proration: ProrationResult;
    attendancePeriodStatus: AttendancePeriodStatus | 'OPEN';
    unpaidLeaveDays?: number;
    unexcusedAbsentDays?: number;
    lateOccurrences?: number;
    adjustmentTotal?: number;
    payrollAudit?: PayrollBasisAudit;
    dailyRateUsed?: number;
  }
): HybridPayrollComponents {
  const a = breakdown.allowances;
  const seniorityPay = num(breakdown.seniorityEntitlement);
  const fixedOther = num(a.transport) + num(a.meal) + num(a.position);
  const fixed: HybridPayrollComponents['fixed'] = {
    contractBaseSalary: opts.contractBaseSalary,
    fixedBaseSalary: breakdown.baseSalary,
    prorationFactor: opts.proration.factor,
    prorationReason: opts.proration.reason,
    positionAllowance: num(a.position),
    seniorityAllowance: seniorityPay,
    seniorityIndemnity: num(breakdown.seniorityIndemnity),
    transportAllowance: num(a.transport),
    mealAllowance: num(a.meal),
    otherFixedAllowances: 0,
    total:
      breakdown.baseSalary +
      num(breakdown.seniorityIndemnity) +
      seniorityPay +
      fixedOther,
  };

  const unpaidLeave =
    opts.unpaidLeaveDays && breakdown.deductions.absences
      ? breakdown.deductions.absences
      : 0;
  const totalAbsenceDed = breakdown.deductions.absences;
  const unexcusedAbsence = Math.max(0, totalAbsenceDed - unpaidLeave);

  const variableAdditions: HybridPayrollComponents['variableAdditions'] = {
    overtime: { ...breakdown.overtime },
    attendanceIncentive: num(a.attendance),
    commission: num(a.commission),
    shiftAllowance: 0,
    attendanceAllowance: num(a.attendance),
    otMeal: num(a.otMeal),
    other: 0,
    total:
      breakdown.overtime.total +
      num(a.attendance) +
      num(a.commission) +
      num(a.otMeal),
  };

  const variableDeductions: HybridPayrollComponents['variableDeductions'] = {
    unpaidLeave,
    unexcusedAbsence,
    latePenalty: Math.max(0, (opts.lateOccurrences ?? 0) > 0 ? 0 : 0),
    advances: breakdown.deductions.advances,
    other: 0,
    total: totalAbsenceDed + breakdown.deductions.advances,
  };

  const notes: string[] = [];
  notes.push(
    `Daily rate = contract base ÷ ${opts.payrollAudit?.payrollBasisDays ?? opts.proration.standardDays} payroll basis days.`
  );
  notes.push(
    'Attendance metrics (present, absent, late, overtime) come from attendance records only — not roster planning.'
  );
  notes.push(
    'Absent days reduce pay via daily rate × absent count when attendance is finalized.'
  );
  if (opts.period.attendanceCutoffDate) {
    notes.push(`Attendance included through ${opts.period.attendanceCutoffDate}.`);
  }
  if (opts.proration.reason) {
    notes.push(`Employment proration: ${opts.proration.reason}.`);
  }

  const payrollAudit: PayrollCalculationAudit | undefined = opts.payrollAudit
    ? {
        engineVersion: opts.payrollAudit.engineVersion,
        payrollPeriodStart: opts.payrollAudit.payrollPeriodStart,
        payrollPeriodEnd: opts.payrollAudit.payrollPeriodEnd,
        totalCalendarDays: opts.payrollAudit.totalCalendarDays,
        totalScheduledWorkingDays: opts.payrollAudit.totalScheduledWorkingDays,
        eligibleWorkingDays: opts.payrollAudit.eligibleWorkingDays,
        calculationMethod: opts.payrollAudit.calculationMethod,
        dailyRateDivisor: opts.payrollAudit.dailyRateDivisor,
        payrollBasisDays: opts.payrollAudit.payrollBasisDays,
        payrollWorkDayMethod: opts.payrollAudit.payrollWorkDayMethod,
        dailyRateSource: opts.payrollAudit.dailyRateSource,
        prorationFactor: opts.payrollAudit.prorationFactor,
        payrollProcessingType: opts.payrollAudit.payrollProcessingType,
        dailyRateUsed: opts.dailyRateUsed,
      }
    : undefined;

  const taxDependents = num(breakdown.attendanceSummary?.dependents);

  return {
    model: 'hybrid_enterprise_v1',
    periodMonth: opts.period.month,
    payPeriodStart: opts.period.payPeriodStart,
    payPeriodEnd: opts.period.payPeriodEnd,
    attendanceCutoffDate: opts.period.attendanceCutoffDate,
    attendancePeriodStatus: opts.attendancePeriodStatus,
    fixed,
    variableAdditions,
    variableDeductions,
    earningsBeforeStatutory: fixed.total + variableAdditions.total,
    adjustmentTotal: opts.adjustmentTotal ?? 0,
    notes,
    payrollAudit,
    standardDays: opts.proration.standardDays,
    eligibleDays: opts.proration.eligibleDays,
    taxDependents,
  };
}

/** Apply hybrid fixed salary + variable attendance deductions on top of portal user calc. */
export function calculateHybridPayrollForPortalUser(params: {
  user: any;
  employee: any | null;
  attendance: any[];
  month: string;
  period: PayrollPeriodBounds;
  attendancePeriodStatus?: AttendancePeriodStatus | 'OPEN';
  compliance?: import('../payrollComplianceRuleService.js').PayrollComplianceEngineConfig;
  nssfBrackets?: import('../nssfAssumedWage.js').NssfWageBracket[];
  approvedOvertime?: { hours150: number; hours200: number };
  taxBrackets?: import('../cambodiaSalaryTax.js').SalaryTaxBracketUsd[];
  unpaidLeaveDays?: number;
  allowanceEngine?: import('../allowanceRuleEngine.js').AllowanceEngineResult;
  latePenaltyPerOccurrenceUsd?: number;
  lastWorkingDateOverride?: string | null;
  prorationConfig?: ProrationConfig;
  /** Versioned work-day policy (preferred over prorationConfig for basis days). */
  workDayPolicy?: PayrollWorkDayPolicy;
  payrollRunType?: PayrollRunType;
  payrollBasisAudit?: PayrollBasisAudit | null;
  paidLeaveDates?: Iterable<string>;
  approvedLeaveByDate?: Map<string, LeaveDayInfo>;
  unpaidLeaveDates?: Iterable<string>;
  seniorityEntitlement?: import('./seniority/seniorityEngineService.js').SeniorityPayrollResult;
  seniorityIndemnityResult?: import('./seniorityIndemnity/seniorityIndemnityTypes.js').SeniorityIndemnityCalculationResult;
  /** @deprecated Use seniorityIndemnityResult */
  applySeniorityIndemnity?: boolean;
}): PayrollBreakdown & { hybrid: HybridPayrollComponents; contractBaseSalary: number } {
  const {
    user,
    employee,
    attendance,
    month,
    period,
    attendancePeriodStatus = 'OPEN',
    unpaidLeaveDays = 0,
    latePenaltyPerOccurrenceUsd = 0,
    lastWorkingDateOverride,
    prorationConfig: prorationConfigIn,
    payrollRunType,
    payrollBasisAudit: payrollBasisAuditIn,
    paidLeaveDates,
    approvedLeaveByDate,
    unpaidLeaveDates,
    compliance,
    ...rest
  } = params;

  let contractBase = num(
    employee?.base_salary ??
      employee?.salary_structure?.base_salary ??
      user?.salary
  );
  const minimumWage = num(compliance?.minimumWageUsd);
  if (contractBase > 0 && minimumWage > 0 && contractBase < minimumWage) {
    contractBase = minimumWage;
  }

  const prorationConfig = {
    method: 'scheduled_shift_days' as const,
    workDaysPerMonth: LEGACY_WORK_DAYS_PER_MONTH,
    ...prorationConfigIn,
    useCalendarEngine: true as const,
  };
  // Prefer explicit versioned work-day policy; proration JSON can lag behind UI saves.
  const workDayPolicy = params.workDayPolicy ?? {
    method: prorationConfig.workDayMethod ?? 'fixed_employee_basis',
    companyBasisDays: prorationConfig.companyBasisDays ?? 26,
  };
  const lwd =
    toDateKey(lastWorkingDateOverride) ?? resolveLastWorkingDate(employee ?? {});

  const monthPrefix = month.slice(0, 7);
  const periodStart = toDateKey(period.payPeriodStart) ?? period.payPeriodStart.slice(0, 10);
  const periodEnd = toDateKey(period.payPeriodEnd) ?? period.payPeriodEnd.slice(0, 10);
  const periodRecords = attendance.filter((r) => {
    const d = toDateKey(r.date);
    return d && d >= periodStart && d <= periodEnd;
  });

  const payrollBasisDays = resolveEmployeePayrollBasisDays({
    policy: workDayPolicy,
    employeeBasisDays: employee?.payroll_basis_days,
  });
  const basisAudit = buildPayrollBasisAuditExtras({
    policy: workDayPolicy,
    payrollBasisDays,
  });

  let payrollBasisAudit: PayrollBasisAudit | null = payrollBasisAuditIn ?? null;
  if (!payrollBasisAudit) {
    payrollBasisAudit = {
      engineVersion: 'basis_days_v1',
      payrollPeriodStart: period.payPeriodStart.slice(0, 10),
      payrollPeriodEnd: period.payPeriodEnd.slice(0, 10),
      totalCalendarDays: daysInclusive(period.payPeriodStart, period.payPeriodEnd),
      totalScheduledWorkingDays: basisAudit.payrollBasisDays,
      eligibleWorkingDays: basisAudit.payrollBasisDays,
      calculationMethod: prorationConfig.method,
      dailyRateDivisor: basisAudit.dailyRateDivisor,
      payrollBasisDays: basisAudit.payrollBasisDays,
      payrollWorkDayMethod: basisAudit.payrollWorkDayMethod,
      dailyRateSource: basisAudit.dailyRateSource,
      prorationFactor: 1,
      prorationReason: null,
      notEmployed: false,
      payrollProcessingType:
        payrollRunType === 'FINAL_SETTLEMENT' ? 'FINAL_SETTLEMENT' : 'MONTHLY',
    };
  } else {
    payrollBasisAudit = {
      ...payrollBasisAudit,
      payrollBasisDays: basisAudit.payrollBasisDays,
      payrollWorkDayMethod: basisAudit.payrollWorkDayMethod,
      dailyRateDivisor: basisAudit.dailyRateDivisor,
      dailyRateSource: basisAudit.dailyRateSource,
    };
  }

  const employmentProration = computeFixedSalaryProration({
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    joinDate: employee?.join_date ?? user?.joinDate,
    lastWorkingDate: lwd,
    terminationDate: employee?.termination_date ?? employee?.resign_date ?? null,
    workDaysPerMonth: basisAudit.payrollBasisDays,
    prorationMethod: prorationConfig.method,
  });

  const attendanceMetrics = computePayrollAttendanceMetrics({
    attendance: periodRecords,
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    joinDate: employee?.join_date ?? user?.joinDate,
    lastWorkingDate: lwd,
    workDaysCap: payrollBasisAudit.eligibleWorkingDays || employmentProration.eligibleDays,
    paidLeaveDates,
    unpaidLeaveDates,
    leaveByDate: approvedLeaveByDate,
  });

  let proration: ProrationResult;
  const attendanceFinalized =
    attendancePeriodStatus === 'FINALIZED' || attendancePeriodStatus === 'LOCKED';
  const deductionsActive = payrollRunType === 'FINAL_SETTLEMENT' || attendanceFinalized;

  if (employmentProration.factor <= 0) {
    proration = {
      factor: 0,
      eligibleDays: 0,
      standardDays: basisAudit.payrollBasisDays,
      reason: employmentProration.reason ?? 'not_employed',
    };
  } else {
    proration = {
      factor: employmentProration.factor,
      eligibleDays: employmentProration.eligibleDays,
      standardDays: basisAudit.payrollBasisDays,
      reason: employmentProration.reason,
    };
  }

  const rawAbsentRecordCount = attendanceMetrics.absentDays;
  const lateOccurrences = attendanceMetrics.lateCount;

  const dailyRateDivisor = basisAudit.dailyRateDivisor;

  const baseBreakdown = calculatePayrollForPortalUser({
    user,
    employee,
    attendance,
    month,
    unpaidLeaveDays: 0,
    scheduledWorkingDaysPerMonth: dailyRateDivisor,
    seniorityEntitlement: params.seniorityEntitlement,
    seniorityIndemnityResult: params.seniorityIndemnityResult,
    applySeniorityIndemnity: params.applySeniorityIndemnity,
    ...rest,
  });

  const proratedBase =
    proration.factor <= 0
      ? 0
      : proration.factor < 1
        ? Math.round(contractBase * proration.factor * 100) / 100
        : contractBase;

  const standardHoursPerDay = num(employee?.work_hours ?? user?.workHours, 8);
  const contractRates = resolvePayrollContractRates({
    contractBaseSalary: contractBase,
    scheduledWorkingDays: dailyRateDivisor,
    standardHoursPerDay,
  });
  const dailyRateForDeductions = contractRates.dailyRateExact;

  const absenceDayCounts = resolveAbsenceDeductionDayCounts({
    unpaidLeaveDaysParam: unpaidLeaveDays,
    paidDaysDetail: {
      unpaidLeaveDays: attendanceMetrics.unpaidLeaveDays,
      absentDays: attendanceMetrics.absentDays,
    },
    lateOccurrences,
    rawAbsentRecordCount,
  });
  const unexcusedAbsentDays = absenceDayCounts.unexcusedAbsentDays;
  const resolvedUnpaidLeaveDays = absenceDayCounts.unpaidLeaveDays;

  const absenceDeductionParts = computeAbsenceDeductionUsd({
    dailyRate: dailyRateForDeductions,
    counts: absenceDayCounts,
    latePenaltyPerOccurrenceUsd,
    active: deductionsActive,
  });
  const unpaidLeaveDeduction = absenceDeductionParts.unpaidLeave;
  const unexcusedDeduction = absenceDeductionParts.unexcusedAbsence;
  const latePenalty = absenceDeductionParts.latePenalty;
  const attendanceDeductions = absenceDeductionParts.total;

  const payFactor = proration.factor;
  const scaleFixedUsd = (n: number) =>
    payFactor <= 0 ? 0 : payFactor < 1 ? Math.round(n * payFactor * 100) / 100 : n;

  const a = baseBreakdown.allowances;
  const scaleAllowancesForPayFactor =
    payFactor <= 0
      ? true
      : payFactor < 1 && payrollRunType !== 'FINAL_SETTLEMENT'
        ? true
        : payrollRunType === 'FINAL_SETTLEMENT' && payFactor < 1;
  const scaledAllowances = scaleAllowancesForPayFactor
    ? {
        transport: scaleFixedUsd(num(a.transport)),
        attendance: scaleFixedUsd(num(a.attendance)),
        meal: scaleFixedUsd(num(a.meal)),
        seniority: 0,
        position: scaleFixedUsd(num(a.position)),
        commission: num(a.commission),
        otMeal: num(a.otMeal),
      }
    : payFactor <= 0
      ? {
          transport: 0,
          attendance: 0,
          meal: 0,
          seniority: 0,
          position: 0,
          commission: num(a.commission),
          otMeal: num(a.otMeal),
        }
      : a;

  const allowanceDelta =
    scaleAllowancesForPayFactor
      ? num(scaledAllowances.transport) +
        num(scaledAllowances.attendance) +
        num(scaledAllowances.meal) +
        num(scaledAllowances.seniority) +
        num(scaledAllowances.position) +
        num(scaledAllowances.commission) +
        num(scaledAllowances.otMeal) -
        (num(a.transport) +
          num(a.attendance) +
          num(a.meal) +
          num(a.seniority) +
          num(a.position) +
          num(a.commission) +
          num(a.otMeal))
      : 0;

  const scaledIndemnity =
    payFactor < 1
      ? scaleFixedUsd(num(baseBreakdown.seniorityIndemnity))
      : num(baseBreakdown.seniorityIndemnity);
  const indemnityDelta = scaledIndemnity - num(baseBreakdown.seniorityIndemnity);

  const baseDelta = proratedBase - baseBreakdown.baseSalary;
  // Absence dollars belong in deductions only — do not add them to gross (NSSF/tax base).
  const grossSalary = Math.round(
    (baseBreakdown.grossSalary +
      baseDelta +
      allowanceDelta +
      indemnityDelta -
      baseBreakdown.deductions.absences) *
      100
  ) / 100;

  const exchangeRate = compliance?.exchangeRate ?? baseBreakdown.exchangeRate;
  const nssfEnrolled = employee?.nssf_enrolled !== false;
  const resolvedDependents = Math.max(
    0,
    Math.floor(num(employee?.tax_dependents ?? user?.dependents))
  );
  const dependents = resolvedDependents;
  const taxDependentReliefUsd = dependentDeductionUsd(dependents, exchangeRate);
  const nssfDual = computeNssfDual({
    monthlyGrossUsd: grossSalary,
    exchangeRateKhrPerUsd: exchangeRate,
    nssfEnrolled,
    occupationalEmployeePct: compliance?.nssfOccupationalRiskEmployeePct ?? 0,
    healthcareEmployeePct: compliance?.nssfHealthcareEmployeePct ?? 0,
    pensionEmployeePct: compliance?.nssfPensionEmployeePct ?? 2,
    pensionEmployeeCapKhr: compliance?.nssfPensionEmployeeCapKhr ?? 24_000,
    occupationalEmployerPct: compliance?.nssfOccupationalRiskEmployerPct ?? 0.8,
    healthcareEmployerPct: compliance?.nssfHealthcareEmployerPct ?? 2.6,
    pensionEmployerPct: compliance?.nssfPensionEmployerPct ?? 2,
    brackets: rest.nssfBrackets,
  });
  const nssf = nssfDual.employeeContributionUsd;

  const taxDual = computeSalaryTaxDual({
    monthlyGrossUsd: grossSalary,
    taxDependents: dependents,
    exchangeRateKhrPerUsd: exchangeRate,
    bracketsKhr: rest.taxBrackets?.length
      ? usdBracketsToKhr(rest.taxBrackets, exchangeRate)
      : undefined,
  });
  const taxableBaseUsd = taxDual.taxableIncomeUsd;

  const deductions = {
    nssf,
    taxOnSalary: taxDual.taxOnSalaryUsd,
    absences: attendanceDeductions,
    advances: baseBreakdown.deductions.advances,
    total: 0,
  };
  deductions.total =
    deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;

  const netSalary = Math.max(
    0,
    Math.round((grossSalary - deductions.total) * 100) / 100
  );
  const netSalaryKHR = usdToKhr(netSalary, exchangeRate);

  const breakdown = reconcilePayrollBreakdown({
    ...baseBreakdown,
    contractBaseSalary: contractBase,
    baseSalary: proratedBase,
    seniorityIndemnity: scaledIndemnity > 0 ? scaledIndemnity : baseBreakdown.seniorityIndemnity,
    allowances: scaledAllowances,
    proratedDays: proration.eligibleDays,
    grossSalary,
    taxDependentReliefUsd,
    taxableBaseUsd,
    taxableIncomeKhr: taxDual.taxableIncomeKhr,
    taxableIncomeUsd: taxDual.taxableIncomeUsd,
    taxAmountKhr: taxDual.taxAmountKhr,
    taxAmountUsd: taxDual.taxAmountUsd,
    exchangeRateUsed: taxDual.exchangeRateUsed,
    nssfSalaryKhr: nssfDual.nssfSalaryKhr,
    nssfSalaryUsd: nssfDual.nssfSalaryUsd,
    employeeContributionKhr: nssfDual.employeeContributionKhr,
    employeeContributionUsd: nssfDual.employeeContributionUsd,
    employerContributionKhr: nssfDual.employerContributionKhr,
    employerContributionUsd: nssfDual.employerContributionUsd,
    deductions,
    nssfDetail: nssfDual.nssfDetail ?? baseBreakdown.nssfDetail,
    netSalary,
    exchangeRate,
    netSalaryKHR,
  });

  const hybrid = buildHybridComponentsFromBreakdown(breakdown, {
    period,
    contractBaseSalary: contractBase,
    proration,
    attendancePeriodStatus,
    unpaidLeaveDays: resolvedUnpaidLeaveDays,
    unexcusedAbsentDays,
    lateOccurrences,
    payrollAudit: payrollBasisAudit ?? undefined,
    dailyRateUsed: contractRates.dailyRateExact,
  });
  hybrid.variableDeductions.unpaidLeave = unpaidLeaveDeduction;
  hybrid.variableDeductions.unexcusedAbsence = unexcusedDeduction;
  hybrid.variableDeductions.latePenalty = latePenalty;
  hybrid.variableDeductions.total =
    unpaidLeaveDeduction + unexcusedDeduction + latePenalty + breakdown.deductions.advances;

  const approvedOtHours =
    num(rest.approvedOvertime?.hours150) + num(rest.approvedOvertime?.hours200);

  let attendanceSummary = buildPayrollAttendanceSnapshot({
    attendance: periodRecords,
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    joinDate: employee?.join_date ?? user?.joinDate,
    lastWorkingDate: lwd,
    payrollBasisDays: basisAudit.payrollBasisDays,
    eligibleBasisDays: payrollBasisAudit.eligibleWorkingDays || employmentProration.eligibleDays,
    paidLeaveDates,
    unpaidLeaveDates,
    leaveByDate: approvedLeaveByDate,
    standardHoursPerDay,
    hourlyRate: contractRates.hourlyRate,
    dailyRate: contractRates.dailyRate > 0 ? contractRates.dailyRate : undefined,
    dependents: resolvedDependents || baseBreakdown.attendanceSummary?.dependents || 0,
    overtimeHours: approvedOtHours,
  });
  attendanceSummary.dependents = resolvedDependents || attendanceSummary.dependents || 0;

  const classification: PayrollDayClassification = classifyPayrollDays({
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    joinDate: employee?.join_date ?? user?.joinDate,
    lastWorkingDate: lwd,
    windowStart: attendanceMetrics.windowStart,
    windowEnd: attendanceMetrics.windowEnd,
    payrollBasisDays: basisAudit.payrollBasisDays,
    eligibleBasisDays: payrollBasisAudit.eligibleWorkingDays || employmentProration.eligibleDays,
    attendance: periodRecords,
    paidLeaveDates,
    unpaidLeaveDates,
    leaveByDate: approvedLeaveByDate,
    unpaidLeaveDays: resolvedUnpaidLeaveDays,
    attendanceFinalized: deductionsActive,
  });
  const dayClassification: PayrollDayClassificationAudit = {
    employmentEligiblePeriod: classification.eligiblePeriod,
    totalScheduledWorkingDays: classification.totalScheduledWorkingDays,
    scheduledWorkingDays: basisAudit.payrollBasisDays,
    payableDays: classification.payableDays,
    deductibleDays: classification.deductibleDays,
    neutralDays: classification.neutralDays,
    presentDays: attendanceSummary.presentDays,
    paidLeaveDays: attendanceSummary.paidLeaveDays ?? classification.paidLeaveDays,
    unpaidLeaveDays: classification.unpaidLeaveDays,
    unexcusedAbsentDays: attendanceSummary.absentDays ?? classification.unexcusedAbsentDays,
    attendanceBreakdown: classification.attendanceBreakdown,
    leaveBreakdown: classification.leaveBreakdown,
    finalized: classification.finalized,
  };
  hybrid.dayClassification = dayClassification;
  if (hybrid.payrollAudit) {
    hybrid.payrollAudit.payableDays = dayClassification.payableDays;
    hybrid.payrollAudit.deductibleDays = dayClassification.deductibleDays;
    hybrid.payrollAudit.neutralDays = dayClassification.neutralDays;
    hybrid.payrollAudit.employmentEligiblePeriodStart =
      dayClassification.employmentEligiblePeriod?.start;
    hybrid.payrollAudit.employmentEligiblePeriodEnd =
      dayClassification.employmentEligiblePeriod?.end;
  }

  if (hybrid) {
    hybrid.taxDependents = attendanceSummary.dependents ?? resolvedDependents;
    hybrid.taxDependentReliefUsd = taxDependentReliefUsd;
    hybrid.taxableBaseUsd = taxableBaseUsd;
    hybrid.variableAdditions.overtime = {
      hours150: breakdown.overtime.hours150,
      amount150: breakdown.overtime.amount150,
      hours200: breakdown.overtime.hours200,
      amount200: breakdown.overtime.amount200,
      total: breakdown.overtime.total,
    };
  }

  return {
    ...breakdown,
    attendanceSummary,
    overtime: { ...breakdown.overtime },
    hybrid,
    contractBaseSalary: contractBase,
    proratedDays: proration.eligibleDays,
    payrollAudit: hybrid.payrollAudit,
  };
}
