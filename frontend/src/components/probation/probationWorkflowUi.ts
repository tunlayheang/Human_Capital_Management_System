import type { ProbationReviewStatus } from '../../types';

export type ProbationWorkflowStep = {
  id: string;
  label: string;
  statuses: ProbationReviewStatus[];
};

export const PROBATION_WORKFLOW_STEPS: ProbationWorkflowStep[] = [
  {
    id: 'hr',
    label: 'HR',
    statuses: ['UPCOMING', 'REVIEW_DUE', 'IN_REVIEW', 'EXTENDED'],
  },
  { id: 'manager', label: 'Manager', statuses: ['PENDING_MANAGER'] },
  { id: 'employee', label: 'Employee', statuses: ['PENDING_EMPLOYEE'] },
  {
    id: 'evaluation',
    label: 'Evaluation',
    statuses: ['PENDING_HR', 'PENDING_FINAL_APPROVAL'],
  },
  { id: 'complete', label: 'Complete', statuses: ['PASSED', 'EXTENDED', 'FAILED', 'REJECTED'] },
];

export function probationWorkflowStepIndex(status: ProbationReviewStatus): number {
  const idx = PROBATION_WORKFLOW_STEPS.findIndex((s) => s.statuses.includes(status));
  return idx >= 0 ? idx : 0;
}

export function probationWorkflowStatusHint(
  status: ProbationReviewStatus,
  completed: boolean
): string {
  if (completed) {
    return 'Finalized — probation outcome recorded.';
  }
  switch (status) {
    case 'UPCOMING':
    case 'REVIEW_DUE':
    case 'IN_REVIEW':
    case 'EXTENDED':
      return 'Route to a manager for evaluation, or enter ratings directly when no manager is assigned.';
    case 'PENDING_MANAGER':
      return 'Manager review — complete evaluation and submit for employee self-evaluation.';
    case 'PENDING_EMPLOYEE':
      return 'Waiting for the employee to complete their self-evaluation before HR can finalize.';
    case 'PENDING_HR':
      return 'Evaluation — review combined feedback, choose outcome, assign approvers, then submit for final approval.';
    case 'PENDING_FINAL_APPROVAL':
      return 'Waiting for approvers in the chain to sign off before the outcome is applied.';
    case 'PASSED':
    case 'FAILED':
      return 'Probation review finalized.';
    case 'REJECTED':
      return 'Final approval rejected — this probation review is closed.';
    default:
      return status;
  }
}
