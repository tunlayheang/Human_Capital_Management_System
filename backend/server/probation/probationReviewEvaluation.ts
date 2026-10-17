import type {
  ProbationEvaluationRatings,
  ProbationRatingLevel,
  ProbationReviewRecommendation,
} from './probationReviewTypes.js';

const RATING_SCORE: Record<ProbationRatingLevel, number> = {
  EXCELLENT: 4,
  GOOD: 3,
  AVERAGE: 2,
  NEEDS_IMPROVEMENT: 1,
};

export function normalizeRatingLevel(raw: unknown): ProbationRatingLevel | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (s === 'EXCELLENT') return 'EXCELLENT';
  if (s === 'GOOD') return 'GOOD';
  if (s === 'AVERAGE') return 'AVERAGE';
  if (s === 'NEEDS_IMPROVEMENT') return 'NEEDS_IMPROVEMENT';
  return null;
}

export function normalizeEvaluationRatings(
  raw: Partial<ProbationEvaluationRatings> | null | undefined
): ProbationEvaluationRatings | null {
  if (!raw || typeof raw !== 'object') return null;
  const jobPerformance = normalizeRatingLevel(raw.jobPerformance);
  const attendance = normalizeRatingLevel(raw.attendance);
  const workAttitude = normalizeRatingLevel(raw.workAttitude);
  const teamwork = normalizeRatingLevel(raw.teamwork);
  if (!jobPerformance || !attendance || !workAttitude || !teamwork) return null;
  return { jobPerformance, attendance, workAttitude, teamwork };
}

export function deriveOverallRecommendation(
  ratings: ProbationEvaluationRatings | null
): { label: string; recommendation: ProbationReviewRecommendation } {
  if (!ratings) {
    return { label: 'Complete evaluation to see recommendation', recommendation: 'EXTEND' };
  }
  const scores = [
    RATING_SCORE[ratings.jobPerformance],
    RATING_SCORE[ratings.attendance],
    RATING_SCORE[ratings.workAttitude],
    RATING_SCORE[ratings.teamwork],
  ];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const needsImprovementCount = scores.filter((s) => s <= 1).length;

  if (needsImprovementCount >= 2 || avg < 1.75) {
    return { label: 'Fail Probation — significant improvement needed', recommendation: 'FAIL' };
  }
  if (avg >= 3) {
    return { label: 'Pass Probation — meets expectations', recommendation: 'PASS' };
  }
  return { label: 'Extend Probation — more observation time recommended', recommendation: 'EXTEND' };
}

export function ratingsToScore(ratings: ProbationEvaluationRatings | null): number | null {
  if (!ratings) return null;
  const scores = [
    RATING_SCORE[ratings.jobPerformance],
    RATING_SCORE[ratings.attendance],
    RATING_SCORE[ratings.workAttitude],
    RATING_SCORE[ratings.teamwork],
  ];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round((avg / 4) * 100);
}

export function parseEvaluationRatingsJson(raw: unknown): ProbationEvaluationRatings | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    return normalizeEvaluationRatings(raw as Partial<ProbationEvaluationRatings>);
  }
  try {
    const parsed = JSON.parse(String(raw));
    return normalizeEvaluationRatings(parsed);
  } catch {
    return null;
  }
}
