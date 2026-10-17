import React, { useMemo } from 'react';
import type { EmployeeAppraisal, ComponentScore } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import { formatAppraisalScore } from '../../types/appraisal';
import { CombinedEvaluatorScoresTable } from './CombinedEvaluatorScoresTable';
import { resolveAppraisalEvaluators } from './appraisalApprovalDisplay';
import { parseEmployeeEvaluationPayload } from './appraisalDetailUtils';
import { AppraisalApprovalTracker } from './appraisalApprovalDisplay';
import { AppraisalWorkflowTimeline } from './AppraisalWorkflowTimeline';
import { AppraisalMovementDocumentSection } from './AppraisalMovementDocumentSection';
import { workflowStatusSummaryLabel } from './appraisalWorkflowTimelineModel';

type Props = {
  appraisal: EmployeeAppraisal;
  componentScores: ComponentScore[];
  linkedMovements?: EmployeeMovementRow[];
  showApprovalTracker?: boolean;
  viewerUserId?: string | null;
  /** Applied for PDF capture — forces light document styling. */
  exportMode?: boolean;
};

function DocumentSection({
  title,
  children,
  exportMode = false,
}: {
  title: string;
  children: React.ReactNode;
  exportMode?: boolean;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h2
        className={`text-[11px] font-bold uppercase tracking-[0.14em] border-b pb-1.5 mb-3 ${
          exportMode
            ? 'text-slate-600 border-slate-300'
            : 'text-slate-500 border-slate-200 dark:border-slate-700'
        }`}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function NarrativeBlock({
  label,
  text,
  exportMode = false,
}: {
  label: string;
  text: string | null | undefined;
  exportMode?: boolean;
}) {
  if (!text?.trim()) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p
        className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${
          exportMode ? 'text-slate-600' : 'text-slate-500'
        }`}
      >
        {label}
      </p>
      <p
        className={`text-sm whitespace-pre-wrap leading-relaxed ${
          exportMode ? 'text-slate-900' : 'text-slate-800 dark:text-slate-200'
        }`}
      >
        {text.trim()}
      </p>
    </div>
  );
}

export const AppraisalReviewDocument: React.FC<Props> = ({
  appraisal,
  componentScores,
  linkedMovements = [],
  showApprovalTracker = true,
  viewerUserId,
  exportMode = false,
}) => {
  const managerSubmitted = Boolean(appraisal.manager_submitted_at);
  const employeeSubmitted = Boolean(appraisal.self_review_at);
  const employeeEvaluation = useMemo(
    () => parseEmployeeEvaluationPayload(appraisal.outcome_payload_json),
    [appraisal.outcome_payload_json]
  );
  const showFinalApproval =
    showApprovalTracker &&
    (String(appraisal.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL' ||
      appraisal.assignedFinalApprovers?.length);

  const evaluatorRefs = useMemo(
    () =>
      resolveAppraisalEvaluators(appraisal).map((ev) => ({
        userId: ev.userId,
        name: ev.name,
        submitted: ev.phase === 'submitted',
      })),
    [appraisal]
  );

  const shellClass = exportMode
    ? 'mx-auto max-w-3xl rounded-lg border border-slate-300 bg-white shadow-none text-slate-900'
    : 'mx-auto max-w-3xl rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm print:shadow-none print:border-slate-300';

  return (
    <article className={shellClass} data-appraisal-review-document="">
      <div
        className={`px-6 sm:px-8 pt-6 sm:pt-8 pb-4 border-b ${
          exportMode ? 'border-slate-300' : 'border-slate-200 dark:border-slate-700'
        }`}
      >
        <p
          className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
            exportMode ? 'text-blue-800' : 'text-primary-600 dark:text-primary-400'
          }`}
        >
          Performance Appraisal Record
        </p>
        <h1
          className={`mt-2 text-xl sm:text-2xl font-bold leading-tight ${
            exportMode ? 'text-slate-900' : 'text-slate-900 dark:text-white'
          }`}
        >
          {appraisal.employeeName ?? 'Employee'}
        </h1>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {appraisal.employeeCode ? (
            <div className="flex gap-2">
              <dt className="text-slate-500 shrink-0">Employee ID</dt>
              <dd className="font-medium tabular-nums">{appraisal.employeeCode}</dd>
            </div>
          ) : null}
          {appraisal.periodName ? (
            <div className="flex gap-2">
              <dt className="text-slate-500 shrink-0">Period</dt>
              <dd className="font-medium">{appraisal.periodName}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="text-slate-500 shrink-0">Workflow status</dt>
            <dd className="font-medium">{workflowStatusSummaryLabel(appraisal.workflow_status)}</dd>
          </div>
          {appraisal.assignedManagerName ? (
            <div className="flex gap-2 sm:col-span-2">
              <dt className="text-slate-500 shrink-0">Evaluating manager</dt>
              <dd className="font-medium">{appraisal.assignedManagerName}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="px-6 sm:px-8 py-5 sm:py-6">
        <DocumentSection title="Workflow history" exportMode={exportMode}>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            Complete path from HR scoring through manager and employee review, final approval, and
            employee movement follow-up.
          </p>
          <AppraisalWorkflowTimeline
            appraisal={appraisal}
            linkedMovements={linkedMovements}
          />
        </DocumentSection>

        <DocumentSection title="Overall outcome" exportMode={exportMode}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                exportMode
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Weighted score
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {appraisal.weighted_score != null
                  ? formatAppraisalScore(appraisal.weighted_score)
                  : '—'}
              </p>
            </div>
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                exportMode
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Grade</p>
              <p className="mt-1 text-lg font-bold">{appraisal.final_grade ?? '—'}</p>
            </div>
            <div
              className={`rounded-lg border px-3 py-2.5 sm:col-span-2 ${
                exportMode
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40'
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Recommendation
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug">
                {appraisal.recommendation?.trim() || '—'}
              </p>
            </div>
          </div>
        </DocumentSection>

        {componentScores.length ? (
          <DocumentSection title="KPI component scores" exportMode={exportMode}>
            <CombinedEvaluatorScoresTable
              componentScores={componentScores}
              evaluators={evaluatorRefs}
              compact={exportMode}
              description={
                employeeSubmitted
                  ? 'Combined average from all management evaluators and the employee self-evaluation.'
                  : 'Combined average from all management evaluators who scored this appraisal.'
              }
            />
          </DocumentSection>
        ) : null}

        {appraisal.strengths ||
        appraisal.weaknesses ||
        appraisal.manager_recommendations ||
        managerSubmitted ? (
          <DocumentSection title="Manager evaluation" exportMode={exportMode}>
            <NarrativeBlock label="Strengths" text={appraisal.strengths} exportMode={exportMode} />
            <NarrativeBlock
              label="Areas for improvement"
              text={appraisal.weaknesses}
              exportMode={exportMode}
            />
            <NarrativeBlock
              label="Recommendations"
              text={appraisal.manager_recommendations}
              exportMode={exportMode}
            />
            {!appraisal.strengths &&
            !appraisal.weaknesses &&
            !appraisal.manager_recommendations ? (
              <p className="text-sm text-slate-500 italic">No written manager feedback recorded.</p>
            ) : null}
          </DocumentSection>
        ) : null}

        {employeeSubmitted ? (
          <DocumentSection title="Employee self-evaluation" exportMode={exportMode}>
            <NarrativeBlock
              label="Strengths"
              text={employeeEvaluation?.strengths as string | undefined}
              exportMode={exportMode}
            />
            <NarrativeBlock
              label="Areas for improvement"
              text={employeeEvaluation?.weaknesses as string | undefined}
              exportMode={exportMode}
            />
            {appraisal.self_review_notes ? (
              <NarrativeBlock
                label="Additional notes"
                text={appraisal.self_review_notes}
                exportMode={exportMode}
              />
            ) : null}
          </DocumentSection>
        ) : null}

        {showFinalApproval ? (
          <DocumentSection title="Final approval routing" exportMode={exportMode}>
            <AppraisalApprovalTracker appraisal={appraisal} viewerUserId={viewerUserId} />
          </DocumentSection>
        ) : null}

        <DocumentSection title="Employee movement follow-up" exportMode={exportMode}>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            {String(appraisal.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL'
              ? 'Review the planned promotion, transfer, or pay outcome below as part of your approval decision.'
              : 'Promotion, transfer, or pay changes linked to this appraisal outcome.'}
          </p>
          <AppraisalMovementDocumentSection movements={linkedMovements} appraisal={appraisal} />
        </DocumentSection>
      </div>

      <footer
        className={`px-6 sm:px-8 py-3 border-t ${
          exportMode
            ? 'border-slate-300 bg-slate-50'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30'
        }`}
      >
        <p className="text-[10px] text-slate-400 text-center">
          Confidential — internal performance appraisal record
        </p>
      </footer>
    </article>
  );
};

export default AppraisalReviewDocument;
