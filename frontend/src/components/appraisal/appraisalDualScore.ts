import { clampKpiScore, formatAppraisalScore, type ComponentScore } from '../../types/appraisal';
import { parseEvaluatorScoresJson } from './appraisalDetailUtils';

export type ComponentScoreStageOptions = {
  /** When set on the management step, reads only this evaluator's scores (not prior evaluators). */
  evaluatorUserId?: string;
};

export type EvaluatorScoreColumn = {
  userId: string;
  label: string;
  score: number | null;
};

export type DualScoreSummary = {
  hrScore: number | null;
  managerScore: number | null;
  employeeScore: number | null;
  averageScore: number;
  hasHrScore: boolean;
  hasManagerScore: boolean;
  hasEmployeeScore: boolean;
  participantCount: number;
  /** Ordered management evaluator columns for display. */
  evaluatorColumns: EvaluatorScoreColumn[];
  managementAverage: number | null;
  autoBaselineScore: number | null;
  isAutoCalculated: boolean;
  /** Raw scores included in the combined average. */
  participantScores: number[];
};

export type ComponentScoreStage = 'hr' | 'manager' | 'employee' | 'combined';

function meanScores(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 100) / 100;
}

export function evaluatorDisplayLabel(name: string | null | undefined, fallback: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return fallback;
  // Never show raw portal ids (e.g. u-3) as column/person labels.
  if (/^u-\d+$/i.test(trimmed)) return fallback;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

/** Build ordered evaluator score columns from chain metadata + stored JSON scores. */
export function buildEvaluatorScoreColumns(
  component: ComponentScore,
  evaluators: Array<{ userId: string; name?: string | null; submitted?: boolean }> = []
): EvaluatorScoreColumn[] {
  const isAuto = Number(component.auto_calculated) === 1;
  const autoBaseline = isAuto
    ? component.hr_raw_score != null
      ? Number(component.hr_raw_score)
      : Number(component.raw_score)
    : null;
  const scoreMap = parseEvaluatorScoresJson(component.evaluator_scores_json);
  const columns: EvaluatorScoreColumn[] = [];
  const seen = new Set<string>();

  for (const [index, evaluator] of evaluators.entries()) {
    const userId = String(evaluator.userId);
    if (seen.has(userId)) continue;
    seen.add(userId);
    const stored = scoreMap[userId];
    columns.push({
      userId,
      label: evaluatorDisplayLabel(evaluator.name, `Evaluator ${index + 1}`),
      score:
        stored != null
          ? Number(stored)
          : isAuto && autoBaseline != null && evaluator.submitted
            ? autoBaseline
            : null,
    });
  }

  for (const [userId, raw] of Object.entries(scoreMap)) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    columns.push({
      userId,
      label: `Evaluator ${columns.length + 1}`,
      score: Number(raw),
    });
  }

  return columns;
}

/**
 * Combined component score:
 * - Manual KPIs: mean(management evaluator scores…) and employee self-score when submitted.
 * - Auto KPIs: mean(auto baseline and/or evaluator scores, employee self-score when submitted).
 * HR routing scores are not included for manual components once evaluators have scored.
 */
