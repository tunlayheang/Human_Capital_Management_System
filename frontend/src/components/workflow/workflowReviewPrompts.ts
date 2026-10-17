import type { PromptDialogOptions } from '../../hooks/useConfirmDialog';

export type ReviewSubject =
  | 'appraisal'
  | 'movement'
  | 'probation'
  | 'payroll'
  | 'leave'
  | 'overtime';

/** Single label for every workflow approve action button. */
export const APPROVE_BUTTON_LABEL = 'Approve';

const APPROVE_TITLES: Record<ReviewSubject, string> = {
  appraisal: 'Approve appraisal',
  movement: 'Approve movement',
  probation: 'Approve probation review',
  payroll: 'Approve payroll run',
  leave: 'Approve leave request',
  overtime: 'Approve overtime request',
};

const APPROVE_DESCRIPTIONS: Record<ReviewSubject, string> = {
  appraisal:
    'Confirm that you approve this appraisal. A comment is required and will be recorded with your sign-off.',
  movement:
    'Confirm that you approve this movement. A comment is required and will be recorded with your sign-off.',
  probation:
    'Confirm that you approve this probation outcome. A comment is required and will be recorded with your sign-off.',
  payroll:
    'Confirm that you approve and finalize this payroll run. A comment is required and will be recorded with your sign-off.',
  leave:
    'Confirm that you approve this leave request. A comment is required and will be recorded with your sign-off.',
  overtime:
    'Confirm that you approve this overtime request. A comment is required and will be recorded with your sign-off.',
};

const RETURN_TITLES: Record<ReviewSubject, string> = {
  appraisal: 'Return appraisal for revision',
  movement: 'Return movement for revision',
  probation: 'Return probation review for revision',
  payroll: 'Return payroll run for revision',
  leave: 'Return leave request for revision',
  overtime: 'Return overtime request for revision',
};

const RETURN_DESCRIPTIONS: Record<ReviewSubject, string> = {
  appraisal:
    'Return this appraisal to the submitter so they can revise it and resubmit for approval. Explain what should be changed.',
  movement:
    'Return this movement to the submitter so they can revise it and resubmit for approval. Explain what should be changed.',
  probation:
    'Return this probation review to the submitter so they can revise it and resubmit for approval. Explain what should be changed.',
  payroll:
    'Return this payroll run to the preparer so they can revise it and resubmit for approval. Explain what should be changed.',
  leave:
    'Return this leave request to the submitter so they can revise it and resubmit for approval. Explain what should be changed.',
  overtime:
    'Return this overtime request to the submitter so they can revise it and resubmit for approval. Explain what should be changed.',
};

const REJECT_TITLES: Record<ReviewSubject, string> = {
  appraisal: 'Reject appraisal',
  movement: 'Reject movement',
  probation: 'Reject probation review',
  payroll: 'Reject payroll run',
  leave: 'Reject leave request',
  overtime: 'Reject overtime request',
};

const REJECT_DESCRIPTIONS: Record<ReviewSubject, string> = {
  appraisal:
    'Confirm that you are rejecting this appraisal. A comment is required so the submitter knows why.',
  movement:
    'Confirm that you are rejecting this movement. A comment is required so the submitter knows why.',
  probation:
    'Confirm that you are rejecting this probation outcome. A comment is required so the submitter knows why.',
  payroll:
    'Confirm that you are rejecting this payroll run. A reason is required so finance and HR can review.',
  leave:
    'Confirm that you are rejecting this leave request. A comment is required so the submitter knows why.',
  overtime:
    'Confirm that you are rejecting this overtime request. A comment is required so the submitter knows why.',
};

export function approveReviewPrompt(subject: ReviewSubject): PromptDialogOptions {
  return {
    title: APPROVE_TITLES[subject],
    description: APPROVE_DESCRIPTIONS[subject],
    variant: 'success',
    confirmLabel: APPROVE_BUTTON_LABEL,
    reasonPlaceholder: 'Approval comment (required)',
    reasonRequired: true,
  };
}

export function returnReviewPrompt(subject: ReviewSubject): PromptDialogOptions {
  return {
    title: RETURN_TITLES[subject],
    description: RETURN_DESCRIPTIONS[subject],
    variant: 'success',
    confirmLabel: 'Return',
    reasonPlaceholder: 'Return comment (required)',
    reasonRequired: true,
  };
}

export function rejectReviewPrompt(subject: ReviewSubject): PromptDialogOptions {
  return {
    title: REJECT_TITLES[subject],
    description: REJECT_DESCRIPTIONS[subject],
    variant: 'danger',
    confirmLabel: 'Reject',
    reasonPlaceholder: 'Rejection comment (required)',
    reasonRequired: true,
  };
}
