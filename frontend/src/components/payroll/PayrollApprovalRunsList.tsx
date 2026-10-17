import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Api } from '../../services/api';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import { Badge } from '../ui/Badge';
import { StatusLabel } from '../ui/StatusLabel';
import { ListSearchFilterBar } from '../ui/page';
import { FilterMenuRadioGroup, PageFilterMenu } from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import type { PayrollPendingApprovalItem } from '../../types';
import { formatRunStatusLabel, normalizePayrollRunStatus } from '../../pages/payroll/payrollUtils';
import { PayrollApprovalTracker, viewerPayrollApproverStep } from './payrollApprovalDisplay';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import { formatPayrollMoney } from '../../utils/payrollCurrencyDisplay';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { LoadingState } from '../common/LoadingState';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';
import {
  SortableTableHeader,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';

type ApprovalRunsSortCol = 'period' | 'employees' | 'netPay' | 'status' | 'approval';

function getApprovalRunSortValue(
  row: PayrollPendingApprovalItem,
  column: ApprovalRunsSortCol,
  t: (key: string) => string
): string | number {
  switch (column) {
    case 'period':
      return row.monthLabel || row.month || '';
    case 'employees':
      return Number(row.totalEmployees ?? 0);
    case 'netPay':
      return Number(row.totalNetPay ?? 0);
    case 'status':
      return formatRunStatusLabel(row.status, t);
    case 'approval':
      if (row.canApproverReview) return 0;
      return row.assignedApprovers?.length ?? 0;
    default:
      return '';
  }
}

const approvalRunsThClass =
  'py-2.5 px-3 font-semibold text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';

type StatusFilter = 'all' | 'action' | 'PENDING_APPROVAL' | 'APPROVED' | 'DRAFT' | 'REJECTED' | 'other';

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'action', label: 'Needs my action' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'other', label: 'Other' },
];

const FINALIZED_STATUSES = new Set([
  'APPROVED',
  'LOCKED',
  'PAYMENT_PROCESSING',
  'PAID',
]);

function matchesStatusFilter(row: PayrollPendingApprovalItem, filter: StatusFilter): boolean {
  const status = normalizePayrollRunStatus(String(row.status ?? ''));
  if (filter === 'all') return true;
  if (filter === 'action') return row.canApproverReview;
  if (filter === 'PENDING_APPROVAL') return status === 'PENDING_APPROVAL';
  if (filter === 'APPROVED') return FINALIZED_STATUSES.has(status);
  if (filter === 'DRAFT') return status === 'DRAFT' || status === 'UNDER_REVIEW';
  if (filter === 'REJECTED') return status === 'REJECTED' || status === 'REVERSED';
  if (filter === 'other') {
    return !['PENDING_APPROVAL', 'DRAFT', 'UNDER_REVIEW', 'REJECTED', 'REVERSED', ...FINALIZED_STATUSES].includes(status);
  }
  return true;
}

function actionHint(row: PayrollPendingApprovalItem, viewerUserId?: string): string | null {
  if (row.canApproverReview) return 'Your approval is required';
  const step = viewerPayrollApproverStep(row, viewerUserId);
  if (step?.phase === 'approved') return 'You signed off — waiting on others';
  if (step?.phase === 'queued') return `Step ${step.stepNumber} of ${step.total} — waiting on earlier approvers`;
  if (row.selfApprovalBlocked) return 'Maker-checker: another approver must sign off';
  return null;
}

type Props = {
  onChanged?: () => void;
  reloadToken?: number;
};