export function resolveCombinedScoreSummary(
  component: ComponentScore,
  evaluators: Array<{ userId: string; name?: string | null; submitted?: boolean }> = []
): DualScoreSummary {
  const isAuto = Number(component.auto_calculated) === 1;
  const autoBaseline = isAuto
    ? component.hr_raw_score != null
      ? Number(component.hr_raw_score)
      : Number(component.raw_score)
    : null;
  const evaluatorColumns = buildEvaluatorScoreColumns(component, evaluators);
  const managementScores = evaluatorColumns
    .map((col) => col.score)
    .filter((score): score is number => score != null);

  let managementAverage: number | null = managementScores.length
    ? meanScores(managementScores)
    : component.manager_raw_score != null
      ? Number(component.manager_raw_score)
      : isAuto && autoBaseline != null
        ? autoBaseline
        : null;

  const employeeScore =
    component.employee_raw_score != null ? Number(component.employee_raw_score) : null;

  const parts: number[] = [];

  if (isAuto) {
    if (managementAverage != null) parts.push(managementAverage);
    else if (autoBaseline != null) parts.push(autoBaseline);
  } else if (managementAverage != null) {
    parts.push(managementAverage);
  } else if (component.hr_raw_score != null && managementScores.length === 0) {
    // Legacy appraisals where HR entered manual scores before routing.
    parts.push(Number(component.hr_raw_score));
  }

  if (employeeScore != null) parts.push(employeeScore);
  if (!parts.length) parts.push(Number(component.raw_score));

  const averageScore = clampKpiScore(meanScores(parts));

  return {
    hrScore: isAuto ? autoBaseline : managementScores.length === 0 ? component.hr_raw_score ?? null : null,
    managerScore: managementAverage,
    employeeScore,
    averageScore,
    hasHrScore: isAuto && autoBaseline != null,
    hasManagerScore: managementAverage != null,
    hasEmployeeScore: employeeScore != null,
    participantCount: parts.length,
    evaluatorColumns,
    managementAverage,
    autoBaselineScore: autoBaseline,
    isAutoCalculated: isAuto,
    participantScores: parts,
  };
}

/** @deprecated Prefer resolveCombinedScoreSummary with evaluator metadata. */
export function resolveDualScoreSummary(
  component: ComponentScore,
  _managerSubmitted?: boolean,
  evaluators: Array<{ userId: string; name?: string | null }> = []
): DualScoreSummary {
  return resolveCombinedScoreSummary(component, evaluators);
}

/** Score for a wizard step — reads evaluator snapshots, not combined raw_score. */
export function resolveStageComponentScore(
  component: ComponentScore,
  stage: ComponentScoreStage,
  options?: ComponentScoreStageOptions
): number | null {
  if (stage === 'combined') {
    return resolveCombinedScoreSummary(component).averageScore;
  }

  if (stage === 'employee') {
    if (component.employee_raw_score != null) return Number(component.employee_raw_score);
    return Number(component.raw_score);
  }

  const isAuto = Number(component.auto_calculated) === 1;

  if (isAuto) {
    if (stage === 'hr' && component.hr_raw_score != null) return Number(component.hr_raw_score);
    if (stage === 'manager') {
      if (component.hr_raw_score != null) return Number(component.hr_raw_score);
      return Number(component.raw_score);
    }
    if (component.hr_raw_score != null) return Number(component.hr_raw_score);
    return Number(component.raw_score);
  }

  if (stage === 'hr') {
    const evaluatorScores = Object.values(parseEvaluatorScoresJson(component.evaluator_scores_json));
    const hrScore = component.hr_raw_score != null ? Number(component.hr_raw_score) : null;
    // Legacy HR placeholder 0 must not mask combined/management scores on the final step.
    if (hrScore === 0 && evaluatorScores.length) {
      if (component.manager_raw_score != null) return Number(component.manager_raw_score);
      return resolveCombinedScoreSummary(component).averageScore;
    }
    if (hrScore != null) return hrScore;
    return Number(component.raw_score);
  }

  if (stage === 'manager') {
    if (options?.evaluatorUserId) {
      const mine = parseEvaluatorScoresJson(component.evaluator_scores_json)[options.evaluatorUserId];
      return mine != null ? mine : null;
    }
    if (component.manager_raw_score != null) return Number(component.manager_raw_score);
    return null;
  }

  return Number(component.raw_score);
}

/** Initial manual score string for the score draft — each evaluator starts with their own scores only. */
export function resolveManualDraftScore(
  component: ComponentScore,
  stage: ComponentScoreStage,
  options?: ComponentScoreStageOptions
): string {
  const resolved = resolveStageComponentScore(component, stage, options);
  return resolved == null ? '' : String(resolved);
}

export function resolveManualDraftStage(options: {
  canManagerEvaluate: boolean;
}): ComponentScoreStage {
  return options.canManagerEvaluate ? 'manager' : 'hr';
}

