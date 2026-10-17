import type { Payslip, SalaryBreakdown, PayrollPaymentStatus, PayrollReviewContext, EmploymentReviewFlag } from '../../types';
import type { PayrollEmployeeProfile } from './payrollEmployeeDisplay';
import {
  attendanceMetricsFromBreakdown,
  inferContractBaseSalary,
  resolveDependentReliefFromBreakdown,
  resolveOvertimeFromBreakdown,
} from './payrollBreakdownEnrichment';
import { resolveDeductionsFromBreakdown } from './payrollDeductionResolve';
import {
  coercePayrollUsdAmount,
  reconcilePayrollBreakdown,
  roundUsd,
} from './payrollBreakdownReconcile';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import { formatBankDisplay } from './payrollEmployeeDisplay';
import { CANONICAL_PAYROLL_TAX_BRACKETS_USD, marginalTaxRateForTaxableBase } from '../../utils/payrollTaxRate';
import { usdToKhr } from '../../utils/payrollRulesCurrency';

function readReviewContext(b: SalaryBreakdown): PayrollReviewContext | undefined {
  return b.reviewContext;
}

function readEmploymentFlags(ctx: PayrollReviewContext | undefined): EmploymentReviewFlag[] {
  return ctx?.employmentFlags ?? [];
}

function readPriorMonthNet(ctx: PayrollReviewContext | undefined): number | null {
  if (ctx?.priorMonthNetUsd != null && Number.isFinite(ctx.priorMonthNetUsd)) {
    return ctx.priorMonthNetUsd;
  }
  return null;
}

function resolveEmployerNssfUsd(b: SalaryBreakdown): number {
  const detail = b.nssfDetail;
  if (detail?.employerNssfUsd != null && Number(detail.employerNssfUsd) > 0) {
    return roundUsd(Number(detail.employerNssfUsd));
  }
  const ex = resolveExchangeRateKhrPerUsd(b.exchangeRate, 'active');
  if (detail?.employerTotalKhr != null && Number(detail.employerTotalKhr) > 0) {
    return roundUsd(Number(detail.employerTotalKhr) / ex);
  }
  const sumKhr =
    Number(detail?.employerOccupationalRiskKhr ?? 0) +
    Number(detail?.employerHealthcareKhr ?? 0) +
    Number(detail?.employerPensionKhr ?? 0);
  if (sumKhr > 0) return roundUsd(sumKhr / ex);
  return 0;
}

export type PayrollItemRow = {
  id: string;
  userId: string;
  employeeName: string;
  jobTitle: string;
  bankDisplay: string;
  /** Monthly contract base from employee profile (Employee Pay). */
  base: number;
  /** Fixed pay earned this period after attendance proration. */
  proratedPay: number;
  /** Eligible payroll basis days in employment window (informational). */
  proratedDays: number;
  /** Payroll basis days (salary divisor). */
  scheduledWorkingDays: number;
  payrollBasisDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  /** Unexcused ABSENT only (excludes unpaid leave). */
  absentDays: number;
  /** Present + paid leave combined for pay (distinct dates). */
  totalPaidDays: number;
  totalWorkHours: number;
  standardHoursPerDay: number;
  hourlyRate: number;
  /** Contract base ÷ work days — reference daily rate; absent days reduce pay via proration. */
  dailyRate: number;
  dependents: number;
  /** GDT dependent allowance (USD) — reduces taxable base before ToS, not added to gross. */
  dependentRelief: number;
  taxableBase: number;
  transport: number;
  meal: number;
  attendanceBonus: number;
  seniority: number;
  position: number;
  commission: number;
  otMeal: number;
  seniorityIndemnity: number;
  backPayment: number;
  allowanceTotal: number;
  otHours150: number;
  otHours200: number;
  otAmount150: number;
  otAmount200: number;
  otTotal: number;
  gross: number;
  taxRatePct: number;
  employerNssf: number;
  nssf: number;
  tax: number;
  absences: number;
  advances: number;
  otherDeductions: number;
  deductionsTotal: number;
  net: number;
  netKhr: number;
  exchangeRate: number;
  departmentId: string;
  departmentName: string;
  taxId: string;
  nssfId: string;
  nssfAssumedWageKhr: number | null;
  totalEmployerCostUsd: number;
  paymentStatus: PayrollPaymentStatus | null;
  prorationLabel: string;
  prorationPct: number;
  employmentFlags: import('../../types').EmploymentReviewFlag[];
  priorMonthNetUsd: number | null;
  netChangeVsPriorMonthUsd: number | null;
  netChangeVsPriorMonthPct: number | null;
  netChangedSincePreviousRun: boolean;
  attendanceFinalized: boolean;
};

