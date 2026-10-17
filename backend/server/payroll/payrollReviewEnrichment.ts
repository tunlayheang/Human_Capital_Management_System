/**
 * Enrich payslip breakdown with Cambodia payroll register / review fields.
 */
import {
  marginalTaxRateForTaxableBaseUsd,
  type SalaryTaxBracketUsd,
} from '../cambodiaSalaryTax.js';
import type { PayrollBreakdown } from '../payrollCalculation.js';
import type { PayrollReviewContext, PayrollReviewSnapshot, EmploymentReviewFlag } from './payrollReviewContext.js';
import {
  computeNetChange,
  computeProrationReviewDisplay,
  previousCalendarMonth,
  resolveEmploymentReviewFlags,
} from './payrollReviewComparisonService.js';

export type { PayrollReviewContext, PayrollReviewSnapshot } from './payrollReviewContext.js';

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveEmployeePositionTitle(
  employee: Record<string, unknown>,
  positionTitleById?: Map<string, string>
): string {
  const job = String(employee.job_position ?? '').trim();
  if (job) return job;
  const posObj = employee.position as { title?: string } | undefined;
  if (posObj?.title) return String(posObj.title).trim();
  const placementTitle = String(employee.position_title ?? '').trim();
  if (placementTitle) return placementTitle;
  const posId = String(employee.position_id ?? '').trim();
  if (posId && positionTitleById?.has(posId)) {
    return positionTitleById.get(posId) || '—';
  }
  return '—';
}

export function resolveDepartmentName(
  employee: Record<string, unknown>,
  departmentNameById?: Map<string, string>
): { departmentId: string | null; departmentName: string } {
  const deptObj = employee.department as { id?: string; name?: string } | undefined;
  const departmentId =
    String(employee.department_id ?? deptObj?.id ?? '').trim() || null;
  const fromEmployee = String(employee.department_name ?? deptObj?.name ?? '').trim();
  if (fromEmployee) return { departmentId, departmentName: fromEmployee };
  if (departmentId && departmentNameById?.has(departmentId)) {
    return { departmentId, departmentName: departmentNameById.get(departmentId) || '—' };
  }
  return { departmentId, departmentName: '—' };
}

export function enrichNssfDetailEmployerTotals(
  detail: PayrollBreakdown['nssfDetail'],
  exchangeRate: number
): PayrollBreakdown['nssfDetail'] {
  if (!detail) return undefined;
  const employerTotalKhr =
    num(detail.employerOccupationalRiskKhr) +
    num(detail.employerHealthcareKhr) +
    num(detail.employerPensionKhr);
  const ex = Math.max(1, exchangeRate || 4100);
  return {
    ...detail,
    employerTotalKhr,
    employerNssfUsd: roundUsd(employerTotalKhr / ex),
  };
}

export function computeAllowanceTotalUsd(b: PayrollBreakdown): number {
  const a = b.allowances ?? ({} as PayrollBreakdown['allowances']);
  const seniorityEntitlement =
    Number(b.seniorityEntitlement) > 0
      ? Number(b.seniorityEntitlement)
      : num(a.seniority);
  return roundUsd(
    num(a.transport) +
      num(a.meal) +
      num(a.attendance) +
      seniorityEntitlement +
      num(a.position) +
      num(a.commission) +
      num(a.otMeal) +
      num(b.seniorityIndemnity) +
      num(b.backPayment)
  );
}

export function computeOtherDeductionsUsd(b: PayrollBreakdown): number {
  const d = b.deductions ?? ({} as PayrollBreakdown['deductions']);
  return roundUsd(num(d.absences) + num(d.advances));
}

