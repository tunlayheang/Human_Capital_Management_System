import { calculatePayrollForUser } from '../../services/cambodiaTax';
import type { AttendanceRecord, PayrollTaxBracket, SalaryBreakdown, User } from '../../types';
import { dependentDeductionUsd } from '../../utils/cambodiaSalaryTax';
import { resolvePayrollContractRates } from '../../utils/payrollContractRates';
import type { PayrollEngineConfig } from '../../utils/payrollEngineConfig';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';

/** Legacy fixed divisor when stored audit is unavailable (historical payslips). */
export const LEGACY_WORK_DAYS_PER_MONTH = 26;

/** Match backend reconcileUnexcusedAbsentDays — Review list / exports. */
export function reconcileUnexcusedAbsentDays(params: {
  absentDays: number;
  scheduledWorkingDays: number;
  paidDays: number;
  unpaidLeaveDays: number;
}): number {
  const { absentDays, scheduledWorkingDays, paidDays, unpaidLeaveDays } = params;
  if (scheduledWorkingDays <= 0) return Math.max(0, absentDays);
  const implicitAbsent = Math.max(
    0,
    scheduledWorkingDays - paidDays - unpaidLeaveDays
  );
  let result = Math.max(0, absentDays);
  if (implicitAbsent > result) result = implicitAbsent;
  if (unpaidLeaveDays > 0 && result === implicitAbsent + unpaidLeaveDays) {
    result = implicitAbsent;
  }
  return result;
}
export const DEFAULT_STANDARD_HOURS_PER_DAY = 8;

/** Payroll basis days (salary divisor) from stored breakdown. */
export function payrollBasisDaysFromBreakdown(breakdown: SalaryBreakdown): number {
  const summary = breakdown.attendanceSummary;
  if (
    typeof summary?.payrollBasisDays === 'number' &&
    Number.isFinite(summary.payrollBasisDays) &&
    summary.payrollBasisDays > 0
  ) {
    return summary.payrollBasisDays;
  }
  if (
    typeof summary?.scheduledWorkDays === 'number' &&
    Number.isFinite(summary.scheduledWorkDays) &&
    summary.scheduledWorkDays > 0
  ) {
    return summary.scheduledWorkDays;
  }

  const audit = breakdown.payrollAudit ?? breakdown.hybrid?.payrollAudit;
  if (typeof audit?.payrollBasisDays === 'number' && audit.payrollBasisDays > 0) {
    return audit.payrollBasisDays;
  }
  if (typeof audit?.dailyRateDivisor === 'number' && audit.dailyRateDivisor > 0) {
    return audit.dailyRateDivisor;
  }
  if (
    typeof audit?.totalScheduledWorkingDays === 'number' &&
    audit.totalScheduledWorkingDays > 0
  ) {
    return audit.totalScheduledWorkingDays;
  }
  return LEGACY_WORK_DAYS_PER_MONTH;
}

/** @deprecated Use payrollBasisDaysFromBreakdown — kept for historical payslip rows. */
export function scheduledWorkingDaysFromBreakdown(breakdown: SalaryBreakdown): number {
  return payrollBasisDaysFromBreakdown(breakdown);
}

export type ResolvedOvertimeFromBreakdown = {
  hours100: number;
  hours150: number;
  hours200: number;
  amount100: number;
  amount150: number;
  amount200: number;
  total: number;
};

/** Approved OT request hours + pay — never attendance-inferred OT. */
export function resolveOvertimeFromBreakdown(breakdown: SalaryBreakdown): ResolvedOvertimeFromBreakdown {
  const hybridOt = breakdown.hybrid?.variableAdditions?.overtime;
  const ot = breakdown.overtime;
  const hours100 = Math.max(0, Number(ot?.hours100 ?? hybridOt?.hours100 ?? 0));
  const hours150 = Math.max(0, Number(ot?.hours150 ?? hybridOt?.hours150 ?? 0));
  const hours200 = Math.max(0, Number(ot?.hours200 ?? hybridOt?.hours200 ?? 0));
  let amount100 = Math.max(0, Number(ot?.amount100 ?? hybridOt?.amount100 ?? 0));
  let amount150 = Math.max(0, Number(ot?.amount150 ?? hybridOt?.amount150 ?? 0));
  let amount200 = Math.max(0, Number(ot?.amount200 ?? hybridOt?.amount200 ?? 0));

  const hourlyRate =
    breakdown.attendanceSummary?.hourlyRate && breakdown.attendanceSummary.hourlyRate > 0
      ? breakdown.attendanceSummary.hourlyRate
      : computeHourlyRate(
          breakdown.baseSalary ?? breakdown.contractBaseSalary ?? 0,
          breakdown.attendanceSummary?.standardHoursPerDay ?? DEFAULT_STANDARD_HOURS_PER_DAY,
          scheduledWorkingDaysFromBreakdown(breakdown)
        );

  if (hours100 > 0 && amount100 <= 0 && hourlyRate > 0) {
    amount100 = Math.round(hours100 * hourlyRate * 1 * 100) / 100;
  }
  if (hours150 > 0 && amount150 <= 0 && hourlyRate > 0) {
    amount150 = Math.round(hours150 * hourlyRate * 1.5 * 100) / 100;
  }
  if (hours200 > 0 && amount200 <= 0 && hourlyRate > 0) {
    amount200 = Math.round(hours200 * hourlyRate * 2 * 100) / 100;
  }

  const total =
    Math.round(
      (Number(ot?.total ?? hybridOt?.total ?? 0) > 0
        ? Number(ot?.total ?? hybridOt?.total)
        : amount100 + amount150 + amount200) * 100
    ) / 100;

  return { hours100, hours150, hours200, amount100, amount150, amount200, total };
}