export function buildPayrollItemRow(
  item: Payslip,
  profile: PayrollEmployeeProfile
): PayrollItemRow {
  const b: SalaryBreakdown = reconcilePayrollBreakdown(
    item.breakdown ?? ({} as SalaryBreakdown)
  );
  const a = b.allowances ?? { transport: 0, attendance: 0, meal: 0, seniority: 0 };
  const allowanceLines = (
    b.allowanceLines ??
    ((b as unknown as { allowanceSnapshot?: { lines?: Array<{ code?: string; amount?: number }> } })
      .allowanceSnapshot?.lines ?? [])
  ).filter(Boolean) as Array<{ code?: string; amount?: number }>;
  const amountByCode = new Map<string, number>();
  for (const line of allowanceLines) {
    const code = String(line.code ?? '').toUpperCase();
    if (!code) continue;
    amountByCode.set(code, (amountByCode.get(code) ?? 0) + (Number(line.amount) || 0));
  }
  const ot = resolveOvertimeFromBreakdown(b);
  const depRelief = resolveDependentReliefFromBreakdown(b);
  const ded = resolveDeductionsFromBreakdown(b);
  const metrics = attendanceMetricsFromBreakdown(b);
  // Use the engine's paid (post-proration) allowance values as the source of truth so
  // each row reconciles with gross. Fall back to the assigned rule-engine lines only when
  // the corresponding paid field is missing entirely (not when it is a legitimate 0).
  const transport = a.transport ?? amountByCode.get('TRANSPORT') ?? 0;
  const meal = a.meal ?? amountByCode.get('MEAL') ?? 0;
  const attendanceBonus = a.attendance ?? amountByCode.get('ATTENDANCE') ?? 0;
  /** Monthly service seniority removed — Cambodian payroll uses Jun/Dec indemnity only. */
  const seniority = 0;
  const position = a.position ?? amountByCode.get('POSITION') ?? 0;
  const commission = a.commission ?? amountByCode.get('COMMISSION') ?? 0;
  /** OT meal allowance retired — not paid via payroll. */
  const otMeal = 0;
  const seniorityIndemnity = Number(b.seniorityIndemnity) || 0;
  const backPaymentRaw = Number(b.backPayment);
  const backPayment = Number.isFinite(backPaymentRaw) ? backPaymentRaw : 0;
  const proratedPay = roundUsd(b.baseSalary ?? item.basicSalary ?? 0);
  const contractBase = inferContractBaseSalary(b);
  const base = contractBase > 0 ? contractBase : proratedPay;
  const gross = b.grossSalary ?? 0;
  const net = b.netSalary ?? item.netPay ?? 0;
  const exchangeRate = resolveExchangeRateKhrPerUsd(b.exchangeRate, 'active');
  const deductionsTotal = ded.total;
  const allowanceTotal =
    Number(b.allowanceTotalUsd) > 0
      ? roundUsd(Number(b.allowanceTotalUsd))
      : roundUsd(
          transport +
            meal +
            attendanceBonus +
            seniority +
            position +
            commission +
            otMeal +
            seniorityIndemnity +
            backPayment
        );
  const otherDeductions =
    Number(b.otherDeductionsUsd) > 0
      ? roundUsd(Number(b.otherDeductionsUsd))
      : roundUsd(ded.absences + ded.advances);
  const taxRatePct =
    b.taxMarginalRatePct != null
      ? Number(b.taxMarginalRatePct)
      : b.reviewContext?.taxMarginalRatePct != null
        ? Number(b.reviewContext.taxMarginalRatePct)
        : marginalTaxRateForTaxableBase(
          depRelief.taxableBaseUsd,
          CANONICAL_PAYROLL_TAX_BRACKETS_USD,
          resolveExchangeRateKhrPerUsd(b.exchangeRate, 'active')
        );
  const employerNssf = resolveEmployerNssfUsd(b);
  const ctx = b.reviewContext;
  const assumedWageKhr =
    ctx?.nssfAssumedWageKhr ??
    (b.nssfDetail?.assumedWageKhr != null && Number(b.nssfDetail.assumedWageKhr) > 0
      ? Math.round(Number(b.nssfDetail.assumedWageKhr))
      : null);
  const totalEmployerCostUsd =
    ctx?.totalEmployerCostUsd != null && ctx.totalEmployerCostUsd > 0
      ? roundUsd(ctx.totalEmployerCostUsd)
      : roundUsd(gross + employerNssf);
  const jobTitle =
    ctx?.positionTitle || b.reviewSnapshot?.positionTitle || profile.positionTitle || '—';
  const scheduled = metrics.scheduledWorkingDays;
  const paid = metrics.paidDays;
  const prorationPct =
    ctx?.prorationPct ??
    (scheduled > 0 ? Math.round((paid / scheduled) * 100) : 100);
  const prorationLabel =
    ctx?.prorationLabel ??
    (scheduled > 0 ? `${paid}/${scheduled} · ${prorationPct}%` : `${paid} · ${prorationPct}%`);

  const priorMonthNetUsd = readPriorMonthNet(ctx);
  const netUsd = roundUsd(net);
  const netChangeVsPriorMonthUsd =
    ctx?.netChangeVsPriorMonthUsd ??
    (priorMonthNetUsd != null ? roundUsd(netUsd - priorMonthNetUsd) : null);
  const netChangeVsPriorMonthPct =
    ctx?.netChangeVsPriorMonthPct ??
    (priorMonthNetUsd != null && priorMonthNetUsd > 0 && netChangeVsPriorMonthUsd != null
      ? Math.round((netChangeVsPriorMonthUsd / priorMonthNetUsd) * 1000) / 10
      : priorMonthNetUsd === 0 && netUsd > 0
        ? 100
        : null);

  return {
    id: item.id,
    userId: item.userId,
    employeeName: profile.displayName,
    jobTitle,
    bankDisplay: formatBankDisplay(profile),
    base,
    proratedPay,
    proratedDays: metrics.paidDays,
    scheduledWorkingDays: metrics.payrollBasisDays,
    payrollBasisDays: metrics.payrollBasisDays,
    presentDays: metrics.presentDays,
    paidLeaveDays: metrics.paidLeaveDays,
    unpaidLeaveDays: metrics.unpaidLeaveDays,
    absentDays: metrics.absentDays,
    totalPaidDays: metrics.paidDays,
    totalWorkHours: metrics.totalWorkHours,
    standardHoursPerDay: metrics.standardHoursPerDay,
    hourlyRate: metrics.hourlyRate,
    dailyRate: metrics.dailyRate,
    dependents: depRelief.dependents,
    dependentRelief: depRelief.reliefUsd,
    taxableBase: depRelief.taxableBaseUsd,
    transport,
    meal,
    attendanceBonus,
    seniority,
    position,
    commission,
    otMeal,
    seniorityIndemnity,
    backPayment,
    allowanceTotal,
    otHours150: ot.hours150,
    otHours200: ot.hours200,
    otAmount150: ot.amount150,
    otAmount200: ot.amount200,
    otTotal: ot.total,
    gross,
    taxRatePct,
    employerNssf,
    nssf: ded.nssf,
    tax: ded.taxOnSalary,
    absences: ded.absences,
    advances: ded.advances,
    otherDeductions,
    deductionsTotal: roundUsd(deductionsTotal),
    net: roundUsd(net),
    netKhr: b.netSalaryKHR ?? usdToKhr(net, exchangeRate),
    exchangeRate: ctx?.exchangeRate ?? exchangeRate,
    departmentId: ctx?.departmentId ?? profile.departmentId ?? '',
    departmentName: ctx?.departmentName ?? profile.departmentName ?? '—',
    taxId: ctx?.taxId ?? profile.taxId ?? '—',
    nssfId: ctx?.nssfId ?? profile.nssfId ?? '—',
    nssfAssumedWageKhr: assumedWageKhr,
    totalEmployerCostUsd,
    paymentStatus: item.paymentStatus ?? null,
    prorationLabel,
    prorationPct,
    employmentFlags: readEmploymentFlags(ctx),
    priorMonthNetUsd,
    netChangeVsPriorMonthUsd,
    netChangeVsPriorMonthPct,
    netChangedSincePreviousRun: ctx?.netChangedSincePreviousRun ?? false,
    attendanceFinalized:
      ctx?.attendanceFinalized ??
      ['FINALIZED', 'LOCKED'].includes(
        String(b.hybrid?.attendancePeriodStatus ?? '').toUpperCase()
      ),
  };
}

