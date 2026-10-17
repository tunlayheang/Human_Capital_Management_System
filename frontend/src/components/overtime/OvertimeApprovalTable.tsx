import React, { useMemo, useState } from 'react';
import { Badge } from '../ui/Badge';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import type { OvertimeRequest, Role, User } from '../../types';
import { StatusLabel } from '../ui/StatusLabel';
import { formatOvertimeStatusLabel, overtimeRateLabel } from '../../utils/overtimeLabels';
import { useLanguage } from '../../context/LanguageContext';
import { userDisplayEmployeeCode, userDisplayName } from '../../utils/userProfile';
import {
  localizedLabelUsesKhmerFont,
  resolveOvertimeRequestTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import {
  EmployeeListIdentityBlock,
  EmployeeListIdentityCells,
  employeeListIdentityFromUser,
} from '../employee/EmployeeListIdentity';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../../utils/listColumnSort';
import { Check, RotateCcw, X, FileText } from 'lucide-react';
import { OvertimeRequestViewModal } from './OvertimeRequestViewModal';
import { resolveOvertimeApprovalSteps } from '../../utils/workflowRequestApproval';
import {
  RequestStatusWithApprovalChain,
  WorkflowRequestApprovalTracker,
} from '../workflow/WorkflowRequestApprovalTracker';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import {
  approveReviewPrompt,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';
import {
  FilterMenuDateRange,
  FilterMenuRadioGroup,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { ListSearchFilterBar } from '../ui/page';
import { RulesConfigHelp } from '../ui/RulesConfigHelp';
import type { RulesConfigHelpId } from '../../content/rulesConfigHelpContent';
import {
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';

type FilterMode = 'pending' | 'all';

type SortCol = 'id' | 'name' | 'date' | 'type' | 'hours' | 'rate' | 'reason' | 'status';

const otApprovalThClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-bold uppercase text-slate-500';

type Props = {
  requests: OvertimeRequest[];
  usersMap: Record<string, User>;
  onApprove: (id: string, notes: string) => Promise<void>;
  onReturn: (id: string, notes: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  title?: string;
  /** Hide the in-panel title when the parent page already shows a tab header. */
  hideTitle?: boolean;
  defaultFilterMode?: FilterMode;
  pendingCount?: number;
  currentUserId?: string;
  currentUserRole?: Role | string;
  /** Optional rules-help control shown next to the filter (not overlaid). */
  help?: RulesConfigHelpId;
};

export const OvertimeApprovalTable: React.FC<Props> = ({
  requests,
  usersMap,
  onApprove,
  onReturn,
  onReject,
  title = 'OT Approval',
  hideTitle = false,
  defaultFilterMode = 'all',
  pendingCount,
  currentUserId,
  help,
}) => {
  const { language } = useLanguage();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>(defaultFilterMode);
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  const [viewRequest, setViewRequest] = useState<OvertimeRequest | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const pendingTotal = pendingCount ?? requests.filter((r) => r.status === 'PENDING').length;

  const runApprove = async (requestId: string) => {
    const notes = asPromptReason(await prompt(approveReviewPrompt('overtime')));
    if (notes === null) return;
    setActing(requestId);
    try {
      await onApprove(requestId, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const runReturn = async (requestId: string) => {
    const notes = asPromptReason(await prompt(returnReviewPrompt('overtime')));
    if (notes === null) return;
    setActing(requestId);
    try {
      await onReturn(requestId, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const runReject = async (requestId: string) => {
    const notes = asPromptReason(await prompt(rejectReviewPrompt('overtime')));
    if (notes === null) return;
    setActing(requestId);
    try {
      await onReject(requestId, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: filterMode, defaultValue: defaultFilterMode }]) +
      countDateRangeFilters(dateRange),
    [filterMode, defaultFilterMode, dateRange]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (filterMode === 'pending' && r.status !== 'PENDING') return false;
      if (!recordMatchesDateRange(r.workDate, dateRange)) return false;
      if (!term) return true;
      const u = usersMap[r.userId];
      const name = userDisplayName(u, language).toLowerCase();
      const empCode = userDisplayEmployeeCode(u).toLowerCase();
      return (
        name.includes(term) ||
        (empCode !== '—' && empCode.includes(term)) ||
        r.workDate.includes(term) ||
        (r.reason || '').toLowerCase().includes(term) ||
        (r.otTypeName || '').toLowerCase().includes(term)
      );
    });
  }, [requests, search, filterMode, dateRange, usersMap, language]);

  const sorted = useMemo(() => {
    const getSortValue = (request: OvertimeRequest, col: SortCol): string | number => {
      const u = usersMap[request.userId];
      switch (col) {
        case 'id':
          return userDisplayEmployeeCode(u);
        case 'name':
          return userDisplayName(u, language);
        case 'date':
          return String(request.workDate ?? '');
        case 'type':
          return resolveOvertimeRequestTypeLabel(request, language);
        case 'hours':
          return request.hours;
        case 'rate':
          return overtimeRateLabel(request.rateTier);
        case 'reason':
          return request.reason ?? '';
        case 'status':
          return formatOvertimeStatusLabel(request.status, request);
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: OvertimeRequest[]) =>
      rows.sort(
        (a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime()
      );
    return sortRowsByColumn(filtered, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [filtered, sortBy, sortOrder, usersMap, language]);

  const {
    pageItems: pagedRequests,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sorted,
    undefined,
    `${search}|${filterMode}|${dateRange.from}|${dateRange.to}|${sortBy}|${sortOrder}`
  );

  const handleExport = async (format: ExportFileExt) => {
    await exportListTable(format, {
      module: 'Overtime_Approvals',
      reportTitle: title,
      sheetName: 'Overtime Approvals',
      rows: filtered,
      metadata: [
        { label: 'Rows', value: filtered.length },
        { label: 'Search', value: search || 'All requests' },
        { label: 'Filter mode', value: filterMode },
        { label: 'Date from', value: dateRange.from || 'Any' },
        { label: 'Date to', value: dateRange.to || 'Any' },
      ],
      columns: [
        { header: 'User ID', value: (row) => row.userId, width: 16 },
        { header: 'Employee Code', value: (row) => userDisplayEmployeeCode(usersMap[row.userId]), width: 16 },
        { header: 'Employee Name', value: (row) => userDisplayName(usersMap[row.userId], language), width: 24 },
        { header: 'Work Date', value: (row) => formatDateOnlyDisplay(row.workDate), width: 14 },
        { header: 'Type', value: (row) => resolveOvertimeRequestTypeLabel(row, language), width: 18 },
        { header: 'Hours', value: (row) => row.hours, width: 12 },
        { header: 'Rate', value: (row) => overtimeRateLabel(row.rateTier), width: 14 },
        { header: 'Reason', value: (row) => row.reason || '', width: 28 },
        { header: 'Status', value: (row) => formatOvertimeStatusLabel(row.status, row), width: 16 },
      ],
    });
  };

  return (
    <div className="space-y-4">
      <ConfirmDialogHost />
      {!hideTitle && (
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">
          {title} ({filtered.length})
        </h3>
      )}

      <ListSearchFilterBar
        leading={
          <ExportFormatMenu
            formats={['csv', 'xlsx']}
            disabled={filtered.length === 0}
            onExport={handleExport}
          />
        }
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, employee ID, date…"
        filter={
          <PageFilterMenu
            activeCount={filterActiveCount}
            onClear={() => {
              setFilterMode(defaultFilterMode);
              setDateRange(EMPTY_DATE_RANGE);
              resetSort();
            }}
          >
            <FilterMenuDateRange
              from={dateRange.from}
              to={dateRange.to}
              onChange={setDateRange}
              fromLabel="Work date from"
              toLabel="Work date to"
            />
            <FilterMenuRadioGroup
              label="Show"
              value={filterMode}
              onChange={(value) => setFilterMode(value as FilterMode)}
              options={[
                { value: 'pending', label: `Pending (${pendingTotal})` },
                { value: 'all', label: 'All requests' },
              ]}
              defaultValue={defaultFilterMode}
            />
          </PageFilterMenu>
        }
        trailing={
          help ? (
            <RulesConfigHelp
              help={help}
              className="h-10 w-10 shrink-0 rounded-full border border-slate-200/90 bg-white text-sm font-semibold text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 dark:border-slate-600/75 dark:bg-slate-800/95 dark:text-slate-400 dark:hover:bg-slate-700/90 dark:hover:text-slate-200"
            />
          ) : null
        }
      />

      <div className="surface-card shadow-sm overflow-hidden">
        <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-500">
              {filterMode === 'pending'
                ? 'No pending overtime approvals'
                : 'No overtime approvals found'}
            </div>
          ) : (
            pagedRequests.map((r) => {
              const u = usersMap[r.userId];
              const chain = r.assignedApprovers ?? [];
              const hasChain = chain.length > 0;
              const isCurrentApprover =
                hasChain &&
                !!currentUserId &&
                String(r.currentApproverUserId ?? '') === String(currentUserId);
              const canAct =
                r.status === 'PENDING' && (hasChain ? isCurrentApprover : true);
              const approvalSteps = resolveOvertimeApprovalSteps(r, usersMap);
              const statusLabel = formatOvertimeStatusLabel(r.status, r);
              const typeLabel = resolveOvertimeRequestTypeLabel(r, language);
              return (
                <div key={r.id} className="p-3 sm:p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <EmployeeListIdentityBlock
                      className="flex-1 min-w-0"
                      data={employeeListIdentityFromUser(u)}
                      showSubtitle
                      compactOnMobile
                    />
                    <ResponsiveRowActions
                      mode="menu"
                      menuLabel="Actions"
                      actions={[
                        {
                          key: 'view',
                          label: 'View detail',
                          icon: <FileText className="w-4 h-4" />,
                          onClick: () => setViewRequest(r),
                        },
                        ...(canAct
                          ? [
                              {
                                key: 'return',
                                label: 'Return',
                                icon: <RotateCcw className="w-4 h-4" />,
                                disabled: !!acting,
                                onClick: () => void runReturn(r.id),
                              },
                              {
                                key: 'reject',
                                label: 'Reject',
                                icon: <X className="w-4 h-4" />,
                                disabled: !!acting,
                                destructive: true,
                                onClick: () => void runReject(r.id),
                              },
                              {
                                key: 'approve',
                                label: 'Approve',
                                icon: <Check className="w-4 h-4" />,
                                disabled: !!acting,
                                onClick: () => void runApprove(r.id),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <StatusLabel
                      status={r.status}
                      context="overtime"
                      label={statusLabel}
                      size="sm"
                    />
                    {approvalSteps.length > 0 ? (
                      <WorkflowRequestApprovalTracker
                        steps={approvalSteps}
                        compact
                        viewerUserId={currentUserId}
                      />
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <div className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Date</dt>
                      <dd className="mt-0.5 text-slate-700 dark:text-slate-200">
                        {formatDateOnlyDisplay(r.workDate)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</dt>
                      <dd
                        className={cn(
                          'mt-0.5 break-words text-slate-700 dark:text-slate-200',
                          localizedLabelUsesKhmerFont(r.otTypeName, r.otTypeNameKh, language) &&
                            'font-khmer'
                        )}
                        title={typeLabel}
                      >
                        {typeLabel}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hours</dt>
                      <dd className="mt-0.5 tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                        {r.hours}h
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rate</dt>
                      <dd className="mt-0.5">
                        <Badge
                          variant="neutral"
                          className="max-w-full whitespace-normal text-left text-[10px] leading-snug px-1.5 py-0.5"
                        >
                          {overtimeRateLabel(r.rateTier)}
                        </Badge>
                      </dd>
                    </div>
                    {r.reason ? (
                      <div className="min-w-0 col-span-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Reason</dt>
                        <dd className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-300" title={r.reason}>
                          {r.reason}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <SortableTableHeader
                  label="ID"
                  column="id"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={`${otApprovalThClass} whitespace-nowrap`}
                />
                <SortableTableHeader
                  label="Employee"
                  column="name"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Date"
                  column="date"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Type"
                  column="type"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Hours"
                  column="hours"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Rate"
                  column="rate"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Reason"
                  column="reason"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <SortableTableHeader
                  label="Status"
                  column="status"
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onToggle={toggleSort}
                  className={otApprovalThClass}
                />
                <th className={otApprovalThClass}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                    {filterMode === 'pending'
                      ? 'No pending overtime approvals'
                      : 'No overtime approvals found'}
                  </td>
                </tr>
              ) : (
                pagedRequests.map((r) => {
                  const u = usersMap[r.userId];
                  const chain = r.assignedApprovers ?? [];
                  const hasChain = chain.length > 0;
                  const isCurrentApprover =
                    hasChain &&
                    !!currentUserId &&
                    String(r.currentApproverUserId ?? '') === String(currentUserId);
                  const canAct =
                    r.status === 'PENDING' &&
                    (hasChain ? isCurrentApprover : true);
                  const approvalSteps = resolveOvertimeApprovalSteps(r, usersMap);
                  const statusLabel = formatOvertimeStatusLabel(r.status, r);
                  return (
                  <tr key={r.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                    <EmployeeListIdentityCells
                      data={employeeListIdentityFromUser(u)}
                      idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap"
                      identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2"
                      showSubtitle
                    />
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">{formatDateOnlyDisplay(r.workDate)}</td>
                    <td
                      className={cn(
                        'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400',
                        localizedLabelUsesKhmerFont(r.otTypeName, r.otTypeNameKh, language) &&
                          'font-khmer'
                      )}
                    >
                      {resolveOvertimeRequestTypeLabel(r, language)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm tabular-nums font-semibold">{r.hours}h</td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                      <Badge variant="neutral">{overtimeRateLabel(r.rateTier)}</Badge>
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 max-w-xs truncate text-xs sm:text-sm text-slate-600" title={r.reason}>
                      {r.reason}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 align-top">
                      <RequestStatusWithApprovalChain
                        viewerUserId={currentUserId}
                        steps={approvalSteps}
                        statusNode={
                          <StatusLabel
                            status={r.status}
                            context="overtime"
                            label={statusLabel}
                            size="sm"
                          />
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                      <ResponsiveRowActions
                        className="w-full"
                        menuLabel="Actions"
                        actions={[
                          {
                            key: 'view',
                            label: 'View detail',
                            icon: <FileText className="w-4 h-4" />,
                            onClick: () => setViewRequest(r),
                          },
                          ...(canAct
                            ? [
                                {
                                  key: 'return',
                                  label: 'Return',
                                  icon: <RotateCcw className="w-4 h-4" />,
                                  disabled: !!acting,
                                  onClick: () => void runReturn(r.id),
                                },
                                {
                                  key: 'reject',
                                  label: 'Reject',
                                  icon: <X className="w-4 h-4" />,
                                  disabled: !!acting,
                                  destructive: true,
                                  onClick: () => void runReject(r.id),
                                },
                                {
                                  key: 'approve',
                                  label: 'Approve',
                                  icon: <Check className="w-4 h-4" />,
                                  disabled: !!acting,
                                  onClick: () => void runApprove(r.id),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <ListPagination
          from={showingFrom}
          to={showingTo}
          total={totalCount}
          itemLabel="requests"
          currentPage={currentPage}
          totalPages={totalPages}
          pagesWindow={pagesWindow}
          onPageChange={setCurrentPage}
        />
      </div>

      <OvertimeRequestViewModal
        isOpen={Boolean(viewRequest)}
        onClose={() => setViewRequest(null)}
        request={viewRequest}
        usersMap={usersMap}
      />
    </div>
  );
};