export const PayrollApprovalRunsList: React.FC<Props> = ({ onChanged, reloadToken = 0 }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { currency } = usePreferredCurrency();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PayrollPendingApprovalItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = useCallback(async () => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await Api.payroll.listApprovalBoard();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      showToast('Could not load payroll runs.', 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showToast, user?.id]);

  useEffect(() => {
    void load();
  }, [load, reloadToken, location.pathname]);

  const actionCount = useMemo(() => rows.filter((row) => row.canApproverReview).length, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesStatusFilter(row, statusFilter)) return false;
      if (!q) return true;
      const haystack = [
        row.monthLabel,
        row.month,
        row.runId,
        row.calculatedByName,
        row.status,
        formatRunStatusLabel(row.status, t),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, statusFilter, t]);

  const { sortBy, sortOrder, toggleSort } = useListColumnSort<ApprovalRunsSortCol>();

  const sortedRows = useMemo(
    () =>
      sortRowsByColumn(filteredRows, sortBy, sortOrder, (row, column) =>
        getApprovalRunSortValue(row, column, t)
      ),
    [filteredRows, sortBy, sortOrder, t]
  );

  const activeFilterCount = countActiveFilters([{ value: statusFilter, defaultValue: 'all' }]);

  const openDetail = (row: PayrollPendingApprovalItem) => {
    navigate(`/payroll/approvals/${row.runId}`);
  };

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Payroll_Approval_Runs',
        reportTitle: 'Payroll Approval Runs',
        sheetName: 'Payroll Approvals',
        rows: filteredRows,
        metadata: [
          { label: 'Rows', value: filteredRows.length },
          { label: 'Search', value: search || 'All runs' },
          { label: 'Status', value: statusFilter },
        ],
        columns: [
          { header: 'Run ID', value: (row) => row.runId, width: 18 },
          { header: 'Period', value: (row) => row.monthLabel, width: 18 },
          { header: 'Month Key', value: (row) => row.month, width: 14 },
          { header: 'Calculated At', value: (row) => (row.calculatedAt ? formatDateOnlyDisplay(row.calculatedAt) : ''), width: 16 },
          { header: 'Calculated By', value: (row) => row.calculatedByName ?? '', width: 20 },
          { header: 'Total Employees', value: (row) => row.totalEmployees, width: 14 },
          { header: 'Total Net Pay', value: (row) => row.totalNetPay, width: 16 },
          { header: 'Status', value: (row) => formatRunStatusLabel(row.status, t), width: 18 },
          { header: 'Needs My Review', value: (row) => (row.canApproverReview ? 'Yes' : 'No'), width: 16 },
          { header: 'Self Approval Blocked', value: (row) => (row.selfApprovalBlocked ? 'Yes' : 'No'), width: 18 },
        ],
      });
    },
    [filteredRows, search, statusFilter, t]
  );

  if (loading) {
    return <LoadingState variant="section" layout="cards" rows={2} label="Loading payroll runs…" />;
  }

  return (
    <Card className="surface-card-pad">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {rows.length > 0
              ? `${rows.length} payroll run(s) · ${actionCount} need your action`
              : 'No payroll runs yet.'}
          </p>
        </div>
        {actionCount > 0 ? (
          <Badge variant="warning" className="tabular-nums">
            {actionCount} action
          </Badge>
        ) : null}
      </div>

      <ListSearchFilterBar
        leading={
          <ExportFormatMenu
            formats={['csv', 'xlsx']}
            disabled={filteredRows.length === 0}
            onExport={handleExport}
          />
        }
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search period, run ID, preparer…"
        filter={
          <PageFilterMenu
            activeCount={activeFilterCount}
            title="Filter runs"
            onClear={() => setStatusFilter('all')}
          >
            <FilterMenuRadioGroup
              label="Status"
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              defaultValue="all"
            />
          </PageFilterMenu>
        }
        className="mb-4"
      />

      {sortedRows.length === 0 ? (
        <p className="hcms-empty-state text-sm text-slate-500 dark:text-slate-400 text-center">
          {rows.length === 0
            ? t('approvals.payrollHistoryEmptyAll') ||
              'Payroll runs will appear here once they are calculated and routed for approval.'
            : 'No payroll runs match your filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[720px] text-sm hcms-table-compact">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <SortableTableHeader
                  label="Period"
                  column="period"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={approvalRunsThClass}
                />
                <SortableTableHeader
                  label="Employees"
                  column="employees"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={approvalRunsThClass}
                />
                <SortableTableHeader
                  label="Net pay"
                  column="netPay"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={approvalRunsThClass}
                />
                <SortableTableHeader
                  label="Status"
                  column="status"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={approvalRunsThClass}
                />
                <SortableTableHeader
                  label="Approval"
                  column="approval"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={approvalRunsThClass}
                />
                <th className={`${approvalRunsThClass} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const hint = actionHint(row, user?.id);
                let calculatedLabel = '—';
                if (row.calculatedAt) {
                  try {
                    calculatedLabel = formatDateOnlyDisplay(row.calculatedAt);
                  } catch {
                    calculatedLabel = row.calculatedAt;
                  }
                }
                return (
                  <tr
                    key={row.runId}
                    className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-3 min-w-[10rem]">
                      <p className="font-semibold text-slate-900 dark:text-white">{row.monthLabel}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Calculated {calculatedLabel}
                        {row.calculatedByName ? ` · ${row.calculatedByName}` : ''}
                      </p>
                      {hint ? (
                        <p
                          className={`text-[11px] font-medium mt-1 ${
                            row.canApproverReview
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {hint}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 px-3 tabular-nums text-slate-700 dark:text-slate-200">
                      {row.totalEmployees}
                    </td>
                    <td className="py-3 px-3 font-semibold tabular-nums text-slate-900 dark:text-white">
                      {formatPayrollMoney(row.totalNetPay, { currency })}
                    </td>
                    <td className="py-3 px-3">
                      <StatusLabel
                        status={normalizePayrollRunStatus(row.status)}
                        context="payroll"
                        label={formatRunStatusLabel(row.status, t)}
                        size="sm"
                      />
                    </td>
                    <td className="py-3 px-3 min-w-[12rem]">
                      {row.assignedApprovers?.length ? (
                        <PayrollApprovalTracker row={row} compact viewerUserId={user?.id} />
                      ) : (
                        <span className="text-xs text-slate-400">Not routed</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <ResponsiveRowActions
                        menuLabel="Run actions"
                        actions={[
                          {
                            key: 'view',
                            label: `View ${row.monthLabel}`,
                            icon: <FileText className="w-4 h-4" />,
                            onClick: () => {
                              onChanged?.();
                              openDetail(row);
                            },
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export default PayrollApprovalRunsList;