export function sumPayrollRows(rows: PayrollItemRow[]): PayrollItemRow {
  const fx = resolveExchangeRateKhrPerUsd(rows[0]?.exchangeRate, 'active');
  /** Sum real USD only — coerce any leftover KHR-scale values before aggregating. */
  const sumUsd = (fn: (r: PayrollItemRow) => number) =>
    roundUsd(
      rows.reduce((acc, r) => {
        const rate = resolveExchangeRateKhrPerUsd(r.exchangeRate || fx, 'active');
        return acc + coercePayrollUsdAmount(fn(r), rate);
      }, 0)
    );
  const sum = (fn: (r: PayrollItemRow) => number) =>
    rows.reduce((acc, r) => acc + fn(r), 0);
  const gross = sumUsd((r) => r.gross);
  const nssf = sumUsd((r) => r.nssf);
  const tax = sumUsd((r) => r.tax);
  const absences = sumUsd((r) => r.absences);
  const advances = sumUsd((r) => r.advances);
  const otherDeductions = sumUsd((r) => r.otherDeductions);
  // Rebuild from coerced parts so TOTALS never inherit a mixed KHR grand total.
  const deductionsTotal = roundUsd(nssf + tax + absences + advances);
  const net = roundUsd(Math.max(0, gross - deductionsTotal));
  return {
    id: 'totals',
    userId: '',
    employeeName: 'TOTALS',
    jobTitle: '',
    bankDisplay: '',
    base: sumUsd((r) => r.base),
    proratedPay: sumUsd((r) => r.proratedPay),
    proratedDays: sum((r) => r.totalPaidDays),
    scheduledWorkingDays: 0,
    payrollBasisDays: 0,
    presentDays: sum((r) => r.presentDays),
    paidLeaveDays: sum((r) => r.paidLeaveDays),
    unpaidLeaveDays: sum((r) => r.unpaidLeaveDays),
    absentDays: sum((r) => r.absentDays),
    totalPaidDays: sum((r) => r.totalPaidDays),
    totalWorkHours: Math.round(sum((r) => r.totalWorkHours) * 100) / 100,
    standardHoursPerDay: 0,
    hourlyRate: 0,
    dailyRate: 0,
    dependents: 0,
    dependentRelief: sumUsd((r) => r.dependentRelief),
    taxableBase: sumUsd((r) => r.taxableBase),
    transport: sumUsd((r) => r.transport),
    meal: sumUsd((r) => r.meal),
    attendanceBonus: sumUsd((r) => r.attendanceBonus),
    seniority: sumUsd((r) => r.seniority),
    position: sumUsd((r) => r.position),
    commission: sumUsd((r) => r.commission),
    otMeal: sumUsd((r) => r.otMeal),
    seniorityIndemnity: sumUsd((r) => r.seniorityIndemnity),
    backPayment: sumUsd((r) => r.backPayment),
    allowanceTotal: sumUsd((r) => r.allowanceTotal),
    otHours150: Math.round(sum((r) => r.otHours150) * 100) / 100,
    otHours200: Math.round(sum((r) => r.otHours200) * 100) / 100,
    otAmount150: sumUsd((r) => r.otAmount150),
    otAmount200: sumUsd((r) => r.otAmount200),
    otTotal: sumUsd((r) => r.otTotal),
    gross,
    taxRatePct: 0,
    employerNssf: sumUsd((r) => r.employerNssf),
    nssf,
    tax,
    absences,
    advances,
    otherDeductions,
    deductionsTotal,
    net,
    netKhr: Math.round(sum((r) => r.netKhr)),
    exchangeRate: fx,
    departmentId: '',
    departmentName: '',
    taxId: '',
    nssfId: '',
    nssfAssumedWageKhr: null,
    totalEmployerCostUsd: sumUsd((r) => r.totalEmployerCostUsd),
    paymentStatus: null,
    prorationLabel: '',
    prorationPct: 0,
    employmentFlags: [],
    priorMonthNetUsd: null,
    netChangeVsPriorMonthUsd: null,
    netChangeVsPriorMonthPct: null,
    netChangedSincePreviousRun: false,
    attendanceFinalized: false,
  };
}

export const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const hours = (n: number) => n.toFixed(1);
/** Signed money for earnings (+) / legacy deductions. Zeros render as plain `0` (no `$`, no sign). */
export const signedMoney = (n: number, sign: '+' | '-' | '') =>
  n !== 0 ? `${sign}${money(n)}` : '0';
/** Deduction columns: positive display amount, no leading minus (use red cell styling). */
export const deductionMoney = (n: number) => (n !== 0 ? money(Math.abs(n)) : '0');
