import { CheckCircle2, CircleCheck, ClipboardList, User, Users } from 'lucide-react';
import type { WizardStep } from '../EmployeeWizardStepper';
import type { ProbationReviewStatus, ProbationRow } from '../../types';

export const PROBATION_SCORE_STEP_LABEL = 'Evaluator chain';

/** Mirrors KPI appraisal wizard: Evaluator chain → Management evaluation → Self evaluation → Final evaluation → Complete */
export const PROBATION_WIZARD_STEPS: WizardStep[] = [
  {
    id: 'hr',
    label: PROBATION_SCORE_STEP_LABEL,
    description:
      'Select one or more management evaluators in order, then route this probation review for evaluation.',
    icon: ClipboardList,
  },
  {
    id: 'manager',
    label: 'Management evaluation',
    description:
      'Rate performance criteria and add evaluation notes. Multiple evaluators each submit in order before employee self-evaluation.',
    icon: Users,
  },
  {
    id: 'employee',
    label: 'Self evaluation',
    description: 'Employee completes self-evaluation before HR finalizes.',
    icon: User,
  },
  {
    id: 'evaluation',
    label: 'Final evaluation',
    description:
      'Review combined ratings from all evaluators and the employee, choose probation outcome, assign approvers, then submit for final approval.',
    icon: CheckCircle2,
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Probation decision recorded — view history.',
    icon: CircleCheck,
  },
];

export const PROBATION_PIPELINE_STEPS = [
  {
    id: 'hr',
    label: PROBATION_SCORE_STEP_LABEL,
    statuses: ['UPCOMING', 'REVIEW_DUE', 'IN_REVIEW', 'EXTENDED'] as ProbationReviewStatus[],
  },
  {
    id: 'manager',
    label: 'Management evaluation',
    statuses: ['PENDING_MANAGER'] as ProbationReviewStatus[],
  },
  { id: 'employee', label: 'Self evaluation', statuses: ['PENDING_EMPLOYEE'] as ProbationReviewStatus[] },
  {
    id: 'evaluation',
    label: 'Final evaluation',
    statuses: ['PENDING_HR', 'PENDING_FINAL_APPROVAL'] as ProbationReviewStatus[],
  },
  {
    id: 'done',
    label: 'Complete',
    statuses: ['PASSED', 'EXTENDED', 'FAILED', 'REJECTED'] as ProbationReviewStatus[],
  },
];

export type ProbationListPhase = 'all' | 'active' | 'completed';

const COMPLETED_STATUSES = new Set<ProbationReviewStatus>([
  'PASSED',
  'EXTENDED',
  'FAILED',
  'REJECTED',
]);

export function splitProbationByPhase(rows: ProbationRow[]) {
  const completed = rows.filter((r) => COMPLETED_STATUSES.has(r.status));
  const active = rows.filter((r) => !COMPLETED_STATUSES.has(r.status));
  return { active, completed };
}

export function probationPipelineStepIndex(status: ProbationReviewStatus): number {
  const idx = PROBATION_PIPELINE_STEPS.findIndex((s) => s.statuses.includes(status));
  return idx >= 0 ? idx : 0;
}

export function probationRowStepLabel(status: ProbationReviewStatus): string {
  return PROBATION_PIPELINE_STEPS[probationPipelineStepIndex(status)]?.label ?? 'HR';
}

/** Wizard step index (0–4, excluding employee select). Mirrors appraisalWizardUi. */
export function suggestedProbationWizardStep(row: ProbationRow | null): number {
  if (!row) return 0;
  switch (row.status) {
    case 'PENDING_MANAGER':
      return 1;
    case 'PENDING_EMPLOYEE':
      return 2;
    case 'PENDING_HR':
    case 'PENDING_FINAL_APPROVAL':
      return 3;
    case 'PASSED':
    case 'EXTENDED':
    case 'FAILED':
    case 'REJECTED':
      return 4;
    case 'REVIEW_DUE':
    case 'IN_REVIEW':
    case 'UPCOMING':
    default:
      if (row.canRouteToManager) return 0;
      if (row.canManagerEdit) return 1;
      if (row.canEvaluate) return row.managerSubmittedAt ? 3 : 2;
      return 0;
  }
}

export function maxReachableProbationWizardStep(row: ProbationRow | null): number {
  if (!row) return 0;
  if (COMPLETED_STATUSES.has(row.status)) return 4;
  const suggested = suggestedProbationWizardStep(row);
  const unrouted =
    row.canRouteToManager &&
    !row.routedByHrUserId &&
    !row.assignedEvaluatorUserIds?.length &&
    !row.assignedManagerUserId;
  if (unrouted) return 0;
  if (row.canRouteToManager && !COMPLETED_STATUSES.has(row.status)) {
    return Math.max(suggested, 0);
  }
  if (row.canEvaluate && row.status === 'PENDING_HR') return 3;
  if (row.status === 'PENDING_FINAL_APPROVAL') return 3;
  if (row.canManagerEdit) return 1;
  if (row.status === 'PENDING_EMPLOYEE') return row.employeeSubmittedAt || row.employeeRatings ? 3 : 2;
  if (row.status === 'PENDING_MANAGER') return row.managerSubmittedAt ? 2 : 1;
  if (row.status === 'PENDING_HR') return 3;
  return suggested;
}

export function probationActionWizardStep(row: ProbationRow | null): number {
  if (!row) return 0;
  if (row.canRouteToManager) return 0;
  if (row.canManagerEdit) return 1;
  if (row.canEmployeeSelfEvaluate) return 2;
  if (row.canEvaluate && row.status === 'PENDING_HR') return 3;
  if (row.status === 'PENDING_FINAL_APPROVAL') return 3;
  if (row.canApproverReview) return 3;
  if (COMPLETED_STATUSES.has(row.status)) return 4;
  return suggestedProbationWizardStep(row);
}