export function enrichPayrollBreakdownReviewFields(
  breakdown: PayrollBreakdown,
  employee: Record<string, unknown> | null | undefined,
  options?: {
    taxBrackets?: SalaryTaxBracketUsd[];
    positionTitleById?: Map<string, string>;
    departmentNameById?: Map<string, string>;
    userId?: string;
    period?: { payPeriodStart: string; payPeriodEnd: string };
    priorMonthNetByUserId?: Map<string, number>;
    previousRunNetByUserId?: Map<string, number>;
    settlementOverlapUserIds?: Set<string>;
    attendancePeriodStatus?: string | null;
    attendanceFinalized?: boolean;
    payrollMonth?: string;
  }
): PayrollBreakdown {
  const ex = breakdown.exchangeRate || 4100;
  const taxableBase =
    breakdown.taxableBaseUsd != null
      ? num(breakdown.taxableBaseUsd)
      : Math.max(0, num(breakdown.grossSalary) - num(breakdown.taxDependentReliefUsd));
  const taxMarginalRatePct = marginalTaxRateForTaxableBaseUsd(
    taxableBase,
    options?.taxBrackets,
    ex
  );
  const nssfDetail = enrichNssfDetailEmployerTotals(breakdown.nssfDetail, ex);
  const priorCtx = breakdown.reviewContext;
  const priorSnapshot = breakdown.reviewSnapshot ?? priorCtx;

  const positionTitle = employee
    ? resolveEmployeePositionTitle(employee, options?.positionTitleById)
    : priorSnapshot?.positionTitle ?? priorCtx?.positionTitle ?? '—';
  const { departmentId, departmentName } = employee
    ? resolveDepartmentName(employee, options?.departmentNameById)
    : {
        departmentId: priorCtx?.departmentId ?? null,
        departmentName: priorCtx?.departmentName ?? '—',
      };

  const reviewSnapshot: PayrollReviewSnapshot = {
    positionTitle,
    bankName: employee
      ? String(employee.bank_name ?? '').trim() || null
      : priorSnapshot?.bankName ?? null,
    bankAccountNumber: employee
      ? String(employee.bank_account_number ?? '').trim() || null
      : priorSnapshot?.bankAccountNumber ?? null,
    paymentMethod: employee
      ? String(employee.payment_method ?? 'bank')
      : priorSnapshot?.paymentMethod ?? 'bank',
  };

  const proration = computeProrationReviewDisplay(breakdown);
  const contractBaseUsd = roundUsd(
    num(
      breakdown.contractBaseSalary ??
        breakdown.hybrid?.fixed?.contractBaseSalary ??
        breakdown.baseSalary
    )
  );
  const proratedPayUsd = roundUsd(num(breakdown.baseSalary));
  const currentNet = roundUsd(num(breakdown.netSalary));
  const uid = String(options?.userId ?? '').trim();
  const priorMonthNetUsd =
    uid && options?.priorMonthNetByUserId?.has(uid)
      ? options.priorMonthNetByUserId.get(uid)!
      : priorCtx?.priorMonthNetUsd ?? null;
  const priorChange = computeNetChange(currentNet, priorMonthNetUsd);
  const previousRunNetUsd =
    uid && options?.previousRunNetByUserId?.has(uid)
      ? options.previousRunNetByUserId.get(uid)!
      : priorCtx?.previousRunNetUsd ?? null;
  const runChange = computeNetChange(currentNet, previousRunNetUsd);
  const payrollMonth = options?.payrollMonth?.slice(0, 7) ?? null;

  const employmentFlags =
    employee && options?.period
      ? resolveEmploymentReviewFlags(employee, options.period, {
          settlementOverlapUserIds: options.settlementOverlapUserIds,
          userId: uid,
        })
      : priorCtx?.employmentFlags ?? [];

  const attStatus =
    options?.attendancePeriodStatus ??
    breakdown.hybrid?.attendancePeriodStatus ??
    priorCtx?.attendancePeriodStatus ??
    null;
  const attFinalized =
    options?.attendanceFinalized ??
    priorCtx?.attendanceFinalized ??
    ['FINALIZED', 'LOCKED'].includes(String(attStatus ?? '').toUpperCase());

  const grossUsd = roundUsd(num(breakdown.grossSalary));
  const employerNssfUsd = roundUsd(num(nssfDetail?.employerNssfUsd));
  const nssfAssumedWageKhr =
    nssfDetail?.assumedWageKhr != null && Number(nssfDetail.assumedWageKhr) > 0
      ? Math.round(Number(nssfDetail.assumedWageKhr))
      : priorCtx?.nssfAssumedWageKhr ?? null;

  const reviewContext: PayrollReviewContext = {
    ...reviewSnapshot,
    departmentId,
    departmentName,
    contractBaseUsd,
    proratedPayUsd,
    payableDays: proration.payableDays,
    scheduledWorkingDays: proration.scheduledWorkingDays,
    prorationPct: proration.prorationPct,
    prorationLabel: proration.prorationLabel,
    exchangeRate: ex,
    employmentFlags,
    priorMonthNetUsd,
    priorMonth: payrollMonth ? previousCalendarMonth(payrollMonth) : priorCtx?.priorMonth ?? null,
    netChangeVsPriorMonthUsd: priorChange.deltaUsd,
    netChangeVsPriorMonthPct: priorChange.deltaPct,
    previousRunNetUsd,
    netChangeVsPreviousRunUsd: runChange.deltaUsd,
    netChangedSincePreviousRun:
      runChange.deltaUsd != null && Math.abs(runChange.deltaUsd) >= 0.01,
    attendancePeriodStatus: attStatus,
    attendanceFinalized: attFinalized,
    nssfId: employee
      ? String(employee.nssf_id ?? '').trim() || null
      : priorCtx?.nssfId ?? null,
    taxId: employee
      ? String(employee.tax_id ?? '').trim() || null
      : priorCtx?.taxId ?? null,
    nssfAssumedWageKhr,
    totalEmployerCostUsd: roundUsd(grossUsd + employerNssfUsd),
    taxMarginalRatePct,
  };

  return {
    ...breakdown,
    taxableBaseUsd: roundUsd(taxableBase),
    taxMarginalRatePct,
    nssfDetail,
    reviewSnapshot,
    reviewContext,
    allowanceTotalUsd: computeAllowanceTotalUsd(breakdown),
    otherDeductionsUsd: computeOtherDeductionsUsd(breakdown),
  };
}

