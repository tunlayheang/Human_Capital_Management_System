import React, { forwardRef } from 'react';
import { AlertTriangle, Building2 } from 'lucide-react';
import type { Payslip, SalaryBreakdown } from '../../types';
import {
  attendanceMetricsFromBreakdown,
  inferContractBaseSalary,
  resolveDependentReliefFromBreakdown,
  resolveOvertimeFromBreakdown,
} from '../../pages/payroll/payrollBreakdownEnrichment';
import { resolveDeductionsFromBreakdown } from '../../pages/payroll/payrollDeductionResolve';
import { usePortalBranding } from '../../services/portalBranding';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { formatKhr, formatUsd } from '../../utils/payrollBreakdown';
import type { PayrollDisplayCurrency } from '../../utils/payrollCurrencyDisplay';
import { marginalTaxRateForTaxableBase } from '../../utils/payrollTaxRate';
import { usdToKhr } from '../../utils/payrollRulesCurrency';
import { StatusLabel } from '../ui/StatusLabel';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

type MoneyFormatter = (usd: number, khr?: number | null, rate?: number) => string;

export type EmployeePayslipDocumentProps = {
  payslip: Payslip;
  employeeName: string;
  employeeCode: string;
  position: string;
  departmentName?: string | null;
  displayCurrency: PayrollDisplayCurrency;
  money: MoneyFormatter;
  payslipFooter?: string;
};

type LineRow = { label: string; amount: number; note?: string };

const ALLOWANCE_LABELS: Record<string, string> = {
  transport: 'Transport allowance',
  attendance: 'Attendance allowance',
  meal: 'Meal allowance',
  seniority: 'Seniority allowance',
  position: 'Position allowance',
  commission: 'Commission',
  otMeal: 'OT meal allowance',
};

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatPayPeriod(month: string): string {
  const trimmed = month.trim();
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) return trimmed || '—';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatShortDate(value: string | null | undefined): string {
  return formatDateOnlyDisplay(value);
}

function maskBankAccount(account: string | null | undefined): string {
  const raw = String(account ?? '').trim();
  if (!raw) return '—';
  if (raw.length <= 4) return raw;
  return `•••• ${raw.slice(-4)}`;
}

