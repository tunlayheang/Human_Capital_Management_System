/** Configuration-driven KPI appraisal engine types. */

export type AppraisalPeriodType = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL';

export type AppraisalPeriodStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CLOSED';

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

/** Appraisals that count in rankings, analytics, and employee KPI history. */
export const FINALIZED_APPRAISAL_STATUSES: AppraisalWorkflowStatus[] = ['APPROVED', 'CLOSED'];

export function isFinalizedAppraisalStatus(status: string): boolean {
  return FINALIZED_APPRAISAL_STATUSES.includes(status as AppraisalWorkflowStatus);
}

export type AttendanceDeductionRuleType =
  | 'LATE'
  | 'ABSENCE'
  | 'EARLY_LEAVE'
  | 'UNPAID_LEAVE'
  | 'UNEXCUSED_ABSENCE';

export type KpiComponentRow = {
  id: string;
  name: string;
  description: string | null;
  weight_percent: number;
  scoring_method: KpiScoringMethod;
  auto_metric: KpiAutoMetric;
  sort_order: number;
  active: number;
  effective_from: string | null;
  created_at: string;
  updated_at: string;
};

export type AppraisalPeriodRow = {
  id: string;
  name: string;
  period_type: AppraisalPeriodType;
  start_date: string;
  end_date: string;
  status: AppraisalPeriodStatus;
  /** 1 = enabled for pickers / generate / alerts; 0 = disabled (soft). */
  is_active: number;
  alert_notification_date: string | null;
  alert_notification_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeAppraisalRow = {
  id: string;
  user_id: string;
  period_id: string;
  workflow_status: AppraisalWorkflowStatus;
  self_review_notes: string | null;
  self_review_at: string | null;
  supervisor_id: string | null;
  supervisor_submitted_at: string | null;
  manager_id: string | null;
  manager_reviewed_at: string | null;
  assigned_manager_user_id: string | null;
  routed_by_hr_user_id: string | null;
  routed_at: string | null;
  manager_submitted_at: string | null;
  manager_submitted_by: string | null;
  outcome_payload_json: string | null;
  hr_approved_by: string | null;
  hr_approved_at: string | null;
  final_approved_by: string | null;
  final_approved_at: string | null;
  raw_score: number | null;
  weighted_score: number | null;
  final_grade: string | null;
  recommendation: string | null;
  ranking_position: number | null;
  strengths: string | null;
  weaknesses: string | null;
  manager_recommendations: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  assigned_final_approver_user_id: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_notes: string | null;
  locked: number;
  created_at: string;
  updated_at: string;
};

export type ComponentScoreRow = {
  id: string;
  appraisal_id: string;
  component_id: string;
  raw_score: number;
  weighted_score: number;
  auto_calculated: number;
  comment: string | null;
  evaluation_notes: string | null;
  calculated_at: string;
};

export type AttendanceDeductionRuleRow = {
  id: string;
  rule_type: AttendanceDeductionRuleType;
  min_count: number;
  max_count: number | null;
  deduction_points: number;
  deduction_mode: string;
  active: number;
  sort_order: number;
};

export type RecommendationRuleRow = {
  id: string;
  grade_codes_json: string;
  recommendation_type: string;
  message: string;
  active: number;
  sort_order: number;
};

export type ComponentScoreInput = {
  componentId: string;
  rawScore: number;
  comment?: string | null;
  evaluationNotes?: string | null;
  autoCalculated?: boolean;
};

export type AppraisalScoreAuditRow = {
  id: string;
  appraisal_id: string;
  component_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
};

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

export async function validateManualScore(
  score: number,
  comment?: string | null,
  threshold = 60
): Promise<string | null> {
  const s = clampScore(score);
  if (s < threshold && !(comment ?? '').trim()) {
    return `Comment is required when score is below ${threshold}`;
  }
  return null;
}