/** GDT tax dependents for Review list / tax (from snapshot, hybrid, or DB column). */
export function resolveDependentsFromBreakdown(breakdown: SalaryBreakdown): number {
  const summary = breakdown.attendanceSummary;
  const hybrid = breakdown.hybrid as { taxDependents?: number } | undefined;
  const fromSummary = summary?.dependents;
  if (typeof fromSummary === 'number' && Number.isFinite(fromSummary) && fromSummary >= 0) {
    return fromSummary;
  }
  if (typeof hybrid?.taxDependents === 'number' && Number.isFinite(hybrid.taxDependents)) {
    return Math.max(0, hybrid.taxDependents);
  }
  const flat = (breakdown as { attendanceDependents?: number }).attendanceDependents;
  if (typeof flat === 'number' && Number.isFinite(flat)) return Math.max(0, flat);
  return 0;
}

/** GDT dependent relief (USD) — same formula as Employee Pay / Salary step. */
export function resolveDependentReliefFromBreakdown(breakdown: SalaryBreakdown): {
  dependents: number;
  reliefUsd: number;
  taxableBaseUsd: number;
  perDependentUsd: number;
} {
  const dependents = resolveDependentsFromBreakdown(breakdown);
  const exchangeRate = resolveExchangeRateKhrPerUsd(breakdown.exchangeRate, 'active');
  const hybrid = breakdown.hybrid as
    | { taxDependentReliefUsd?: number; taxableBaseUsd?: number }
    | undefined;
  const storedRelief = Number(breakdown.taxDependentReliefUsd ?? hybrid?.taxDependentReliefUsd ?? 0);
  const reliefUsd =
    storedRelief > 0 ? storedRelief : dependentDeductionUsd(dependents, exchangeRate);
  const gross = Number(breakdown.grossSalary) || 0;
  const storedBase = Number(breakdown.taxableBaseUsd ?? hybrid?.taxableBaseUsd ?? 0);
  const taxableBaseUsd =
    storedBase > 0 || gross > 0
      ? storedBase > 0
        ? storedBase
        : Math.max(0, Math.round((gross - reliefUsd) * 100) / 100)
      : 0;
  const perDependentUsd =
    dependents > 0 ? Math.round((reliefUsd / dependents) * 100) / 100 : dependentDeductionUsd(1, exchangeRate);
  return { dependents, reliefUsd, taxableBaseUsd, perDependentUsd };
}

/** Full contract monthly base — never use prorated Base column as contract. */
export function inferContractBaseSalary(breakdown: SalaryBreakdown): number {
  const explicit = Number(
    breakdown.contractBaseSalary ?? breakdown.hybrid?.fixed?.contractBaseSalary ?? 0
  );
  if (explicit > 0) return Math.round(explicit * 100) / 100;
  const prorated = Number(breakdown.baseSalary ?? 0);
  const factor = breakdown.hybrid?.fixed?.prorationFactor;
  if (prorated > 0) {
    if (typeof factor === 'number' && factor > 0 && factor < 1) {
      return Math.round((prorated / factor) * 100) / 100;
    }
    return Math.round(prorated * 100) / 100;
  }
  return 0;
}

