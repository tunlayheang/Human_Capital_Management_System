import type { PayrollBreakdown } from './payrollCalculation.js';
import { normalizePayrollBreakdown, reconcilePayrollBreakdown } from './payrollCalculation.js';
import { hydrateStoredPayrollBreakdown } from './payroll/payrollBreakdownHydration.js';
import { parseReviewContextFromJson } from './payroll/payrollReviewEnrichment.js';

/** DB row shape for `payslipbreakdowns` (1:1 with payslips). */
export type PayslipBreakdownRow = {
  payslipId: string;
  baseSalary: number;
  proratedDays: number;
  grossSalary: number;
  netSalary: number;
  exchangeRate: number;
  netSalaryKhr: number;
  allowanceTransport: number;
  allowanceAttendance: number;
  allowanceMeal: number;
  allowanceSeniority: number;
  allowanceSeniorityIndemnity: number;
  allowancePosition: number;
  allowanceCommission: number;
  allowanceOtMeal: number;
  allowanceBreakdownJson: string | null;
  otHours100?: number;
  otAmount100?: number;
  otHours150: number;
  otAmount150: number;
  otHours200: number;
  otAmount200: number;
  otTotal: number;
  deductionNssf: number;
  deductionTaxOnSalary: number;
  taxableIncomeKhr?: number;
  taxableIncomeUsd?: number;
  taxAmountKhr?: number;
  taxAmountUsd?: number;
  exchangeRateUsed?: number;
  nssfSalaryKhr?: number;
  nssfSalaryUsd?: number;
  employeeContributionKhr?: number;
  employeeContributionUsd?: number;
  employerContributionKhr?: number;
  employerContributionUsd?: number;
  deductionAbsences: number;
  deductionAdvances: number;
  deductionTotal: number;
  attendanceRecordsInPeriod: number;
  attendancePresentDays: number;
  attendanceTotalWorkHours: number;
  attendanceStandardHoursPerDay: number;
  attendanceHourlyRate: number;
  attendanceDependents: number;
  attendancePaidLeaveDays?: number;
  attendancePaidDays?: number;
  attendanceAbsentDays?: number;
  attendanceScheduledWorkDays?: number;
  contractBaseSalary?: number;
  hybridComponentsJson?: string | null;
  payrollAuditJson?: string | null;
  backPaymentUsd?: number;
  backPaymentSourceMonth?: string | null;
  reviewContextJson?: string | null;
};

function resolveStoredContractBaseSalary(b: PayrollBreakdown): number {
  const explicit = Number(b.contractBaseSalary ?? 0);
  if (explicit > 0) return explicit;
  const hybridFixed = Number(b.hybrid?.fixed?.contractBaseSalary ?? 0);
  if (hybridFixed > 0) return hybridFixed;
  const prorated = Number(b.baseSalary ?? 0);
  const factor = Number(b.hybrid?.fixed?.prorationFactor ?? 0);
  if (prorated > 0 && factor > 0 && factor < 1) {
    return Math.round((prorated / factor) * 100) / 100;
  }
  return prorated > 0 ? prorated : 0;
}

