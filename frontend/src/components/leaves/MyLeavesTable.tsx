import React, { useMemo } from 'react';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../../utils/listColumnSort';
import { Badge } from '../ui/Badge';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import { LeaveRequest, LeaveStatus, User } from '../../types';
import { calculateLeaveDays, formatLeaveDateRange, formatLeaveDurationLabel } from '../../utils/leaveDays';
import { MY_LEAVE_TYPE_BADGE } from '../../utils/leaveStyles';
import { StatusLabel } from '../ui/StatusLabel';
import { formatLeaveStatusLabel } from '../../utils/leaveWorkflow';
import { resolveLeaveApprovalSteps } from '../../utils/workflowRequestApproval';
import { RequestStatusWithApprovalChain, WorkflowRequestApprovalTracker } from '../workflow/WorkflowRequestApprovalTracker';
import { Calendar as CalendarIcon, FileText, Pencil, XCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveStoredLeaveTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';

type Props = {
  leaves: LeaveRequest[];
  usersMap?: Record<string, User>;
  labels: {
    type: string;
    dates: string;
    day: string;
    days: string;
    reason: string;
    status: string;
    actions: string;
    noRequests: string;
    noData: string;
    to: string;
    view: string;
    cancel: string;
    edit?: string;
  };
  onView?: (leave: LeaveRequest) => void;
  onCancel?: (leave: LeaveRequest) => void;
  onEdit?: (leave: LeaveRequest) => void;
};

function isReadOnlyRow(status: string): boolean {
  const s = String(status).toUpperCase();
  return (
    s === LeaveStatus.CANCELLED ||
    s === LeaveStatus.REJECTED ||
    s === LeaveStatus.APPROVED ||
    s === LeaveStatus.MANAGER_APPROVED
  );
}

type SortCol = 'type' | 'dates' | 'days' | 'reason' | 'status';

const thClass = 'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-bold uppercase text-slate-500';
const tdClass = 'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm';

export const MyLeavesTable: React.FC<Props> = ({
  leaves,
  usersMap = {},
  labels,
  onView,
  onCancel,
  onEdit,
}) => {
  const { language } = useLanguage();
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<SortCol>();
  const sorted = useMemo(() => {
    const getSortValue = (leave: LeaveRequest, col: SortCol): string | number => {
      switch (col) {
        case 'type':
          return resolveStoredLeaveTypeLabel(leave.type, language, { typeKh: leave.typeKh });
        case 'dates':
          return String(leave.startDate ?? '');
        case 'days':
          return calculateLeaveDays(leave);
        case 'reason':
          return leave.reason ?? '';
        case 'status':
          return formatLeaveStatusLabel(leave.status, leave);
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: LeaveRequest[]) =>
      rows.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
      );
    return sortRowsByColumn(leaves, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [leaves, sortBy, sortOrder, language]);
  const {
    pageItems: pagedLeaves,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(sorted, undefined, `${sortBy}|${sortOrder}`);
  const showActions = Boolean(onView || onCancel || onEdit);

  if (sorted.length === 0) {
    return (
      <div className="surface-card shadow-sm">
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <CalendarIcon className="w-16 h-16 text-slate-300 mb-4" />
          <p className="text-lg font-medium text-slate-900 dark:text-white">{labels.noRequests}</p>
          <p className="text-sm text-slate-500 mt-1">{labels.noData}</p>
        </div>
      </div>
    );
  }

  const rowActions = (l: LeaveRequest) => {
    const statusUpper = String(l.status).toUpperCase();
    const canCancel =
      (statusUpper === LeaveStatus.PENDING || statusUpper === LeaveStatus.RETURNED) &&
      Boolean(onCancel);
    const canEdit = statusUpper === LeaveStatus.RETURNED && Boolean(onEdit);
    return [
      ...(onView
        ? [{
            key: 'view',
            label: labels.view,
            icon: <FileText className="w-4 h-4" />,
            onClick: () => onView(l),
          }]
        : []),
      ...(canEdit && onEdit
        ? [{
            key: 'edit',
            label: labels.edit || 'Edit & resubmit',
            icon: <Pencil className="w-4 h-4" />,
            onClick: () => onEdit(l),
          }]
        : []),
      ...(canCancel
        ? [{
            key: 'cancel',
            label: labels.cancel,
            icon: <XCircle className="w-4 h-4" />,
            destructive: true,
            onClick: () => onCancel?.(l),
          }]
        : []),
    ];
  };

  return (
    <div className="surface-card shadow-sm overflow-hidden">
      <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
        {pagedLeaves.map((l) => {
          const dayCount = calculateLeaveDays(l);
          const dateLabel = formatLeaveDateRange(l);
          const readonly = isReadOnlyRow(l.status);
          const approvalSteps = resolveLeaveApprovalSteps(l, usersMap);
          const typeLabel = resolveStoredLeaveTypeLabel(l.type, language, { typeKh: l.typeKh });
          const actions = rowActions(l);
          return (
            <div
              key={l.id}
              className={`p-3 sm:p-3.5 space-y-2.5 ${
                readonly ? 'bg-slate-50/90 dark:bg-slate-900/50' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <Badge
                  className={cn(
                    MY_LEAVE_TYPE_BADGE,
                    'text-[10px] px-1.5 py-0.5 max-w-full whitespace-normal text-left leading-snug',
                    localizedLabelUsesKhmerFont(l.type, l.typeKh, language) && 'font-khmer'
                  )}
                >
                  {typeLabel}
                </Badge>
                {showActions && actions.length > 0 ? (
                  <ResponsiveRowActions mode="menu" menuLabel="Leave actions" actions={actions} />
                ) : null}
              </div>

              <div className="min-w-0 space-y-1.5">
                <StatusLabel
                  status={l.status}
                  context="leave"
                  label={formatLeaveStatusLabel(l.status, l)}
                  size="sm"
                />
                {approvalSteps.length > 0 ? (
                  <WorkflowRequestApprovalTracker steps={approvalSteps} compact />
                ) : null}
              </div>

              <div className="min-w-0 space-y-0.5">
                <p className="text-xs text-slate-700 dark:text-slate-200">{dateLabel}</p>
                <p className="text-[10px] text-slate-500 tabular-nums">
                  {formatLeaveDurationLabel(dayCount, {
                    day: labels.day,
                    days: labels.days,
                    halfDay: '½ day',
                  })}
                </p>
              </div>

              {l.reason ? (
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2" title={l.reason}>
                  {l.reason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <SortableTableHeader
                label={labels.type}
                column="type"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label={labels.dates}
                column="dates"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label={labels.days}
                column="days"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label={labels.reason}
                column="reason"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label={labels.status}
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              {showActions && (
                <th className={`${thClass} text-right`}>{labels.actions}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pagedLeaves.map((l) => {
              const dayCount = calculateLeaveDays(l);
              const dateLabel = formatLeaveDateRange(l);
              const readonly = isReadOnlyRow(l.status);
              const approvalSteps = resolveLeaveApprovalSteps(l, usersMap);
              return (
                <tr
                  key={l.id}
                  className={
                    readonly
                      ? 'bg-slate-50/90 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                  }
                >
                  <td className={tdClass}>
                    <Badge
                      className={cn(
                        MY_LEAVE_TYPE_BADGE,
                        localizedLabelUsesKhmerFont(l.type, l.typeKh, language) && 'font-khmer'
                      )}
                    >
                      {resolveStoredLeaveTypeLabel(l.type, language, { typeKh: l.typeKh })}
                    </Badge>
                  </td>
                  <td className={`${tdClass} text-xs`}>{dateLabel}</td>
                  <td className={tdClass}>
                    {formatLeaveDurationLabel(dayCount, {
                      day: labels.day,
                      days: labels.days,
                      halfDay: '½ day',
                    })}
                  </td>
                  <td className={`${tdClass} max-w-xs truncate`} title={l.reason}>
                    {l.reason}
                  </td>
                  <td className={`${tdClass} align-top`}>
                    <RequestStatusWithApprovalChain
                      steps={approvalSteps}
                      statusNode={
                        <StatusLabel
                          status={l.status}
                          context="leave"
                          label={formatLeaveStatusLabel(l.status, l)}
                          size="sm"
                        />
                      }
                    />
                  </td>
                  {showActions && (
                    <td className={`${tdClass} text-right`}>
                      <ResponsiveRowActions menuLabel="Leave actions" actions={rowActions(l)} />
                    </td>
                  )}
                </tr>
              );
            })}
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
  );
};
