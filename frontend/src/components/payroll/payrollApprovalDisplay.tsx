import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import type { PayrollPendingApprovalItem, PayrollRun } from '../../types';
import { normalizePayrollRunStatus } from '../../pages/payroll/payrollUtils';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';

type ApproverRow = NonNullable<PayrollPendingApprovalItem['assignedApprovers']>[number];

export function resolvePayrollApprovers(
  row: Pick<PayrollPendingApprovalItem | PayrollRun, 'assignedApprovers' | 'status'>
): Array<ApproverRow & { sortOrder: number; phase: 'approved' | 'current' | 'queued' }> {
  if (!row.assignedApprovers?.length) return [];
  return row.assignedApprovers.map((entry, index) => ({
    ...entry,
    sortOrder: entry.sortOrder ?? index,
    phase:
      entry.phase ??
      (entry.status === 'approved' ? 'approved' : entry.phase === 'current' ? 'current' : 'queued'),
  }));
}

export function viewerPayrollApproverStep(
  row: Pick<PayrollPendingApprovalItem | PayrollRun, 'assignedApprovers' | 'status'>,
  viewerUserId?: string | null
): {
  stepNumber: number;
  total: number;
  phase: 'approved' | 'current' | 'queued' | null;
} | null {
  const viewerId = String(viewerUserId ?? '').trim();
  if (!viewerId) return null;
  const approvers = resolvePayrollApprovers(row);
  const index = approvers.findIndex((entry) => entry.userId === viewerId);
  if (index < 0) return null;
  const entry = approvers[index];
  return {
    stepNumber: index + 1,
    total: approvers.length,
    phase: entry.phase ?? (entry.status === 'approved' ? 'approved' : 'queued'),
  };
}

export function PayrollApprovalTracker({
  row,
  compact = false,
  viewerUserId,
}: {
  row: Pick<PayrollPendingApprovalItem | PayrollRun, 'assignedApprovers' | 'status' | 'currentApproverName'>;
  compact?: boolean;
  viewerUserId?: string | null;
}) {
  const approvers = resolvePayrollApprovers(row);
  if (!approvers.length) return null;

  const pending = normalizePayrollRunStatus(String(row.status ?? '')) === 'PENDING_APPROVAL';
  const approvedCount = approvers.filter((entry) => entry.status === 'approved').length;
  const total = approvers.length;
  const progressPct = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

  return (
    <div className={compact ? 'mt-2' : 'mt-3'}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Approval chain {pending ? `(${approvedCount}/${total})` : '(complete)'}
        </p>
        {pending ? (
          <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
            {progressPct}%
          </span>
        ) : null}
      </div>
      {pending ? (
        <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      ) : null}
      <ol className="space-y-1">
        {approvers.map((entry, index) => {
          const phase = entry.phase ?? (entry.status === 'approved' ? 'approved' : 'queued');
          const isViewer = viewerUserId && entry.userId === viewerUserId;
          const Icon =
            phase === 'approved' ? CheckCircle2 : phase === 'current' ? Clock : Circle;
          const iconClass =
            phase === 'approved'
              ? 'text-emerald-600 dark:text-emerald-400'
              : phase === 'current'
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-slate-400';
          const approvedAtLabel =
            !pending && entry.approvedAt
              ? formatDateTimeDisplay(entry.approvedAt, '') || null
              : null;
          return (
            <li
              key={entry.userId}
              className={`flex items-center gap-2 text-xs ${
                isViewer ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${iconClass}`} />
              <span>
                Step {index + 1}: {entry.name || 'Approver'}
                {phase === 'current'
                  ? ' · current'
                  : phase === 'approved'
                    ? approvedAtLabel
                      ? ` · approved ${approvedAtLabel}`
                      : ' · approved'
                    : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {pending && row.currentApproverName ? (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
          Waiting on: {row.currentApproverName}
        </p>
      ) : null}
    </div>
  );
}
