import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import {
  appraisalScoreAuditId,
  listAppraisalScoreAuditLog,
  logAppraisalScoreChange,
} from './appraisalScoreAuditService.js';
import { clampScore } from './appraisalTypes.js';
import { loadKpiGradeDefinitions, scoreToGrade } from '../personalAnalytics/kpiGradeSettings.js';
import { listKpiComponents, resolveRecommendation } from './kpiComponentService.js';
import { calculateAttendanceKpiScore } from './attendanceKpiCalculator.js';
import { calculateTaskCompletionKpiScore } from './taskKpiCalculator.js';
import { getAppraisalPeriod } from './appraisalPeriodService.js';
import { FINALIZED_APPRAISAL_STATUSES } from './appraisalTypes.js';

export type CalculatedComponentScore = {
  componentId: string;
  componentName: string;
  weightPercent: number;
  scoringMethod: string;
  rawScore: number;
  weightedScore: number;
  autoCalculated: boolean;
  maxScore: number;
};

export async function calculateAutomaticComponentScore(
  userId: string,
  autoMetric: string | null,
  startDate: string,
  endDate: string
): Promise<number> {
  if (autoMetric === 'ATTENDANCE') {
    return (await calculateAttendanceKpiScore(userId, startDate, endDate)).score;
  }
  if (autoMetric === 'TASK_COMPLETION') {
    return (await calculateTaskCompletionKpiScore(userId, startDate, endDate)).score;
  }
  return 0;
}

export async function buildComponentScoresForAppraisal(params: {
  userId: string;
  periodId: string;
  manualScores?: Record<string, { rawScore: number; comment?: string; evaluationNotes?: string }>;
}): Promise<{
  components: CalculatedComponentScore[];
  rawScore: number;
  weightedScore: number;
  grade: string;
  recommendation: string | null;
}> {
  const period = await getAppraisalPeriod(params.periodId);
  if (!period) throw new Error('Appraisal period not found');

  const components = await listKpiComponents(true, String(period.end_date));
  const grades = await loadKpiGradeDefinitions();
  const calculated: CalculatedComponentScore[] = [];
  let weightedSum = 0;
  let rawSum = 0;

  for (const comp of components) {
    const weight = Number(comp.weight_percent);
    let raw = 0;
    let auto = false;

    if (comp.scoring_method === 'AUTOMATIC') {
      raw = await calculateAutomaticComponentScore(
        params.userId,
        comp.auto_metric,
        String(period.start_date),
        String(period.end_date)
      );
      auto = true;
    } else {
      const manual = params.manualScores?.[comp.id];
      raw = clampScore(manual?.rawScore ?? 0);
    }

    const weighted = Math.round(((raw * weight) / 100) * 100) / 100;
    weightedSum += weighted;
    rawSum += raw;

    calculated.push({
      componentId: comp.id,
      componentName: comp.name,
      weightPercent: weight,
      scoringMethod: comp.scoring_method,
      rawScore: raw,
      weightedScore: weighted,
      autoCalculated: auto,
      maxScore: 100,
    });
  }

  const weightedScore = Math.round(weightedSum * 100) / 100;
  const rawScore = components.length
    ? Math.round((rawSum / components.length) * 100) / 100
    : 0;
  const grade = scoreToGrade(weightedScore, grades);
  const recommendation = await resolveRecommendation(grade);

  return {
    components: calculated,
    rawScore,
    weightedScore,
    grade,
    recommendation,
  };
}

export function auditId(): string {
  return appraisalScoreAuditId();
}

export async function logScoreChange(params: {
  appraisalId: string;
  componentId?: string | null;
  fieldName: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  changedBy?: string | null;
  reason?: string | null;
}): Promise<void> {
  await logAppraisalScoreChange(params);
}

/** Archive the finalized cycle before HR reopens — preserved in appraisal audit + unified audit trail. */
export async function logAppraisalReopenSnapshot(
  appraisal: {
    id: string;
    workflow_status?: string;
    raw_score?: number | null;
    weighted_score?: number | null;
    final_grade?: string | null;
    recommendation?: string | null;
    ranking_position?: number | null;
    assigned_manager_user_id?: string | null;
    manager_id?: string | null;
    manager_submitted_at?: string | null;
    final_approved_at?: string | null;
    final_approved_by?: string | null;
    hr_approved_at?: string | null;
    hr_approved_by?: string | null;
    routed_at?: string | null;
    routed_by_hr_user_id?: string | null;
    strengths?: string | null;
    weaknesses?: string | null;
    manager_recommendations?: string | null;
    locked?: number | null;
    outcome_payload_json?: string | null;
  },
  actorId: string,
  notes?: string | null
): Promise<void> {
  const snapshot = {
    workflowStatus: appraisal.workflow_status ?? null,
    rawScore: appraisal.raw_score ?? null,
    weightedScore: appraisal.weighted_score ?? null,
    finalGrade: appraisal.final_grade ?? null,
    recommendation: appraisal.recommendation ?? null,
    rankingPosition: appraisal.ranking_position ?? null,
    assignedManagerUserId: appraisal.assigned_manager_user_id ?? appraisal.manager_id ?? null,
    managerSubmittedAt: appraisal.manager_submitted_at ?? null,
    finalApprovedAt: appraisal.final_approved_at ?? null,
    finalApprovedBy: appraisal.final_approved_by ?? null,
    hrApprovedAt: appraisal.hr_approved_at ?? null,
    hrApprovedBy: appraisal.hr_approved_by ?? null,
    routedAt: appraisal.routed_at ?? null,
    routedByHrUserId: appraisal.routed_by_hr_user_id ?? null,
    strengths: appraisal.strengths ?? null,
    weaknesses: appraisal.weaknesses ?? null,
    managerRecommendations: appraisal.manager_recommendations ?? null,
    locked: appraisal.locked ?? null,
    outcomePayloadJson: appraisal.outcome_payload_json ?? null,
  };

  await logScoreChange({
    appraisalId: appraisal.id,
    fieldName: 'reopen_cycle_snapshot',
    oldValue: JSON.stringify(snapshot),
    newValue: 'REOPENED',
    changedBy: actorId,
    reason: notes ?? 'Prior appraisal cycle archived on reopen',
  });
}

