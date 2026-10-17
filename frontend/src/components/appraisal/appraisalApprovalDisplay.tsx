import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import type { EmployeeAppraisal } from '../../types/appraisal';
import type { WorkflowApproverCandidate } from '../workflow/ApproverSelectPanel';
import {
  mergeAssignedApproverCandidate,
  resolveWorkflowPersonLabel,
} from '../../utils/approverCandidateFromAssigned';

export type AppraisalApproverEntry = NonNullable<EmployeeAppraisal['assignedFinalApprovers']>[number];

export function isAppraisalPendingFinalApproval(appraisal: EmployeeAppraisal): boolean {
  return String(appraisal.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL';
}

export function resolveAppraisalFinalApprovers(appraisal: EmployeeAppraisal): Array<
  AppraisalApproverEntry & {
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }
> {
  if (appraisal.assignedFinalApprovers?.length) {
    return appraisal.assignedFinalApprovers.map((entry, index) => {
      const phase =
        entry.phase ??
        (entry.status === 'approved'
          ? 'approved'
          : appraisal.currentApproverUserId === entry.userId
            ? 'current'
            : 'queued');
      return {
        ...entry,
        name: resolveWorkflowPersonLabel(entry.name, {
          userId: entry.userId,
          fallback: `Approver ${index + 1}`,
        }),
        sortOrder: entry.sortOrder ?? index,
        phase,
      };
    });
  }
  const legacyId = String(appraisal.assigned_final_approver_user_id ?? '').trim();
  if (!legacyId) return [];
  const legacyApproved = !isAppraisalPendingFinalApproval(appraisal);
  return [
    {
      userId: legacyId,
      name: resolveWorkflowPersonLabel(appraisal.assignedFinalApproverName, {
        userId: legacyId,
        fallback: 'Approver',
      }),
      status: legacyApproved ? 'approved' : 'pending',
      approvedAt: null,
      sortOrder: 0,
      phase: legacyApproved ? 'approved' : 'current',
    },
  ];
}

export function finalApproverDraftFromAppraisal(
  appraisal: EmployeeAppraisal,
  directory?: Map<string, WorkflowApproverCandidate> | Record<string, WorkflowApproverCandidate>
): {
  userIds: string[];
  candidates: WorkflowApproverCandidate[];
} {
  const userIds =
    appraisal.assignedFinalApproverUserIds?.length
      ? appraisal.assignedFinalApproverUserIds
      : appraisal.assigned_final_approver_user_id
        ? [appraisal.assigned_final_approver_user_id]
        : [];

  const fromApi = appraisal.assignedFinalApprovers ?? [];
  const candidates = userIds.map((userId) => {
    const row = fromApi.find((entry) => entry.userId === userId);
    return mergeAssignedApproverCandidate(
      {
        userId,
        name:
          row?.name ??
          (userId === appraisal.assigned_final_approver_user_id
            ? appraisal.assignedFinalApproverName
            : null),
      },
      directory
    );
  });

  return { userIds, candidates };
}

export type AppraisalEvaluatorEntry = NonNullable<EmployeeAppraisal['assignedEvaluators']>[number];

/** Ordered evaluator chain for display, with a fallback to the legacy single assignee. */
export function resolveAppraisalEvaluators(appraisal: EmployeeAppraisal): Array<
  AppraisalEvaluatorEntry & {
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }
> {
  if (appraisal.assignedEvaluators?.length) {
    return appraisal.assignedEvaluators.map((entry, index) => {
      const phase =
        entry.phase ??
        (entry.status === 'submitted'
          ? 'submitted'
          : appraisal.currentEvaluatorUserId === entry.userId
            ? 'current'
            : 'queued');
      return {
        ...entry,
        name: resolveWorkflowPersonLabel(entry.name, {
          userId: entry.userId,
          fallback: `Evaluator ${index + 1}`,
        }),
        sortOrder: entry.sortOrder ?? index,
        phase,
      };
    });
  }
  const legacyId = String(appraisal.assigned_manager_user_id ?? appraisal.manager_id ?? '').trim();
  if (!legacyId) return [];
  const submitted = Boolean(appraisal.manager_submitted_at);
  return [
    {
      userId: legacyId,
      name: resolveWorkflowPersonLabel(appraisal.assignedManagerName, {
        userId: legacyId,
        fallback: 'Evaluator',
      }),
      status: submitted ? 'submitted' : 'pending',
      submittedAt: null,
      sortOrder: 0,
      phase: submitted ? 'submitted' : 'current',
    },
  ];
}

/** Hydrate the evaluator multi-select state from an appraisal DTO (for re-render/edit). */
export function evaluatorDraftFromAppraisal(
  appraisal: EmployeeAppraisal,
  directory?: Map<string, WorkflowApproverCandidate> | Record<string, WorkflowApproverCandidate>
): {
  userIds: string[];
  candidates: WorkflowApproverCandidate[];
} {
  const userIds =
    appraisal.assignedEvaluatorUserIds?.length
      ? appraisal.assignedEvaluatorUserIds
      : appraisal.assigned_manager_user_id
        ? [appraisal.assigned_manager_user_id]
        : [];

  const fromApi = appraisal.assignedEvaluators ?? [];
  const candidates = userIds.map((userId) => {
    const row = fromApi.find((entry) => entry.userId === userId);
    const name =
      row?.name ?? (userId === appraisal.assigned_manager_user_id ? appraisal.assignedManagerName : null);
    return mergeAssignedApproverCandidate({ userId, name }, directory);
  });

  return { userIds, candidates };
}

export function viewerAppraisalApproverStep(
  appraisal: EmployeeAppraisal,
  viewerUserId?: string | null
): {
  stepNumber: number;
  total: number;
  phase: 'approved' | 'current' | 'queued' | null;
} | null {
  const viewerId = String(viewerUserId ?? '').trim();
  if (!viewerId) return null;
  const approvers = resolveAppraisalFinalApprovers(appraisal);
  const index = approvers.findIndex((entry) => entry.userId === viewerId);
  if (index < 0) return null;
  const entry = approvers[index];
  return {
    stepNumber: index + 1,
    total: approvers.length,
    phase: entry.phase ?? (entry.status === 'approved' ? 'approved' : 'queued'),
  };
}

export function AppraisalApprovalTracker({
  appraisal,
  compact = false,
  viewerUserId,
}: {
  appraisal: EmployeeAppraisal;
  compact?: boolean;
  viewerUserId?: string | null;
}) {
  const approvers = resolveAppraisalFinalApprovers(appraisal);
  if (!approvers.length) return null;

  const pending = isAppraisalPendingFinalApproval(appraisal);
  const approvedCount = approvers.filter((entry) => entry.status === 'approved').length;
  const total = approvers.length;
  const progressPct = total > 0 ? Math.round((approvedCount / total) * 100) : 0;
  const showTracker = pending || total > 1;
  if (!showTracker) return null;

  const heading = pending
    ? appraisal.currentApproverName
      ? `Awaiting review by ${appraisal.currentApproverName} (step ${approvedCount + 1} of ${total})`
      : approvedCount > 0
        ? `Final approval routing (${approvedCount} of ${total} complete)`
        : `Waiting for final approval (${total} approver${total === 1 ? '' : 's'})`
    : `Final approval complete (${total} approver${total === 1 ? '' : 's'})`;

  return (
    <div
      className={`rounded-lg border ${
        pending
          ? 'border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
          : 'border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/15'
      } ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p
          className={`font-semibold text-slate-800 dark:text-slate-100 ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {heading}
        </p>
        {total > 1 ? (
          <span
            className={`tabular-nums font-medium ${
              pending ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
            } ${compact ? 'text-[10px]' : 'text-xs'}`}
          >
            {approvedCount}/{total}
          </span>
        ) : null}
      </div>

      {total > 1 ? (
        <div
          className="h-1.5 rounded-full bg-white/80 dark:bg-slate-900/40 overflow-hidden mb-2.5"
          aria-hidden
        >
          <div
            className={`h-full rounded-full transition-all ${
              pending ? 'bg-amber-500 dark:bg-amber-400' : 'bg-emerald-500 dark:bg-emerald-400'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      ) : null}

      <ul className={`space-y-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
        {approvers.map((entry, index) => {
          const approved = entry.status === 'approved' || entry.phase === 'approved';
          const isCurrent = entry.phase === 'current';
          const isQueued = entry.phase === 'queued';
          const isViewer = Boolean(viewerUserId && entry.userId === viewerUserId);
          const displayName = resolveWorkflowPersonLabel(entry.name, {
            userId: entry.userId,
            fallback: 'Approver',
          });
          const statusLabel = approved
            ? isViewer
              ? 'You approved'
              : 'Approved'
            : isCurrent
              ? isViewer
                ? 'Your turn'
                : 'Review now'
              : isQueued
                ? isViewer
                  ? 'Your step'
                  : 'Up next'
                : pending
                  ? 'Waiting'
                  : '—';
          return (
            <li key={entry.userId} className="flex items-start gap-2 min-w-0">
              <span
                className={`inline-flex items-center justify-center w-4 h-4 shrink-0 mt-0.5 rounded-full text-[9px] font-bold tabular-nums ${
                  isCurrent
                    ? 'bg-primary-600 text-white'
                    : approved
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {index + 1}
              </span>
              {approved ? (
                <CheckCircle2
                  className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
                  aria-hidden
                />
              ) : isCurrent ? (
                <Clock
                  className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400 mt-0.5"
                  aria-hidden
                />
              ) : (
                <Circle className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600 mt-0.5" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span
                    className={`font-medium break-words ${
                      isCurrent
                        ? 'text-slate-900 dark:text-white'
                        : approved
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {displayName}
                  </span>
                  <span
                    className={`shrink-0 font-medium ${
                      approved
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : isCurrent
                          ? 'text-primary-700 dark:text-primary-300'
                          : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                {isCurrent && pending ? (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isViewer
                      ? 'You can review and approve this appraisal'
                      : 'Can review and approve this appraisal'}
                  </p>
                ) : isQueued && pending ? (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {isViewer
                      ? 'You are step ' +
                        (index + 1) +
                        ' — waiting for earlier approvers in the chain'
                      : 'Waiting for earlier approvers in the chain'}
                  </p>
                ) : approved && isViewer ? (
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                    Your sign-off is complete — waiting for remaining approvers
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
