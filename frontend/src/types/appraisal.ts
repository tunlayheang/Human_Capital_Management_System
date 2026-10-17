export type AppraisalPeriodType = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';
export type AppraisalPeriodStatus = 'DRAFT' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED' | 'CLOSED';
export type KpiScoringMethod = 'AUTOMATIC' | 'MANUAL';
export type KpiAutoMetric = 'ATTENDANCE' | 'TASK_COMPLETION' | null;
export type AppraisalWorkflowStatus =
  | 'DRAFT'
  | 'SELF_REVIEW'
  | 'PENDING_REVIEW'
  | 'SUPERVISOR_EVALUATION'
  | 'MANAGER_REVIEW'
  | 'PENDING_MANAGER'
  | 'PENDING_EMPLOYEE'
  | 'REOPENED'
  | 'PENDING_HR'
  | 'HR_REVIEW'
  | 'SUBMITTED'
  | 'PENDING_FINAL_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLOSED';

export type KpiPolicySettings = {
  manualCommentThreshold: number;
};

export type KpiComponent = {
  id: string;
  name: string;
  description: string | null;
  weight_percent: number;
  scoring_method: KpiScoringMethod;
  auto_metric: KpiAutoMetric;
  sort_order: number;
  active: number;
  effective_from: string | null;
};

export type AppraisalPeriod = {
  id: string;
  name: string;
  period_type: AppraisalPeriodType;
  start_date: string;
  end_date: string;
  status: AppraisalPeriodStatus;
  /** 1 = enabled; 0 = disabled. Missing/null treated as enabled. */
  is_active?: number;
  alert_notification_date?: string | null;
  alert_notification_sent_at?: string | null;
  created_by: string | null;
  /** Employee appraisals generated for this period (from API list). */
  appraisal_count?: number;
  can_delete?: boolean;
};

export function isAppraisalPeriodEnabled(period: Pick<AppraisalPeriod, 'is_active'>): boolean {
  if (period.is_active == null) return true;
  return Number(period.is_active) === 1;
}

export type EmployeeAppraisal = {
  id: string;
  user_id: string;
  period_id: string;
  workflow_status: AppraisalWorkflowStatus;
  raw_score: number | null;
  weighted_score: number | null;
  final_grade: string | null;
  recommendation: string | null;
  ranking_position: number | null;
  strengths: string | null;
  weaknesses: string | null;
  manager_recommendations: string | null;
  rejection_reason: string | null;
  locked: number;
  employeeName?: string;
  employeeCode?: string | null;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  periodName?: string;
  periodEndDate?: string | null;
  linkedMovementCount?: number;
  latestMovementType?: 'transfer' | 'promotion' | 'salary_update' | null;
  departmentId?: string | null;
  assigned_manager_user_id?: string | null;
  manager_id?: string | null;
  assignedManagerName?: string | null;
  routed_by_hr_user_id?: string | null;
  manager_submitted_at?: string | null;
  manager_submitted_by?: string | null;
  self_review_at?: string | null;
  self_review_notes?: string | null;
  outcome_payload_json?: string | null;
  canRouteToManager?: boolean;
  canManagerEdit?: boolean;
  canEmployeeSelfEvaluate?: boolean;
  canHrFinalize?: boolean;
  canFinalApproverReview?: boolean;
  canLegacyAdvance?: boolean;
  assigned_final_approver_user_id?: string | null;
  assignedFinalApproverName?: string | null;
  assignedFinalApproverUserIds?: string[];
  assignedFinalApprovers?: {
    userId: string;
    name: string | null;
    status: 'pending' | 'approved';
    approvedAt?: string | null;
    sortOrder?: number;
    phase?: 'approved' | 'current' | 'queued';
  }[];
  approvalProgress?: { approved: number; total: number } | null;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  // Management-evaluator chain (HR routes to one or more evaluators in order).
  assignedEvaluatorUserIds?: string[];
  assignedEvaluators?: {
    userId: string;
    name: string | null;
    status: 'pending' | 'submitted';
    submittedAt?: string | null;
    sortOrder?: number;
    phase?: 'submitted' | 'current' | 'queued';
  }[];
  currentEvaluatorUserId?: string | null;
  currentEvaluatorName?: string | null;
  evaluationProgress?: { submitted: number; total: number } | null;
  return_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  routed_at?: string | null;
  hr_approved_at?: string | null;
  hr_approved_by?: string | null;
  final_approved_at?: string | null;
  final_approved_by?: string | null;
  rejected_at?: string | null;
  returned_at?: string | null;
};

export type ComponentScore = {
  id: string;
  component_id: string;
  componentName: string;
  weightPercent: number;
  scoringMethod: string;
  raw_score: number;
  weighted_score: number;
  hr_raw_score?: number | null;
  manager_raw_score?: number | null;
  employee_raw_score?: number | null;
  /** JSON map of evaluator user id → raw score for multi-evaluator chains. */
  evaluator_scores_json?: string | null;
  auto_calculated: number;
  autoMetric?: KpiAutoMetric;
  comment: string | null;
  evaluation_notes: string | null;
};

