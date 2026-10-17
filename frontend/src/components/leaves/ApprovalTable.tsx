import React, { useMemo, useState } from 'react';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import {
  FilterMenuDateRange,
  FilterMenuRadioGroup,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  intervalOverlapsDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import { Badge } from '../ui/Badge';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { LeaveRequest, LeaveStatus, Role, User } from '../../types';
import {
  canRejectLeave,
  canReturnLeave,
  formatLeaveStatusShort,
  leaveApprovalActionForUser,
  leaveApproveActionTitle,
  leaveHasApproverChain,
  leaveNeedsActionFilter,
} from '../../utils/leaveWorkflow';
import { resolveLeaveApprovalSteps } from '../../utils/workflowRequestApproval';
import {
  RequestStatusWithApprovalChain,
  WorkflowRequestApprovalTracker,
} from '../workflow/WorkflowRequestApprovalTracker';
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
import { calculateLeaveDays, formatLeaveDateRange, formatLeaveDurationNumber } from '../../utils/leaveDays';
import { getLeaveTypeColor } from '../../utils/leaveStyles';
import { StatusLabel } from '../ui/StatusLabel';
import { Check, FileText, RotateCcw, X } from 'lucide-react';
import { ListSearchFilterBar } from '../ui/page';
import { LeaveRequestViewModal } from './LeaveRequestViewModal';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveStoredLeaveTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';
import { useConfirmDialog, asPromptReason } from '../../hooks/useConfirmDialog';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';
import {
  approveReviewPrompt,
  rejectReviewPrompt,
  returnReviewPrompt,
} from '../workflow/workflowReviewPrompts';

type FilterMode = 'pending' | 'all' | 'this_month';

type SortCol = 'id' | 'name' | 'department' | 'type' | 'dates' | 'days' | 'reason' | 'status';

const approvalThClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-bold uppercase text-slate-500';

/** actionable = only rows this user can approve/reject; open = PENDING + MANAGER_APPROVED */
type PendingFilterKind = 'actionable' | 'open';

type Props = {
  leaves: LeaveRequest[];
  usersMap: Record<string, User>;
  /** Catalog used to resolve leave.type when older rows stored type ids (lt-annual). */
  leaveTypes?: Array<{ id?: string; name: string; nameKh?: string | null; code?: string | null }>;
  /** Map department id → display name for the department column. */
  departmentNames?: Record<string, string>;
  currentUserId?: string;
  currentUserRole?: Role | string;
  onApprove: (id: string, step: 'manager' | 'hr', notes: string) => Promise<void>;
  onReturn: (id: string, notes: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  /** Section heading (e.g. Approvals vs Request list). */
  title?: string;
  /** Hide the in-panel title when the parent page already shows a tab header. */
  hideTitle?: boolean;
  defaultFilterMode?: FilterMode;
  pendingFilterKind?: PendingFilterKind;
  labels: {
    employee: string;
    employeeId: string;
    department: string;
    type: string;
    dates: string;
    days: string;
    day: string;
    reason: string;
    status: string;
    actions: string;
    noRequests: string;
    to: string;
    searchPlaceholder: string;
    filterPending: string;
    filterAll: string;
    filterThisMonth: string;
    rejectTitle: string;
    rejectPlaceholder: string;
    rejectConfirm: string;
    cancel: string;
  };
};

export const ApprovalTable: React.FC<Props> = ({
  leaves,
  usersMap,
  leaveTypes = [],
  departmentNames = {},
  currentUserId,
  currentUserRole,
  onApprove,
  onReturn,
  onReject,
  title = 'Leave Approvals',
  hideTitle = false,
  defaultFilterMode = 'all',
  pendingFilterKind = 'actionable',
  labels,
}) => {
  const { language } = useLanguage();
  const { prompt, ConfirmDialogHost } = useConfirmDialog();
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>(defaultFilterMode);
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  const [acting, setActing] = useState<string | null>(null);
  const [viewLeave, setViewLeave] = useState<LeaveRequest | null>(null);

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: filterMode, defaultValue: defaultFilterMode }]) +
      countDateRangeFilters(dateRange),
    [filterMode, defaultFilterMode, dateRange]
  );

  const filteredLeaves = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    return leaves.filter((leave) => {
      const u = usersMap[leave.userId];
      const hay = [
        u?.name,
        u?.email,
        leave.userId,
        leave.type,
        leave.reason,
        leave.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (q && !hay.includes(q)) return false;

      if (
        !intervalOverlapsDateRange(
          String(leave.startDate ?? '').slice(0, 10),
          String(leave.endDate ?? leave.startDate ?? '').slice(0, 10),
          dateRange
        )
      ) {
        return false;
      }

      if (filterMode === 'pending') {
        if (pendingFilterKind === 'actionable') {
          if (
            !leaveNeedsActionFilter(
              leave,
              currentUserId,
              currentUserRole as Role | undefined
            )
          ) {
            return false;
          }
        } else {
          const s = String(leave.status).toUpperCase();
          if (s !== LeaveStatus.PENDING && s !== LeaveStatus.MANAGER_APPROVED) return false;
        }
      }
      if (filterMode === 'this_month') {
        const start = new Date(leave.startDate);
        if (start.getMonth() !== month || start.getFullYear() !== year) return false;
      }
      return true;
    });
  }, [
    leaves,
    usersMap,
    search,
    filterMode,
    dateRange,
    pendingFilterKind,
    currentUserId,
    currentUserRole,
  ]);

  const sortedLeaves = useMemo(() => {
    const getSortValue = (leave: LeaveRequest, col: SortCol): string | number => {
      const u = usersMap[leave.userId];
      switch (col) {
        case 'id':
          return leave.userId;
        case 'name':
          return u?.name ?? leave.userId;
        case 'department':
          return u?.departmentId ? departmentNames[u.departmentId] || u.departmentId : '';
        case 'type':
          return resolveStoredLeaveTypeLabel(leave.type, language, {
            typeKh: leave.typeKh,
            leaveTypes,
          });
        case 'dates':
          return String(leave.startDate ?? '');
        case 'days':
          return calculateLeaveDays(leave);
        case 'reason':
          return leave.reason ?? '';
        case 'status':
          return formatLeaveStatusShort(leave.status);
        default:
          return '';
      }
    };
    return sortRowsByColumn(filteredLeaves, sortBy, sortOrder, getSortValue);
  }, [filteredLeaves, sortBy, sortOrder, usersMap, departmentNames, language, leaveTypes]);

  const {
    pageItems: pagedLeaves,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sortedLeaves,
    undefined,
    `${search}|${filterMode}|${dateRange.from}|${dateRange.to}|${sortBy}|${sortOrder}`
  );

  const runApprove = async (leave: LeaveRequest, action: 'manager' | 'hr') => {
    const notes = asPromptReason(await prompt(approveReviewPrompt('leave')));
    if (notes === null) return;
    setActing(leave.id);
    try {
      await onApprove(leave.id, action, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const runReturn = async (leaveId: string) => {
    const notes = asPromptReason(await prompt(returnReviewPrompt('leave')));
    if (notes === null) return;
    setActing(leaveId);
    try {
      await onReturn(leaveId, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const runReject = async (leaveId: string) => {
    const notes = asPromptReason(await prompt(rejectReviewPrompt('leave')));
    if (notes === null) return;
    setActing(leaveId);
    try {
      await onReject(leaveId, notes.trim());
    } finally {
      setActing(null);
    }
  };

  const filterOptions: { value: FilterMode; label: string }[] = [
    { value: 'all', label: labels.filterAll },
    { value: 'pending', label: labels.filterPending },
    { value: 'this_month', label: labels.filterThisMonth },
  ];

  const handleExport = async (format: ExportFileExt) => {
    await exportListTable(format, {
      module: 'Leave_Approvals',
      reportTitle: title,
      sheetName: 'Leave Approvals',
      rows: filteredLeaves,
      metadata: [
        { label: 'Rows', value: filteredLeaves.length },
        { label: 'Search', value: search || 'All requests' },
        { label: 'Filter mode', value: filterMode },
        { label: 'Date from', value: dateRange.from || 'Any' },
        { label: 'Date to', value: dateRange.to || 'Any' },
      ],
      columns: [
        { header: 'Employee ID', value: (leave) => leave.userId, width: 16 },
        { header: 'Employee Name', value: (leave) => usersMap[leave.userId]?.name ?? '', width: 24 },
        { header: 'Employee Email', value: (leave) => usersMap[leave.userId]?.email ?? '', width: 28 },
        { header: 'Department', value: (leave) => departmentNames[usersMap[leave.userId]?.departmentId ?? ''] ?? '', width: 20 },
        { header: 'Leave Type', value: (leave) => resolveStoredLeaveTypeLabel(leave.type, language, { leaveTypes }), width: 18 },
        { header: 'Start Date', value: (leave) => leave.startDate, width: 14 },
        { header: 'End Date', value: (leave) => leave.endDate, width: 14 },
        { header: 'Days', value: (leave) => formatLeaveDurationNumber(calculateLeaveDays(leave)), width: 12 },
        { header: 'Reason', value: (leave) => leave.reason ?? '', width: 28 },
        { header: 'Status', value: (leave) => formatLeaveStatusShort(leave.status), width: 16 },
      ],
    });
  };

  return (
    <>
      <ConfirmDialogHost />
      <div className="space-y-4">
        {!hideTitle && (
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
        )}

        <ListSearchFilterBar
          leading={
            <ExportFormatMenu
              formats={['csv', 'xlsx']}
              disabled={filteredLeaves.length === 0}
              onExport={handleExport}
            />
          }
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={labels.searchPlaceholder}
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
                fromLabel="Leave from"
                toLabel="Leave to"
              />
              <FilterMenuRadioGroup
                label="Show"
                value={filterMode}
                onChange={(value) => setFilterMode(value as FilterMode)}
                options={filterOptions}
                defaultValue={defaultFilterMode}
              />
            </PageFilterMenu>
          }
        />

        <div className="surface-card shadow-sm overflow-hidden">
          {/* Phone / tablet: stacked cards — wide table is hard to scan on small screens. */}
          <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
            {totalCount === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-500">{labels.noRequests}</div>
            ) : (
              pagedLeaves.map((leave) => {
                const u = usersMap[leave.userId];
                const dayCount = calculateLeaveDays(leave);
                const dateLabel = formatLeaveDateRange(leave);
                const action = leaveApprovalActionForUser(
                  leave,
                  currentUserId,
                  currentUserRole
                );
                const showReject = canRejectLeave(leave, currentUserId, currentUserRole);
                const showReturn = canReturnLeave(leave, currentUserId, currentUserRole);
                const identity = u
                  ? employeeListIdentityFromUser(u)
                  : {
                      employeeId: leave.userId,
                      firstName: leave.userId,
                      lastName: '',
                      displayName: leave.userId,
                    };
                const approvalSteps = resolveLeaveApprovalSteps(leave, usersMap);
                const statusLabel =
                  leaveHasApproverChain(leave) &&
                  String(leave.status).toUpperCase() === LeaveStatus.PENDING &&
                  leave.approvalProgress
                    ? `Pending (${leave.approvalProgress.approved}/${leave.approvalProgress.total})`
                    : formatLeaveStatusShort(leave.status);
                const departmentLabel = u?.departmentId
                  ? departmentNames[u.departmentId] || u.departmentId
                  : '—';
                const typeLabel = resolveStoredLeaveTypeLabel(leave.type, language, {
                  typeKh: leave.typeKh,
                  leaveTypes,
                });

                return (
                  <div key={leave.id} className="p-3 sm:p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <EmployeeListIdentityBlock
                        className="flex-1 min-w-0"
                        data={identity}
                        showSubtitle
                        compactOnMobile
                      />
                      <ResponsiveRowActions
                        mode="menu"
                        menuLabel={labels.actions}
                        actions={[
                          {
                            key: 'view',
                            label: 'View detail',
                            icon: <FileText className="w-4 h-4" />,
                            onClick: () => setViewLeave(leave),
                          },
                          ...(showReturn
                            ? [{
                                key: 'return',
                                label: 'Return',
                                icon: <RotateCcw className="w-4 h-4" />,
                                disabled: !!acting,
                                onClick: () => void runReturn(leave.id),
                              }]
                            : []),
                          ...(showReject
                            ? [{
                                key: 'reject',
                                label: 'Reject',
                                icon: <X className="w-4 h-4" />,
                                disabled: !!acting,
                                destructive: true,
                                onClick: () => void runReject(leave.id),
                              }]
                            : []),
                          ...(action
                            ? [{
                                key: `approve-${action}`,
                                label: leaveApproveActionTitle(leave, action),
                                icon: <Check className="w-4 h-4" />,
                                disabled: !!acting,
                                onClick: () => {
                                  if (action === 'manager' || action === 'hr') {
                                    void runApprove(leave, action);
                                  }
                                },
                              }]
                            : []),
                        ]}
                      />
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <StatusLabel
                        status={leave.status}
                        context="leave"
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
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {labels.department}
                        </dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200" title={departmentLabel}>
                          {departmentLabel}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {labels.type}
                        </dt>
                        <dd className="mt-0.5">
                          <Badge
                            className={cn(
                              `${getLeaveTypeColor(leave.type)} max-w-full whitespace-normal text-left text-[10px] leading-snug px-1.5 py-0.5`,
                              localizedLabelUsesKhmerFont(leave.type, leave.typeKh, language) &&
                                'font-khmer'
                            )}
                            title={typeLabel}
                          >
                            {typeLabel}
                          </Badge>
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {labels.dates}
                        </dt>
                        <dd className="mt-0.5 break-words text-slate-700 dark:text-slate-200">{dateLabel}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {labels.days}
                        </dt>
                        <dd className="mt-0.5 tabular-nums text-slate-700 dark:text-slate-200">
                          {formatLeaveDurationNumber(dayCount)}
                        </dd>
                      </div>
                      {leave.reason ? (
                        <div className="min-w-0 col-span-2">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            {labels.reason}
                          </dt>
                          <dd className="mt-0.5 line-clamp-2 text-slate-600 dark:text-slate-300" title={leave.reason}>
                            {leave.reason}
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
                    label={labels.employeeId}
                    column="id"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={`${approvalThClass} whitespace-nowrap`}
                  />
                  <SortableTableHeader
                    label={labels.employee}
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.department}
                    column="department"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.type}
                    column="type"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.dates}
                    column="dates"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.days}
                    column="days"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.reason}
                    column="reason"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <SortableTableHeader
                    label={labels.status}
                    column="status"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={approvalThClass}
                  />
                  <th className={`${approvalThClass} text-right`}>{labels.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {totalCount === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-16 text-center text-slate-500">
                      {labels.noRequests}
                    </td>
                  </tr>
                ) : (
                  pagedLeaves.map((leave) => {
                    const u = usersMap[leave.userId];
                    const dayCount = calculateLeaveDays(leave);
                    const dateLabel = formatLeaveDateRange(leave);
                    const action = leaveApprovalActionForUser(
                      leave,
                      currentUserId,
                      currentUserRole
                    );
                    const showReject = canRejectLeave(leave, currentUserId, currentUserRole);
                    const showReturn = canReturnLeave(leave, currentUserId, currentUserRole);

                    const identity = u
                      ? employeeListIdentityFromUser(u)
                      : {
                          employeeId: leave.userId,
                          firstName: leave.userId,
                          lastName: '',
                          displayName: leave.userId,
                        };

                    const approvalSteps = resolveLeaveApprovalSteps(leave, usersMap);
                    const statusLabel =
                      leaveHasApproverChain(leave) &&
                      String(leave.status).toUpperCase() === LeaveStatus.PENDING &&
                      leave.approvalProgress
                        ? `Pending (${leave.approvalProgress.approved}/${leave.approvalProgress.total})`
                        : formatLeaveStatusShort(leave.status);

                    return (
                      <tr key={leave.id} className="hover:bg-primary-50/40 dark:hover:bg-primary-950/20">
                        <EmployeeListIdentityCells
                          data={identity}
                          idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap"
                          identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2"
                          showSubtitle
                        />
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                          {u?.departmentId
                            ? departmentNames[u.departmentId] || u.departmentId
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                          <Badge
                            className={cn(
                              `${getLeaveTypeColor(leave.type)} text-xs px-2 py-0.5`,
                              localizedLabelUsesKhmerFont(leave.type, leave.typeKh, language) &&
                                'font-khmer'
                            )}
                            title={resolveStoredLeaveTypeLabel(leave.type, language, {
                              typeKh: leave.typeKh,
                              leaveTypes,
                            })}
                          >
                            {resolveStoredLeaveTypeLabel(leave.type, language, {
                              typeKh: leave.typeKh,
                              leaveTypes,
                            })}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-slate-600 dark:text-slate-300 text-xs">
                          {dateLabel}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                          {formatLeaveDurationNumber(dayCount)}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 max-w-xs truncate text-xs sm:text-sm text-slate-500" title={leave.reason}>
                          {leave.reason}
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 align-top">
                          <RequestStatusWithApprovalChain
                            viewerUserId={currentUserId}
                            steps={approvalSteps}
                            statusNode={
                              <StatusLabel
                                status={leave.status}
                                context="leave"
                                label={statusLabel}
                                size="sm"
                              />
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                          <ResponsiveRowActions
                            className="w-full"
                            menuLabel={labels.actions}
                            actions={[
                              {
                                key: 'view',
                                label: 'View detail',
                                icon: <FileText className="w-4 h-4" />,
                                onClick: () => setViewLeave(leave),
                              },
                              ...(showReturn
                                ? [{
                                    key: 'return',
                                    label: 'Return',
                                    icon: <RotateCcw className="w-4 h-4" />,
                                    disabled: !!acting,
                                    onClick: () => void runReturn(leave.id),
                                  }]
                                : []),
                              ...(showReject
                                ? [{
                                    key: 'reject',
                                    label: 'Reject',
                                    icon: <X className="w-4 h-4" />,
                                    disabled: !!acting,
                                    destructive: true,
                                    onClick: () => void runReject(leave.id),
                                  }]
                                : []),
                              ...(action
                                ? [{
                                    key: `approve-${action}`,
                                    label: leaveApproveActionTitle(leave, action),
                                    icon: <Check className="w-4 h-4" />,
                                    disabled: !!acting,
                                    onClick: () => {
                                      if (action === 'manager' || action === 'hr') {
                                        void runApprove(leave, action);
                                      }
                                    },
                                  }]
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
      </div>

      <LeaveRequestViewModal
        isOpen={Boolean(viewLeave)}
        onClose={() => setViewLeave(null)}
        leave={viewLeave}
        usersMap={usersMap}
        departmentNames={departmentNames}
        labels={{
          title: 'Leave request details',
          type: labels.type,
          dates: labels.dates,
          days: labels.days,
          day: labels.day,
          reason: labels.reason,
          status: labels.status,
          manager: 'Approving manager',
          close: 'Close',
        }}
      />
    </>
  );
};
