import { CheckCircle2, CircleCheck, ClipboardList, User, Users } from 'lucide-react';
import type { WizardStep } from '../EmployeeWizardStepper';
import type { AppraisalWorkflowStatus } from '../../types/appraisal';
import { normalizeWorkflowStatus } from './appraisalWorkflowUi';

export const APPRAISAL_SCORE_STEP_LABEL = 'Evaluator chain';

export const APPRAISAL_WIZARD_STEPS: WizardStep[] = [
  {
    id: 'score',
    label: APPRAISAL_SCORE_STEP_LABEL,
    description:
      'Select one or more management evaluators in order, then route this appraisal for evaluation.',
    icon: ClipboardList,
  },
  {
    id: 'manager',
    label: 'Management evaluation',
    description:
      'Score KPIs and add your evaluation notes. Multiple evaluators each submit in order; scores are averaged before employee self-evaluation.',
    icon: Users,
  },
  {
    id: 'employee',
    label: 'Self evaluation',
    description: 'Employee reflects on their performance and submits self-evaluation.',
    icon: User,
  },
  {
    id: 'hr',
    label: 'Final evaluation',
    description: 'Review combined scores from all evaluators, then final approve to lock the record.',
    icon: CheckCircle2,
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Record promotion or pay change if needed.',
    icon: CircleCheck,
  },
];

/** Workflow-driven step the user should land on when opening an appraisal. */
export function suggestedAppraisalWizardStep(
  status: AppraisalWorkflowStatus | string | undefined,
  locked: boolean
): number {
  const normalized = normalizeWorkflowStatus(status);
  if (locked || normalized === 'APPROVED' || normalized === 'CLOSED') return 4;
  if (normalized === 'PENDING_FINAL_APPROVAL') return 3;
  if (normalized === 'PENDING_HR' || normalized === 'HR_REVIEW' || normalized === 'SUBMITTED') {
    return 3;
  }
  if (normalized === 'PENDING_EMPLOYEE') return 2;
  if (normalized === 'PENDING_MANAGER' || normalized === 'MANAGER_REVIEW') return 1;
  return 0;
}

/** Furthest wizard step the user may jump to (completed + current). */
export function maxReachableAppraisalWizardStep(
  status: AppraisalWorkflowStatus | string | undefined,
  locked: boolean
): number {
  return suggestedAppraisalWizardStep(status, locked);
}

export function scoreStepLabelForStatus(status: AppraisalWorkflowStatus | string | undefined): string {
  return normalizeWorkflowStatus(status) === 'REOPENED' ? 'Reopened' : APPRAISAL_SCORE_STEP_LABEL;
}

/** Override first step label when case was reopened. */
export function appraisalWizardStepsForStatus(
  status: AppraisalWorkflowStatus | string | undefined
): WizardStep[] {
  const scoreLabel = scoreStepLabelForStatus(status);
  if (scoreLabel === APPRAISAL_SCORE_STEP_LABEL) return APPRAISAL_WIZARD_STEPS;
  return APPRAISAL_WIZARD_STEPS.map((step, index) =>
    index === 0 ? { ...step, label: scoreLabel } : step
  );
}
