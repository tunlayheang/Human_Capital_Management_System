export type ProbationReviewStatus =
  | 'UPCOMING'
  | 'REVIEW_DUE'
  | 'IN_REVIEW'
  | 'PENDING_MANAGER'
  | 'PENDING_EMPLOYEE'
  | 'PENDING_HR'
  | 'PENDING_FINAL_APPROVAL'
  | 'PASSED'
  | 'EXTENDED'
  | 'FAILED'
  | 'REJECTED';

export type ProbationReviewRecommendation = 'PASS' | 'EXTEND' | 'FAIL';

export type ProbationRatingLevel =
  | 'EXCELLENT'
  | 'GOOD'
  | 'AVERAGE'
  | 'NEEDS_IMPROVEMENT';

export type ProbationEvaluationRatings = {
  jobPerformance: ProbationRatingLevel;
  attendance: ProbationRatingLevel;
  workAttitude: ProbationRatingLevel;
  teamwork: ProbationRatingLevel;
};

export const PROBATION_RATING_LEVELS: ProbationRatingLevel[] = [
  'EXCELLENT',
  'GOOD',
  'AVERAGE',
  'NEEDS_IMPROVEMENT',
];

export const PROBATION_EXTENSION_DAYS = [15, 30, 60, 90] as const;

export type ProbationReviewSummary = {
  totalOnProbation: number;
  reviewsDueThisMonth: number;
  passed: number;
  extended: number;
  failed: number;
};

export type ProbationReviewListItem = {
  userId: string;
  employeeId: string;
  name: string;
  email: string;
  role: string;
  departmentId?: string;
  departmentName?: string;
  positionId?: string;
  position?: string;
  /** Current contractual base salary on the employee record. */
  baseSalary?: number;
  currency?: string;
  joinDate: string;
  probationEnd: string;
  probationMonths: number;
  workerType: string;
  daysRemaining: number;
  overdue: boolean;
  status: ProbationReviewStatus;
  recommendation: ProbationReviewRecommendation | null;
  overallRecommendation: string | null;
  reviewId: string | null;
  nextReviewDate: string | null;
  inProbation: boolean;
  probationConfirmedAt: string | null;
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  hrNotes: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  assignedHrUserId: string | null;
  assignedHrName: string | null;
  assignedManagerUserId: string | null;
  assignedManagerName: string | null;
  routedByHrUserId: string | null;
  managerSubmittedBy: string | null;
  managerSubmittedAt: string | null;
  managerRatings: ProbationEvaluationRatings | null;
  managerStrengths: string;
  managerAreasForImprovement: string;
  managerOverallRecommendation: string | null;
  employeeSubmittedAt: string | null;
  employeeSubmittedBy: string | null;
  employeeRatings: ProbationEvaluationRatings | null;
  employeeStrengths: string;
  employeeAreasForImprovement: string;
  canManagerEdit: boolean;
  canEmployeeSelfEvaluate: boolean;
  canHrDecide: boolean;
  /** HR/Admin can run the full evaluate → outcome workflow */
  canEvaluate: boolean;
  /** HR/Admin can assign a manager to evaluate first */
  canRouteToManager: boolean;
  assignedEvaluatorUserIds?: string[];
  assignedEvaluators?: Array<{
    userId: string;
    name: string | null;
    status: 'pending' | 'submitted';
    submittedAt: string | null;
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }>;
  currentEvaluatorUserId?: string | null;
  currentEvaluatorName?: string | null;
  evaluationProgress?: { submitted: number; total: number } | null;
  evaluatorRatingsByUserId?: Record<string, ProbationEvaluationRatings>;
  managementEvaluationsByUserId?: Record<
    string,
    {
      strengths?: string | null;
      areasForImprovement?: string | null;
      overallRecommendation?: string | null;
      submittedAt?: string | null;
    }
  >;
  assignedApproverUserIds?: string[];
  assignedApprovers?: Array<{
    userId: string;
    name: string | null;
    status: string;
    approvedAt: string | null;
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }>;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  approvalProgress?: { approved: number; total: number } | null;
  canApproverReview?: boolean;
};

export type ProbationHrAssignee = {
  userId: string;
  name: string;
  email: string;
};

export type ProbationManagerAssignee = {
  userId: string;
  name: string;
  email: string;
  departmentId: string;
  departmentName: string;
};

export type SubmitProbationReviewInput = {
  userId: string;
  reviewId?: string | null;
  action:
    | 'SAVE_DRAFT'
    | 'ROUTE_TO_MANAGER'
    | 'SUBMIT_TO_HR'
    | 'SUBMIT_SELF_EVALUATION'
    | 'SUBMIT_FOR_APPROVAL'
    | 'HR_DECIDE'
    | 'SUBMIT';
  assignedApproverUserIds?: string[];
  recommendation?: ProbationReviewRecommendation;
  ratings?: Partial<ProbationEvaluationRatings>;
  strengths?: string;
  areasForImprovement?: string;
  hrNotes?: string;
  extensionDays?: number;
  extensionReason?: string;
  nextReviewDate?: string;
  assignedHrUserId?: string | null;
  assignedManagerUserId?: string | null;
  /** Ordered management evaluators (multi-evaluator chain). */
  assignedEvaluatorUserIds?: string[];
  reviewedBy?: string | null;
  periodEnd?: string | null;
  actorRole?: string | null;
  actorUserId?: string | null;
  movementOutcome?: Record<string, unknown>;
  offboardOutcome?: Record<string, unknown>;
};
