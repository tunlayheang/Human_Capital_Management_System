import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import type { EmployeeAppraisalRow } from './appraisalTypes.js';
import {
  APPRAISAL_ASSIGNED_MANAGER_JOINS,
  APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR,
  APPRAISAL_DEPARTMENT_ID_EXPR,
  APPRAISAL_EMPLOYEE_CODE_EXPR,
  APPRAISAL_EMPLOYEE_EMAIL_EXPR,
  APPRAISAL_EMPLOYEE_JOINS,
  APPRAISAL_EMPLOYEE_NAME_EXPR,
  APPRAISAL_EMPLOYEE_PHONE_EXPR,
} from './appraisalQuerySql.js';
import {
  enrichAppraisalRow,
  employeeCanSeeOwnAppraisal,
  parseAppraisalOutcomePayload,
  type AppraisalActor,
} from './appraisalRoutingService.js';
import {
  getAppraisalDetail,
  listMyPendingAppraisalSelfEvaluations,
} from './appraisalWorkflowService.js';
import { listMyPendingProbationSelfEvaluation } from '../probation/probationReviewService.js';
import { listProbationReviewHistory } from '../probation/probationReviewService.js';

export async function listMyKpiAppraisalHistory(userId: string) {
  const rows = (await sequelize.query(
    `SELECT ea.*, ap.name AS periodName, ap.end_date AS periodEndDate,
            ${APPRAISAL_EMPLOYEE_NAME_EXPR}, ${APPRAISAL_EMPLOYEE_CODE_EXPR},
            ${APPRAISAL_EMPLOYEE_EMAIL_EXPR}, ${APPRAISAL_EMPLOYEE_PHONE_EXPR},
            ${APPRAISAL_DEPARTMENT_ID_EXPR},
            ${APPRAISAL_ASSIGNED_MANAGER_NAME_EXPR}
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     ${APPRAISAL_ASSIGNED_MANAGER_JOINS}
     WHERE ea.user_id = :userId
     ORDER BY ap.end_date DESC, ea.updated_at DESC`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  )) as Array<
    EmployeeAppraisalRow & {
      periodName?: string;
      periodEndDate?: string;
      assignedManagerName?: string | null;
    }
  >;

  const actor: AppraisalActor = { userId, role: 'EMPLOYEE' };
  return rows
    .filter((row) => employeeCanSeeOwnAppraisal(row, userId))
    .map((row) => {
      const caps = enrichAppraisalRow(row, actor);
      const payload = parseAppraisalOutcomePayload(row.outcome_payload_json);
      const employeeEval = payload?.employeeEvaluation as Record<string, unknown> | undefined;
      return {
        ...caps,
        periodName: row.periodName,
        periodEndDate: row.periodEndDate,
        assignedManagerName: row.assignedManagerName,
        employeeSelfReviewNotes: row.self_review_notes,
        employeeSelfReviewAt: row.self_review_at,
        employeeEvaluationSummary: employeeEval
          ? {
              strengths: employeeEval.strengths ?? null,
              weaknesses: employeeEval.weaknesses ?? null,
              notes: employeeEval.notes ?? null,
            }
          : null,
      };
    });
}

export async function getMyPerformanceHub(userId: string) {
  const [pendingKpi, pendingProbation, kpiHistory, probationHistory] = await Promise.all([
    listMyPendingAppraisalSelfEvaluations(userId),
    listMyPendingProbationSelfEvaluation(userId),
    listMyKpiAppraisalHistory(userId),
    listProbationReviewHistory(userId),
  ]);

  const pendingKpiIds = new Set(pendingKpi.map((r) => r.id));
  const historyKpi = kpiHistory.filter((r) => !pendingKpiIds.has(r.id));

  const completedKpi = historyKpi.filter((r) =>
    ['APPROVED', 'CLOSED'].includes(String(r.workflow_status))
  ).length;
  const completedProbation = probationHistory.filter((r) =>
    ['PASSED', 'FAILED', 'EXTENDED'].includes(String(r.status).toUpperCase())
  ).length;

  return {
    summary: {
      pendingCount: pendingKpi.length + (pendingProbation ? 1 : 0),
      completedCount: completedKpi + completedProbation,
      kpiCount: kpiHistory.length,
      probationCount: probationHistory.length,
    },
    pending: {
      kpi: pendingKpi,
      probation: pendingProbation,
    },
    history: {
      kpi: historyKpi,
      probation: probationHistory,
    },
  };
}

export async function getMyKpiAppraisalDetail(userId: string, appraisalId: string) {
  const detail = await getAppraisalDetail(appraisalId, { userId, role: 'EMPLOYEE' });
  if (!detail?.appraisal) return null;
  if (String(detail.appraisal.user_id) !== String(userId)) return null;
  if (!employeeCanSeeOwnAppraisal(detail.appraisal, userId)) return null;

  const payload = parseAppraisalOutcomePayload(detail.appraisal.outcome_payload_json);
  const managerEval = payload?.managerEvaluation as Record<string, unknown> | undefined;
  const employeeEval = payload?.employeeEvaluation as Record<string, unknown> | undefined;

  return {
    appraisal: detail.appraisal,
    period: detail.period,
    componentScores: detail.componentScores,
    managerEvaluation: managerEval
      ? {
          strengths: managerEval.strengths ?? detail.appraisal.strengths,
          weaknesses: managerEval.weaknesses ?? detail.appraisal.weaknesses,
          managerRecommendations:
            managerEval.managerRecommendations ?? detail.appraisal.manager_recommendations,
        }
      : null,
    employeeEvaluation: employeeEval
      ? {
          strengths: employeeEval.strengths ?? null,
          weaknesses: employeeEval.weaknesses ?? null,
          notes: employeeEval.notes ?? detail.appraisal.self_review_notes,
          submittedAt: employeeEval.submittedAt ?? detail.appraisal.self_review_at,
          weightedScore:
            employeeEval.weightedScore != null ? Number(employeeEval.weightedScore) : null,
          scores: Array.isArray(employeeEval.scores)
            ? (employeeEval.scores as Array<Record<string, unknown>>).map((s) => ({
                componentId: String(s.componentId ?? ''),
                componentName: String(s.componentName ?? ''),
                rawScore: Number(s.rawScore ?? 0),
                weightPercent: Number(s.weightPercent ?? 0),
                weightedScore: Number(s.weightedScore ?? 0),
              }))
            : undefined,
        }
      : detail.appraisal.self_review_at
        ? { notes: detail.appraisal.self_review_notes, submittedAt: detail.appraisal.self_review_at }
        : null,
  };
}