/** Hourly + daily rates from contract (daily display = hourly × std hours). */
export function resolvePayrollRatesFromBreakdown(breakdown: SalaryBreakdown): {
  hourlyRate: number;
  dailyRate: number;
  contractBase: number;
  scheduledWorkingDays: number;
} {
  const summary = breakdown.attendanceSummary;
  const payrollBasisDays = payrollBasisDaysFromBreakdown(breakdown);
  const stdHours = summary?.standardHoursPerDay ?? DEFAULT_STANDARD_HOURS_PER_DAY;
  const contractBase = inferContractBaseSalary(breakdown);
  const audit = breakdown.payrollAudit ?? breakdown.hybrid?.payrollAudit;
  const divisor =
    (audit?.dailyRateDivisor ?? 0) > 0 ? audit!.dailyRateDivisor : payrollBasisDays;

  if (
    typeof summary?.hourlyRate === 'number' &&
    summary.hourlyRate > 0 &&
    typeof summary?.dailyRate === 'number' &&
    summary.dailyRate > 0
  ) {
    return {
      hourlyRate: summary.hourlyRate,
      dailyRate: summary.dailyRate,
      contractBase,
      scheduledWorkingDays: payrollBasisDays,
    };
  }

  const rates = resolvePayrollContractRates({
    contractBaseSalary: contractBase,
    scheduledWorkingDays: divisor,
    standardHoursPerDay: stdHours,
  });
  return {
    hourlyRate: rates.hourlyRate,
    dailyRate: rates.dailyRate,
    contractBase,
    scheduledWorkingDays: payrollBasisDays,
  };
}

/** Daily rate shown in grid (matches hourly × std hours). */
export function resolveDailyRateFromBreakdown(breakdown: SalaryBreakdown): number {
  return resolvePayrollRatesFromBreakdown(breakdown).dailyRate;
}

/** Paid days for payroll (present/late + approved paid leave) — never roster eligibility or legacy 26. */
/** Resolve payroll grid attendance metrics with hybrid/audit fallbacks. */
export function attendanceMetricsFromBreakdown(breakdown: SalaryBreakdown): {
  scheduledWorkingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  paidDays: number;
  totalWorkHours: number;
  standardHoursPerDay: number;
  hourlyRate: number;
  dailyRate: number;
  dependents: number;
  payrollBasisDays: number;
  overtimeHours: number;
  lateCount: number;
  attendanceSource: string;
} {
  const dayClass = breakdown.hybrid?.dayClassification;
  const summary = breakdown.attendanceSummary;
  const payrollBasisDays = payrollBasisDaysFromBreakdown(breakdown);
  const paidDays = paidDaysFromBreakdown(breakdown);
  const presentDays = summary?.presentDays ?? dayClass?.presentDays ?? 0;
  const paidLeaveDays = summary?.paidLeaveDays ?? dayClass?.paidLeaveDays ?? 0;
  const unpaidLeaveDays = Math.max(
    Number(summary?.unpaidLeaveDays) || 0,
    Number(dayClass?.unpaidLeaveDays) || 0
  );
  const absentDays = Math.max(
    Number(summary?.absentDays) || 0,
    Number(dayClass?.unexcusedAbsentDays) || 0
  );
  const rates = resolvePayrollRatesFromBreakdown(breakdown);
  const ot = resolveOvertimeFromBreakdown(breakdown);

  return {
    scheduledWorkingDays: payrollBasisDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    paidDays,
    totalWorkHours: summary?.totalWorkHours ?? 0,
    standardHoursPerDay: summary?.standardHoursPerDay ?? DEFAULT_STANDARD_HOURS_PER_DAY,
    hourlyRate:
      summary?.hourlyRate && summary.hourlyRate > 0 ? summary.hourlyRate : rates.hourlyRate,
    dailyRate: summary?.dailyRate && summary.dailyRate > 0 ? summary.dailyRate : rates.dailyRate,
    dependents: resolveDependentsFromBreakdown(breakdown),
    payrollBasisDays,
    overtimeHours: summary?.overtimeHours ?? ot.hours150 + ot.hours200,
    lateCount: summary?.lateCount ?? 0,
    attendanceSource: summary?.attendanceSource ?? 'attendance_module',
  };
}

export function paidDaysFromBreakdown(breakdown: SalaryBreakdown): number {
  const summary = breakdown.attendanceSummary;
  if (summary && typeof summary.paidDays === 'number' && Number.isFinite(summary.paidDays)) {
    return summary.paidDays;
  }
  if (typeof breakdown.proratedDays === 'number' && Number.isFinite(breakdown.proratedDays)) {
    return breakdown.proratedDays;
  }
  if (typeof breakdown.hybrid?.eligibleDays === 'number' && Number.isFinite(breakdown.hybrid.eligibleDays)) {
    return breakdown.hybrid.eligibleDays;
  }
  return 0;
}