export function breakdownToRow(payslipId: string, b: PayrollBreakdown): PayslipBreakdownRow {
  const hydrated = hydrateStoredPayrollBreakdown(b);
  const summary = hydrated.attendanceSummary;
  const payrollAudit = hydrated.payrollAudit ?? hydrated.hybrid?.payrollAudit;
  return {
    payslipId,
    baseSalary: hydrated.baseSalary,
    proratedDays: hydrated.proratedDays,
    grossSalary: hydrated.grossSalary,
    netSalary: hydrated.netSalary,
    exchangeRate: hydrated.exchangeRate,
    netSalaryKhr: hydrated.netSalaryKHR,
    allowanceTransport: hydrated.allowances.transport,
    allowanceAttendance: hydrated.allowances.attendance,
    allowanceMeal: hydrated.allowances.meal,
    allowanceSeniority: hydrated.allowances.seniority,
    allowanceSeniorityIndemnity: hydrated.seniorityIndemnity ?? 0,
    allowancePosition: hydrated.allowances.position ?? 0,
    allowanceCommission: hydrated.allowances.commission ?? 0,
    allowanceOtMeal: hydrated.allowances.otMeal ?? 0,
    allowanceBreakdownJson: (() => {
      const snap =
        hydrated.allowanceSnapshot && typeof hydrated.allowanceSnapshot === 'object'
          ? { ...(hydrated.allowanceSnapshot as Record<string, unknown>) }
          : ({} as Record<string, unknown>);
      if (hydrated.seniorityIndemnitySnapshot) {
        snap.seniorityIndemnitySnapshot = hydrated.seniorityIndemnitySnapshot;
      }
      return Object.keys(snap).length ? JSON.stringify(snap) : null;
    })(),
    otHours100: hydrated.overtime.hours100 ?? 0,
    otAmount100: hydrated.overtime.amount100 ?? 0,
    otHours150: hydrated.overtime.hours150,
    otAmount150: hydrated.overtime.amount150,
    otHours200: hydrated.overtime.hours200,
    otAmount200: hydrated.overtime.amount200,
    otTotal: hydrated.overtime.total,
    deductionNssf: hydrated.deductions.nssf,
    deductionTaxOnSalary: hydrated.deductions.taxOnSalary,
    taxableIncomeKhr: hydrated.taxableIncomeKhr ?? hydrated.taxableBaseUsd != null
      ? Math.round((hydrated.taxableBaseUsd ?? 0) * (hydrated.exchangeRateUsed ?? hydrated.exchangeRate))
      : 0,
    taxableIncomeUsd: hydrated.taxableIncomeUsd ?? hydrated.taxableBaseUsd ?? 0,
    taxAmountKhr: hydrated.taxAmountKhr ?? Math.round((hydrated.deductions.taxOnSalary ?? 0) * (hydrated.exchangeRateUsed ?? hydrated.exchangeRate)),
    taxAmountUsd: hydrated.taxAmountUsd ?? hydrated.deductions.taxOnSalary ?? 0,
    exchangeRateUsed: hydrated.exchangeRateUsed ?? hydrated.exchangeRate,
    nssfSalaryKhr: hydrated.nssfSalaryKhr ?? 0,
    nssfSalaryUsd: hydrated.nssfSalaryUsd ?? 0,
    employeeContributionKhr: hydrated.employeeContributionKhr ?? 0,
    employeeContributionUsd: hydrated.employeeContributionUsd ?? hydrated.deductions.nssf ?? 0,
    employerContributionKhr: hydrated.employerContributionKhr ?? 0,
    employerContributionUsd: hydrated.employerContributionUsd ?? 0,
    deductionAbsences: hydrated.deductions.absences,
    deductionAdvances: hydrated.deductions.advances,
    deductionTotal: hydrated.deductions.total,
    attendanceRecordsInPeriod: summary?.recordsInPeriod ?? 0,
    attendancePresentDays: summary?.presentDays ?? 0,
    attendancePaidLeaveDays: summary?.paidLeaveDays ?? 0,
    attendancePaidDays: summary?.paidDays ?? hydrated.proratedDays ?? 0,
    attendanceAbsentDays: summary?.absentDays ?? 0,
    attendanceScheduledWorkDays:
      summary?.scheduledWorkDays ??
      hydrated.hybrid?.dayClassification?.scheduledWorkingDays ??
      0,
    attendanceTotalWorkHours: summary?.totalWorkHours ?? 0,
    attendanceStandardHoursPerDay: summary?.standardHoursPerDay ?? 8,
    attendanceHourlyRate: summary?.hourlyRate ?? 0,
    attendanceDependents: summary?.dependents ?? 0,
    contractBaseSalary: resolveStoredContractBaseSalary(hydrated),
    hybridComponentsJson: hydrated.hybrid ? JSON.stringify(hydrated.hybrid) : null,
    payrollAuditJson: payrollAudit ? JSON.stringify(payrollAudit) : null,
    backPaymentUsd: hydrated.backPayment ?? 0,
    backPaymentSourceMonth: hydrated.backPaymentSourceMonth ?? null,
    reviewContextJson: hydrated.reviewContext
      ? JSON.stringify(hydrated.reviewContext)
      : null,
  };
}

