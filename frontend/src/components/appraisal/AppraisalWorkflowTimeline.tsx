import React from 'react';
import { CheckCircle2, Circle, Clock, MinusCircle, XCircle } from 'lucide-react';
import {
  buildAppraisalWorkflowTimeline,
  formatAppraisalDocumentDateTime,
  type WorkflowTimelineStep,
  type WorkflowTimelineStepStatus,
} from './appraisalWorkflowTimelineModel';
import type { EmployeeAppraisal } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';

function StepIcon({ status }: { status: WorkflowTimelineStepStatus }) {
  if (status === 'complete') {
    return (
      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
    );
  }
  if (status === 'current') {
    return <Clock className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />;
  }
  if (status === 'rejected') {
    return <XCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />;
  }
  if (status === 'skipped') {
    return <MinusCircle className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />;
  }
  return <Circle className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />;
}

function statusPill(status: WorkflowTimelineStepStatus): string {
  switch (status) {
    case 'complete':
      return 'text-emerald-700 dark:text-emerald-300';
    case 'current':
      return 'text-primary-700 dark:text-primary-300';
    case 'rejected':
      return 'text-red-700 dark:text-red-300';
    case 'skipped':
      return 'text-slate-400 dark:text-slate-500';
    default:
      return 'text-slate-500 dark:text-slate-400';
  }
}

function statusWord(
  status: WorkflowTimelineStepStatus,
  step?: WorkflowTimelineStep,
  appraisalStatus?: string
): string {
  if (
    step?.id === 'movement' &&
    status === 'current' &&
    String(appraisalStatus ?? '') === 'PENDING_FINAL_APPROVAL'
  ) {
    return 'For review';
  }
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'current':
      return 'In progress';
    case 'rejected':
      return 'Rejected';
    case 'skipped':
      return 'Not started';
    default:
      return 'Pending';
  }
}

function TimelineStepRow({
  step,
  isLast,
  appraisalStatus,
}: {
  step: WorkflowTimelineStep;
  isLast: boolean;
  appraisalStatus?: string;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast ? (
        <span
          className="absolute left-[7px] top-5 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden
        />
      ) : null}
      <div className="relative z-[1] mt-0.5">
        <StepIcon status={step.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{step.title}</p>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${statusPill(step.status)}`}>
            {statusWord(step.status, step, appraisalStatus)}
          </span>
        </div>
        {step.completedAt ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            {formatAppraisalDocumentDateTime(step.completedAt)}
          </p>
        ) : null}
        {step.detail ? (
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{step.detail}</p>
        ) : null}
        {step.subSteps?.length ? (
          <ul className="mt-2 space-y-1.5 rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 px-2.5 py-2">
            {step.subSteps.map((sub, index) => (
              <li key={`${step.id}-${index}`} className="flex items-start gap-2 text-[11px] min-w-0">
                <StepIcon status={sub.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{sub.label}</span>
                    <span className={`shrink-0 font-medium ${statusPill(sub.status)}`}>
                      {statusWord(sub.status, step, appraisalStatus)}
                    </span>
                  </div>
                  {sub.completedAt ? (
                    <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">
                      {formatAppraisalDocumentDateTime(sub.completedAt)}
                    </p>
                  ) : null}
                  {sub.detail ? (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{sub.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function AppraisalWorkflowTimeline({
  appraisal,
  linkedMovements = [],
  compact = false,
}: {
  appraisal: EmployeeAppraisal;
  linkedMovements?: EmployeeMovementRow[];
  compact?: boolean;
}) {
  const steps = buildAppraisalWorkflowTimeline(appraisal, linkedMovements);
  if (!steps.length) return null;

  return (
    <div
      className={`rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      }`}
    >
      <ul className="list-none m-0 p-0">{steps.map((step, index) => (
        <TimelineStepRow
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
          appraisalStatus={appraisal.workflow_status}
        />
      ))}</ul>
    </div>
  );
}

export default AppraisalWorkflowTimeline;