export function usesCalendarPaidDayEngine(breakdown: SalaryBreakdown): boolean {
  const audit = breakdown.payrollAudit ?? breakdown.hybrid?.payrollAudit;
  return (
    Boolean(breakdown.hybrid?.model) ||
    audit?.engineVersion === 'calendar_v2' ||
    typeof breakdown.hybrid?.eligibleDays === 'number'
  );
}

export type PayslipEnrichContext = {
  user?: User;
  monthPrefix?: string;
  attendanceRecords?: AttendanceRecord[];
  taxBrackets?: PayrollTaxBracket[];
  compliance?: PayrollEngineConfig;
  runStatus?: string;
  frozen?: boolean;
};

export function computeHourlyRate(
  baseSalary: number,
  standardHoursPerDay: number,
  scheduledWorkingDays = LEGACY_WORK_DAYS_PER_MONTH
): number {
  if (baseSalary <= 0 || standardHoursPerDay <= 0) return 0;
  const divisor =
    scheduledWorkingDays > 0 ? scheduledWorkingDays : LEGACY_WORK_DAYS_PER_MONTH;
  return Math.round((baseSalary / (divisor * standardHoursPerDay)) * 100) / 100;
}

function hasStoredAttendance(summary: SalaryBreakdown['attendanceSummary']): boolean {
  if (!summary) return false;
  return (
    (summary.recordsInPeriod ?? 0) > 0 ||
    (summary.presentDays ?? 0) > 0 ||
    (summary.totalWorkHours ?? 0) > 0
  );
}

function hasStoredOvertime(breakdown: SalaryBreakdown): boolean {
  const resolved = resolveOvertimeFromBreakdown(breakdown);
  return (
    resolved.hours150 > 0 ||
    resolved.hours200 > 0 ||
    resolved.total > 0 ||
    resolved.amount150 > 0 ||
    resolved.amount200 > 0
  );
}

