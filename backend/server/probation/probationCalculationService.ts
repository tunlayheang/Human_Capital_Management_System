import type {
  ProbationEvaluationRatings,
  ProbationRatingLevel,
} from './probationReviewTypes.js';
import {
  normalizeEvaluationRatings,
  parseEvaluationRatingsJson,
} from './probationReviewEvaluation.js';

export const PROBATION_CRITERIA = [
  'jobPerformance',
  'attendance',
  'workAttitude',
  'teamwork',
] as const;

export type ProbationCriterion = (typeof PROBATION_CRITERIA)[number];

const RATING_SCORE: Record<ProbationRatingLevel, number> = {
  EXCELLENT: 4,
  GOOD: 3,
  AVERAGE: 2,
  NEEDS_IMPROVEMENT: 1,
};

export function ratingLevelToNumeric(level: ProbationRatingLevel): number {
  return RATING_SCORE[level];
}

export function numericToRatingLevel(score: number): ProbationRatingLevel {
  const rounded = Math.round(score * 100) / 100;
  if (rounded >= 3.5) return 'EXCELLENT';
  if (rounded >= 2.5) return 'GOOD';
  if (rounded >= 1.5) return 'AVERAGE';
  return 'NEEDS_IMPROVEMENT';
}

function meanNumeric(values: number[]): number {
  if (!values.length) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export type ProbationManagementEvaluationEntry = {
  strengths?: string | null;
  areasForImprovement?: string | null;
  overallRecommendation?: string | null;
  submittedAt?: string | null;
};

/** Parse `{ userId: narrative }` from outcome payload. */
export function parseManagementEvaluationsMap(
  raw: unknown
): Record<string, ProbationManagementEvaluationEntry> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ProbationManagementEvaluationEntry> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    out[String(userId)] = {
      strengths: entry.strengths != null ? String(entry.strengths) : null,
      areasForImprovement:
        entry.areasForImprovement != null ? String(entry.areasForImprovement) : null,
      overallRecommendation:
        entry.overallRecommendation != null ? String(entry.overallRecommendation) : null,
      submittedAt: entry.submittedAt != null ? String(entry.submittedAt) : null,
    };
  }
  return out;
}

/** Parse `{ userId: ratings }` from outcome payload. */
export function parseEvaluatorRatingsMap(
  raw: unknown
): Record<string, ProbationEvaluationRatings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ProbationEvaluationRatings> = {};
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    const ratings = parseEvaluationRatingsJson(value);
    if (ratings) out[String(userId)] = ratings;
  }
  return out;
}

export function parseProbationOutcomePayload(
  raw: string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Store this evaluator's ratings + narrative in the outcome payload. */
export function recordProbationEvaluatorSnapshot(
  priorOutcome: Record<string, unknown>,
  actorUserId: string,
  ratings: ProbationEvaluationRatings,
  evaluation: {
    strengths?: string | null;
    areasForImprovement?: string | null;
    overallRecommendation?: string | null;
  }
): Record<string, unknown> {
  const actorKey = String(actorUserId ?? '').trim();
  const evaluatorRatings = parseEvaluatorRatingsMap(priorOutcome.evaluatorRatings);
  const managementEvaluations =
    priorOutcome.managementEvaluations &&
    typeof priorOutcome.managementEvaluations === 'object' &&
    !Array.isArray(priorOutcome.managementEvaluations)
      ? { ...(priorOutcome.managementEvaluations as Record<string, unknown>) }
      : {};

  if (actorKey) {
    evaluatorRatings[actorKey] = ratings;
    managementEvaluations[actorKey] = {
      strengths: evaluation.strengths?.trim() || null,
      areasForImprovement: evaluation.areasForImprovement?.trim() || null,
      overallRecommendation: evaluation.overallRecommendation ?? null,
      submittedAt: new Date().toISOString(),
    };
  }

  return {
    ...priorOutcome,
    evaluatorRatings,
    managementEvaluations,
  };
}

/** Combined rating for one criterion from management evaluators and optional employee. */
export function computeCriterionCombinedRating(
  criterion: ProbationCriterion,
  evaluatorRatings: Record<string, ProbationEvaluationRatings>,
  submittedEvaluatorIds: string[],
  employeeRatings: ProbationEvaluationRatings | null
): ProbationRatingLevel | null {
  const managementScores = submittedEvaluatorIds
    .map((userId) => evaluatorRatings[userId]?.[criterion])
    .filter((level): level is ProbationRatingLevel => Boolean(level))
    .map(ratingLevelToNumeric);

  const parts: number[] = [];
  if (managementScores.length) {
    parts.push(meanNumeric(managementScores));
  }
  const employeeLevel = employeeRatings?.[criterion];
  if (employeeLevel) {
    parts.push(ratingLevelToNumeric(employeeLevel));
  }
  if (!parts.length) return null;
  return numericToRatingLevel(meanNumeric(parts));
}

/** Combined ratings across all criteria (management average + employee when present). */
export function computeCombinedProbationRatings(
  evaluatorRatings: Record<string, ProbationEvaluationRatings>,
  submittedEvaluatorIds: string[],
  employeeRatings: ProbationEvaluationRatings | null
): ProbationEvaluationRatings | null {
  const partial: Partial<ProbationEvaluationRatings> = {};
  for (const criterion of PROBATION_CRITERIA) {
    const combined = computeCriterionCombinedRating(
      criterion,
      evaluatorRatings,
      submittedEvaluatorIds,
      employeeRatings
    );
    if (!combined) return null;
    partial[criterion] = combined;
  }
  return normalizeEvaluationRatings(partial);
}

/** Build aggregate manager evaluation snapshot after every evaluator has submitted. */
export function buildAggregateManagerEvaluation(
  outcome: Record<string, unknown>,
  submittedEvaluatorIds: string[]
): {
  ratings: ProbationEvaluationRatings;
  strengths: string | null;
  areasForImprovement: string | null;
  overallRecommendation: string | null;
} | null {
  const evaluatorRatings = parseEvaluatorRatingsMap(outcome.evaluatorRatings);
  const combined = computeCombinedProbationRatings(
    evaluatorRatings,
    submittedEvaluatorIds,
    null
  );
  if (!combined) return null;

  const managementEvaluations =
    outcome.managementEvaluations &&
    typeof outcome.managementEvaluations === 'object' &&
    !Array.isArray(outcome.managementEvaluations)
      ? (outcome.managementEvaluations as Record<string, { overallRecommendation?: string | null }>)
      : {};

  const recommendations = submittedEvaluatorIds
    .map((id) => managementEvaluations[id]?.overallRecommendation)
    .filter((v): v is string => Boolean(v?.trim()));

  const lastId = submittedEvaluatorIds[submittedEvaluatorIds.length - 1];
  const lastEval =
    lastId && managementEvaluations[lastId] && typeof managementEvaluations[lastId] === 'object'
      ? (managementEvaluations[lastId] as {
          strengths?: string | null;
          areasForImprovement?: string | null;
        })
      : null;

  return {
    ratings: combined,
    strengths: lastEval?.strengths?.trim() || null,
    areasForImprovement: lastEval?.areasForImprovement?.trim() || null,
    overallRecommendation: recommendations[recommendations.length - 1] ?? null,
  };
}