export async function listAppraisalAuditLog(appraisalId: string) {
  return listAppraisalScoreAuditLog(appraisalId);
}

/** Parse the per-evaluator score map ({ userId: rawScore }) stored on a component row. */
export function parseEvaluatorScores(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = Number(value);
      if (Number.isFinite(num)) out[key] = num;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Recompute component and appraisal totals by averaging the scores that actually
 * participated in the review:
 *   - Management = mean of every evaluator in `evaluator_scores_json` (any count ≥ 1)
 *   - Employee self-score when submitted
 *   - Auto KPI baseline when no evaluator snapshots exist yet
 * Legacy HR manual scores are only used when no management evaluators have scored.
 */
export function computeComponentCombinedScore(row: {
  raw_score: number;
  hr_raw_score: number | null;
  manager_raw_score: number | null;
  employee_raw_score: number | null;
  evaluator_scores_json: string | null;
  auto_calculated?: number | boolean | null;
}): { combinedRaw: number; managementAverage: number | null; participantScores: number[] } {
  const isAuto = Number(row.auto_calculated) === 1;
  const evaluatorMap = parseEvaluatorScores(row.evaluator_scores_json);
  const evaluatorScores = Object.values(evaluatorMap);
  const autoBaseline = isAuto
    ? row.hr_raw_score != null
      ? Number(row.hr_raw_score)
      : Number(row.raw_score)
    : null;

  const managementAverage = evaluatorScores.length
    ? Math.round((evaluatorScores.reduce((a, b) => a + b, 0) / evaluatorScores.length) * 100) /
      100
    : row.manager_raw_score != null
      ? Number(row.manager_raw_score)
      : isAuto && autoBaseline != null
        ? autoBaseline
        : null;

  const employeeScore = row.employee_raw_score != null ? Number(row.employee_raw_score) : null;

  const parts: number[] = [];

  if (managementAverage != null) {
    parts.push(managementAverage);
  } else if (!isAuto && row.hr_raw_score != null && evaluatorScores.length === 0) {
    parts.push(Number(row.hr_raw_score));
  } else if (isAuto && autoBaseline != null) {
    parts.push(autoBaseline);
  }

  if (employeeScore != null) parts.push(employeeScore);
  if (!parts.length) parts.push(Number(row.raw_score));

  const combinedRaw = clampScore(parts.reduce((a, b) => a + b, 0) / parts.length);
  return { combinedRaw, managementAverage, participantScores: parts };
}

/** Stamp auto KPI engine scores into per-evaluator snapshots for submitted evaluators. */
export async function repairAutoEvaluatorSnapshots(appraisalId: string): Promise<void> {
  const { APPRAISAL_EVALUATOR_CONFIG, loadChainApprovers } = await import(
    '../workflowChainApproverService.js'
  );
  const chain = await loadChainApprovers(APPRAISAL_EVALUATOR_CONFIG, appraisalId);
  const submitted = chain.filter((row) => row.status === 'approved');
  if (!submitted.length) return;

  const rows = (await sequelize.query(
    `SELECT component_id, raw_score, evaluator_scores_json
     FROM appraisal_component_scores
     WHERE appraisal_id = :id AND auto_calculated = 1`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    component_id: string;
    raw_score: number;
    evaluator_scores_json: string | null;
  }>;

  for (const row of rows) {
    const map = parseEvaluatorScores(row.evaluator_scores_json);
    const autoScore = clampScore(Number(row.raw_score));
    let changed = false;
    for (const evaluator of submitted) {
      if (map[evaluator.userId] == null) {
        map[evaluator.userId] = autoScore;
        changed = true;
      }
    }
    if (!changed) continue;
    await sequelize.query(
      `UPDATE appraisal_component_scores
       SET evaluator_scores_json = :json
       WHERE appraisal_id = :id AND component_id = :compId`,
      {
        replacements: {
          json: JSON.stringify(map),
          id: appraisalId,
          compId: row.component_id,
        },
      }
    );
  }
}

/** Record this evaluator's scores for every component (manual + auto KPI). */
export async function recordEvaluatorSnapshotsForActor(
  appraisalId: string,
  actorUserId: string,
  manualScoresByComponentId?: Map<string, number>
): Promise<void> {
  const actorKey = String(actorUserId ?? '').trim();
  if (!actorKey) return;

  const rows = (await sequelize.query(
    `SELECT component_id, raw_score, auto_calculated, evaluator_scores_json
     FROM appraisal_component_scores WHERE appraisal_id = :id`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    component_id: string;
    raw_score: number;
    auto_calculated: number;
    evaluator_scores_json: string | null;
  }>;

  for (const row of rows) {
    const isAuto = Number(row.auto_calculated) === 1;
    let score: number | undefined;
    if (isAuto) {
      score = clampScore(Number(row.raw_score));
    } else if (manualScoresByComponentId?.has(row.component_id)) {
      score = clampScore(Number(manualScoresByComponentId.get(row.component_id)));
    }
    if (score == null) continue;

    const map = parseEvaluatorScores(row.evaluator_scores_json);
    map[actorKey] = score;
    await sequelize.query(
      `UPDATE appraisal_component_scores
       SET evaluator_scores_json = :json
       WHERE appraisal_id = :id AND component_id = :compId`,
      {
        replacements: {
          json: JSON.stringify(map),
          id: appraisalId,
          compId: row.component_id,
        },
      }
    );
  }
}

export async function recalculateCombinedAppraisalScores(appraisalId: string): Promise<void> {
  await repairAutoEvaluatorSnapshots(appraisalId);

  const rows = (await sequelize.query(
    `SELECT acs.id, acs.raw_score, acs.hr_raw_score, acs.manager_raw_score, acs.employee_raw_score,
            acs.evaluator_scores_json, acs.auto_calculated,
            kc.weight_percent AS weightPercent
     FROM appraisal_component_scores acs
     JOIN kpi_config_items kc ON kc.id = acs.component_id AND kc.kind = 'component'
     WHERE acs.appraisal_id = :id`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    id: string;
    raw_score: number;
    hr_raw_score: number | null;
    manager_raw_score: number | null;
    employee_raw_score: number | null;
    evaluator_scores_json: string | null;
    auto_calculated: number;
    weightPercent: number;
  }>;

  if (!rows.length) return;

  let weightedSum = 0;
  let rawSum = 0;
  for (const row of rows) {
    const { combinedRaw, managementAverage } = computeComponentCombinedScore(row);
    const weight = Number(row.weightPercent ?? 0);
    const weighted = Math.round(((combinedRaw * weight) / 100) * 100) / 100;
    weightedSum += weighted;
    rawSum += combinedRaw;

    if (managementAverage != null && Object.keys(parseEvaluatorScores(row.evaluator_scores_json)).length) {
      await sequelize.query(
        `UPDATE appraisal_component_scores SET weighted_score = :weighted, manager_raw_score = :mgr WHERE id = :id`,
        { replacements: { weighted, mgr: managementAverage, id: row.id } }
      );
    } else {
      await sequelize.query(
        `UPDATE appraisal_component_scores SET weighted_score = :weighted WHERE id = :id`,
        { replacements: { weighted, id: row.id } }
      );
    }
  }

  const weightedScore = Math.round(weightedSum * 100) / 100;
  const rawScore = rows.length ? Math.round((rawSum / rows.length) * 100) / 100 : 0;
  const grades = await loadKpiGradeDefinitions();
  const grade = scoreToGrade(weightedScore, grades);
  const recommendation = await resolveRecommendation(grade);

  await sequelize.query(
    `UPDATE employee_appraisals
     SET raw_score = :raw, weighted_score = :weighted, final_grade = :grade, recommendation = :rec,
         updated_at = UTC_TIMESTAMP()
     WHERE id = :id`,
    {
      replacements: {
        raw: rawScore,
        weighted: weightedScore,
        grade,
        rec: recommendation,
        id: appraisalId,
      },
    }
  );
}

/** Assign dense ranks within a period (1 = highest weighted score). */
export async function recalculatePeriodRankings(periodId: string): Promise<void> {
  const finalized = FINALIZED_APPRAISAL_STATUSES.map((s) => `'${s}'`).join(', ');
  const rows = (await sequelize.query(
    `SELECT id FROM employee_appraisals
     WHERE period_id = :periodId AND weighted_score IS NOT NULL
       AND workflow_status IN (${finalized})
     ORDER BY weighted_score DESC, id ASC`,
    { replacements: { periodId }, type: QueryTypes.SELECT }
  )) as Array<{ id: string }>;

  for (let i = 0; i < rows.length; i++) {
    await sequelize.query(
      `UPDATE employee_appraisals SET ranking_position = :rank, updated_at = updated_at WHERE id = :id`,
      { replacements: { rank: i + 1, id: rows[i].id } }
    );
  }
}
