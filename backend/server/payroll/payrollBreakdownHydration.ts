import type { PayrollBreakdown, PayrollAttendanceSummary } from '../payrollCalculation.js';
import { resolvePayrollContractRates } from './payrollContractRates.js';
import type { HybridPayrollComponents, PayrollCalculationAudit } from './hybridPayrollTypes.js';
import { usdToKhr } from '../usdToKhr.js';
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJson<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Restore top-level audit + attendance metrics from hybrid JSON when DB columns are empty. */
export function hydrateStoredPayrollBreakdown(b: PayrollBreakdown): PayrollBreakdown {
  const hybrid = (b.hybrid ?? parseJson<HybridPayrollComponents>((b as { hybridComponentsJson?: string }).hybridComponentsJson)) as
    | HybridPayrollComponents
    | undefined;
  const payrollAudit =
    b.payrollAudit ??
    hybrid?.payrollAudit ??
    parseJson<PayrollCalculationAudit>((b as { payrollAuditJson?: string }).payrollAuditJson);

  const dayClass = hybrid?.dayClassification;
  const existing = b.attendanceSummary;

  const presentDays = num(
    existing?.presentDays ?? dayClass?.presentDays ?? hybrid?.dayClassification?.presentDays,
    0
  );
  const paidLeaveDays = num(
    existing?.paidLeaveDays ??
      dayClass?.paidLeaveDays ??
      (b as { attendancePaidLeaveDays?: number }).attendancePaidLeaveDays,
    0
  );
  const unpaidLeaveDays = Math.max(
    num(existing?.unpaidLeaveDays, 0),
    num(dayClass?.unpaidLeaveDays, 0)
  );
  const taxDependentsFromHybrid = num(hybrid?.taxDependents, -1);
  const paidDays = num(
    existing?.paidDays ??
      b.proratedDays ??
      hybrid?.eligibleDays ??
      dayClass?.payableDays ??
      (b as { attendancePaidDays?: number }).attendancePaidDays,
    0
  );
  const payrollBasisDays = num(
    existing?.payrollBasisDays ??
      existing?.scheduledWorkDays ??
      payrollAudit?.payrollBasisDays ??
      payrollAudit?.totalScheduledWorkingDays,
    0
  );
  // Prefer the richest source — DB column can be 0 while hybrid still has the calculated count.
  const absentDays = Math.max(
    num(existing?.absentDays, 0),
    num(dayClass?.unexcusedAbsentDays, 0),
    num((b as { attendanceAbsentDays?: number }).attendanceAbsentDays, 0)
  );
  const dependents = num(
    existing?.dependents ??
      (taxDependentsFromHybrid >= 0 ? taxDependentsFromHybrid : undefined) ??
      (b as { attendanceDependents?: number }).attendanceDependents,
    0
  );

  const attendanceSummary: PayrollAttendanceSummary = {
    recordsInPeriod: num(existing?.recordsInPeriod, 0),
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    paidDays,
    payrollBasisDays: payrollBasisDays > 0 ? payrollBasisDays : undefined,
    scheduledWorkDays: payrollBasisDays > 0 ? payrollBasisDays : undefined,
    lateCount: num(existing?.lateCount, 0) || undefined,
    overtimeHours: num(existing?.overtimeHours, 0) || undefined,
    attendanceSource: existing?.attendanceSource ?? 'attendance_records',
    totalWorkHours: num(existing?.totalWorkHours, 0),
    standardHoursPerDay: num(existing?.standardHoursPerDay, 8),
    hourlyRate: num(existing?.hourlyRate, 0),
    dailyRate: (() => {
      if (num(existing?.dailyRate, 0) > 0) return num(existing?.dailyRate);
      const contract = num(
        b.contractBaseSalary ?? hybrid?.fixed?.contractBaseSalary,
        0
      );
      const days = payrollBasisDays > 0 ? payrollBasisDays : 0;
      const std = num(existing?.standardHoursPerDay, 8) || 8;
      if (contract > 0 && days > 0) {
        return resolvePayrollContractRates({
          contractBaseSalary: contract,
          scheduledWorkingDays: days,
          standardHoursPerDay: std,
        }).dailyRate;
      }
      return undefined;
    })(),
    dependents,
  };

  const backPaymentRaw = b.backPayment ?? (b as { backPaymentUsd?: number }).backPaymentUsd;
  const backPaymentNum = num(backPaymentRaw, Number.NaN);
  const backPayment = Number.isFinite(backPaymentNum) ? backPaymentNum : undefined;
  const backPaymentSourceMonth =
    b.backPaymentSourceMonth ??
    (b as { backPaymentSourceMonth?: string }).backPaymentSourceMonth ??
    undefined;

  const hybridOt = hybrid?.variableAdditions?.overtime;
  const storedOt = b.overtime;
  const overtime = {
    hours150: num(storedOt?.hours150 ?? hybridOt?.hours150, 0),
    amount150: num(storedOt?.amount150 ?? hybridOt?.amount150, 0),
    hours200: num(storedOt?.hours200 ?? hybridOt?.hours200, 0),
    amount200: num(storedOt?.amount200 ?? hybridOt?.amount200, 0),
    total: num(
      storedOt?.total ??
        hybridOt?.total ??
        num(storedOt?.amount150 ?? hybridOt?.amount150, 0) +
          num(storedOt?.amount200 ?? hybridOt?.amount200, 0),
      0
    ),
  };
  if (!overtime.total) {
    overtime.total =
      Math.round((overtime.amount150 + overtime.amount200) * 100) / 100;
  }

  const varDed = hybrid?.variableDeductions;
  const storedDed = b.deductions ?? {
    nssf: 0,
    taxOnSalary: 0,
    absences: 0,
    advances: 0,
    total: 0,
  };
  const absenceFromHybrid =
    varDed != null
      ? Math.round(
          (num(varDed.unpaidLeave) +
            num(varDed.unexcusedAbsence) +
            num(varDed.latePenalty)) *
            100
        ) / 100
      : 0;
  const absences =
    num(storedDed.absences) > 0 ? num(storedDed.absences) : absenceFromHybrid;
  const advances = num(storedDed.advances) > 0 ? num(storedDed.advances) : num(varDed?.advances);
  const deductions = {
    nssf: num(storedDed.nssf),
    taxOnSalary: num(storedDed.taxOnSalary),
    absences,
    advances,
    total: 0,
  };
  deductions.total = Math.round(
    (deductions.nssf +
      deductions.taxOnSalary +
      deductions.absences +
      deductions.advances) *
      100
  ) / 100;

  const taxDependentReliefUsd =
    num(b.taxDependentReliefUsd, 0) > 0
      ? num(b.taxDependentReliefUsd)
      : num(hybrid?.taxDependentReliefUsd, 0);
  const grossForTax = num(b.grossSalary, 0);
  const exchangeUsed = num(b.exchangeRateUsed ?? b.exchangeRate, 4100);
  const nssfSalaryKhr =
    num(b.nssfSalaryKhr, 0) || (grossForTax > 0 ? usdToKhr(grossForTax, exchangeUsed) : 0);
  const nssfSalaryUsd = num(b.nssfSalaryUsd, 0) || grossForTax;
  const employeeContributionKhr =
    num(b.employeeContributionKhr, 0) || num(b.nssfDetail?.employeeTotalKhr, 0);
  const employeeContributionUsd =
    num(b.employeeContributionUsd, 0) ||
    num(b.deductions?.nssf, 0) ||
    (employeeContributionKhr > 0
      ? Math.round((employeeContributionKhr / exchangeUsed) * 100) / 100
      : 0);
  const employerContributionKhr =
    num(b.employerContributionKhr, 0) || num(b.nssfDetail?.employerTotalKhr, 0);
  const employerContributionUsd =
    num(b.employerContributionUsd, 0) ||
    num(b.nssfDetail?.employerNssfUsd, 0) ||
    (employerContributionKhr > 0
      ? Math.round((employerContributionKhr / exchangeUsed) * 100) / 100
      : 0);
  const taxableBaseUsd =
    num(b.taxableBaseUsd, 0) > 0
      ? num(b.taxableBaseUsd)
      : num(hybrid?.taxableBaseUsd, 0) > 0
        ? num(hybrid?.taxableBaseUsd)
        : Math.max(0, Math.round((grossForTax - taxDependentReliefUsd) * 100) / 100);

  return {
    ...b,
    deductions,
    nssfSalaryKhr: nssfSalaryKhr > 0 ? nssfSalaryKhr : b.nssfSalaryKhr,
    nssfSalaryUsd: nssfSalaryUsd > 0 ? nssfSalaryUsd : b.nssfSalaryUsd,
    employeeContributionKhr:
      employeeContributionKhr > 0 ? employeeContributionKhr : b.employeeContributionKhr,
    employeeContributionUsd:
      employeeContributionUsd > 0 ? employeeContributionUsd : b.employeeContributionUsd,
    employerContributionKhr:
      employerContributionKhr > 0 ? employerContributionKhr : b.employerContributionKhr,
    employerContributionUsd:
      employerContributionUsd > 0 ? employerContributionUsd : b.employerContributionUsd,
    taxDependentReliefUsd: taxDependentReliefUsd > 0 ? taxDependentReliefUsd : b.taxDependentReliefUsd,
    taxableBaseUsd: taxableBaseUsd > 0 || grossForTax > 0 ? taxableBaseUsd : b.taxableBaseUsd,
    hybrid: hybrid ?? b.hybrid,
    payrollAudit: payrollAudit ?? b.payrollAudit,
    proratedDays: paidDays,
    backPayment: backPayment !== undefined ? backPayment : b.backPayment,
    backPaymentSourceMonth,
    attendanceSummary,
    overtime,
    taxMarginalRatePct:
      b.taxMarginalRatePct ??
      (b.reviewContext as { taxMarginalRatePct?: number } | undefined)?.taxMarginalRatePct,
  };
}