export function parseReviewContextFromJson(raw: unknown): PayrollReviewContext | undefined {
  if (raw == null) return undefined;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return undefined;
    const record = obj as Record<string, unknown>;
    const flagsRaw = record.employmentFlags ?? record.employment_flags;
    const employmentFlags = Array.isArray(flagsRaw)
      ? (flagsRaw as EmploymentReviewFlag[])
      : [];
    return {
      positionTitle: String(record.positionTitle ?? record.position_title ?? '—'),
      bankName:
        record.bankName != null || record.bank_name != null
          ? String(record.bankName ?? record.bank_name ?? '').trim() || null
          : null,
      bankAccountNumber:
        record.bankAccountNumber != null || record.bank_account_number != null
          ? String(record.bankAccountNumber ?? record.bank_account_number ?? '').trim() || null
          : null,
      paymentMethod: String(record.paymentMethod ?? record.payment_method ?? 'bank'),
      departmentId:
        record.departmentId != null || record.department_id != null
          ? String(record.departmentId ?? record.department_id ?? '').trim() || null
          : null,
      departmentName: String(record.departmentName ?? record.department_name ?? '—'),
      contractBaseUsd: num(record.contractBaseUsd ?? record.contract_base_usd),
      proratedPayUsd: num(record.proratedPayUsd ?? record.prorated_pay_usd),
      payableDays: num(record.payableDays ?? record.payable_days),
      scheduledWorkingDays: num(record.scheduledWorkingDays ?? record.scheduled_working_days),
      prorationPct: num(record.prorationPct ?? record.proration_pct, 100),
      prorationLabel: String(record.prorationLabel ?? record.proration_label ?? ''),
      exchangeRate: num(record.exchangeRate ?? record.exchange_rate, 4100),
      employmentFlags,
      priorMonthNetUsd: (() => {
        const v = record.priorMonthNetUsd ?? record.prior_month_net_usd;
        return v == null ? null : num(v);
      })(),
      priorMonth:
        record.priorMonth != null || record.prior_month != null
          ? String(record.priorMonth ?? record.prior_month ?? '').slice(0, 7) || null
          : null,
      netChangeVsPriorMonthUsd: (() => {
        const v = record.netChangeVsPriorMonthUsd ?? record.net_change_vs_prior_month_usd;
        return v == null ? null : num(v);
      })(),
      netChangeVsPriorMonthPct: (() => {
        const v = record.netChangeVsPriorMonthPct ?? record.net_change_vs_prior_month_pct;
        return v == null ? null : num(v);
      })(),
      previousRunNetUsd: (() => {
        const v = record.previousRunNetUsd ?? record.previous_run_net_usd;
        return v == null ? null : num(v);
      })(),
      netChangeVsPreviousRunUsd: (() => {
        const v = record.netChangeVsPreviousRunUsd ?? record.net_change_vs_previous_run_usd;
        return v == null ? null : num(v);
      })(),
      netChangedSincePreviousRun: Boolean(
        record.netChangedSincePreviousRun ?? record.net_changed_since_previous_run
      ),
      attendancePeriodStatus:
        record.attendancePeriodStatus != null || record.attendance_period_status != null
          ? String(record.attendancePeriodStatus ?? record.attendance_period_status ?? '')
          : null,
      attendanceFinalized: Boolean(record.attendanceFinalized ?? record.attendance_finalized),
      nssfId:
        record.nssfId != null || record.nssf_id != null
          ? String(record.nssfId ?? record.nssf_id ?? '').trim() || null
          : null,
      taxId:
        record.taxId != null || record.tax_id != null
          ? String(record.taxId ?? record.tax_id ?? '').trim() || null
          : null,
      nssfAssumedWageKhr: (() => {
        const v = record.nssfAssumedWageKhr ?? record.nssf_assumed_wage_khr;
        return v == null ? null : Math.round(num(v));
      })(),
      totalEmployerCostUsd: num(record.totalEmployerCostUsd ?? record.total_employer_cost_usd),
      taxMarginalRatePct: (() => {
        const v = record.taxMarginalRatePct ?? record.tax_marginal_rate_pct;
        return v == null ? undefined : num(v);
      })(),
    };
  } catch {
    return undefined;
  }
}
