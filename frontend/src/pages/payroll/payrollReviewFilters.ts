import type { EmploymentReviewFlag, Payslip, PayrollPaymentStatus } from '../../types';
import type { PayrollItemRow } from './payrollItemRows';
import { employeeSearchHaystack, matchesEmployeeSearch } from '../../utils/employeeSearchText';

export type PayrollReviewViewMode = 'detailed' | 'simple';

export type PayrollReviewFilterState = {
  viewMode: PayrollReviewViewMode;
  changedOnly: boolean;
  departmentId: string;
  search: string;
};

export const DEFAULT_PAYROLL_REVIEW_FILTERS: PayrollReviewFilterState = {
  viewMode: 'detailed',
  changedOnly: false,
  departmentId: '',
  search: '',
};

const FLAG_LABELS: Record<EmploymentReviewFlag, string> = {
  new_hire: 'New hire',
  mid_month_join: 'Mid-month join',
  resigning: 'Resigning',
  final_settlement_overlap: 'Final settlement',
};

export function employmentFlagLabel(flag: EmploymentReviewFlag): string {
  return FLAG_LABELS[flag] ?? flag;
}

const PAYMENT_STATUS_LABELS: Record<PayrollPaymentStatus, string> = {
  pending: 'Pending',
  exported: 'Exported',
  paid: 'Paid',
};

export function paymentStatusLabel(status: PayrollPaymentStatus | null | undefined): string {
  if (!status) return '—';
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function paymentStatusBadgeVariant(
  status: PayrollPaymentStatus | null | undefined
): 'neutral' | 'info' | 'warning' | 'success' {
  if (status === 'paid') return 'success';
  if (status === 'exported') return 'info';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

export function formatNetDelta(usd: number | null | undefined, pct: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  const sign = usd > 0 ? '+' : '';
  const pctPart =
    pct != null && Number.isFinite(pct) ? ` (${sign}${pct}%)` : '';
  return `${sign}$${Math.abs(usd).toFixed(2)}${pctPart}`;
}

export function rowMatchesChangedFilter(row: PayrollItemRow, changedOnly: boolean): boolean {
  if (!changedOnly) return true;
  return row.netChangedSincePreviousRun || Math.abs(row.netChangeVsPriorMonthUsd ?? 0) >= 0.01;
}

export function filterPayrollReviewItems(
  items: Payslip[],
  rowsById: Map<string, PayrollItemRow>,
  filters: PayrollReviewFilterState
): Payslip[] {
  return items.filter((item) => {
    const row = rowsById.get(item.id);
    if (!row) return true;
    if (filters.departmentId && row.departmentId !== filters.departmentId) return false;
    if (!rowMatchesChangedFilter(row, filters.changedOnly)) return false;
    if (filters.search.trim()) {
      const haystack = employeeSearchHaystack([
        row.employeeName,
        row.departmentName,
        row.jobTitle,
        row.bankDisplay,
        row.taxId,
        row.nssfId,
        item.employeeId,
        row.userId,
      ]);
      if (!matchesEmployeeSearch(haystack, filters.search)) return false;
    }
    return true;
  });
}

export function collectDepartmentOptions(rows: PayrollItemRow[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.departmentId || row.departmentId === '—') continue;
    map.set(row.departmentId, row.departmentName || row.departmentId);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
