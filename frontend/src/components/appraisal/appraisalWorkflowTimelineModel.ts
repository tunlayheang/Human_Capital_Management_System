import type { EmployeeAppraisal } from '../../types/appraisal';
import { WORKFLOW_LABELS } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';
import { normalizeWorkflowStatus } from './appraisalWorkflowUi';
import { movementTypeLabel } from '../employee/employeeMovementDisplay';
import {
  isAppraisalMovementReviewVisible,
  plannedMovementFollowUp,
} from './appraisalMovementUtils';

export type WorkflowTimelineStepStatus = 'complete' | 'current' | 'pending' | 'skipped' | 'rejected';

export type WorkflowTimelineStep = {
  id: string;
  title: string;
  status: WorkflowTimelineStepStatus;
  completedAt?: string | null;
  detail?: string | null;
  subSteps?: Array<{
    label: string;
    status: WorkflowTimelineStepStatus;
    completedAt?: string | null;
    detail?: string | null;
  }>;
};

export function formatAppraisalDocumentDateTime(iso?: string | null): string {
  if (!iso?.trim()) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function movementStatusLabel(row: EmployeeMovementRow): string {
  const canon = String(row.canonicalStatus ?? '').toLowerCase();
  const s = String(row.status ?? '').toLowerCase();
  if (canon === 'draft' || s === 'draft') return 'Draft';
  if (canon === 'pending' || s === 'pending' || s === 'pending_approval') return 'Pending approval';
  if (canon === 'returned' || s === 'returned') return 'Returned';
  if (canon === 'rejected' || s === 'rejected') return 'Rejected';
  if (canon === 'approved' || s === 'approved' || s === 'scheduled') return 'Approved — awaiting effective date';
  if (canon === 'applied' || s === 'applied' || s === 'completed') return 'Applied';
  if (canon === 'cancelled' || s === 'cancelled') return 'Cancelled';
  return 'In progress';
}

function stepStatusFromTimestamp(
  completedAt: string | null | undefined,
  isCurrent: boolean
): WorkflowTimelineStepStatus {
  if (completedAt) return 'complete';
  if (isCurrent) return 'current';
  return 'pending';
}

/** Build ordered workflow steps from appraisal creation through movement follow-up. */
export function buildAppraisalWorkflowTimeline(
  appraisal: EmployeeAppraisal,
  linkedMovements: EmployeeMovementRow[] = []
): WorkflowTimelineStep[] {
  const status = normalizeWorkflowStatus(appraisal.workflow_status);
  const steps: WorkflowTimelineStep[] = [];

  if (status === 'REJECTED') {
    steps.push({
      id: 'rejected',
      title: 'Appraisal rejected',
      status: 'rejected',
      completedAt: appraisal.rejected_at ?? null,
      detail: appraisal.rejection_reason?.trim() || 'This appraisal was rejected.',
    });
    return steps;
  }

  const createdAt = appraisal.created_at ?? null;
  steps.push({
    id: 'hr-init',
    title: 'HR KPI scoring',
    status: createdAt ? 'complete' : 'pending',
    completedAt: createdAt,
    detail: appraisal.periodName
      ? `Appraisal opened for ${appraisal.periodName}.`
      : 'Appraisal record created.',
  });

  const routedAt = appraisal.routed_at ?? null;
  const managerCurrent = status === 'PENDING_MANAGER' || status === 'MANAGER_REVIEW';
  steps.push({
    id: 'route-manager',
    title: 'Routed to manager',
    status: stepStatusFromTimestamp(routedAt, managerCurrent && !routedAt),
    completedAt: routedAt,
    detail: appraisal.assignedManagerName
      ? `Assigned to ${appraisal.assignedManagerName} for evaluation.`
      : routedAt
        ? 'Routed for manager evaluation.'
        : 'Waiting to assign a manager reviewer.',
  });

  const managerAt = appraisal.manager_submitted_at ?? null;
  const employeeCurrent = status === 'PENDING_EMPLOYEE';
  steps.push({
    id: 'manager-eval',
    title: 'Manager evaluation',
    status: stepStatusFromTimestamp(managerAt, managerCurrent),
    completedAt: managerAt,
    detail: managerAt
      ? 'Manager submitted KPI scores and written evaluation.'
      : managerCurrent
        ? 'Manager review in progress.'
        : 'Awaiting manager evaluation.',
  });

  const selfAt = appraisal.self_review_at ?? null;
  const hrCurrent =
    status === 'PENDING_HR' || status === 'HR_REVIEW' || status === 'SUBMITTED';
  steps.push({
    id: 'employee-self',
    title: 'Employee self-evaluation',
    status: stepStatusFromTimestamp(selfAt, employeeCurrent),
    completedAt: selfAt,
    detail: selfAt
      ? 'Employee completed self-evaluation.'
      : employeeCurrent
        ? 'Waiting for employee self-evaluation.'
        : managerAt
          ? 'Not yet submitted by employee.'
          : 'Opens after manager evaluation.',
  });

  const hrAt = appraisal.hr_approved_at ?? null;
  const finalCurrent = status === 'PENDING_FINAL_APPROVAL';
  steps.push({
    id: 'hr-finalize',
    title: 'HR evaluation & submission',
    status: stepStatusFromTimestamp(
      hrAt,
      hrCurrent && !hrAt
    ),
    completedAt: hrAt,
    detail: hrAt
      ? 'HR finalized scores and submitted for final approval.'
      : hrCurrent
        ? 'HR is reviewing combined scores before final submission.'
        : finalCurrent || status === 'APPROVED' || status === 'CLOSED'
          ? 'Submitted for final approval routing.'
          : 'Awaiting HR finalization.',
  });

  const approvers = appraisal.assignedFinalApprovers ?? [];
  if (approvers.length) {
    const approvedCount = approvers.filter((a) => a.status === 'approved').length;
    const allApproved = approvedCount === approvers.length;
    steps.push({
      id: 'final-approval',
      title: 'Final approval chain',
      status: allApproved
        ? 'complete'
        : finalCurrent
          ? 'current'
          : approvedCount > 0
            ? 'current'
            : 'pending',
      completedAt: allApproved ? appraisal.final_approved_at ?? approvers.at(-1)?.approvedAt : null,
      detail: allApproved
        ? `${approvers.length} approver${approvers.length === 1 ? '' : 's'} signed off.`
        : finalCurrent
          ? `Step ${approvedCount + 1} of ${approvers.length}${
              appraisal.currentApproverName ? ` — ${appraisal.currentApproverName}` : ''
            }.`
          : `${approvedCount} of ${approvers.length} approvals recorded.`,
      subSteps: approvers.map((entry, index) => ({
        label: entry.name?.trim() || `Approver ${index + 1}`,
        status:
          entry.status === 'approved'
            ? 'complete'
            : entry.phase === 'current' || appraisal.currentApproverUserId === entry.userId
              ? 'current'
              : 'pending',
        completedAt: entry.approvedAt ?? null,
        detail:
          entry.status === 'approved'
            ? 'Approved'
            : entry.phase === 'current'
              ? 'Awaiting review'
              : 'Waiting for earlier approvers',
      })),
    });
  } else if (finalCurrent || status === 'APPROVED' || status === 'CLOSED') {
    steps.push({
      id: 'final-approval',
      title: 'Final approval',
      status: status === 'APPROVED' || status === 'CLOSED' ? 'complete' : 'current',
      completedAt: appraisal.final_approved_at ?? null,
      detail:
        status === 'APPROVED' || status === 'CLOSED'
          ? 'Final approval recorded.'
          : 'Awaiting final approver sign-off.',
    });
  }

  if (appraisal.returned_at) {
    steps.push({
      id: 'returned',
      title: 'Returned to HR',
      status: 'complete',
      completedAt: appraisal.returned_at,
      detail: appraisal.return_notes?.trim() || 'Returned during approval review.',
    });
  }

  const pendingFinal = status === 'PENDING_FINAL_APPROVAL';
  const movementReviewVisible = isAppraisalMovementReviewVisible(status);
  const planned = plannedMovementFollowUp(appraisal);

  if (linkedMovements.length) {
    const allApplied = linkedMovements.every(
      (m) =>
        String(m.canonicalStatus ?? m.status).toLowerCase() === 'applied' ||
        String(m.status).toLowerCase() === 'completed'
    );
    steps.push({
      id: 'movement',
      title: 'Employee movement follow-up',
      status: allApplied ? 'complete' : 'current',
      detail: pendingFinal
        ? `For your review — ${linkedMovements.length} linked movement record${linkedMovements.length === 1 ? '' : 's'} plus outcome below.`
        : `${linkedMovements.length} movement record${linkedMovements.length === 1 ? '' : 's'} linked to this appraisal.`,
      subSteps: linkedMovements.map((m) => ({
        label: movementTypeLabel(m.movementType),
        status:
          ['applied', 'completed'].includes(String(m.canonicalStatus ?? m.status).toLowerCase()) ||
          String(m.status).toLowerCase() === 'applied'
            ? 'complete'
            : ['rejected', 'cancelled'].includes(String(m.canonicalStatus ?? m.status).toLowerCase())
              ? 'rejected'
              : pendingFinal || !allApplied
                ? 'current'
                : 'pending',
        completedAt: m.appliedAt ?? m.approvedAt ?? m.createdAt ?? null,
        detail: [
          movementStatusLabel(m),
          m.effectiveDate ? `Effective ${m.effectiveDate}` : null,
          m.fromPositionTitle || m.toPositionTitle
            ? `${m.fromPositionTitle || '—'} → ${m.toPositionTitle || '—'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    });
  } else if (movementReviewVisible) {
    steps.push({
      id: 'movement',
      title: 'Employee movement follow-up',
      status: pendingFinal ? 'current' : 'pending',
      detail: pendingFinal
        ? `For your review — ${planned.summary}`
        : 'No employee movement recorded yet. Record promotion, transfer, or pay change if applicable.',
      subSteps: planned.detailLines.map((line) => {
        const colon = line.indexOf(':');
        const label = colon > 0 ? line.slice(0, colon).trim() : 'Follow-up';
        const detail = colon > 0 ? line.slice(colon + 1).trim() : line;
        return {
          label,
          status: pendingFinal ? ('current' as const) : ('pending' as const),
          detail,
        };
      }),
    });
  } else {
    steps.push({
      id: 'movement',
      title: 'Employee movement follow-up',
      status: 'skipped',
      detail: 'Opens when HR submits the appraisal for final approval.',
    });
  }

  return steps;
}

export function workflowStatusSummaryLabel(status: string | undefined): string {
  const normalized = normalizeWorkflowStatus(status);
  return WORKFLOW_LABELS[normalized] ?? normalized;
}
