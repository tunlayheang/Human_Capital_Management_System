import type { AppraisalWorkflowStatus } from '../../types/appraisal';
import { WORKFLOW_LABELS } from '../../types/appraisal';

export type AppraisalListPhase = 'review' | 'appraised' | 'movement';

export type WorkflowStep = {
  id: string;
  label: string;
  statuses: AppraisalWorkflowStatus[];
};

export const APPRAISAL_WORKFLOW_STEPS: WorkflowStep[] = [
  { id: 'score', label: 'HR', statuses: ['DRAFT', 'REOPENED', 'SELF_REVIEW', 'PENDING_REVIEW', 'SUPERVISOR_EVALUATION'] },
  { id: 'manager', label: 'Manager', statuses: ['MANAGER_REVIEW', 'PENDING_MANAGER'] },
  { id: 'employee', label: 'Employee', statuses: ['PENDING_EMPLOYEE'] },
  { id: 'hr', label: 'Evaluation', statuses: ['PENDING_HR', 'HR_REVIEW', 'SUBMITTED'] },
  { id: 'approved', label: 'Approved', statuses: ['APPROVED', 'CLOSED'] },
];

export type WorkflowActionDef = {
  action: string;
  label: string;
  variant?: 'primary' | 'outline' | 'danger';
  notes?: string;
};

export function workflowStepIndex(status: AppraisalWorkflowStatus): number {
  const normalized = normalizeWorkflowStatus(status);
  const idx = APPRAISAL_WORKFLOW_STEPS.findIndex((s) => s.statuses.includes(normalized));
  if (normalized === 'REJECTED') return 1;
  return idx >= 0 ? idx : 0;
}

export function normalizeWorkflowStatus(status: AppraisalWorkflowStatus | string | undefined): AppraisalWorkflowStatus {
  const raw = String(status ?? 'DRAFT').trim().toUpperCase();
  if (raw === 'REOPENED') return 'REOPENED';
  if (raw === 'DRAFT') return 'DRAFT';
  if (raw === 'PENDING_MANAGER') return 'PENDING_MANAGER';
  if (raw === 'PENDING_EMPLOYEE') return 'PENDING_EMPLOYEE';
  if (raw === 'PENDING_HR') return 'PENDING_HR';
  if (raw === 'APPROVED') return 'APPROVED';
  if (raw === 'CLOSED') return 'CLOSED';
  if (raw === 'REJECTED') return 'REJECTED';
  if (raw === 'MANAGER_REVIEW') return 'MANAGER_REVIEW';
  if (raw === 'HR_REVIEW') return 'HR_REVIEW';
  if (raw === 'SUBMITTED') return 'SUBMITTED';
  if (raw === 'PENDING_FINAL_APPROVAL') return 'PENDING_FINAL_APPROVAL';
  if (raw === 'SELF_REVIEW') return 'SELF_REVIEW';
  if (raw === 'PENDING_REVIEW') return 'PENDING_REVIEW';
  if (raw === 'SUPERVISOR_EVALUATION') return 'SUPERVISOR_EVALUATION';
  return 'DRAFT';
}

/** True only when HR explicitly reopened a previously finalized/rejected case. */
export function isReopenedAppraisalStatus(status: AppraisalWorkflowStatus | string | undefined): boolean {
  return normalizeWorkflowStatus(status) === 'REOPENED';
}

export function scoreStepDisplayLabel(status: AppraisalWorkflowStatus | string | undefined): string {
  return isReopenedAppraisalStatus(status) ? 'Reopened' : 'HR';
}

export type WorkflowStatusBadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Badge label + color for list rows and detail headers. */
export function workflowStatusBadgeMeta(
  status: AppraisalWorkflowStatus | string | undefined
): { label: string; variant: WorkflowStatusBadgeVariant } {
  const normalized = normalizeWorkflowStatus(status);
  switch (normalized) {
    case 'REOPENED':
      return { label: WORKFLOW_LABELS.REOPENED, variant: 'warning' };
    case 'PENDING_MANAGER':
    case 'MANAGER_REVIEW':
      return { label: WORKFLOW_LABELS[normalized], variant: 'info' };
    case 'PENDING_EMPLOYEE':
      return { label: WORKFLOW_LABELS.PENDING_EMPLOYEE, variant: 'info' };
    case 'PENDING_HR':
    case 'HR_REVIEW':
    case 'SUBMITTED':
    case 'PENDING_FINAL_APPROVAL':
      return { label: WORKFLOW_LABELS[normalized] ?? normalized, variant: 'warning' };
    case 'APPROVED':
    case 'CLOSED':
      return { label: WORKFLOW_LABELS[normalized], variant: 'success' };
    case 'REJECTED':
      return { label: WORKFLOW_LABELS.REJECTED, variant: 'danger' };
    case 'DRAFT':
      return { label: WORKFLOW_LABELS.DRAFT, variant: 'neutral' };
    case 'SELF_REVIEW':
    case 'PENDING_REVIEW':
    case 'SUPERVISOR_EVALUATION':
      return { label: WORKFLOW_LABELS[normalized], variant: 'neutral' };
    default:
      return { label: WORKFLOW_LABELS[normalized] ?? normalized, variant: 'neutral' };
  }
}