export function rowToBreakdown(row: PayslipBreakdownRow | Record<string, unknown>): PayrollBreakdown {
  const r = row as PayslipBreakdownRow;
  const seniorityIndemnity = Number(
    (r as PayslipBreakdownRow).allowanceSeniorityIndemnity ?? 0
  );
  const hybridParsed = (() => {
    const raw = (r as PayslipBreakdownRow).hybridComponentsJson;
    if (!raw) return undefined;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  })();

  const paidDaysFromHybrid =
    typeof (hybridParsed as { eligibleDays?: number } | undefined)?.eligibleDays === 'number'
      ? Number((hybridParsed as { eligibleDays: number }).eligibleDays)
      : null;

  const allowanceSnapshotParsed = (() => {
    const raw = r.allowanceBreakdownJson;
    if (!raw) return undefined;
    try {
      return typeof raw === 'string' ? (JSON.parse(raw) as any) : (raw as any);
    } catch {
      return undefined;
    }
  })();

  const seniorityIndemnitySnapshot =
    allowanceSnapshotParsed?.seniorityIndemnitySnapshot &&
    typeof allowanceSnapshotParsed.seniorityIndemnitySnapshot === 'object'
      ? allowanceSnapshotParsed.seniorityIndemnitySnapshot
      : undefined;

  const allowanceLines =
    allowanceSnapshotParsed?.lines && Array.isArray(allowanceSnapshotParsed.lines)
      ? allowanceSnapshotParsed.lines.map((l: any) => ({
          code: String(l.code ?? '').toUpperCase(),
          name: String(l.name ?? ''),
          amount: Number(l.amount) || 0,
        }))
      : undefined;

  const payrollAuditParsed = (() => {
    const raw = (r as PayslipBreakdownRow).payrollAuditJson;
    if (!raw) return undefined;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return undefined;
    }
  })();

  const partial = reconcilePayrollBreakdown({
    baseSalary: Number(r.baseSalary) || 0,
    contractBaseSalary: (() => {
      const fromCol = Number((r as PayslipBreakdownRow).contractBaseSalary) || 0;
      if (fromCol > 0) return fromCol;
      const fromHybrid = Number(
        (hybridParsed as { fixed?: { contractBaseSalary?: number } } | undefined)?.fixed
          ?.contractBaseSalary ?? 0
      );
      if (fromHybrid > 0) return fromHybrid;
      const prorated = Number(r.baseSalary) || 0;
      const factor = Number(
        (hybridParsed as { fixed?: { prorationFactor?: number } } | undefined)?.fixed
          ?.prorationFactor ?? 0
      );
      if (prorated > 0 && factor > 0 && factor < 1) {
        return Math.round((prorated / factor) * 100) / 100;
      }
      return undefined;
    })(),
    hybrid: hybridParsed,
    payrollAudit: payrollAuditParsed,
    seniorityIndemnity: seniorityIndemnity > 0 ? seniorityIndemnity : undefined,
    seniorityIndemnitySnapshot,
    proratedDays: (() => {
      const n = Number(r.proratedDays);
      return Number.isFinite(n) ? n : 0;
    })(),
    grossSalary: Number(r.grossSalary) || 0,
    netSalary: Number(r.netSalary) || 0,
    exchangeRate: Number(r.exchangeRateUsed ?? r.exchangeRate) || 4100,
    exchangeRateUsed: Number(r.exchangeRateUsed ?? r.exchangeRate) || 4100,
    taxableIncomeKhr: Number(r.taxableIncomeKhr) || 0,
    taxableIncomeUsd: Number(r.taxableIncomeUsd) || 0,
    taxAmountKhr: Number(r.taxAmountKhr) || 0,
    taxAmountUsd: Number(r.taxAmountUsd) || 0,
    taxableBaseUsd: Number(r.taxableIncomeUsd) || undefined,
    nssfSalaryKhr: Number((r as PayslipBreakdownRow).nssfSalaryKhr) || 0,
    nssfSalaryUsd: Number((r as PayslipBreakdownRow).nssfSalaryUsd) || 0,
    employeeContributionKhr: Number((r as PayslipBreakdownRow).employeeContributionKhr) || 0,
    employeeContributionUsd:
      Number((r as PayslipBreakdownRow).employeeContributionUsd) ||
      Number(r.deductionNssf) ||
      0,
    employerContributionKhr: Number((r as PayslipBreakdownRow).employerContributionKhr) || 0,
    employerContributionUsd: Number((r as PayslipBreakdownRow).employerContributionUsd) || 0,
    netSalaryKHR: Number(r.netSalaryKhr ?? (r as any).netSalaryKHR) || 0,
    backPayment: Number((r as PayslipBreakdownRow).backPaymentUsd) || 0,
    backPaymentSourceMonth:
      (r as PayslipBreakdownRow).backPaymentSourceMonth != null
        ? String((r as PayslipBreakdownRow).backPaymentSourceMonth)
        : undefined,
    allowances: {
      transport: Number(r.allowanceTransport) || 0,
      attendance: Number(r.allowanceAttendance) || 0,
      meal: Number(r.allowanceMeal) || 0,
      seniority: Number(r.allowanceSeniority) || 0,
      position: Number(r.allowancePosition) || 0,
      commission: Number(r.allowanceCommission) || 0,
      otMeal: Number(r.allowanceOtMeal) || 0,
    },
    allowanceSnapshot: allowanceSnapshotParsed,
    allowanceLines,
    overtime: {
      hours100: Number((r as PayslipBreakdownRow).otHours100) || 0,
      amount100: Number((r as PayslipBreakdownRow).otAmount100) || 0,
      hours150: Number(r.otHours150) || 0,
      amount150: Number(r.otAmount150) || 0,
      hours200: Number(r.otHours200) || 0,
      amount200: Number(r.otAmount200) || 0,
      total: Number(r.otTotal) || 0,
    },
    deductions: {
      nssf: Number(r.deductionNssf) || 0,
      taxOnSalary: Number(r.deductionTaxOnSalary) || 0,
      absences: Number(r.deductionAbsences) || 0,
      advances: Number(r.deductionAdvances) || 0,
      total: Number(r.deductionTotal) || 0,
    },
    attendanceSummary: {
      recordsInPeriod: Number(r.attendanceRecordsInPeriod) || 0,
      presentDays: Number(r.attendancePresentDays) || 0,
      paidLeaveDays: Number((r as PayslipBreakdownRow).attendancePaidLeaveDays) || 0,
      unpaidLeaveDays:
        Math.max(
          Number(
            (hybridParsed as { dayClassification?: { unpaidLeaveDays?: number } } | undefined)
              ?.dayClassification?.unpaidLeaveDays
          ) || 0,
          Number(
            (hybridParsed as { unpaidLeaveDays?: number } | undefined)?.unpaidLeaveDays
          ) || 0
        ) || 0,
      absentDays: Math.max(
        Number((r as PayslipBreakdownRow).attendanceAbsentDays) || 0,
        Number(
          (hybridParsed as { dayClassification?: { unexcusedAbsentDays?: number } } | undefined)
            ?.dayClassification?.unexcusedAbsentDays
        ) || 0
      ),
      scheduledWorkDays: (() => {
        const n = Number((r as PayslipBreakdownRow).attendanceScheduledWorkDays);
        return Number.isFinite(n) && n > 0 ? n : undefined;
      })(),
      paidDays: (() => {
        const fromCol = Number((r as PayslipBreakdownRow).attendancePaidDays);
        if (Number.isFinite(fromCol) && fromCol >= 0 && (r as PayslipBreakdownRow).attendancePaidDays != null) {
          return fromCol;
        }
        if (paidDaysFromHybrid != null && Number.isFinite(paidDaysFromHybrid)) {
          return paidDaysFromHybrid;
        }
        const pr = Number(r.proratedDays);
        return Number.isFinite(pr) ? pr : 0;
      })(),
      totalWorkHours: Number(r.attendanceTotalWorkHours) || 0,
      standardHoursPerDay: Number(r.attendanceStandardHoursPerDay) || 8,
      hourlyRate: Number(r.attendanceHourlyRate) || 0,
      dependents: Number(r.attendanceDependents) || 0,
    },
    reviewContext: parseReviewContextFromJson(
      (r as PayslipBreakdownRow).reviewContextJson ?? (r as Record<string, unknown>).review_context_json
    ),
  });

  return hydrateStoredPayrollBreakdown(partial);
}

export function plainToBreakdownRow(plain: Record<string, unknown>): PayslipBreakdownRow | null {
  const normalized = normalizePayrollBreakdown(plain);
  if (!normalized) return null;
  const payslipId = String(plain.payslipId ?? plain.id ?? '');
  if (!payslipId) return null;
  return breakdownToRow(payslipId, normalized);
}
