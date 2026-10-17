import React, { useMemo } from 'react';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../../utils/listColumnSort';
import { Badge } from '../ui/Badge';
import type { OvertimeRequest, User } from '../../types';
import { StatusLabel } from '../ui/StatusLabel';
import { formatOvertimeStatusLabel, overtimeRateLabel } from '../../utils/overtimeLabels';
import { resolveOvertimeApprovalSteps } from '../../utils/workflowRequestApproval';
import {
  RequestStatusWithApprovalChain,
  WorkflowRequestApprovalTracker,
} from '../workflow/WorkflowRequestApprovalTracker';
import { Button } from '../ui/Button';
import { ResponsiveRowActions } from '../ui/ResponsiveRowActions';
import { Clock, Edit2, FileText, Plus, XCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveOvertimeRequestTypeLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

type Props = {
  requests: OvertimeRequest[];
  usersMap?: Record<string, User>;
  onRequest?: () => void;
  onEdit?: (request: OvertimeRequest) => void;
  onView?: (request: OvertimeRequest) => void;
  onCancel?: (request: OvertimeRequest) => void;
};

type SortCol = 'date' | 'type' | 'hours' | 'rate' | 'reason' | 'status';

const thClass = 'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-bold uppercase text-slate-500';
const tdClass = 'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm';

export const MyOvertimeTable: React.FC<Props> = ({
  requests,
  usersMap = {},
  onRequest,
  onEdit,
  onView,
  onCancel,
}) => {
  const { t, language } = useLanguage();
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<SortCol>();
  const sorted = useMemo(() => {
    const getSortValue = (request: OvertimeRequest, col: SortCol): string | number => {
      switch (col) {
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
    return sortRowsByColumn(requests, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [requests, sortBy, sortOrder, language]);
  const {
    pageItems: pagedRequests,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(sorted, undefined, `${sortBy}|${sortOrder}`);
  const showActions = Boolean(onView || onEdit || onCancel);

  if (sorted.length === 0) {
    return (
      <div className="surface-card shadow-sm">
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <Clock className="w-16 h-16 text-slate-300 mb-4" />
          <p className="text-lg font-medium text-slate-900 dark:text-white">No overtime requests</p>
          <p className="text-sm text-slate-500 mt-1">Submit a request when you work approved overtime.</p>
          {onRequest && (
            <Button onClick={onRequest} className="mt-6">
              <Plus className="w-4 h-4 mr-2" />
              Request overtime
            </Button>
          )}
        </div>
      </div>
    );
  }

  const rowActions = (r: OvertimeRequest) => {
    const statusUpper = String(r.status).toUpperCase();
    const canEdit =
      Boolean(onEdit) && (statusUpper === 'PENDING' || statusUpper === 'RETURNED');
    const canCancel =
      Boolean(onCancel) && (statusUpper === 'PENDING' || statusUpper === 'RETURNED');
    return [
      ...(onView
        ? [{
            key: 'view',
            label: t('overtime.viewDetail') || 'View detail',
            icon: <FileText className="w-4 h-4" />,
            onClick: () => onView(r),
          }]
        : []),
      ...(canEdit
        ? [{
            key: 'edit',
            label:
              statusUpper === 'RETURNED'
                ? t('common.edit') || 'Edit & resubmit'
                : t('common.edit') || 'Edit',
            icon: <Edit2 className="w-4 h-4" />,
            onClick: () => onEdit?.(r),
          }]
        : []),
      ...(canCancel
        ? [{
            key: 'cancel',
            label: t('overtime.cancelRequest') || 'Cancel request',
            icon: <XCircle className="w-4 h-4" />,
            destructive: true,
            onClick: () => onCancel?.(r),
          }]
        : []),
    ];
  };

  return (
    <div className="surface-card shadow-sm overflow-hidden">
      <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
        {pagedRequests.map((r) => {
          const approvalSteps = resolveOvertimeApprovalSteps(r, usersMap);
          const statusLabel = formatOvertimeStatusLabel(r.status, r);
          const typeLabel = resolveOvertimeRequestTypeLabel(r, language);
          const actions = rowActions(r);
          const cancelled = String(r.status).toUpperCase() === 'CANCELLED';
          return (
            <div
              key={r.id}
              className={`p-3 sm:p-3.5 space-y-2.5 ${cancelled ? 'opacity-75' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs sm:text-sm font-medium text-slate-900 dark:text-white">
                    {formatDateOnlyDisplay(r.workDate)}
                  </p>
                  <p
                    className={cn(
                      'text-[10px] sm:text-xs text-slate-500 break-words',
                      localizedLabelUsesKhmerFont(r.otTypeName, r.otTypeNameKh, language) &&
                        'font-khmer'
                    )}
                  >
                    {typeLabel}
                  </p>
                </div>
                {showActions && actions.length > 0 ? (
                  <ResponsiveRowActions mode="menu" menuLabel="Overtime actions" actions={actions} />
                ) : null}
              </div>

              <div className="min-w-0 space-y-1.5">
                <StatusLabel status={r.status} context="overtime" label={statusLabel} size="sm" />
                {approvalSteps.length > 0 ? (
                  <WorkflowRequestApprovalTracker steps={approvalSteps} compact />
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs">
                <span className="shrink-0 font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {r.hours}h
                </span>
                <Badge
                  variant="neutral"
                  className="max-w-full whitespace-normal text-left text-[10px] leading-snug px-1.5 py-0.5"
                >
                  {overtimeRateLabel(r.rateTier)}
                </Badge>
              </div>

              {r.reason ? (
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2" title={r.reason}>
                  {r.reason}
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
                label="Date"
                column="date"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label="Type"
                column="type"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label="Hours"
                column="hours"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label="Rate"
                column="rate"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label="Reason"
                column="reason"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              <SortableTableHeader
                label="Status"
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={thClass}
              />
              {showActions && (
                <th className={`${thClass} text-right`}>
                  {t('common.actions') || 'Actions'}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pagedRequests.map((r) => {
              const approvalSteps = resolveOvertimeApprovalSteps(r, usersMap);
              const statusLabel = formatOvertimeStatusLabel(r.status, r);
              const cancelled = String(r.status).toUpperCase() === 'CANCELLED';
              return (
              <tr
                key={r.id}
                className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${cancelled ? 'opacity-75' : ''}`}
              >
                <td className={`${tdClass} text-slate-700 dark:text-slate-300`}>{formatDateOnlyDisplay(r.workDate)}</td>
                <td
                  className={cn(
                    `${tdClass} text-slate-600 dark:text-slate-400`,
                    localizedLabelUsesKhmerFont(r.otTypeName, r.otTypeNameKh, language) &&
                      'font-khmer'
                  )}
                >
                  {resolveOvertimeRequestTypeLabel(r, language)}
                </td>
                <td className={`${tdClass} font-semibold tabular-nums`}>{r.hours}h</td>
                <td className={tdClass}>
                  <Badge variant="neutral">{overtimeRateLabel(r.rateTier)}</Badge>
                </td>
                <td className={`${tdClass} max-w-xs truncate text-slate-600 dark:text-slate-400`} title={r.reason}>
                  {r.reason}
                </td>
                <td className={`${tdClass} align-top`}>
                  <RequestStatusWithApprovalChain
                    steps={approvalSteps}
                    statusNode={
                      <StatusLabel status={r.status} context="overtime" label={statusLabel} size="sm" />
                    }
                  />
                </td>
                {showActions && (
                  <td className={`${tdClass} text-right`}>
                    <ResponsiveRowActions menuLabel="Overtime actions" actions={rowActions(r)} />
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
