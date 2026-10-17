import type { ProbationEvaluationRatings, ProbationRatingLevel } from '../../types';
import { PROBATION_RATING_OPTIONS } from './probationReviewUi';

export const PROBATION_CRITERIA = [
  'jobPerformance',
  'attendance',
  'workAttitude',
  'teamwork',
] as const;

export type ProbationCriterion = (typeof PROBATION_CRITERIA)[number];

export const PROBATION_CRITERION_LABELS: Array<{ key: ProbationCriterion; label: string }> = [
  { key: 'jobPerformance', label: 'Job Performance' },
  { key: 'attendance', label: 'Attendance & Punctuality' },
  { key: 'workAttitude', label: 'Work Attitude' },
  { key: 'teamwork', label: 'Teamwork' },
];

const RATING_SCORE: Record<ProbationRatingLevel, number> = {
  EXCELLENT: 4,
  GOOD: 3,
  AVERAGE: 2,
  NEEDS_IMPROVEMENT: 1,
};

function ratingLevelToNumeric(level: ProbationRatingLevel): number {
  return RATING_SCORE[level];
}

function numericToRatingLevel(score: number): ProbationRatingLevel {
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

function computeCriterionCombinedRating(
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
  if (managementScores.length) parts.push(meanNumeric(managementScores));
  const employeeLevel = employeeRatings?.[criterion];
  if (employeeLevel) parts.push(ratingLevelToNumeric(employeeLevel));
  if (!parts.length) return null;
  return numericToRatingLevel(meanNumeric(parts));
}

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
  return partial as ProbationEvaluationRatings;
}

export type EvaluatorRatingColumn = {
  userId: string;
  label: string;
  rating: ProbationRatingLevel | null;
};

export type CriterionCombinedSummary = {
  evaluatorColumns: EvaluatorRatingColumn[];
  employeeRating: ProbationRatingLevel | null;
  combinedRating: ProbationRatingLevel | null;
  managementAverage: ProbationRatingLevel | null;
  participantScores: number[];
};

function firstNameOrLabel(name: string | null | undefined, fallback: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0] ?? fallback;
}

export function ratingLabel(level: ProbationRatingLevel | null | undefined): string {
  if (!level) return '—';
  return PROBATION_RATING_OPTIONS.find((opt) => opt.value === level)?.label ?? level;
}

export function buildEvaluatorRatingColumns(
  criterion: ProbationCriterion,
  evaluatorRatingsByUserId: Record<string, ProbationEvaluationRatings> = {},
  evaluators: Array<{ userId: string; name?: string | null; submitted?: boolean }> = []
): EvaluatorRatingColumn[] {
  const columns: EvaluatorRatingColumn[] = [];
  const seen = new Set<string>();

  for (const [index, evaluator] of evaluators.entries()) {
    const userId = String(evaluator.userId);
    if (seen.has(userId)) continue;
    seen.add(userId);
    columns.push({
      userId,
      label: firstNameOrLabel(evaluator.name, `Evaluator ${index + 1}`),
      rating: evaluatorRatingsByUserId[userId]?.[criterion] ?? null,
    });
  }

  for (const [userId, ratings] of Object.entries(evaluatorRatingsByUserId)) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    columns.push({
      userId,
      label: `Evaluator ${columns.length + 1}`,
      rating: ratings[criterion] ?? null,
    });
  }

  return columns;
}

export function resolveCriterionCombinedSummary(
  criterion: ProbationCriterion,
  evaluatorRatingsByUserId: Record<string, ProbationEvaluationRatings> = {},
  evaluators: Array<{ userId: string; name?: string | null; submitted?: boolean }> = [],
  employeeRatings: ProbationEvaluationRatings | null = null
): CriterionCombinedSummary {
  const evaluatorColumns = buildEvaluatorRatingColumns(
    criterion,
    evaluatorRatingsByUserId,
    evaluators
  );
  const submittedIds = evaluators
    .filter((ev) => ev.submitted)
    .map((ev) => String(ev.userId));
  const idsForAverage = submittedIds.length ? submittedIds : Object.keys(evaluatorRatingsByUserId);
  const managementScores = idsForAverage
    .map((userId) => evaluatorRatingsByUserId[userId]?.[criterion])
    .filter((rating): rating is ProbationRatingLevel => Boolean(rating))
    .map(ratingLevelToNumeric);

  const employeeRating = employeeRatings?.[criterion] ?? null;
  const parts: number[] = [];
  if (managementScores.length) parts.push(meanNumeric(managementScores));
  if (employeeRating) parts.push(ratingLevelToNumeric(employeeRating));
  const combinedRating = parts.length ? numericToRatingLevel(meanNumeric(parts)) : null;
  const managementAverage = managementScores.length
    ? numericToRatingLevel(meanNumeric(managementScores))
    : null;

  return {
    evaluatorColumns,
    employeeRating,
    combinedRating,
    managementAverage,
    participantScores: parts,
  };
}

export function formatCriterionCombinedFormula(summary: CriterionCombinedSummary): string {
  const labels: string[] = [];
  for (const col of summary.evaluatorColumns) {
    if (col.rating) labels.push(`${col.label} ${ratingLabel(col.rating)}`);
  }
  if (summary.employeeRating) {
    labels.push(`Employee ${ratingLabel(summary.employeeRating)}`);
  }
  if (!labels.length) return 'No ratings recorded yet.';
  if (labels.length === 1) return `${labels[0]} (single rating)`;
  return `(${labels.join(' + ')}) ÷ ${summary.participantScores.length} = ${ratingLabel(summary.combinedRating)}`;
}
