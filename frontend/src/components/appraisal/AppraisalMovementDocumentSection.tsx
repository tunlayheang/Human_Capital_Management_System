import React from 'react';
import type { EmployeeAppraisal } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import {
  MovementApprovalTracker,
  MovementChangeLines,
  formatMovementDate,
  movementTypeLabel,
} from '../employee/employeeMovementDisplay';
import {
  isAppraisalMovementReviewVisible,
  plannedMovementFollowUp,
} from './appraisalMovementUtils';

function movementStatusText(row: EmployeeMovementRow): string {
  const canon = String(row.canonicalStatus ?? '').toLowerCase();
  const s = String(row.status ?? '').toLowerCase();
  if (canon === 'draft' || s === 'draft') return 'Draft';
  if (canon === 'pending' || s === 'pending' || s === 'pending_approval') {
    if (row.approvalProgress && row.approvalProgress.total > 1) {
      return `Pending approval (${row.approvalProgress.approved}/${row.approvalProgress.total})`;
    }
    return 'Pending approval';
  }
  if (canon === 'returned' || s === 'returned') return 'Returned';
  if (canon === 'rejected' || s === 'rejected') return 'Rejected';
  if (canon === 'approved' || s === 'approved' || s === 'scheduled') {
    return 'Approved — awaiting effective date';
  }
  if (canon === 'applied' || s === 'applied' || s === 'completed') return 'Applied';
  if (canon === 'cancelled' || s === 'cancelled') return 'Cancelled';
  return 'In progress';
}

function PlannedMovementReviewCard({ appraisal }: { appraisal: EmployeeAppraisal }) {
  const pendingFinal = String(appraisal.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL';
  const planned = plannedMovementFollowUp(appraisal);

  return (
    <div
      className={`rounded-lg border p-3 sm:p-4 ${
        pendingFinal
          ? 'border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/30'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {pendingFinal ? 'Planned follow-up — for your review' : 'Planned follow-up'}
        </p>
        {planned.suggestedTypeLabel ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
            Suggested: {planned.suggestedTypeLabel}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed mb-3">
        {planned.summary}
      </p>
      <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        {planned.detailLines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-slate-400 shrink-0" aria-hidden>
              •
            </span>
            <span className="leading-relaxed">{line}</span>
          </li>
        ))}
      </ul>
      {pendingFinal ? (
        <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-3 leading-relaxed">
          Review this outcome before approving. Employee movement is recorded after final approval.
        </p>
      ) : null}
    </div>
  );
}

export function AppraisalMovementDocumentSection({
  movements,
  appraisal,
}: {
  movements: EmployeeMovementRow[];
  appraisal?: EmployeeAppraisal;
}) {
  const showPlanned =
    appraisal && isAppraisalMovementReviewVisible(appraisal.workflow_status) && !movements.length;

  if (!movements.length && !showPlanned) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 italic leading-relaxed">
        Employee movement follow-up opens when HR submits this appraisal for final approval.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {showPlanned && appraisal ? <PlannedMovementReviewCard appraisal={appraisal} /> : null}
      {movements.map((row) => (
        <div
          key={row.id}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {movementTypeLabel(row.movementType)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Effective {formatMovementDate(row.effectiveDate)}
                {row.createdByName ? ` · Recorded by ${row.createdByName}` : ''}
              </p>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              {movementStatusText(row)}
            </span>
          </div>
          <MovementChangeLines row={row} compact salaryDeltaFormat="percent" />
          {row.notes?.trim() ? (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 whitespace-pre-wrap leading-relaxed">
              {row.notes.trim()}
            </p>
          ) : null}
          <div className="mt-3">
            <MovementApprovalTracker row={row} compact />
          </div>
        </div>
      ))}
    </div>
  );
}

export default AppraisalMovementDocumentSection;