export type AttendanceDeductionRule = {
  id: string;
  rule_type: string;
  min_count: number;
  max_count: number | null;
  deduction_points: number;
  deduction_mode: string;
  active: number;
  sort_order: number;
};

export type RecommendationRule = {
  id: string;
  grade_codes_json: string;
  recommendation_type: string;
  message: string;
};

export type AppraisalAnalytics = {
  summary: { totalAppraisals: number; averageScore: number };
  gradeDistribution: Array<{ grade: string; count: number }>;
  topPerformers: Array<{ rank: number; employeeName: string; score: number; grade: string }>;
  lowPerformers: Array<{ rank: number; employeeName: string; score: number; grade: string }>;
  departmentAverages: Array<{ departmentId: string; averageScore: number; headcount: number }>;
};

export const PERIOD_TYPE_LABELS: Record<AppraisalPeriodType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUAL: 'Semi-Annual',
  ANNUAL: 'Annual',
};

export const WORKFLOW_LABELS: Record<AppraisalWorkflowStatus, string> = {
  DRAFT: 'Draft',
  SELF_REVIEW: 'Self Review',
  PENDING_REVIEW: 'Pending Review',
  SUPERVISOR_EVALUATION: 'Supervisor Evaluation',
  MANAGER_REVIEW: 'Manager Review',
  PENDING_MANAGER: 'Pending Manager',
  PENDING_EMPLOYEE: 'Pending Employee',
  REOPENED: 'Reopened',
  PENDING_HR: 'Pending HR',
  HR_REVIEW: 'HR Review',
  SUBMITTED: 'Submitted',
  PENDING_FINAL_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};

export function clampKpiScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

/** API DECIMAL fields may arrive as strings — safe display formatting. */
export function formatAppraisalScore(value: unknown, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** Finalized appraisals — one per employee per period; shown in the Appraised list. */
export function isAppraisalFinalized(status: AppraisalWorkflowStatus): boolean {
  return status === 'APPROVED' || status === 'CLOSED';
}

export function splitAppraisalsByPhase<
  T extends {
    workflow_status: AppraisalWorkflowStatus;
    linkedMovementCount?: number | string | null;
  },
>(rows: T[]): { review: T[]; appraised: T[]; movement: T[] } {
  const review: T[] = [];
  const appraised: T[] = [];
  const movement: T[] = [];
  for (const row of rows) {
    if (!isAppraisalFinalized(row.workflow_status)) {
      review.push(row);
      continue;
    }
    const linkedCount = Number(row.linkedMovementCount ?? 0);
    if (linkedCount > 0) movement.push(row);
    else appraised.push(row);
  }
  return { review, appraised, movement };
}

/** Whether this user was assigned as a management evaluator (chain or legacy submit). */
export function actorWasAppraisalEvaluator(
  row: {
    assignedEvaluatorUserIds?: string[] | null;
    assignedEvaluators?: Array<{ userId: string }> | null;
    manager_submitted_by?: string | null;
    outcome_payload_json?: string | null;
  },
  userId: string | null | undefined
): boolean {
  const actorId = String(userId ?? '').trim();
  if (!actorId) return false;
  if (
    Array.isArray(row.assignedEvaluatorUserIds) &&
    row.assignedEvaluatorUserIds.some((id) => String(id) === actorId)
  ) {
    return true;
  }
  if (
    Array.isArray(row.assignedEvaluators) &&
    row.assignedEvaluators.some((ev) => String(ev.userId) === actorId)
  ) {
    return true;
  }
  if (String(row.manager_submitted_by ?? '').trim() === actorId) return true;
  try {
    const raw = row.outcome_payload_json;
    if (!raw) return false;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const evals = parsed?.managementEvaluations;
    if (evals && typeof evals === 'object' && !Array.isArray(evals)) {
      return Object.prototype.hasOwnProperty.call(evals, actorId);
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Evaluator (non-HR) list split: actionable evaluations vs submitted history proof.
 * Reuses phase keys: review = needs action, appraised = submitted history, movement = unused.
 */
export function splitEvaluatorAppraisalsByAction<
  T extends {
    canManagerEdit?: boolean;
    assignedEvaluatorUserIds?: string[] | null;
    assignedEvaluators?: Array<{ userId: string }> | null;
    manager_submitted_by?: string | null;
    outcome_payload_json?: string | null;
  },
>(rows: T[], userId: string | null | undefined): { review: T[]; appraised: T[]; movement: T[] } {
  const review: T[] = [];
  const appraised: T[] = [];
  for (const row of rows) {
    if (row.canManagerEdit) {
      review.push(row);
      continue;
    }
    if (actorWasAppraisalEvaluator(row, userId)) {
      appraised.push(row);
    }
  }
  return { review, appraised, movement: [] };
}
