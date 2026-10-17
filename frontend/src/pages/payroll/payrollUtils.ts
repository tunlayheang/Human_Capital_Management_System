import type { PayrollRun, Payslip, PayrollReviewContext, SalaryBreakdown } from '../../types';
import { calculatePayrollForUser } from '../../services/cambodiaTax';
import { keysToCamel } from '../../utils';
import {
  enrichPayrollBreakdown,
  type PayslipEnrichContext,
} from './payrollBreakdownEnrichment';
import { reconcilePayrollBreakdown } from './payrollBreakdownReconcile';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import { usdToKhr } from '../../utils/payrollRulesCurrency';

export type { PayslipEnrichContext };

function parseReviewContext(raw: unknown): PayrollReviewContext | undefined {
  if (raw == null) return undefined;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const record = keysToCamel(obj) as Record<string, unknown>;
  const flagsRaw = record.employmentFlags;
  const employmentFlags = Array.isArray(flagsRaw)
    ? (flagsRaw as PayrollReviewContext['employmentFlags'])
    : [];
  const numOrNull = (v: unknown): number | null =>
    v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  return {
    ...(record as unknown as PayrollReviewContext),
    employmentFlags,
    priorMonthNetUsd: numOrNull(record.priorMonthNetUsd),
    netChangeVsPriorMonthUsd: numOrNull(record.netChangeVsPriorMonthUsd),
    netChangeVsPriorMonthPct: numOrNull(record.netChangeVsPriorMonthPct),
    previousRunNetUsd: numOrNull(record.previousRunNetUsd),
    netChangeVsPreviousRunUsd: numOrNull(record.netChangeVsPreviousRunUsd),
    nssfAssumedWageKhr: numOrNull(record.nssfAssumedWageKhr),
    totalEmployerCostUsd: Number(record.totalEmployerCostUsd) || 0,
    contractBaseUsd: Number(record.contractBaseUsd) || 0,
    proratedPayUsd: Number(record.proratedPayUsd) || 0,
    exchangeRate: resolveExchangeRateKhrPerUsd(Number(record.exchangeRate), 'active'),
  };
}

/** Ensure payslip breakdown is camelCase and nested (API/DB may return snake_case or flat). */
export function normalizePayslip(item: Payslip, ctx?: PayslipEnrichContext): Payslip {
  if (!item) return item;
  const raw = item.breakdown as unknown;
  const frozen =
    Boolean((item as Payslip & { readOnly?: boolean }).readOnly) ||
    Boolean(ctx?.frozen) ||
    (ctx?.runStatus ? isFinalizedPayrollStatus(ctx.runStatus) : false);

  if (!raw) {
    if (frozen || !ctx?.user) return item;
    const computed = calculatePayrollForUser(ctx.user, {
      attendanceRecords: ctx.attendanceRecords ?? [],
      monthPrefix: ctx.monthPrefix,
    });
    return {
      ...item,
      breakdown: enrichPayrollBreakdown(computed, ctx),
    };
  }

  let b: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      b = JSON.parse(raw);
    } catch {
      return item;
    }
  } else {
    b = raw as Record<string, unknown>;
  }

  const camel = keysToCamel(b) as SalaryBreakdown;
  const reviewContext = parseReviewContext(
    camel.reviewContext ?? (camel as { reviewContextJson?: unknown }).reviewContextJson ?? b.review_context
  );
  const allowances = camel.allowances ?? {
    transport: 0,
    attendance: 0,
    meal: 0,
    seniority: 0,
  };
  const overtime = camel.overtime ?? {
    hours100: 0,
    amount100: 0,
    hours150: 0,
    amount150: 0,
    hours200: 0,
    amount200: 0,
    total: 0,
  };
  const deductions = camel.deductions ?? {
    nssf: 0,
    taxOnSalary: 0,
    absences: 0,
    advances: 0,
    total: 0,
  };

  const grossSalary =
    camel.grossSalary ??
    (camel.baseSalary ?? 0) +
      (camel.seniorityIndemnity ?? 0) +
      (allowances.transport ?? 0) +
      (allowances.attendance ?? 0) +
      (allowances.meal ?? 0) +
      (allowances.seniority ?? 0) +
      (overtime.total ?? 0);

  const dedTotal =
    deductions.total ??
    (deductions.nssf ?? 0) +
      (deductions.taxOnSalary ?? 0) +
      (deductions.absences ?? 0) +
      (deductions.advances ?? 0);

  const netSalary =
    camel.netSalary ?? Math.max(0, grossSalary - dedTotal);

  const exchangeRate = resolveExchangeRateKhrPerUsd(camel.exchangeRate, 'active');

  const base: SalaryBreakdown = reconcilePayrollBreakdown({
    ...camel,
    reviewContext,
    allowances,
    overtime: {
      ...overtime,
      total:
        overtime.total ??
        (overtime.amount100 ?? 0) + overtime.amount150 + overtime.amount200,
    },
    deductions: {
      ...deductions,
      total: dedTotal,
    },
    grossSalary,
    netSalary,
    exchangeRate,
    netSalaryKHR: camel.netSalaryKHR ?? usdToKhr(netSalary, exchangeRate),
  });

  return {
    ...item,
    breakdown: enrichPayrollBreakdown(base, ctx),
  };
}

