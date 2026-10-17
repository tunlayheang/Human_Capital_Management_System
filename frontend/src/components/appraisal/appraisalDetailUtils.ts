import type { EmployeeAppraisal } from '../../types/appraisal';
import type { ComponentScore } from '../../types/appraisal';
import type { EmployeeMovementRow } from '../../types/employeeMovement';

export type AppraisalDetailPayload = {
  appraisal: EmployeeAppraisal;
  componentScores: ComponentScore[];
  auditLog?: Array<Record<string, unknown>>;
  linkedMovements?: EmployeeMovementRow[];
};

export type ManagementEvaluationEntry = {
  strengths?: string | null;
  weaknesses?: string | null;
  managerRecommendations?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
};

export function parseEvaluatorScoresJson(raw?: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const num = Number(value);
      if (Number.isFinite(num)) out[key] = num;
    }
    return out;
  } catch {
    return {};
  }
}

export function parseAppraisalOutcomePayload(raw?: string | null) {
  if (!raw) return { managementEvaluations: {} as Record<string, ManagementEvaluationEntry> };
  try {
    const parsed = JSON.parse(raw) as {
      managementEvaluations?: Record<string, ManagementEvaluationEntry>;
      employeeEvaluation?: Record<string, unknown>;
    };
    return {
      managementEvaluations: parsed.managementEvaluations ?? {},
      employeeEvaluation: parsed.employeeEvaluation,
    };
  } catch {
    return { managementEvaluations: {} as Record<string, ManagementEvaluationEntry> };
  }
}

export function getManagementEvaluationForUser(
  raw: string | null | undefined,
  userId: string
): ManagementEvaluationEntry | null {
  const { managementEvaluations } = parseAppraisalOutcomePayload(raw);
  return managementEvaluations[userId] ?? null;
}

export function parseEmployeeEvaluationPayload(raw?: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { employeeEvaluation?: Record<string, unknown> };
    return parsed?.employeeEvaluation ?? null;
  } catch {
    return null;
  }
}
