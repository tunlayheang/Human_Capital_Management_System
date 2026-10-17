import type { ProbationRatingLevel, ProbationRow } from '../../types';

export type ProbationRatingDraft = {
  jobPerformance: ProbationRatingLevel | '';
  attendance: ProbationRatingLevel | '';
  workAttitude: ProbationRatingLevel | '';
  teamwork: ProbationRatingLevel | '';
};

export const EMPTY_PROBATION_RATINGS: ProbationRatingDraft = {
  jobPerformance: '',
  attendance: '',
  workAttitude: '',
  teamwork: '',
};

/** Whether this review uses per-evaluator drafts (HR-routed chain). */
export function isProbationRoutedEvaluatorFlow(row: ProbationRow): boolean {
  return Boolean(
    row.routedByHrUserId ||
      row.assignedEvaluatorUserIds?.length ||
      (row.status === 'PENDING_MANAGER' && row.assignedManagerUserId)
  );
}

/** Load evaluation draft for the current wizard actor — isolated per evaluator only during their turn. */
export function hydrateProbationEvaluatorDraft(
  row: ProbationRow,
  userId: string | undefined
): {
  ratings: ProbationRatingDraft;
  strengths: string;
  areasForImprovement: string;
} {
  const actorId = String(userId ?? '').trim();
  const currentEvaluatorId = String(
    row.currentEvaluatorUserId ?? row.assignedManagerUserId ?? ''
  ).trim();
  const isCurrentEvaluatorStep =
    row.status === 'PENDING_MANAGER' &&
    Boolean(actorId) &&
    Boolean(currentEvaluatorId) &&
    actorId === currentEvaluatorId;

  if (isProbationRoutedEvaluatorFlow(row) && isCurrentEvaluatorStep) {
    const myRatings = row.evaluatorRatingsByUserId?.[actorId];
    const myNarrative = row.managementEvaluationsByUserId?.[actorId];
    return {
      ratings: {
        jobPerformance: myRatings?.jobPerformance ?? '',
        attendance: myRatings?.attendance ?? '',
        workAttitude: myRatings?.workAttitude ?? '',
        teamwork: myRatings?.teamwork ?? '',
      },
      strengths: myNarrative?.strengths ?? '',
      areasForImprovement: myNarrative?.areasForImprovement ?? '',
    };
  }

  if (row.managerRatings) {
    return {
      ratings: {
        jobPerformance: row.managerRatings.jobPerformance ?? '',
        attendance: row.managerRatings.attendance ?? '',
        workAttitude: row.managerRatings.workAttitude ?? '',
        teamwork: row.managerRatings.teamwork ?? '',
      },
      strengths: row.managerStrengths ?? '',
      areasForImprovement: row.managerAreasForImprovement ?? '',
    };
  }

  return {
    ratings: {
      jobPerformance: row.ratings?.jobPerformance ?? '',
      attendance: row.ratings?.attendance ?? '',
      workAttitude: row.ratings?.workAttitude ?? '',
      teamwork: row.ratings?.teamwork ?? '',
    },
    strengths: row.strengths ?? '',
    areasForImprovement: row.areasForImprovement ?? '',
  };
}