/** Fill gaps only — do not replace API/DB breakdown with empty client-side attendance. */
export function enrichPayrollBreakdown(
  breakdown: SalaryBreakdown,
  ctx?: PayslipEnrichContext
): SalaryBreakdown {
  const base = breakdown.baseSalary ?? 0;
  const scheduledDays = scheduledWorkingDaysFromBreakdown(breakdown);
  const user = ctx?.user;
  const monthPrefix = ctx?.monthPrefix ?? '';
  const storedAttendance = hasStoredAttendance(breakdown.attendanceSummary);
  const storedOvertime = hasStoredOvertime(breakdown);
  const canClientCalc =
    Boolean(user && base > 0) &&
    Boolean(ctx?.attendanceRecords?.length) &&
    !storedAttendance &&
    !storedOvertime &&
    !usesCalendarPaidDayEngine(breakdown);

  if (canClientCalc) {
    const calcUser: User = { ...user!, salary: base };
    const computed = calculatePayrollForUser(calcUser, {
      attendanceRecords: ctx!.attendanceRecords!,
      monthPrefix: monthPrefix || undefined,
      taxBrackets: ctx?.taxBrackets,
      compliance: ctx?.compliance,
    });

    const summary = computed.attendanceSummary!;
    const overtime = storedOvertime ? breakdown.overtime! : computed.overtime;

    return {
      ...breakdown,
      seniorityIndemnity: breakdown.seniorityIndemnity ?? computed.seniorityIndemnity,
      proratedDays: usesCalendarPaidDayEngine(breakdown)
        ? paidDaysFromBreakdown(breakdown)
        : (breakdown.proratedDays ?? computed.proratedDays),
      attendanceSummary: {
        recordsInPeriod: summary.recordsInPeriod,
        presentDays: summary.presentDays,
        totalWorkHours: summary.totalWorkHours,
        standardHoursPerDay: summary.standardHoursPerDay,
        hourlyRate: summary.hourlyRate,
        dependents: user!.dependents ?? summary.dependents ?? 0,
      },
      overtime: {
        hours150: overtime.hours150 ?? 0,
        amount150: overtime.amount150 ?? 0,
        hours200: overtime.hours200 ?? 0,
        amount200: overtime.amount200 ?? 0,
        total: overtime.total ?? 0,
      },
    };
  }

  const existing = breakdown.attendanceSummary;
  const stdHours = existing?.standardHoursPerDay ?? DEFAULT_STANDARD_HOURS_PER_DAY;
  const dayClass = breakdown.hybrid?.dayClassification;
  const scheduledWorkDays =
    existing?.payrollBasisDays ??
    existing?.scheduledWorkDays ??
    payrollBasisDaysFromBreakdown(breakdown);
  const paidLeaveDays = existing?.paidLeaveDays ?? dayClass?.paidLeaveDays;
  const unpaidLeaveDays = Math.max(
    Number(existing?.unpaidLeaveDays) || 0,
    Number(dayClass?.unpaidLeaveDays) || 0
  );
  const paidDays = existing?.paidDays ?? paidDaysFromBreakdown(breakdown);
  const absentDays = Math.max(
    Number(existing?.absentDays) || 0,
    Number(dayClass?.unexcusedAbsentDays) || 0
  );
  const dependents = resolveDependentsFromBreakdown({
    ...breakdown,
    attendanceSummary: {
      ...(existing ?? {
        recordsInPeriod: 0,
        presentDays: 0,
        totalWorkHours: 0,
        standardHoursPerDay: stdHours,
        hourlyRate: 0,
        dependents: 0,
      }),
      presentDays: existing?.presentDays ?? dayClass?.presentDays ?? 0,
      paidLeaveDays,
      unpaidLeaveDays,
      absentDays,
      paidDays,
      scheduledWorkDays: scheduledWorkDays > 0 ? scheduledWorkDays : undefined,
      dependents:
        existing?.dependents ??
        (breakdown.hybrid as { taxDependents?: number } | undefined)?.taxDependents ??
        user?.dependents ??
        0,
    },
  });

  const overtime = resolveOvertimeFromBreakdown(breakdown);
  const rates = resolvePayrollRatesFromBreakdown({
    ...breakdown,
    attendanceSummary: {
      ...(existing ?? {
        recordsInPeriod: 0,
        presentDays: 0,
        totalWorkHours: 0,
        standardHoursPerDay: stdHours,
        hourlyRate: 0,
        dependents: 0,
      }),
      presentDays: existing?.presentDays ?? dayClass?.presentDays ?? 0,
      paidLeaveDays,
      unpaidLeaveDays,
      absentDays,
      paidDays,
      scheduledWorkDays: scheduledWorkDays > 0 ? scheduledWorkDays : undefined,
      dependents:
        existing?.dependents ??
        (breakdown.hybrid as { taxDependents?: number } | undefined)?.taxDependents ??
        user?.dependents ??
        0,
    },
  });
  const depRelief = resolveDependentReliefFromBreakdown({
    ...breakdown,
    attendanceSummary: {
      ...(breakdown.attendanceSummary ?? {
        recordsInPeriod: 0,
        presentDays: 0,
        totalWorkHours: 0,
        standardHoursPerDay: stdHours,
        hourlyRate: rates.hourlyRate,
        dependents: 0,
      }),
      dependents,
    },
  });

  return {
    ...breakdown,
    taxDependentReliefUsd: depRelief.reliefUsd,
    taxableBaseUsd: depRelief.taxableBaseUsd,
    overtime: {
      hours150: overtime.hours150,
      amount150: overtime.amount150,
      hours200: overtime.hours200,
      amount200: overtime.amount200,
      total: overtime.total,
    },
    attendanceSummary: {
      recordsInPeriod: existing?.recordsInPeriod ?? 0,
      presentDays: existing?.presentDays ?? dayClass?.presentDays ?? 0,
      paidLeaveDays,
      unpaidLeaveDays,
      absentDays,
      paidDays,
      payrollBasisDays: scheduledWorkDays > 0 ? scheduledWorkDays : undefined,
      scheduledWorkDays: scheduledWorkDays > 0 ? scheduledWorkDays : undefined,
      lateCount: existing?.lateCount,
      overtimeHours: existing?.overtimeHours ?? overtime.hours150 + overtime.hours200,
      attendanceSource: existing?.attendanceSource ?? 'attendance_records',
      totalWorkHours: existing?.totalWorkHours ?? 0,
      standardHoursPerDay: existing?.standardHoursPerDay ?? stdHours,
      hourlyRate: rates.hourlyRate,
      dailyRate: rates.dailyRate > 0 ? rates.dailyRate : undefined,
      dependents,
    },
    hybrid: breakdown.hybrid
      ? {
          ...breakdown.hybrid,
          taxDependents: dependents,
          taxDependentReliefUsd: depRelief.reliefUsd,
          taxableBaseUsd: depRelief.taxableBaseUsd,
          variableAdditions: {
            ...breakdown.hybrid.variableAdditions,
            overtime: {
              hours150: overtime.hours150,
              amount150: overtime.amount150,
              hours200: overtime.hours200,
              amount200: overtime.amount200,
              total: overtime.total,
            },
          },
        }
      : breakdown.hybrid,
  };
}