function formatPaymentMethod(
  method: string | null | undefined,
  bankName: string | null | undefined,
  bankAccount: string | null | undefined
): string {
  const m = String(method ?? '').trim().toLowerCase();
  if (m && m !== 'bank') {
    return m.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (bankName && bankAccount) {
    return `${bankName} · ${maskBankAccount(bankAccount)}`;
  }
  if (bankName) return bankName;
  if (bankAccount) return maskBankAccount(bankAccount);
  return '—';
}

function payslipReference(payslip: Payslip): string {
  const code = payslip.employeeId?.trim() || 'EMP';
  const month = payslip.month?.replace(/-/g, '') || '000000';
  const tail = payslip.id.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
  return `${code}-${month}-${tail}`;
}

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function buildEarningsRows(b: SalaryBreakdown): LineRow[] {
  const rows: LineRow[] = [];
  const ctx = b.reviewContext;
  const contractBase = inferContractBaseSalary(b);
  const metrics = attendanceMetricsFromBreakdown(b);
  const payableDays = ctx?.payableDays ?? b.proratedDays ?? metrics.paidDays;
  const basisDays = ctx?.scheduledWorkingDays ?? metrics.payrollBasisDays;
  const prorationPct = ctx?.prorationPct;
  const prorationNoteParts: string[] = [];
  if (contractBase > 0 && contractBase !== b.baseSalary) {
    prorationNoteParts.push(`Contract ${fmtUsd(contractBase)}`);
  }
  if (payableDays != null && basisDays > 0) {
    prorationNoteParts.push(`${payableDays}/${basisDays} payable days`);
  } else if (b.proratedDays > 0) {
    prorationNoteParts.push(`${b.proratedDays} payable days`);
  }
  if (prorationPct != null && prorationPct > 0 && prorationPct < 100) {
    prorationNoteParts.push(`${prorationPct.toFixed(1)}% proration`);
  }
  if (ctx?.prorationLabel?.trim()) {
    prorationNoteParts.push(ctx.prorationLabel.trim());
  } else if (b.hybrid?.fixed?.prorationReason?.trim()) {
    prorationNoteParts.push(b.hybrid.fixed.prorationReason.trim());
  }

  rows.push({
    label: 'Base salary (prorated)',
    amount: b.baseSalary,
    note: prorationNoteParts.length > 0 ? prorationNoteParts.join(' · ') : undefined,
  });

  if ((b.seniorityIndemnity ?? 0) > 0) {
    rows.push({
      label: 'Siniority',
      amount: b.seniorityIndemnity!,
      note: 'Semi-annual · Labor Law Art. 89',
    });
  }

  if ((b.backPayment ?? 0) !== 0) {
    rows.push({
      label: 'Back payment',
      amount: b.backPayment!,
      note: b.backPaymentSourceMonth
        ? `From ${formatPayPeriod(b.backPaymentSourceMonth)} (approved adjustments)`
        : 'Approved prior-month adjustments',
    });
  }

  if (Array.isArray(b.allowanceLines) && b.allowanceLines.length > 0) {
    for (const line of b.allowanceLines) {
      if (line.amount <= 0) continue;
      if (String(line.code).toUpperCase() === 'OT_MEAL') continue;
      rows.push({
        label: line.name || line.code,
        amount: line.amount,
        note: b.allowancePackageName ? `Package: ${b.allowancePackageName}` : undefined,
      });
    }
  } else if (b.allowances) {
    for (const [key, value] of Object.entries(b.allowances)) {
      if (!value || value <= 0) continue;
      if (key === 'otMeal') continue;
      rows.push({
        label: ALLOWANCE_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').trim(),
        amount: value,
        note:
          key === 'transport' || key === 'meal'
            ? 'Non-taxable'
            : b.allowancePackageName
              ? `Package: ${b.allowancePackageName}`
              : undefined,
      });
    }
  }

  const ot = resolveOvertimeFromBreakdown(b);
  if (ot.amount100 > 0) {
    rows.push({
      label: 'Overtime (100%)',
      amount: ot.amount100,
      note: ot.hours100 > 0 ? `${ot.hours100.toFixed(1)} hrs` : undefined,
    });
  }
  if (ot.amount150 > 0) {
    rows.push({
      label: 'Overtime (150%)',
      amount: ot.amount150,
      note: ot.hours150 > 0 ? `${ot.hours150.toFixed(1)} hrs · Art. 139` : 'Art. 139',
    });
  }
  if (ot.amount200 > 0) {
    rows.push({
      label: 'Overtime (200%)',
      amount: ot.amount200,
      note: ot.hours200 > 0 ? `${ot.hours200.toFixed(1)} hrs · Art. 140` : 'Art. 140',
    });
  }
  if (ot.total > 0 && ot.amount100 <= 0 && ot.amount150 <= 0 && ot.amount200 <= 0) {
    rows.push({
      label: 'Overtime',
      amount: ot.total,
      note:
        ot.hours100 + ot.hours150 + ot.hours200 > 0
          ? `${(ot.hours100 + ot.hours150 + ot.hours200).toFixed(1)} hrs total`
          : undefined,
    });
  }

  return rows;
}

function buildDeductionRows(b: SalaryBreakdown): LineRow[] {
  const rows: LineRow[] = [];
  const resolved = resolveDeductionsFromBreakdown(b);
  const nssf = b.employeeContributionUsd ?? resolved.nssf;
  const tax = b.taxAmountUsd ?? resolved.taxOnSalary;

  if (nssf > 0) {
    const nssfNoteParts: string[] = [];
    if (b.employeeContributionKhr) nssfNoteParts.push(formatKhr(b.employeeContributionKhr));
    if (b.nssfDetail?.assumedWageKhr) {
      nssfNoteParts.push(`Assumed wage ${formatKhr(b.nssfDetail.assumedWageKhr)}`);
    } else if (b.reviewContext?.nssfAssumedWageKhr) {
      nssfNoteParts.push(`Assumed wage ${formatKhr(b.reviewContext.nssfAssumedWageKhr)}`);
    }
    rows.push({
      label: 'NSSF pension (employee 2%)',
      amount: nssf,
      note: nssfNoteParts.length > 0 ? nssfNoteParts.join(' · ') : 'Employee share',
    });
  }

  if (tax > 0) {
    const taxNotes: string[] = [];
    const { taxableBaseUsd, dependents, reliefUsd } = resolveDependentReliefFromBreakdown(b);
    if (taxableBaseUsd > 0) taxNotes.push(`Taxable base ${fmtUsd(taxableBaseUsd)}`);
    if (dependents > 0 && reliefUsd > 0) {
      taxNotes.push(`${dependents} dependent${dependents === 1 ? '' : 's'} · relief ${fmtUsd(reliefUsd)}`);
    }
    if (b.taxMarginalRatePct != null && b.taxMarginalRatePct > 0) {
      taxNotes.push(`Marginal rate ${b.taxMarginalRatePct}%`);
    }
    rows.push({
      label: 'Tax on salary (GDT)',
      amount: tax,
      note: taxNotes.length > 0 ? taxNotes.join(' · ') : undefined,
    });
  }

  if (resolved.unpaidLeave > 0) {
    rows.push({ label: 'Unpaid leave deduction', amount: resolved.unpaidLeave });
  }
  if (resolved.unexcusedAbsence > 0) {
    rows.push({ label: 'Unexcused absence', amount: resolved.unexcusedAbsence });
  }
  if (resolved.latePenalty > 0) {
    rows.push({ label: 'Late penalty', amount: resolved.latePenalty });
  }
  if (resolved.absences > 0 && resolved.unpaidLeave + resolved.unexcusedAbsence + resolved.latePenalty <= 0) {
    rows.push({ label: 'Absence / late deduction', amount: resolved.absences });
  }

  if (resolved.advances > 0) {
    rows.push({ label: 'Salary advance', amount: resolved.advances });
  }

  return rows;
}

function statusLabel(status: Payslip['status']): { text: string; tone: 'published' | 'pending' } {
  if (status === 'APPROVED' || status === 'PAID') {
    return { text: status, tone: 'published' };
  }
  return { text: 'Pending approval', tone: 'pending' };
}

function paymentStatusLabel(status: Payslip['paymentStatus']): string | null {
  if (!status) return null;
  if (status === 'paid') return 'Disbursed';
  if (status === 'exported') return 'Exported for payment';
  return 'Awaiting disbursement';
}

export const EmployeePayslipDocument = forwardRef<HTMLDivElement, EmployeePayslipDocumentProps>(
  function EmployeePayslipDocument(
    { payslip, employeeName, employeeCode, position, departmentName, displayCurrency, money, payslipFooter },
    ref
  ) {
    const { companyName, logo } = usePortalBranding();
    const b = payslip.breakdown;
    if (!b) return null;

    const rate = b.exchangeRateUsed ?? b.exchangeRate;
    const periodLabel = formatPayPeriod(payslip.month);
    const generatedOn = payslip.generatedAt
      ? formatDateOnlyDisplay(payslip.generatedAt)
      : '—';
    const ctx = b.reviewContext;
    const snapshot = b.reviewSnapshot;
    const dept =
      departmentName?.trim() ||
      ctx?.departmentName?.trim() ||
      null;
    const brandName = companyName.trim() || 'ROC HR';
    const logoUrl = logo ? resolveMediaUrl(logo) : null;
    const metrics = attendanceMetricsFromBreakdown(b);
    const contractBase = inferContractBaseSalary(b);
    const taxInfo = resolveDependentReliefFromBreakdown(b);
    const marginalRate =
      b.taxMarginalRatePct ??
      (taxInfo.taxableBaseUsd > 0 ? marginalTaxRateForTaxableBase(taxInfo.taxableBaseUsd) : null);

    const periodStart = b.hybrid?.payPeriodStart ?? null;
    const periodEnd = b.hybrid?.payPeriodEnd ?? null;
    const periodRange =
      periodStart && periodEnd
        ? `${formatShortDate(periodStart)} – ${formatShortDate(periodEnd)}`
        : periodStart
          ? formatShortDate(periodStart)
          : null;
    const attendanceCutoff = b.hybrid?.attendanceCutoffDate ?? null;

    const earningsRows = buildEarningsRows(b);
    const deductionRows = buildDeductionRows(b);
    const resolvedDeductions = resolveDeductionsFromBreakdown(b);
    const totalDeductions =
      deductionRows.reduce((sum, row) => sum + row.amount, 0) ||
      resolvedDeductions.total ||
      b.deductions.total ||
      0;

    const status = statusLabel(payslip.status);
    const isHolding = payslip.disbursementStatus === 'HOLDING';
    const isPaid =
      payslip.disbursementStatus === 'PAID' ||
      (!payslip.disbursementStatus && (payslip.status === 'APPROVED' || payslip.status === 'PAID'));
    const isPublished = isPaid || status.tone === 'published';
    const previewNet = Math.max(0, Math.round((b.grossSalary - totalDeductions) * 100) / 100);
    const previewNetKhr = rate > 0 ? usdToKhr(previewNet, rate) : 0;
    const showPreviewNet = !isPublished && b.netSalary <= 0 && b.grossSalary > 0;
    const displayNetUsd = showPreviewNet ? previewNet : b.netSalary;
    const displayNetKhr = showPreviewNet ? previewNetKhr : b.netSalaryKHR;

    const nssfId = ctx?.nssfId?.trim() || '—';
    const taxId = ctx?.taxId?.trim() || '—';
    const paymentDisplay = formatPaymentMethod(
      snapshot?.paymentMethod ?? ctx?.paymentMethod,
      snapshot?.bankName ?? ctx?.bankName,
      snapshot?.bankAccountNumber ?? ctx?.bankAccountNumber
    );
    const employerNssfUsd =
      b.nssfDetail?.employerNssfUsd ??
      (b.nssfDetail?.employerTotalKhr && rate > 0
        ? b.nssfDetail.employerTotalKhr / rate
        : null);
    const disbursement = isHolding
      ? 'On hold'
      : payslip.disbursementStatus === 'PAID'
        ? 'Paid'
        : paymentStatusLabel(payslip.paymentStatus);

    return (
      <div
        ref={ref}
        className="mx-auto max-w-[760px] rounded-lg bg-white p-6 text-slate-900 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 sm:p-8 print:shadow-none print:ring-0"
      >
        <div className="flex flex-col gap-4 border-b-2 border-slate-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white">
                <Building2 className="h-7 w-7" />
              </div>
            )}
            <div>
              <p className="text-lg font-bold leading-tight">{brandName}</p>
              <p className="text-xs text-slate-500">Official salary statement · Confidential</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-light uppercase tracking-[0.2em] text-slate-400 sm:text-3xl">
              Payslip
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{periodLabel}</p>
            <p className="mt-0.5 text-xs text-slate-500">Issued {generatedOn}</p>
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">Ref {payslipReference(payslip)}</p>
            <StatusLabel
              status={status.tone === 'published' ? 'PAID' : 'PENDING_APPROVAL'}
              context="payroll"
              label={status.text}
              size="sm"
              className="mt-2 uppercase tracking-wide"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3 sm:p-4">
          <DetailCell label="Pay period" value={periodLabel} />
          <DetailCell
            label="Period dates"
            value={periodRange ?? '—'}
          />
          <DetailCell
            label="Attendance cutoff"
            value={attendanceCutoff ? formatShortDate(attendanceCutoff) : '—'}
          />
        </div>

        {!isPublished && !isHolding ? (
          <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Preliminary statement</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                This payslip is awaiting HR approval. Amounts may change before payroll is finalized.
                {showPreviewNet
                  ? ' The estimated net below is calculated from current earnings minus deductions.'
                  : null}
              </p>
            </div>
          </div>
        ) : null}

        {isHolding ? (
          <div className="mt-4 flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Payment on hold</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200/90">
                {payslip.disbursementHoldNote?.trim() ||
                  'Your payslip has been placed on hold by HR. Please contact HR for more information.'}
              </p>
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Employee</p>
            <div>
              <p className="font-semibold text-slate-900">{employeeName}</p>
              <p className="text-sm text-slate-600">{position}</p>
              {dept ? <p className="text-sm text-slate-600">{dept}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
              <DetailCell label="Employee ID" value={employeeCode} />
              <DetailCell label="NSSF ID" value={nssfId} />
              <DetailCell label="Tax ID" value={taxId} />
              <DetailCell label="Dependents" value={String(metrics.dependents)} />
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Payment & attendance
            </p>
            <div className="grid grid-cols-2 gap-3">
              <DetailCell label="Payment method" value={paymentDisplay} />
              <DetailCell
                label="Disbursement"
                value={disbursement ?? (isPublished ? 'Pending transfer' : 'After approval')}
              />
              {b.allowancePackageName ? (
                <DetailCell label="Allowance package" value={b.allowancePackageName} />
              ) : null}
              <DetailCell
                label="Contract base"
                value={contractBase > 0 ? `$${fmtUsd(contractBase)} / month` : '—'}
              />
              <DetailCell
                label="Payable days"
                value={`${ctx?.payableDays ?? b.proratedDays ?? metrics.paidDays} / ${ctx?.scheduledWorkingDays ?? metrics.payrollBasisDays} basis days`}
              />
              <DetailCell label="Present days" value={String(metrics.presentDays)} />
              <DetailCell label="Paid leave" value={String(metrics.paidLeaveDays)} />
              <DetailCell label="Unpaid leave" value={String(metrics.unpaidLeaveDays)} />
              <DetailCell label="Unexcused absent" value={String(metrics.absentDays)} />
              {metrics.overtimeHours > 0 ? (
                <DetailCell label="Overtime hours" value={metrics.overtimeHours.toFixed(1)} />
              ) : null}
              {metrics.totalWorkHours > 0 ? (
                <DetailCell label="Work hours" value={metrics.totalWorkHours.toFixed(1)} />
              ) : null}
              <DetailCell
                label="Attendance status"
                value={
                  ctx?.attendanceFinalized === false
                    ? 'Open'
                    : ctx?.attendanceFinalized
                      ? 'Finalized'
                      : b.hybrid?.attendancePeriodStatus?.replace(/_/g, ' ') ?? '—'
                }
              />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-primary-200 bg-primary-50/70 p-4 sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700/80">
              {showPreviewNet ? 'Estimated net payable' : 'Net payable'}
            </p>
            <p className="mt-1 text-2xl font-bold text-primary-800 sm:text-3xl">
              {money(displayNetUsd, displayNetKhr, rate)}
            </p>
            <p className="text-sm text-primary-700/80">
              {displayCurrency === 'USD'
                ? formatKhr(displayNetKhr)
                : formatUsd(displayNetUsd)}
            </p>
          </div>
          <div className="mt-3 text-left text-xs text-primary-700/70 sm:mt-0 sm:text-right">
            <p>Gross earnings: ${fmtUsd(b.grossSalary)}</p>
            {totalDeductions > 0 ? <p>Total deductions: -${fmtUsd(totalDeductions)}</p> : null}
            {rate > 0 ? <p>Exchange rate: 1 USD = {rate.toLocaleString()} ៛</p> : null}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-100 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Earnings</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 text-right font-semibold">Amount (USD)</th>
                <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Details</th>
              </tr>
            </thead>
            <tbody>
              {earningsRows.map((row) => (
                <tr key={row.label} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{row.label}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">${fmtUsd(row.amount)}</td>
                  <td className="hidden px-3 py-2 text-right text-xs leading-snug text-slate-500 sm:table-cell">
                    {row.note ?? '—'}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-emerald-200 bg-emerald-50 font-semibold">
                <td className="px-3 py-2.5 text-emerald-900">Gross pay</td>
                <td className="px-3 py-2.5 text-right font-mono text-emerald-800">
                  ${fmtUsd(b.grossSalary)}
                </td>
                <td className="hidden px-3 py-2.5 text-right text-xs text-emerald-700 sm:table-cell">
                  {b.allowanceTotalUsd != null && b.allowanceTotalUsd > 0
                    ? `Allowances ${fmtUsd(b.allowanceTotalUsd)} incl.`
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-100 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Deductions</p>
          </div>
          {deductionRows.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount (USD)</th>
                  <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Details</th>
                </tr>
              </thead>
              <tbody>
                {deductionRows.map((row) => (
                  <tr key={row.label} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-700">{row.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-600">
                      -${fmtUsd(row.amount)}
                    </td>
                    <td className="hidden px-3 py-2 text-right text-xs leading-snug text-slate-500 sm:table-cell">
                      {row.note ?? '—'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-rose-200 bg-rose-50 font-semibold">
                  <td className="px-3 py-2.5 text-rose-900">Total deductions</td>
                  <td className="px-3 py-2.5 text-right font-mono text-rose-700">
                    -${fmtUsd(totalDeductions)}
                  </td>
                  <td className="hidden sm:table-cell" />
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-4 text-sm text-slate-500">No deductions applied this period.</p>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-100 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Statutory & tax summary
            </p>
          </div>
          <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
            <DetailCell
              label="Taxable base (USD)"
              value={taxInfo.taxableBaseUsd > 0 ? `$${fmtUsd(taxInfo.taxableBaseUsd)}` : '—'}
            />
            <DetailCell
              label="Dependent relief"
              value={
                taxInfo.reliefUsd > 0
                  ? `$${fmtUsd(taxInfo.reliefUsd)} (${taxInfo.dependents} dependent${taxInfo.dependents === 1 ? '' : 's'})`
                  : taxInfo.dependents > 0
                    ? `${taxInfo.dependents} dependent${taxInfo.dependents === 1 ? '' : 's'} · no relief applied`
                    : '—'
              }
            />
            <DetailCell
              label="Marginal tax rate"
              value={marginalRate != null && marginalRate > 0 ? `${marginalRate}%` : '—'}
            />
            <DetailCell
              label="Tax withheld"
              value={
                (b.taxAmountUsd ?? resolvedDeductions.taxOnSalary) > 0
                  ? `$${fmtUsd(b.taxAmountUsd ?? resolvedDeductions.taxOnSalary)}`
                  : 'None'
              }
            />
            <DetailCell
              label="NSSF employee share"
              value={
                (b.employeeContributionUsd ?? resolvedDeductions.nssf) > 0
                  ? `$${fmtUsd(b.employeeContributionUsd ?? resolvedDeductions.nssf)}`
                  : 'None'
              }
            />
            <DetailCell
              label="NSSF employer share"
              value={
                employerNssfUsd != null && employerNssfUsd > 0
                  ? `$${fmtUsd(employerNssfUsd)} (employer cost)`
                  : ctx?.totalEmployerCostUsd != null && ctx.totalEmployerCostUsd > 0
                    ? `$${fmtUsd(ctx.totalEmployerCostUsd)} total employer cost`
                    : '—'
              }
            />
            {b.taxableIncomeKhr != null && b.taxableIncomeKhr > 0 ? (
              <DetailCell label="Taxable income (KHR)" value={formatKhr(b.taxableIncomeKhr)} />
            ) : null}
            {metrics.dailyRate > 0 ? (
              <DetailCell label="Daily rate (reference)" value={`$${fmtUsd(metrics.dailyRate)}`} />
            ) : null}
            {metrics.hourlyRate > 0 ? (
              <DetailCell label="Hourly rate (reference)" value={`$${fmtUsd(metrics.hourlyRate)}`} />
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-900 px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {showPreviewNet ? 'Estimated take-home pay' : 'Net take-home pay'}
            </p>
            <p className="text-2xl font-bold">{money(displayNetUsd, displayNetKhr, rate)}</p>
            <p className="text-sm text-slate-400">
              {displayCurrency === 'USD'
                ? formatKhr(displayNetKhr)
                : formatUsd(displayNetUsd)}
            </p>
          </div>
          <div className="text-left text-xs leading-relaxed text-slate-400 sm:text-right">
            <p>Gross: ${fmtUsd(b.grossSalary)}</p>
            {totalDeductions > 0 ? <p>Deductions: -${fmtUsd(totalDeductions)}</p> : null}
            <p>Pay period: {periodLabel}</p>
            {periodRange ? <p>Covered: {periodRange}</p> : null}
            <p className="font-mono text-[10px] text-slate-500">Document {payslipReference(payslip)}</p>
          </div>
        </div>

        <p className="mt-5 text-center text-[10px] leading-relaxed text-slate-400">
          {payslipFooter ||
            'This is a system-generated payslip for your records. Cambodia Labor Law 1997 · NSSF Sub-Decree No. 28 · GDT Tax Prakas. Retain for your personal tax and employment records.'}
        </p>
      </div>
    );
  }
);