export function workflowStatusHint(status: AppraisalWorkflowStatus, locked: boolean): string {
  const normalized = normalizeWorkflowStatus(status);
  if (normalized === 'REJECTED') return 'This appraisal was rejected. Reopen to edit and resubmit.';
  if (locked || normalized === 'APPROVED' || normalized === 'CLOSED') {
    return 'Finalized — record employee movement if a promotion or pay change applies.';
  }
  switch (normalized) {
    case 'DRAFT':
      return 'Enter manual KPI scores, add required comments, then advance the workflow.';
    case 'SELF_REVIEW':
      return 'Employee self-review stage — submit when ready for supervisor review.';
    case 'PENDING_REVIEW':
    case 'SUPERVISOR_EVALUATION':
      return 'Supervisor review — confirm scores and send to manager review.';
    case 'MANAGER_REVIEW':
    case 'PENDING_MANAGER':
      return 'Manager review — complete evaluation and submit for employee self-evaluation.';
    case 'PENDING_EMPLOYEE':
      return 'Waiting for the employee to complete their self-evaluation before HR can finalize.';
    case 'REOPENED':
      return 'Reopened — update KPI scores, then route to a manager for evaluation.';
    case 'PENDING_HR':
    case 'HR_REVIEW':
    case 'SUBMITTED':
      return 'Evaluation — review combined scores, select an approver, then submit for final approval.';
    case 'PENDING_FINAL_APPROVAL':
      return 'Waiting for the current approver in the chain to approve, reject, or return this appraisal.';
    default:
      return WORKFLOW_LABELS[normalized] ?? normalized;
  }
}

/** Primary and secondary actions shown for the current workflow state. */
export function workflowActionsForStatus(
  status: AppraisalWorkflowStatus,
  locked: boolean
): { primary: WorkflowActionDef | null; secondary: WorkflowActionDef[] } {
  if (locked) {
    return {
      primary: null,
      secondary: [{ action: 'reopen', label: 'Reopen & return to manager', variant: 'outline' }],
    };
  }
  if (status === 'REJECTED') {
    return {
      primary: { action: 'reopen', label: 'Reopen appraisal', variant: 'primary' },
      secondary: [],
    };
  }

  const secondary: WorkflowActionDef[] = [];

  switch (status) {
    case 'DRAFT':
      return {
        primary: { action: 'route_to_manager', label: 'Route for evaluation', variant: 'primary' },
        secondary: [
          { action: 'supervisor_submit', label: 'Legacy: supervisor review', variant: 'outline' },
          { action: 'self_review', label: 'Mark self review', variant: 'outline' },
        ],
      };
    case 'SELF_REVIEW':
      return {
        primary: { action: 'supervisor_submit', label: 'Submit for supervisor review', variant: 'primary' },
        secondary: [],
      };
    case 'PENDING_REVIEW':
    case 'SUPERVISOR_EVALUATION':
      return {
        primary: { action: 'manager_review', label: 'Send to manager review', variant: 'primary' },
        secondary: [],
      };
    case 'MANAGER_REVIEW':
      return {
        primary: { action: 'submit_to_hr', label: 'Submit for employee review', variant: 'primary' },
        secondary: [{ action: 'hr_approve', label: 'Send to HR (direct)', variant: 'outline' }],
      };
    case 'PENDING_MANAGER':
      return {
        primary: { action: 'submit_to_hr', label: 'Submit for employee review', variant: 'primary' },
        secondary: [],
      };
    case 'REOPENED':
      return {
        primary: { action: 'route_to_manager', label: 'Route for evaluation', variant: 'primary' },
        secondary: [],
      };
    case 'PENDING_HR':
      return {
        primary: { action: 'submit_for_final_approval', label: 'Submit for approval', variant: 'primary' },
        secondary: [],
      };
    case 'PENDING_FINAL_APPROVAL':
      return { primary: null, secondary: [] };
    case 'HR_REVIEW':
    case 'SUBMITTED':
      return {
        primary: { action: 'submit_for_final_approval', label: 'Submit for approval', variant: 'primary' },
        secondary: [],
      };
    case 'APPROVED':
    case 'CLOSED':
      return { primary: null, secondary: [] };
    default:
      return {
        primary: { action: 'supervisor_submit', label: 'Advance workflow', variant: 'primary' },
        secondary: [],
      };
  }
}

