import React from 'react';
import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import type { WorkflowApprovalStep } from '../../utils/workflowRequestApproval';

type Props = {
  steps: WorkflowApprovalStep[];
  compact?: boolean;
  viewerUserId?: string | null;
};

function stepStatusLabel(step: WorkflowApprovalStep): string {
  if (step.phase === 'approved') return 'Approved';
  if (step.phase === 'rejected') return 'Rejected';
  if (step.phase === 'skipped') return 'Skipped';
  if (step.phase === 'current') {
    if (step.name === 'Up next') return 'Up next';
    if (step.name === 'Pending review') return 'Pending';
    return 'Reviewing';
  }
  return 'Waiting';
}

function StepPhaseIcon({ phase }: { phase: WorkflowApprovalStep['phase'] }) {
  if (phase === 'skipped') {
    return (
      <span
        className="w-3 h-3 shrink-0 mt-0.5 rounded-full bg-slate-400 dark:bg-slate-500"
        aria-hidden
      />
    );
  }
  if (phase === 'approved') {
    return (
      <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
    );
  }
  if (phase === 'rejected') {
    return <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" aria-hidden />;
  }
  if (phase === 'current') {
    return <Clock className="w-3 h-3 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />;
  }
  return <Circle className="w-3 h-3 shrink-0 mt-0.5 text-slate-300 dark:text-slate-600" aria-hidden />;
}

export function WorkflowRequestApprovalTracker({
  steps,
  compact = true,
  viewerUserId,
}: Props) {
  if (!steps.length) return null;

  return (
    <ol
      className={`min-w-0 flex-1 space-y-1 ${compact ? 'text-[10px]' : 'text-xs'}`}
      aria-label="Approval chain"
    >
      {steps.map((step) => {
        const isViewer = !!viewerUserId && step.key === viewerUserId;
        const statusLabel = stepStatusLabel(step);

        return (
          <li key={step.key} className="flex items-start gap-1.5 min-w-0">
            <StepPhaseIcon phase={step.phase} />
            <div className="min-w-0 flex-1 leading-snug">
              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
                <span
                  className={`font-medium ${
                    isViewer
                      ? 'text-primary-700 dark:text-primary-300'
                      : step.phase === 'current'
                        ? 'text-slate-800 dark:text-slate-100'
                        : step.phase === 'approved' || step.phase === 'rejected'
                          ? 'text-slate-700 dark:text-slate-200'
                          : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {steps.length > 1 ? `${step.label}: ` : ''}
                  {step.name}
                </span>
                <span
                  className={`shrink-0 ${
                    step.phase === 'approved'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : step.phase === 'rejected'
                        ? 'text-rose-700 dark:text-rose-300'
                        : step.phase === 'current'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  · {statusLabel}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type StatusWithChainProps = {
  statusNode: React.ReactNode;
  steps: WorkflowApprovalStep[];
  viewerUserId?: string | null;
  /**
   * `inline` — badge + chain side-by-side (desktop tables).
   * `stack` — badge above chain (mobile cards; avoids overflow/overlap).
   */
  layout?: 'inline' | 'stack';
};

/** Status badge with approval steps (beside it or stacked). */
export function RequestStatusWithApprovalChain({
  statusNode,
  steps,
  viewerUserId,
  layout = 'inline',
}: StatusWithChainProps) {
  if (!steps.length) {
    return <>{statusNode}</>;
  }

  if (layout === 'stack') {
    return (
      <div className="min-w-0 w-full space-y-1.5">
        <div className="min-w-0">{statusNode}</div>
        <WorkflowRequestApprovalTracker steps={steps} compact viewerUserId={viewerUserId} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 min-w-0 max-w-full sm:min-w-[11rem] sm:max-w-xs">
      <div className="shrink-0 pt-0.5 max-w-full">{statusNode}</div>
      <WorkflowRequestApprovalTracker steps={steps} compact viewerUserId={viewerUserId} />
    </div>
  );
}