const FINALIZED_PAYROLL_STATUSES = new Set([
  'APPROVED',
  'LOCKED',
  'PAYMENT_PROCESSING',
  'PAID',
]);

/** Map legacy DB statuses to canonical workflow statuses. */
export function normalizePayrollRunStatus(status: string): string {
  const s = String(status ?? '').trim().toUpperCase();
  if (s === 'PROCESSING') return 'DRAFT';
  if (s === 'COMPLETED') return 'APPROVED';
  return s;
}

/** True when a payroll run record exists for the period (calculated at least once). */
export function isCalculatedPayrollRunStatus(status: string): boolean {
  const s = normalizePayrollRunStatus(status);
  return s !== 'REJECTED' && s !== 'REVERSED' && s !== 'CANCELLED' && Boolean(s);
}

/**
 * Terminal inactive statuses — period can be calculated again (new run).
 * Cancelled/rejected/reversed runs must not block "Calculate payroll".
 */
export function isInactivePayrollRunStatus(status: string): boolean {
  const s = normalizePayrollRunStatus(status);
  return s === 'CANCELLED' || s === 'REJECTED' || s === 'REVERSED';
}

/** Approved or later — pre-run preview is closed; use the official payroll run record. */
export function isFinalizedPayrollStatus(status: string): boolean {
  return FINALIZED_PAYROLL_STATUSES.has(normalizePayrollRunStatus(status));
}

export function nextPayrollCalendarMonth(year: number, month: number): { year: number; month: number } {
  if (month >= 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

export function payrollRunStatusVariant(
  status: string
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = normalizePayrollRunStatus(status);
  if (s === 'APPROVED' || s === 'PAID') return 'success';
  if (s === 'LOCKED') return 'neutral';
  if (s === 'PENDING_APPROVAL' || s === 'UNDER_REVIEW' || s === 'PAYMENT_PROCESSING') return 'warning';
  if (s === 'DRAFT') return 'info';
  return 'danger';
}

export function formatRunStatusLabel(
  status: string,
  t?: (path: string, vars?: Record<string, string | number>) => string
): string {
  const normalized = normalizePayrollRunStatus(status);
  if (t) {
    const keys: Record<string, string> = {
      UNDER_REVIEW: 'payroll.runStatus.underReview',
      PENDING_APPROVAL: 'payroll.runStatus.pendingApproval',
      APPROVED: 'payroll.runStatus.approved',
      LOCKED: 'payroll.runStatus.locked',
      PAYMENT_PROCESSING: 'payroll.runStatus.paymentProcessing',
      PAID: 'payroll.runStatus.paid',
      DRAFT: 'payroll.runStatus.draft',
      REJECTED: 'payroll.runStatus.rejected',
      REVERSED: 'payroll.runStatus.reversed',
      CANCELLED: 'payroll.runStatus.cancelled',
    };
    const key = keys[normalized];
    if (key) return t(key);
  }
  return normalized.replace(/_/g, ' ');
}

export function payrollRunCalculatedAt(run: Pick<PayrollRun, 'calculatedAt' | 'createdAt'>): string {
  return run.calculatedAt || run.createdAt;
}

export function sortRunsNewestFirst(runs: PayrollRun[]): PayrollRun[] {
  return [...runs].sort(
    (a, b) =>
      new Date(payrollRunCalculatedAt(b)).getTime() - new Date(payrollRunCalculatedAt(a)).getTime()
  );
}