export type AppraisalReviewTabId =
  | 'all'
  | 'pending_manager'
  | 'pending_employee'
  | 'pending_hr'
  | 'pending_approval'
  | 'reopened'
  | 'in_progress';

export const APPRAISAL_REVIEW_TAB_DEFS: Array<{
  id: AppraisalReviewTabId;
  label: string;
  statuses: AppraisalWorkflowStatus[] | null;
}> = [
  {
    id: 'in_progress',
    label: 'Scoring',
    statuses: [
      'DRAFT',
      'SELF_REVIEW',
      'PENDING_REVIEW',
      'SUPERVISOR_EVALUATION',
      'MANAGER_REVIEW',
      'HR_REVIEW',
      'SUBMITTED',
    ],
  },
  { id: 'pending_manager', label: 'Pending manager', statuses: ['PENDING_MANAGER'] },
  { id: 'pending_employee', label: 'Pending employee', statuses: ['PENDING_EMPLOYEE'] },
  { id: 'pending_hr', label: 'Pending HR', statuses: ['PENDING_HR'] },
  { id: 'pending_approval', label: 'Pending approval', statuses: ['PENDING_FINAL_APPROVAL'] },
  { id: 'reopened', label: 'Reopened', statuses: ['REOPENED'] },
  { id: 'all', label: 'All in review', statuses: null },
];

export function filterAppraisalsByReviewTab<
  T extends { workflow_status: AppraisalWorkflowStatus },
>(rows: T[], tabId: AppraisalReviewTabId): T[] {
  if (tabId === 'all') return rows;
  const def = APPRAISAL_REVIEW_TAB_DEFS.find((t) => t.id === tabId);
  if (!def?.statuses) return rows;
  return rows.filter((r) => def.statuses!.includes(normalizeWorkflowStatus(r.workflow_status)));
}

export function buildAppraisalReviewTabs<T extends { workflow_status: AppraisalWorkflowStatus }>(
  rows: T[]
) {
  return APPRAISAL_REVIEW_TAB_DEFS.map((def) => ({
    ...def,
    count:
      def.id === 'all'
        ? rows.length
        : rows.filter((r) => def.statuses?.includes(normalizeWorkflowStatus(r.workflow_status))).length,
  }));
}

export const PHASE_META: Record<
  AppraisalListPhase,
  { title: string; subtitle: string; empty: string }
> = {
  review: {
    title: 'In review',
    subtitle: 'Score and advance each employee',
    empty: 'No active reviews. Generate appraisals or check Awaiting movement / Complete tabs.',
  },
  appraised: {
    title: 'Awaiting movement',
    subtitle: 'Final approved — record promotion or pay change',
    empty: 'No finalized appraisals waiting for movement.',
  },
  movement: {
    title: 'Complete',
    subtitle: 'Movement recorded from appraisal',
    empty: 'No completed appraisal movements yet.',
  },
};

/** Tabs for assigned evaluators: keep submitted work as proof after scoring. */
export const EVALUATOR_PHASE_META: Record<
  AppraisalListPhase,
  { title: string; subtitle: string; empty: string }
> = {
  review: {
    title: 'Needs evaluation',
    subtitle: 'Staff assigned to you for scoring',
    empty: 'No appraisals waiting for your evaluation.',
  },
  appraised: {
    title: 'Submitted',
    subtitle: 'Your completed evaluations — keep for tracking and proof',
    empty: 'No submitted evaluations yet. Completed reviews will appear here.',
  },
  movement: {
    title: 'Complete',
    subtitle: 'Unused for evaluator view',
    empty: '',
  },
};
