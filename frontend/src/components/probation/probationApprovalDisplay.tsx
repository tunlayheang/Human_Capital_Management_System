import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import type { ProbationPendingApprovalItem, ProbationRow } from '../../types';
import type { WorkflowApproverCandidate } from '../workflow/ApproverSelectPanel';
import {
  mergeAssignedApproverCandidate,
  resolveWorkflowPersonLabel,
} from '../../utils/approverCandidateFromAssigned';

export type ProbationApproverEntry = NonNullable<ProbationPendingApprovalItem['assignedApprovers']>[number];

export type ProbationEvaluatorEntry = NonNullable<ProbationRow['assignedEvaluators']>[number];

/** Ordered evaluator chain for display, with a fallback to the legacy single assignee. */
export function resolveProbationEvaluators(row: ProbationRow): Array<
  ProbationEvaluatorEntry & {
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }
> {
  if (row.assignedEvaluators?.length) {
    return row.assignedEvaluators.map((entry, index) => {
      const phase =
        entry.phase ??
        (entry.status === 'submitted'
          ? 'submitted'
          : row.currentEvaluatorUserId === entry.userId
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
  const legacyId = String(row.assignedManagerUserId ?? '').trim();
  if (!legacyId) return [];
  const submitted = Boolean(row.managerSubmittedAt);
  return [
    {
      userId: legacyId,
      name: resolveWorkflowPersonLabel(row.assignedManagerName, {
        userId: legacyId,
        fallback: 'Evaluator',
      }),
      status: submitted ? 'submitted' : 'pending',
      submittedAt: row.managerSubmittedAt ?? null,
      sortOrder: 0,
      phase: submitted ? 'submitted' : 'current',
    },
  ];
}

export function evaluatorDraftFromProbationRow(
  row: ProbationRow,
  directory?: Map<string, WorkflowApproverCandidate> | Record<string, WorkflowApproverCandidate>
): {
  userIds: string[];
  candidates: WorkflowApproverCandidate[];
} {
  const userIds =
    row.assignedEvaluatorUserIds?.length
      ? row.assignedEvaluatorUserIds
      : row.assignedManagerUserId
        ? [row.assignedManagerUserId]
        : [];
  const fromApi = row.assignedEvaluators ?? [];
  const candidates = userIds.map((userId) => {
    const entry = fromApi.find((ev) => ev.userId === userId);
    return mergeAssignedApproverCandidate(
      {
        userId,
        name: entry?.name ?? null,
      },
      directory
    );
  });
  return { userIds, candidates };
}

export function isProbationPendingFinalApproval(status: string | undefined): boolean {
  return String(status ?? '') === 'PENDING_FINAL_APPROVAL';
}

export function resolveProbationApprovers(
  row: Pick<ProbationRow, 'assignedApprovers' | 'status'>
): Array<ProbationApproverEntry & { sortOrder: number; phase: 'approved' | 'current' | 'queued' }> {
  if (row.assignedApprovers?.length) {
    return row.assignedApprovers.map((entry, index) => ({
      ...entry,
      name: resolveWorkflowPersonLabel(entry.name, {
        userId: entry.userId,
        fallback: `Approver ${index + 1}`,
      }),
      sortOrder: entry.sortOrder ?? index,
      phase:
        entry.phase ??
        (entry.status === 'approved'
          ? 'approved'
          : entry.phase === 'current'
            ? 'current'
            : 'queued'),
    }));
  }
  return [];
}

export function viewerProbationApproverStep(
  row: ProbationPendingApprovalItem,
  viewerUserId?: string | null
): {
  stepNumber: number;
  total: number;
  phase: 'approved' | 'current' | 'queued' | null;
} | null {
  const viewerId = String(viewerUserId ?? '').trim();
  if (!viewerId) return null;
  const approvers = resolveProbationApprovers(row);
  const index = approvers.findIndex((entry) => entry.userId === viewerId);
  if (index < 0) return null;
  const entry = approvers[index];
  return {
    stepNumber: index + 1,
    total: approvers.length,
    phase: entry.phase ?? (entry.status === 'approved' ? 'approved' : 'queued'),
  };
}

export function ProbationApprovalTracker({
  row,
  compact = false,
  viewerUserId,
}: {
  row: Pick<ProbationRow, 'status' | 'assignedApprovers'>;
  compact?: boolean;
  viewerUserId?: string | null;
}) {
  const approvers = resolveProbationApprovers(row);
  if (!approvers.length) return null;

  const pending = isProbationPendingFinalApproval(row.status);
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
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-amber-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      ) : null}
      <ol className={`flex flex-wrap gap-2 ${compact ? '' : 'gap-3'}`}>
        {approvers.map((entry, index) => {
          const isViewer = String(viewerUserId ?? '') === entry.userId;
          const phase = entry.phase ?? (entry.status === 'approved' ? 'approved' : 'queued');
          const Icon =
            phase === 'approved' ? CheckCircle2 : phase === 'current' ? Clock : Circle;
          const tone =
            phase === 'approved'
              ? 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
              : phase === 'current'
                ? 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
                : 'text-slate-400 border-slate-200 dark:border-slate-700';

          return (
            <li
              key={entry.userId}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${tone} ${
                isViewer ? 'ring-1 ring-primary-400/60' : ''
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium truncate max-w-[8rem]">
                {index + 1}. {entry.name}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function probationRecommendationLabel(
  recommendation: string | null | undefined
): string {
  const r = String(recommendation ?? '').toUpperCase();
  if (r === 'PASS' || r === 'PASSED') return 'Pass';
  if (r === 'EXTEND' || r === 'EXTENDED') return 'Extend';
  if (r === 'FAIL' || r === 'FAILED') return 'Fail';
  return recommendation ?? '—';
}