export function computeStageWeightedTotal(
  components: ComponentScore[],
  stage: ComponentScoreStage
): number {
  let weightedSum = 0;
  for (const component of components) {
    const raw = resolveStageComponentScore(component, stage);
    if (raw == null) continue;
    weightedSum += roundComponentWeightedScore(raw, component.weightPercent);
  }
  return Math.round(weightedSum * 100) / 100;
}

export function computeDraftWeightedTotal(
  components: ComponentScore[],
  manualDraft: Record<string, { score: string } | undefined>,
  draftStage: ComponentScoreStage,
  options?: ComponentScoreStageOptions
): number {
  let weightedSum = 0;
  for (const component of components) {
    const stageScore = resolveStageComponentScore(component, draftStage, options);
    let raw: number | null = stageScore;
    if (Number(component.auto_calculated) === 0) {
      const draftText = manualDraft[component.component_id]?.score?.trim() ?? '';
      if (draftText !== '') {
        raw = clampKpiScore(Number(draftText));
      } else if (draftStage === 'manager') {
        raw = null;
      }
    }
    if (raw == null) continue;
    weightedSum += roundComponentWeightedScore(raw, component.weightPercent);
  }
  return Math.round(weightedSum * 100) / 100;
}

/** Employee self-rating for one component — null when not submitted yet. */
export function resolveEmployeeSelfScore(
  component: ComponentScore,
  payloadScoreByComponentId?: Record<string, number>
): number | null {
  if (component.employee_raw_score != null) return Number(component.employee_raw_score);
  const fromPayload = payloadScoreByComponentId?.[component.component_id];
  if (fromPayload != null && Number.isFinite(fromPayload)) return fromPayload;
  return null;
}

export function computeEmployeeSelfWeightedTotal(
  components: ComponentScore[],
  payloadScoreByComponentId?: Record<string, number>
): number | null {
  let weightedSum = 0;
  let hasAny = false;
  for (const component of components) {
    const score = resolveEmployeeSelfScore(component, payloadScoreByComponentId);
    if (score == null) continue;
    hasAny = true;
    weightedSum += roundComponentWeightedScore(score, component.weightPercent);
  }
  if (!hasAny) return null;
  return Math.round(weightedSum * 100) / 100;
}

/** Round weighted contribution the same way as the appraisal backend. */
export function roundComponentWeightedScore(rawScore: number, weightPercent: number): number {
  return Math.round(((rawScore * weightPercent) / 100) * 100) / 100;
}

export function computeCombinedWeightedTotal(
  components: ComponentScore[],
  _managerSubmitted?: boolean,
  evaluators: Array<{ userId: string; name?: string | null }> = []
): number {
  let weightedSum = 0;
  for (const component of components) {
    const summary = resolveCombinedScoreSummary(component, evaluators);
    weightedSum += roundComponentWeightedScore(summary.averageScore, component.weightPercent);
  }
  return Math.round(weightedSum * 100) / 100;
}

export function formatDualScoreFormula(summary: DualScoreSummary): string {
  const labels: string[] = [];
  for (const col of summary.evaluatorColumns) {
    if (col.score != null) {
      labels.push(`${col.label} ${formatAppraisalScore(col.score)}`);
    }
  }
  if (!summary.evaluatorColumns.length && summary.hasManagerScore && summary.managerScore != null) {
    labels.push(`Management ${formatAppraisalScore(summary.managerScore)}`);
  }
  if (summary.isAutoCalculated && summary.autoBaselineScore != null && !summary.evaluatorColumns.length) {
    labels.push(`Auto ${formatAppraisalScore(summary.autoBaselineScore)}`);
  }
  if (summary.hasEmployeeScore && summary.employeeScore != null) {
    labels.push(`Employee ${formatAppraisalScore(summary.employeeScore)}`);
  }
  if (!labels.length) return 'No evaluator scores recorded yet.';
  if (labels.length === 1) {
    return `${labels[0]} (single score)`;
  }
  const joined = labels.join(' + ');
  return `(${joined}) ÷ ${summary.participantCount} = ${formatAppraisalScore(summary.averageScore)}`;
}
