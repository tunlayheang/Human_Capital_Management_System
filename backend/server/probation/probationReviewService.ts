import { Op } from 'sequelize';
import { Department, Employee, EmployeeReview, Position, User } from '../db.js';
import {
  applyProbationFailOutcome,
  applyProbationPassOutcome,
  type ProbationMovementOutcome,
  type ProbationOffboardOutcome,
} from './probationReviewOutcomes.js';
import {
  computedProbationEndDate,
  formatDateOnly,
  isInProbation,
  isProbationReviewScope,
  normalizeWorkerType,
  resolveProbationPeriodMonths,
  type ProbationEmployeeSnapshot,
} from '../probationService.js';
import {
  deriveOverallRecommendation,
  normalizeEvaluationRatings,
  parseEvaluationRatingsJson,
  ratingsToScore,
} from './probationReviewEvaluation.js';
import { addDaysToDate, deriveProbationReviewStatus } from './probationReviewStatus.js';
import { joinEmployeeNameParts } from '../employeeDisplayName.js';
import type {
  ProbationEvaluationRatings,
  ProbationHrAssignee,
  ProbationManagerAssignee,
  ProbationReviewListItem,
  ProbationReviewRecommendation,
  ProbationReviewStatus,
  ProbationReviewSummary,
  SubmitProbationReviewInput,
} from './probationReviewTypes.js';
import { PROBATION_EXTENSION_DAYS } from './probationReviewTypes.js';
import {
  buildAggregateManagerEvaluation,
  parseEvaluatorRatingsMap,
  parseManagementEvaluationsMap,
  parseProbationOutcomePayload,
  recordProbationEvaluatorSnapshot,
} from './probationCalculationService.js';
import {
  managerParticipatedInProbationOutcome,
  managerCanSeeAssignedProbation,
} from './probationManagerScope.js';

const CLEAR_MAIN_EVALUATION_FIELDS = {
  evaluationRatingsJson: null,
  strengths: null,
  areasForImprovement: null,
  overallRecommendation: null,
  score: null,
  notes: null,
} as const;

type ProbationEvaluatorDtoFields = {
  assignedEvaluatorUserIds: string[];
  assignedEvaluators: Array<{
    userId: string;
    name: string | null;
    status: 'pending' | 'submitted';
    submittedAt: string | null;
    sortOrder: number;
    phase: 'submitted' | 'current' | 'queued';
  }>;
  currentEvaluatorUserId: string | null;
  currentEvaluatorName: string | null;
  evaluationProgress: { submitted: number; total: number } | null;
};

function serializeProbationEvaluatorRecordsForDto(
  records: import('../workflowChainApproverService.js').ChainApproverRecord[]
): ProbationEvaluatorDtoFields {
  const sorted = [...records].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = sorted.find((row) => row.status === 'pending') ?? null;
  const submitted = sorted.filter((row) => row.status === 'approved').length;
  return {
    assignedEvaluatorUserIds: sorted.map((row) => row.userId),
    assignedEvaluators: sorted.map((row) => ({
      userId: row.userId,
      name: row.userName,
      status: row.status === 'approved' ? 'submitted' : 'pending',
      submittedAt: row.approvedAt,
      sortOrder: row.sortOrder,
      phase:
        row.status === 'approved'
          ? 'submitted'
          : current?.userId === row.userId
            ? 'current'
            : 'queued',
    })),
    currentEvaluatorUserId: current?.userId ?? null,
    currentEvaluatorName: current?.userName ?? null,
    evaluationProgress: sorted.length ? { submitted, total: sorted.length } : null,
  };
}

async function loadProbationEvaluatorDtoFields(reviewId: string): Promise<ProbationEvaluatorDtoFields> {
  const { PROBATION_EVALUATOR_CONFIG, loadChainApprovers } = await import(
    '../workflowChainApproverService.js'
  );
  return serializeProbationEvaluatorRecordsForDto(
    await loadChainApprovers(PROBATION_EVALUATOR_CONFIG, reviewId)
  );
}

async function loadProbationEvaluatorDtoFieldsBatch(
  reviewIds: string[]
): Promise<Map<string, ProbationEvaluatorDtoFields>> {
  const { PROBATION_EVALUATOR_CONFIG, loadChainApproversBatch } = await import(
    '../workflowChainApproverService.js'
  );
  const map = await loadChainApproversBatch(PROBATION_EVALUATOR_CONFIG, reviewIds);
  const out = new Map<string, ProbationEvaluatorDtoFields>();
  for (const id of reviewIds) {
    out.set(String(id), serializeProbationEvaluatorRecordsForDto(map.get(String(id)) ?? []));
  }
  return out;
}

/** Whether `userId` is the evaluator whose turn it is for this probation review. */
export async function isCurrentProbationEvaluator(
  reviewId: string,
  userId: string
): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const { PROBATION_EVALUATOR_CONFIG, loadChainApprovers, getCurrentPendingChainApprover } =
    await import('../workflowChainApproverService.js');
  const chain = await loadChainApprovers(PROBATION_EVALUATOR_CONFIG, reviewId);
  if (chain.length) {
    const current = getCurrentPendingChainApprover(chain);
    return Boolean(current && current.userId === id);
  }
  const row: any = await EmployeeReview.findByPk(reviewId, {
    attributes: ['assignedManagerUserId'],
  });
  if (!row) return false;
  return String(row.assignedManagerUserId ?? '') === id;
}

async function notifyProbationEvaluatorTurn(
  reviewId: string,
  evaluatorUserId: string,
  stepLabel?: string,
  employeeUserId?: string
): Promise<void> {
  const userId = String(evaluatorUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('../notificationService.js');
    let targetUserId = String(employeeUserId ?? '').trim();
    if (!targetUserId) {
      const { loadProbationNotificationMeta } = await import('../workflowProbationApproverService.js');
      const meta = await loadProbationNotificationMeta(reviewId);
      targetUserId = String(meta.employeeUserId ?? '').trim();
    }
    await createNotification({
      userId,
      id: `pev-turn-${reviewId}-${userId}`,
      title: 'Probation review awaiting your evaluation',
      message: `A probation review has been routed to you for evaluation.${stepLabel ? ` ${stepLabel}` : ''}`,
      type: 'WARNING',
      link: targetUserId
        ? `/performance?tab=probation&userId=${encodeURIComponent(targetUserId)}`
        : '/performance?tab=probation',
      entityId: targetUserId || reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[pev] notifyProbationEvaluatorTurn failed:', err);
  }
}

export async function resolveEmployeeFromReviewUserId(
  userId: string
): Promise<{ employee: InstanceType<typeof Employee>; user: InstanceType<typeof User> } | null> {
  const user: any = await User.findByPk(userId);
  if (!user) return null;
  const employeePk = String(user.employeeId ?? '').trim();
  if (!employeePk) return null;
  const employee = await Employee.findOne({
    where: { id: employeePk },
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });
  if (!employee) return null;
  return { employee, user };
}

function reviewPlain(row: any): Record<string, unknown> {
  return row?.get ? row.get({ plain: true }) : row;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parseEmployeeEvaluationSnapshot(latest: Record<string, unknown> | null | undefined): {
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  submittedAt: string | null;
  submittedBy: string | null;
} | null {
  if (!latest) return null;
  const raw = parseJsonObject(latest.outcomePayloadJson);
  const snap =
    raw?.employeeEvaluation && typeof raw.employeeEvaluation === 'object'
      ? (raw.employeeEvaluation as Record<string, unknown>)
      : null;
  const columnSubmittedAt = latest.employeeSubmittedAt
    ? String(latest.employeeSubmittedAt)
    : null;
  const payloadSubmittedAt = snap?.submittedAt ? String(snap.submittedAt) : null;
  const submittedAt = columnSubmittedAt || payloadSubmittedAt;
  if (!submittedAt && !snap) return null;

  if (snap) {
    const ratings =
      parseEvaluationRatingsJson(snap.ratings) ??
      parseEvaluationRatingsJson(snap);
    return {
      ratings,
      strengths: String(snap.strengths ?? ''),
      areasForImprovement: String(snap.areasForImprovement ?? ''),
      submittedAt,
      submittedBy: snap.submittedBy
        ? String(snap.submittedBy)
        : latest.employeeSubmittedBy
          ? String(latest.employeeSubmittedBy)
          : null,
    };
  }

  // Timestamp exists but payload snapshot is missing (legacy / partial rows).
  if (submittedAt) {
    return {
      ratings: null,
      strengths: '',
      areasForImprovement: '',
      submittedAt,
      submittedBy: latest.employeeSubmittedBy ? String(latest.employeeSubmittedBy) : null,
    };
  }
  return null;
}

function parseManagerEvaluationSnapshot(latest: Record<string, unknown> | null | undefined): {
  ratings: ProbationEvaluationRatings | null;
  strengths: string;
  areasForImprovement: string;
  overallRecommendation: string | null;
} | null {
  if (!latest?.managerSubmittedAt) return null;
  try {
    const raw = parseJsonObject(latest.outcomePayloadJson);
    const snap = raw?.managerEvaluation;
    if (snap && typeof snap === 'object') {
      const snapObj = snap as Record<string, unknown>;
      return {
        ratings: parseEvaluationRatingsJson(snapObj.ratings),
        strengths: String(snapObj.strengths ?? ''),
        areasForImprovement: String(snapObj.areasForImprovement ?? ''),
        overallRecommendation: snapObj.overallRecommendation
          ? String(snapObj.overallRecommendation)
          : null,
      };
    }
    const evaluatorRatings = parseEvaluatorRatingsMap(raw?.evaluatorRatings);
    const submittedIds = Object.keys(evaluatorRatings);
    if (submittedIds.length) {
      const aggregate = buildAggregateManagerEvaluation(raw ?? {}, submittedIds);
      if (aggregate) {
        return {
          ratings: aggregate.ratings,
          strengths: String(aggregate.strengths ?? ''),
          areasForImprovement: String(aggregate.areasForImprovement ?? ''),
          overallRecommendation: aggregate.overallRecommendation,
        };
      }
    }
  } catch {
    /* fall through */
  }
  return {
    ratings: parseEvaluationRatingsJson(latest.evaluationRatingsJson),
    strengths: String(latest.strengths ?? ''),
    areasForImprovement: String(latest.areasForImprovement ?? ''),
    overallRecommendation: latest.overallRecommendation
      ? String(latest.overallRecommendation)
      : null,
  };
}

function mapRecommendation(raw: unknown): ProbationReviewRecommendation | null {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'PASS' || s === 'PASSED') return 'PASS';
  if (s === 'EXTEND' || s === 'EXTENDED') return 'EXTEND';
  if (s === 'FAIL' || s === 'FAILED') return 'FAIL';
  return null;
}

export function isEmployeeInProbationReviewScope(
  employee: ProbationEmployeeSnapshot & {
    probation_next_review_date?: string | null;
  }
): boolean {
  if (String(employee.status ?? '').toLowerCase() !== 'active') return false;
  if (employee.probation_confirmed_at) return false;
  if (employee.probation_next_review_date) return true;
  return isProbationReviewScope(employee);
}

export type ProbationReviewActor = {
  userId: string;
  role: string;
  employeePk?: string | null;
};

export async function resolveActorEmployeePk(userId: string): Promise<string | null> {
  const user: any = await User.findByPk(userId, { attributes: ['employeeId'] });
  return user?.employeeId ? String(user.employeeId).trim() : null;
}

export async function listProbationHrAssignees(): Promise<ProbationHrAssignee[]> {
  const users: any[] = await User.findAll({
    where: { role: { [Op.in]: ['HR', 'ADMIN'] }, isActive: true },
    attributes: ['id', 'display_name', 'email'],
    order: [['display_name', 'ASC']],
  });
  return users.map((u) => ({
    userId: String(u.id),
    name: String(u.display_name ?? u.email ?? 'HR'),
    email: String(u.email ?? ''),
  }));
}

export async function listProbationManagerAssignees(
  departmentId?: string | null
): Promise<ProbationManagerAssignee[]> {
  const deptFilter = String(departmentId ?? '').trim();
  const managerUsers: any[] = await User.findAll({
    where: { role: 'MANAGER', isActive: true },
    attributes: ['id', 'display_name', 'email', 'employeeId'],
    order: [['display_name', 'ASC']],
  });
  const employeePks = managerUsers
    .map((u) => String(u.employeeId ?? '').trim())
    .filter(Boolean);
  if (!employeePks.length) return [];

  const employees: any[] = await Employee.findAll({
    where: { id: { [Op.in]: employeePks }, status: 'active' },
    attributes: ['id', 'department_id', 'first_name', 'last_name'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });
  const empByPk = new Map(employees.map((e) => [String(e.id), reviewPlain(e)]));

  const items: ProbationManagerAssignee[] = [];
  for (const user of managerUsers) {
    const emp = empByPk.get(String(user.employeeId ?? '').trim());
    if (!emp) continue;
    const empDeptId = String(emp.department_id ?? '').trim();
    if (deptFilter && empDeptId !== deptFilter) continue;
    const dept = emp.department as { id?: string; name?: string } | undefined;
    const name =
      joinEmployeeNameParts(emp.first_name, emp.last_name) ||
      String(user.display_name ?? user.email ?? 'Manager');
    items.push({
      userId: String(user.id),
      name,
      email: String(user.email ?? ''),
      departmentId: empDeptId,
      departmentName: String(dept?.name ?? empDeptId ?? '—'),
    });
  }
  return items;
}

function actorIsAssignedManager(
  actor: ProbationReviewActor | undefined,
  assignedManagerUserId: string | null | undefined
): boolean {
  if (!actor || !assignedManagerUserId) return false;
  return String(actor.userId) === String(assignedManagerUserId);
}

function actorCanHrDecide(
  actor: ProbationReviewActor | undefined,
  assignedHrUserId: string | null | undefined
): boolean {
  if (!actor) return true;
  const role = String(actor.role ?? '').toUpperCase();
  if (role === 'ADMIN') return true;
  if (role !== 'HR') return false;
  if (!assignedHrUserId) return true;
  return String(assignedHrUserId) === String(actor.userId);
}

export async function listProbationReviewQueue(actor?: ProbationReviewActor): Promise<{
  items: ProbationReviewListItem[];
  summary: ProbationReviewSummary;
}> {
  const { ensureProbationReviewSchema } = await import('./probationReviewSchema.js');
  await ensureProbationReviewSchema();
  const today = formatDateOnly(new Date())!;
  const monthPrefix = today.slice(0, 7);

  const users: any[] = await User.findAll({
    where: { role: { [Op.in]: ['EMPLOYEE', 'MANAGER', 'HR'] }, isActive: true },
    attributes: ['id', 'display_name', 'email', 'phone', 'role', 'employeeId'],
  });

  const employeeIds = users
    .map((u) => String(u.employeeId ?? '').trim())
    .filter(Boolean);

  const employees: any[] = employeeIds.length
    ? await Employee.findAll({
        where: { id: { [Op.in]: employeeIds }, status: 'active' },
        attributes: [
          'id',
          'employee_id',
          'first_name',
          'last_name',
          'status',
          'join_date',
          'probation_period_months',
          'probation_confirmed_at',
          'probation_next_review_date',
          'worker_type',
          'department_id',
          'position_id',
          'phone',
          'email',
        ],
        include: [
          { model: Department, as: 'department', attributes: ['id', 'name'] },
          { model: Position, as: 'position', attributes: ['id', 'title'] },
        ],
      })
    : [];

  const empById = new Map(employees.map((e) => [String(e.id), reviewPlain(e)]));
  const { bulkLoadSalaryStructures } = await import('../salaryStructureService.js');
  const salaryByEmployeeId = await bulkLoadSalaryStructures(
    employees.map((e) => String(e.id))
  );
  const hrUsers: any[] = await User.findAll({
    where: { role: { [Op.in]: ['HR', 'ADMIN'] }, isActive: true },
    attributes: ['id', 'display_name', 'email', 'employeeId'],
  });
  const hrNameById = new Map<string, string>();
  for (const u of hrUsers) {
    const emp = empById.get(String(u.employeeId ?? '').trim());
    const name =
      (emp ? joinEmployeeNameParts(emp.first_name, emp.last_name) : '') ||
      String(u.display_name ?? u.email ?? 'HR');
    hrNameById.set(String(u.id), name);
  }
  const managerUsers: any[] = await User.findAll({
    where: { role: 'MANAGER', isActive: true },
    attributes: ['id', 'display_name', 'email', 'employeeId'],
  });
  const managerNameById = new Map<string, string>();
  for (const u of managerUsers) {
    const emp = empById.get(String(u.employeeId ?? '').trim());
    const name =
      (emp ? joinEmployeeNameParts(emp.first_name, emp.last_name) : '') ||
      String(u.display_name ?? u.email ?? 'Manager');
    managerNameById.set(String(u.id), name);
  }
  // Any portal user linked to an employee in this batch (covers evaluators who are not MANAGER role).
  for (const u of users) {
    const id = String(u.id);
    if (managerNameById.has(id) || hrNameById.has(id)) continue;
    const emp = empById.get(String(u.employeeId ?? '').trim());
    const name =
      (emp ? joinEmployeeNameParts(emp.first_name, emp.last_name) : '') ||
      String(u.display_name ?? u.email ?? '');
    if (name) managerNameById.set(id, name);
  }
  const userIds = users.map((u) => String(u.id));

  const reviews: any[] = userIds.length
    ? await EmployeeReview.findAll({
        where: { reviewType: 'PROBATION', userId: { [Op.in]: userIds } },
        order: [['reviewedAt', 'DESC'], ['createdAt', 'DESC']],
      })
    : [];

  const reviewIds = reviews.map((r) => String(reviewPlain(r).id ?? '')).filter(Boolean);
  const { loadProbationApproversBatch, serializeProbationApproversForDto, probationRequiresActorApproval } =
    await import('../workflowProbationApproverService.js');
  const approverMap = reviewIds.length
    ? await loadProbationApproversBatch(reviewIds)
    : new Map();
  const evaluatorMap = reviewIds.length
    ? await loadProbationEvaluatorDtoFieldsBatch(reviewIds)
    : new Map();

  const latestByUser = new Map<string, any>();
  const historyCount = new Map<string, number>();
  for (const row of reviews) {
    const plain = reviewPlain(row);
    const uid = String(plain.userId);
    historyCount.set(uid, (historyCount.get(uid) ?? 0) + 1);
    if (!latestByUser.has(uid)) latestByUser.set(uid, plain);
  }

  const items: ProbationReviewListItem[] = [];
  const summary: ProbationReviewSummary = {
    totalOnProbation: 0,
    reviewsDueThisMonth: 0,
    passed: 0,
    extended: 0,
    failed: 0,
  };

  for (const user of users) {
    const uid = String(user.id);
    const emp = user.employeeId ? empById.get(String(user.employeeId)) : null;
    if (!emp || !isEmployeeInProbationReviewScope(emp)) continue;

    const join = formatDateOnly(emp.join_date) ?? today;
    const workerType = normalizeWorkerType(emp.worker_type);
    const months = resolveProbationPeriodMonths(emp.probation_period_months, workerType, true);
    const probationEnd = computedProbationEndDate(join, months) ?? join;
    const latest = latestByUser.get(uid);
    const lastStatus = latest?.status as string | undefined;
    const assignedManagerUserId = latest?.assignedManagerUserId
      ? String(latest.assignedManagerUserId)
      : null;
    const managerSubmittedAt = latest?.managerSubmittedAt
      ? String(latest.managerSubmittedAt)
      : null;
    const ratings = parseEvaluationRatingsJson(latest?.evaluationRatingsJson);
    const managerEval = parseManagerEvaluationSnapshot(latest ?? null);
    const employeeEval = parseEmployeeEvaluationSnapshot(latest ?? null);
    const employeeSubmittedAt =
      (latest?.employeeSubmittedAt ? String(latest.employeeSubmittedAt) : null) ||
      employeeEval?.submittedAt ||
      (employeeEval?.ratings ? new Date().toISOString() : null);
    // Repair rows saved before Sequelize tracked employeeSubmitted* columns.
    if (
      latest?.id &&
      employeeEval?.ratings &&
      !latest.employeeSubmittedAt
    ) {
      try {
        const repairedAt = employeeEval.submittedAt
          ? new Date(employeeEval.submittedAt)
          : new Date();
        await EmployeeReview.update(
          {
            employeeSubmittedAt: repairedAt,
            employeeSubmittedBy: employeeEval.submittedBy ?? null,
          },
          { where: { id: String(latest.id) } }
        );
        latest.employeeSubmittedAt = repairedAt;
        latest.employeeSubmittedBy = employeeEval.submittedBy;
      } catch {
        /* non-fatal — list still returns payload ratings */
      }
    }

    const hasOpenDraft =
      lastStatus === 'IN_REVIEW' &&
      latest?.recommendation == null &&
      latest?.reviewedAt == null &&
      managerSubmittedAt == null &&
      !assignedManagerUserId;

    const { status, daysRemaining, overdue } = deriveProbationReviewStatus({
      today,
      probationEnd,
      nextReviewDate: emp.probation_next_review_date ?? latest?.nextReviewDate,
      probationConfirmedAt: emp.probation_confirmed_at,
      lastReviewStatus: lastStatus,
      hasOpenDraft,
    });

    const outcomePayload = parseProbationOutcomePayload(
      latest?.outcomePayloadJson ? String(latest.outcomePayloadJson) : null
    );
    const evaluatorRatingsByUserId = parseEvaluatorRatingsMap(outcomePayload.evaluatorRatings);
    const managementEvaluationsByUserId = parseManagementEvaluationsMap(
      outcomePayload.managementEvaluations
    );
    const hrPendingAfterManager =
      (status === 'PENDING_HR' || status === 'PENDING_EMPLOYEE') &&
      Boolean(managerSubmittedAt) &&
      !latest?.reviewedAt;
    const recommendation = mapRecommendation(latest?.recommendation);

    const assignedHrUserId = latest?.assignedHrUserId
      ? String(latest.assignedHrUserId)
      : null;
    const routedByHrUserId = latest?.routedByHrUserId
      ? String(latest.routedByHrUserId)
      : null;
    const role = String(actor?.role ?? '').toUpperCase();
    const isHrRole = role === 'HR' || role === 'ADMIN';
    const canHrDecide =
      status === 'PENDING_HR' &&
      Boolean(managerSubmittedAt) &&
      Boolean(employeeSubmittedAt) &&
      actorCanHrDecide(actor, assignedHrUserId ?? routedByHrUserId);
    const reviewIdStr = latest?.id ? String(latest.id) : null;
    const approverFields = reviewIdStr
      ? serializeProbationApproversForDto(approverMap.get(reviewIdStr) ?? [])
      : {
          assignedApproverUserIds: [] as string[],
          assignedApprovers: [],
          currentApproverUserId: null,
          currentApproverName: null,
          approvalProgress: null,
        };
    const evaluatorFields = reviewIdStr
      ? evaluatorMap.get(reviewIdStr) ?? {
          assignedEvaluatorUserIds: [],
          assignedEvaluators: [],
          currentEvaluatorUserId: null,
          currentEvaluatorName: null,
          evaluationProgress: null,
        }
      : {
          assignedEvaluatorUserIds: [],
          assignedEvaluators: [],
          currentEvaluatorUserId: null,
          currentEvaluatorName: null,
          evaluationProgress: null,
        };
    const effectiveManagerUserId =
      evaluatorFields.currentEvaluatorUserId ?? assignedManagerUserId;
    // The current evaluator (whoever HR placed at this position in the chain) may
    // edit, regardless of their base role.
    const canManagerEdit =
      status === 'PENDING_MANAGER' &&
      Boolean(routedByHrUserId) &&
      actorIsAssignedManager(actor, effectiveManagerUserId) &&
      String(uid) !== String(actor?.userId ?? '');
    const canEmployeeSelfEvaluate =
      status === 'PENDING_EMPLOYEE' &&
      Boolean(managerSubmittedAt) &&
      !employeeSubmittedAt &&
      String(actor?.userId ?? '') === uid;
    const legacyHrDirectEvaluate =
      isHrRole &&
      !assignedManagerUserId &&
      !managerSubmittedAt &&
      (status === 'IN_REVIEW' || status === 'REVIEW_DUE');
    const canEvaluate =
      isHrRole &&
      status !== 'PASSED' &&
      status !== 'FAILED' &&
      status !== 'PENDING_MANAGER' &&
      status !== 'PENDING_EMPLOYEE' &&
      status !== 'PENDING_FINAL_APPROVAL' &&
      ((status === 'PENDING_HR' && canHrDecide) || legacyHrDirectEvaluate);
    const canApproverReview =
      status === 'PENDING_FINAL_APPROVAL' &&
      Boolean(actor?.userId) &&
      probationRequiresActorApproval(approverMap.get(reviewIdStr ?? '') ?? [], String(actor?.userId));
    const canRouteToManager =
      isHrRole &&
      !managerSubmittedAt &&
      status !== 'PENDING_HR' &&
      status !== 'PENDING_EMPLOYEE' &&
      status !== 'PENDING_MANAGER' &&
      status !== 'PENDING_FINAL_APPROVAL' &&
      status !== 'PASSED' &&
      status !== 'FAILED' &&
      (status === 'REVIEW_DUE' || status === 'UPCOMING' || status === 'IN_REVIEW' || status === 'EXTENDED');

    if (role === 'HR' && status === 'PENDING_HR' && !canHrDecide) continue;
    if (role === 'EMPLOYEE' && !canEmployeeSelfEvaluate) continue;
    // Manager: assignment inbox only (not department-wide probation admin).
    // Includes current + prior evaluators and final approvers (read after submit).
    if (role === 'MANAGER') {
      if (
        !managerCanSeeAssignedProbation({
          actorUserId: String(actor?.userId ?? ''),
          assignedManagerUserId: effectiveManagerUserId ?? assignedManagerUserId,
          assignedEvaluatorUserIds: evaluatorFields.assignedEvaluatorUserIds,
          managerSubmittedBy: latest?.managerSubmittedBy
            ? String(latest.managerSubmittedBy)
            : null,
          canManagerEdit,
          canApproverReview,
        })
      ) {
        continue;
      }
    } else if (
      status === 'PENDING_MANAGER' &&
      !canManagerEdit &&
      role !== 'HR' &&
      role !== 'ADMIN'
    ) {
      continue;
    }

    summary.totalOnProbation += 1;
    const effectiveEnd = emp.probation_next_review_date ?? probationEnd;
    if (String(effectiveEnd).slice(0, 7) === monthPrefix) {
      summary.reviewsDueThisMonth += 1;
    }

    const isRoutedEvaluatorChain =
      Boolean(routedByHrUserId) &&
      status === 'PENDING_MANAGER' &&
      evaluatorFields.assignedEvaluatorUserIds.length > 0;

    items.push({
      userId: uid,
      employeeId: String(emp.employee_id ?? ''),
      name:
        joinEmployeeNameParts(emp.first_name, emp.last_name) ||
        String(user.display_name ?? user.email ?? ''),
      email: String(emp.email ?? user.email ?? ''),
      phone: String(emp.phone ?? user.phone ?? '').trim() || undefined,
      role: String(user.role ?? 'EMPLOYEE'),
      departmentId: emp.department_id ? String(emp.department_id) : undefined,
      departmentName: (emp.department as { name?: string } | undefined)?.name ?? undefined,
      positionId: emp.position_id ? String(emp.position_id) : undefined,
      position:
        String((emp.position as { title?: string } | undefined)?.title ?? '').trim() ||
        String(emp.position_id ?? ''),
      baseSalary: (() => {
        const structure = salaryByEmployeeId.get(String(emp.id));
        const amount = Number(structure?.base_salary ?? 0);
        return Number.isFinite(amount) ? amount : 0;
      })(),
      currency: (() => {
        const structure = salaryByEmployeeId.get(String(emp.id));
        return String(structure?.currency ?? 'USD').trim() || 'USD';
      })(),
      joinDate: join,
      probationEnd,
      probationMonths: months,
      workerType,
      daysRemaining,
      overdue,
      status,
      recommendation,
      overallRecommendation: latest?.overallRecommendation
        ? String(latest.overallRecommendation)
        : null,
      reviewId: latest?.id ? String(latest.id) : null,
      nextReviewDate: formatDateOnly(
        emp.probation_next_review_date ?? latest?.nextReviewDate
      ),
      inProbation: isInProbation(emp, today),
      probationConfirmedAt: formatDateOnly(emp.probation_confirmed_at),
      ratings: isRoutedEvaluatorChain || hrPendingAfterManager ? null : ratings,
      strengths: isRoutedEvaluatorChain || hrPendingAfterManager ? '' : String(latest?.strengths ?? ''),
      areasForImprovement: isRoutedEvaluatorChain || hrPendingAfterManager
        ? ''
        : String(latest?.areasForImprovement ?? ''),
      hrNotes: String(latest?.hrNotes ?? ''),
      reviewedAt: latest?.reviewedAt ? String(latest.reviewedAt) : null,
      reviewedBy: latest?.reviewedBy ? String(latest.reviewedBy) : null,
      assignedHrUserId,
      assignedHrName: assignedHrUserId ? hrNameById.get(assignedHrUserId) ?? null : null,
      assignedManagerUserId: effectiveManagerUserId ?? assignedManagerUserId,
      assignedManagerName: (effectiveManagerUserId ?? assignedManagerUserId)
        ? managerNameById.get(String(effectiveManagerUserId ?? assignedManagerUserId)) ?? null
        : null,
      routedByHrUserId,
      managerSubmittedBy: latest?.managerSubmittedBy
        ? String(latest.managerSubmittedBy)
        : null,
      managerSubmittedAt,
      managerRatings: managerEval?.ratings ?? null,
      managerStrengths: managerEval?.strengths ?? '',
      managerAreasForImprovement: managerEval?.areasForImprovement ?? '',
      managerOverallRecommendation: managerEval?.overallRecommendation ?? null,
      employeeSubmittedAt,
      employeeSubmittedBy:
        (latest?.employeeSubmittedBy ? String(latest.employeeSubmittedBy) : null) ||
        employeeEval?.submittedBy ||
        null,
      employeeRatings: employeeEval?.ratings ?? null,
      employeeStrengths: employeeEval?.strengths ?? '',
      employeeAreasForImprovement: employeeEval?.areasForImprovement ?? '',
      canManagerEdit,
      canEmployeeSelfEvaluate,
      canHrDecide,
      canEvaluate,
      canRouteToManager,
      assignedEvaluatorUserIds: evaluatorFields.assignedEvaluatorUserIds,
      assignedEvaluators: evaluatorFields.assignedEvaluators,
      currentEvaluatorUserId: evaluatorFields.currentEvaluatorUserId,
      currentEvaluatorName: evaluatorFields.currentEvaluatorName,
      evaluationProgress: evaluatorFields.evaluationProgress,
      evaluatorRatingsByUserId,
      managementEvaluationsByUserId,
      assignedApproverUserIds: approverFields.assignedApproverUserIds,
      assignedApprovers: approverFields.assignedApprovers,
      currentApproverUserId: approverFields.currentApproverUserId,
      currentApproverName: approverFields.currentApproverName,
      approvalProgress: approverFields.approvalProgress,
      canApproverReview,
    });
  }

  items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.status === 'REVIEW_DUE' && b.status !== 'REVIEW_DUE') return -1;
    if (b.status === 'REVIEW_DUE' && a.status !== 'REVIEW_DUE') return 1;
    return a.daysRemaining - b.daysRemaining;
  });

  // Outcome cards are lifetime totals (latest decision per employee), not "this month".
  // Passed employees leave the active queue after confirmation, so count from reviews.
  // Managers only see outcomes they participated in — never company-wide HR totals.
  const actorRole = String(actor?.role ?? '').toUpperCase();
  const isManagerActor = actorRole === 'MANAGER';
  const actorUserId = String(actor?.userId ?? '').trim();
  const outcomeDecisions: any[] = await EmployeeReview.findAll({
    where: {
      reviewType: 'PROBATION',
      status: { [Op.in]: ['PASSED', 'EXTENDED', 'FAILED'] },
    },
    attributes: [
      'status',
      'userId',
      'reviewedAt',
      'createdAt',
      'assignedManagerUserId',
      'managerSubmittedBy',
      'outcomePayloadJson',
    ],
    order: [['reviewedAt', 'DESC'], ['createdAt', 'DESC']],
  });
  const countedOutcomeUsers = new Set<string>();
  for (const row of outcomeDecisions) {
    const plain = reviewPlain(row);
    const uid = String(plain.userId ?? '');
    if (!uid || countedOutcomeUsers.has(uid)) continue;
    if (
      isManagerActor &&
      !managerParticipatedInProbationOutcome({
        actorUserId,
        assignedManagerUserId: plain.assignedManagerUserId
          ? String(plain.assignedManagerUserId)
          : null,
        managerSubmittedBy: plain.managerSubmittedBy
          ? String(plain.managerSubmittedBy)
          : null,
        outcomePayloadJson: plain.outcomePayloadJson
          ? String(plain.outcomePayloadJson)
          : null,
      })
    ) {
      continue;
    }
    countedOutcomeUsers.add(uid);
    const status = String(plain.status ?? '').toUpperCase();
    if (status === 'PASSED') summary.passed += 1;
    else if (status === 'EXTENDED') summary.extended += 1;
    else if (status === 'FAILED') summary.failed += 1;
  }

  return { items, summary };
}

export async function listProbationReviewHistory(userId: string) {
  const rows = await EmployeeReview.findAll({
    where: { userId, reviewType: 'PROBATION' },
    order: [['reviewedAt', 'DESC'], ['createdAt', 'DESC']],
  });
  return rows.map((row) => {
    const plain = reviewPlain(row);
    return {
      id: String(plain.id),
      reviewDate: plain.reviewedAt ? String(plain.reviewedAt) : String(plain.createdAt ?? ''),
      reviewer: plain.reviewedBy ? String(plain.reviewedBy) : null,
      status: String(plain.status ?? ''),
      recommendation: mapRecommendation(plain.recommendation),
      overallRecommendation: plain.overallRecommendation
        ? String(plain.overallRecommendation)
        : null,
      ratings: parseEvaluationRatingsJson(plain.evaluationRatingsJson),
      strengths: String(plain.strengths ?? ''),
      areasForImprovement: String(plain.areasForImprovement ?? ''),
      hrNotes: String(plain.hrNotes ?? ''),
      extensionDays: plain.extensionDays != null ? Number(plain.extensionDays) : null,
      extensionReason: plain.extensionReason ? String(plain.extensionReason) : null,
      nextReviewDate: formatDateOnly(plain.nextReviewDate as string),
      notes: String(plain.notes ?? ''),
    };
  });
}

function validateExtension(input: SubmitProbationReviewInput): void {
  const days = Number(input.extensionDays);
  if (!PROBATION_EXTENSION_DAYS.includes(days as (typeof PROBATION_EXTENSION_DAYS)[number])) {
    throw new Error('Extension duration must be 15, 30, 60, or 90 days.');
  }
  if (!String(input.extensionReason ?? '').trim()) {
    throw new Error('Extension reason is required.');
  }
}

function normalizeAction(action: string): SubmitProbationReviewInput['action'] {
  const a = String(action ?? '').toUpperCase();
  if (a === 'HR_DECIDE') return 'HR_DECIDE';
  if (a === 'SUBMIT_FOR_APPROVAL') return 'SUBMIT_FOR_APPROVAL';
  if (a === 'ROUTE_TO_MANAGER') return 'ROUTE_TO_MANAGER';
  if (a === 'SUBMIT_TO_HR') return 'SUBMIT_TO_HR';
  if (a === 'SUBMIT_SELF_EVALUATION') return 'SUBMIT_SELF_EVALUATION';
  if (a === 'SAVE_DRAFT') return 'SAVE_DRAFT';
  return 'SUBMIT';
}

function parseMovementOutcome(raw: Record<string, unknown> | undefined): ProbationMovementOutcome {
  return {
    movementType: (raw?.movementType as ProbationMovementOutcome['movementType']) ?? 'promotion',
    effectiveDate: String(raw?.effectiveDate ?? '').slice(0, 10),
    toDepartmentId: raw?.toDepartmentId ? String(raw.toDepartmentId) : undefined,
    toPositionId: raw?.toPositionId ? String(raw.toPositionId) : undefined,
    toBaseSalary:
      raw?.toBaseSalary != null && raw.toBaseSalary !== ''
        ? Number(raw.toBaseSalary)
        : undefined,
    toCurrency: raw?.toCurrency ? String(raw.toCurrency) : undefined,
    notes: raw?.notes ? String(raw.notes) : undefined,
  };
}

function parseOffboardOutcome(raw: Record<string, unknown> | undefined): ProbationOffboardOutcome {
  return {
    reason: String(raw?.reason ?? '').trim(),
    lastWorkingDate: raw?.lastWorkingDate
      ? String(raw.lastWorkingDate).slice(0, 10)
      : undefined,
  };
}

export async function submitProbationReview(
  input: SubmitProbationReviewInput
): Promise<{ message: string; reviewId: string; status: ProbationReviewStatus }> {
  const resolved = await resolveEmployeeFromReviewUserId(input.userId);
  if (!resolved) throw new Error('Employee record not found for this user.');

  const { employee } = resolved;
  const plain = employee.get({ plain: true }) as ProbationEmployeeSnapshot & {
    id: string;
    employee_id: string;
    department_id: string;
    position_id: string;
    probation_next_review_date?: string | null;
  };

  if (!isEmployeeInProbationReviewScope(plain)) {
    throw new Error('Employee is not in probation review scope.');
  }

  const actor: ProbationReviewActor = {
    userId: String(input.actorUserId ?? input.reviewedBy ?? ''),
    role: String(input.actorRole ?? 'HR').toUpperCase(),
    employeePk: input.actorUserId
      ? await resolveActorEmployeePk(String(input.actorUserId))
      : null,
  };

  const action = normalizeAction(input.action);
  const today = formatDateOnly(new Date())!;
  const workerType = normalizeWorkerType(plain.worker_type);
  const months = resolveProbationPeriodMonths(plain.probation_period_months, workerType, true);
  const periodEnd =
    input.periodEnd ?? computedProbationEndDate(plain.join_date, months) ?? today;

  const ratings = normalizeEvaluationRatings(input.ratings ?? undefined);
  const auto = deriveOverallRecommendation(ratings);

  const reviewId =
    input.reviewId?.trim() ||
    `prob-${employee.id}-${today}-${Date.now()}`;

  const basePayload: Record<string, unknown> = {
    id: reviewId,
    userId: input.userId,
    employeeRowId: String(employee.id),
    reviewType: 'PROBATION',
    periodEnd,
    periodMonth: periodEnd.slice(0, 7),
    evaluationRatingsJson: ratings ? JSON.stringify(ratings) : null,
    strengths: input.strengths?.trim() || null,
    areasForImprovement: input.areasForImprovement?.trim() || null,
    overallRecommendation: auto.label,
    score: ratingsToScore(ratings),
    notes: [input.strengths, input.areasForImprovement].filter(Boolean).join('\n\n') || null,
  };

  if (action === 'SAVE_DRAFT') {
    const existing: any = input.reviewId
      ? await EmployeeReview.findByPk(input.reviewId)
      : null;
    const reviewIdForDraft = String(existing?.id ?? reviewId);
    const assignedManagerUserId = existing?.assignedManagerUserId
      ? String(existing.assignedManagerUserId)
      : null;
    const isAssignedFlow = Boolean(existing?.routedByHrUserId) || Boolean(assignedManagerUserId);
    if (isAssignedFlow) {
      if (!(await isCurrentProbationEvaluator(reviewIdForDraft, String(actor.userId)))) {
        throw new Error('You are not assigned to evaluate this probation review.');
      }
    } else if (String(actor.role ?? '').toUpperCase() === 'MANAGER') {
      throw new Error('You can only evaluate probation reviews assigned to you by HR.');
    } else if (String(actor.role ?? '').toUpperCase() !== 'HR' && String(actor.role ?? '').toUpperCase() !== 'ADMIN') {
      throw new Error('Only HR can start probation evaluations that are not routed to a manager.');
    }
    const draftStatus =
      existing?.status === 'PENDING_MANAGER' ? 'PENDING_MANAGER' : 'IN_REVIEW';
    let outcomePayloadJson = existing?.outcomePayloadJson
      ? String(existing.outcomePayloadJson)
      : null;
    if (isAssignedFlow && ratings) {
      let priorOutcome = parseProbationOutcomePayload(outcomePayloadJson);
      priorOutcome = recordProbationEvaluatorSnapshot(
        priorOutcome,
        String(actor.userId),
        ratings,
        {
          strengths: input.strengths?.trim() || null,
          areasForImprovement: input.areasForImprovement?.trim() || null,
          overallRecommendation: auto.label,
        }
      );
      outcomePayloadJson = JSON.stringify(priorOutcome);
    }
    await EmployeeReview.upsert({
      ...(isAssignedFlow ? CLEAR_MAIN_EVALUATION_FIELDS : basePayload),
      id: reviewIdForDraft,
      userId: input.userId,
      employeeRowId: String(employee.id),
      reviewType: 'PROBATION',
      periodEnd,
      periodMonth: periodEnd.slice(0, 7),
      status: draftStatus,
      recommendation: null,
      reviewedAt: null,
      reviewedBy: null,
      assignedHrUserId: existing?.assignedHrUserId ?? input.assignedHrUserId ?? null,
      assignedManagerUserId: assignedManagerUserId ?? input.assignedManagerUserId ?? null,
      routedByHrUserId: existing?.routedByHrUserId ?? null,
      routedAt: existing?.routedAt ?? null,
      managerSubmittedBy: null,
      managerSubmittedAt: null,
      hrNotes: null,
      outcomePayloadJson,
    });
    return {
      message: 'Draft saved — continue when ready to submit.',
      reviewId,
      status: draftStatus as ProbationReviewStatus,
    };
  }

  if (action === 'ROUTE_TO_MANAGER') {
    if (actor.role !== 'HR' && actor.role !== 'ADMIN') {
      throw new Error('Only HR can route probation reviews to managers.');
    }
    const { PROBATION_EVALUATOR_CONFIG, replaceChainApprovers, resolveAssignedChainApprovers } =
      await import('../workflowChainApproverService.js');
    const evaluatorIds = await resolveAssignedChainApprovers({
      assignedApproverUserIds: input.assignedEvaluatorUserIds,
      assignedApproverUserId: input.assignedManagerUserId,
    });
    if (!evaluatorIds.length) {
      throw new Error('Select at least one evaluator before routing.');
    }
    const employeeUserId = String(input.userId ?? '').trim();
    if (employeeUserId && evaluatorIds.includes(employeeUserId)) {
      throw new Error('An employee cannot be assigned to evaluate their own probation review.');
    }
    const assignedManagerUserId = evaluatorIds[0];
    await EmployeeReview.upsert({
      ...basePayload,
      status: 'PENDING_MANAGER',
      recommendation: null,
      overallRecommendation: null,
      evaluationRatingsJson: null,
      strengths: null,
      areasForImprovement: null,
      score: null,
      reviewedAt: null,
      reviewedBy: null,
      assignedManagerUserId,
      routedByHrUserId: actor.userId,
      routedAt: new Date(),
      assignedHrUserId: actor.userId,
      managerSubmittedBy: null,
      managerSubmittedAt: null,
      employeeSubmittedBy: null,
      employeeSubmittedAt: null,
      hrNotes: null,
      outcomePayloadJson: null,
    });
    await replaceChainApprovers(PROBATION_EVALUATOR_CONFIG, reviewId, evaluatorIds);
    try {
      const { notifyProbationRoutedToManager } = await import('../workflowProbationApproverService.js');
      const empName =
        joinEmployeeNameParts(plain.first_name, plain.last_name) ||
        'Employee';
      await notifyProbationRoutedToManager({
        reviewId,
        employeeName: empName,
        managerUserId: assignedManagerUserId,
        employeeUserId: String(input.userId ?? '').trim() || undefined,
      });
    } catch {
      /* non-fatal */
    }
    return {
      message:
        evaluatorIds.length > 1
          ? `Review routed to ${evaluatorIds.length} evaluators — awaiting first evaluation.`
          : 'Review routed to manager — awaiting manager evaluation.',
      reviewId,
      status: 'PENDING_MANAGER',
    };
  }

  if (action === 'SUBMIT_TO_HR') {
    const existing: any = input.reviewId
      ? await EmployeeReview.findByPk(input.reviewId)
      : await EmployeeReview.findOne({
          where: {
            userId: input.userId,
            reviewType: 'PROBATION',
            status: { [Op.in]: ['PENDING_MANAGER', 'IN_REVIEW'] },
          },
          order: [['updatedAt', 'DESC']],
        });
    const reviewIdForChain = String(existing?.id ?? reviewId);
    const {
      PROBATION_EVALUATOR_CONFIG,
      loadChainApprovers,
      markChainApproverApproved,
      getCurrentPendingChainApprover,
    } = await import('../workflowChainApproverService.js');
    const evaluatorChain = await loadChainApprovers(PROBATION_EVALUATOR_CONFIG, reviewIdForChain);
    const assignedManagerUserId = existing?.assignedManagerUserId
      ? String(existing.assignedManagerUserId)
      : null;
    const isAssignedFlow = Boolean(assignedManagerUserId) || evaluatorChain.length > 0;
    const currentEvaluator = evaluatorChain.length
      ? getCurrentPendingChainApprover(evaluatorChain)
      : null;
    const effectiveEvaluatorId = currentEvaluator?.userId ?? assignedManagerUserId;

    if (isAssignedFlow) {
      if (!(await isCurrentProbationEvaluator(reviewIdForChain, String(actor.userId)))) {
        throw new Error('You are not assigned to evaluate this probation review.');
      }
    } else if (String(actor.role ?? '').toUpperCase() === 'MANAGER') {
      throw new Error('You can only submit probation reviews assigned to you by HR.');
    } else if (String(actor.role ?? '').toUpperCase() !== 'HR' && String(actor.role ?? '').toUpperCase() !== 'ADMIN') {
      throw new Error('Only HR can submit probation reviews that are not routed to a manager.');
    }
    if (!ratings) {
      throw new Error('Complete all evaluation ratings before submitting to HR.');
    }
    const assignedHrUserId = isAssignedFlow
      ? String(existing?.routedByHrUserId ?? existing?.assignedHrUserId ?? '').trim()
      : String(input.assignedHrUserId ?? '').trim();
    if (!assignedHrUserId) {
      throw new Error(
        isAssignedFlow
          ? 'Routing HR officer not found for this review.'
          : 'Select an HR officer to receive this review.'
      );
    }
    const hrUser: any = await User.findByPk(assignedHrUserId);
    if (!hrUser || !['HR', 'ADMIN'].includes(String(hrUser.role ?? '').toUpperCase())) {
      throw new Error('Selected HR assignee is invalid.');
    }

    let priorOutcome = parseProbationOutcomePayload(
      existing?.outcomePayloadJson ? String(existing.outcomePayloadJson) : null
    );
    priorOutcome = recordProbationEvaluatorSnapshot(priorOutcome, String(actor.userId), ratings, {
      strengths: input.strengths?.trim() || null,
      areasForImprovement: input.areasForImprovement?.trim() || null,
      overallRecommendation: auto.label,
    });

    if (evaluatorChain.length) {
      await markChainApproverApproved(
        PROBATION_EVALUATOR_CONFIG,
        reviewIdForChain,
        String(actor.userId)
      );
      const refreshedChain = await loadChainApprovers(PROBATION_EVALUATOR_CONFIG, reviewIdForChain);
      const nextEvaluator = getCurrentPendingChainApprover(refreshedChain);
      if (nextEvaluator) {
        await EmployeeReview.upsert({
          ...basePayload,
          ...CLEAR_MAIN_EVALUATION_FIELDS,
          id: reviewIdForChain,
          status: 'PENDING_MANAGER',
          recommendation: null,
          reviewedAt: null,
          reviewedBy: null,
          assignedHrUserId,
          assignedManagerUserId: nextEvaluator.userId,
          routedByHrUserId: existing?.routedByHrUserId ?? null,
          routedAt: existing?.routedAt ?? null,
          managerSubmittedBy: null,
          managerSubmittedAt: null,
          employeeSubmittedBy: null,
          employeeSubmittedAt: null,
          hrNotes: null,
          outcomePayloadJson: JSON.stringify(priorOutcome),
        });
        const step = refreshedChain.filter((row) => row.status === 'approved').length + 1;
        await notifyProbationEvaluatorTurn(
          reviewIdForChain,
          nextEvaluator.userId,
          refreshedChain.length > 1 ? `(Evaluator ${step} of ${refreshedChain.length})` : undefined
        );
        return {
          message: 'Evaluation submitted — sent to the next evaluator.',
          reviewId: reviewIdForChain,
          status: 'PENDING_MANAGER',
        };
      }

      const submittedEvaluatorIds = refreshedChain
        .filter((row) => row.status === 'approved')
        .map((row) => row.userId);
      const aggregate =
        buildAggregateManagerEvaluation(priorOutcome, submittedEvaluatorIds) ??
        ({
          ratings,
          strengths: input.strengths?.trim() || null,
          areasForImprovement: input.areasForImprovement?.trim() || null,
          overallRecommendation: auto.label,
        } as const);
      const managerEvaluation = {
        ratings: aggregate.ratings,
        strengths: aggregate.strengths,
        areasForImprovement: aggregate.areasForImprovement,
        overallRecommendation: aggregate.overallRecommendation ?? auto.label,
      };
      await EmployeeReview.upsert({
        ...basePayload,
        ...CLEAR_MAIN_EVALUATION_FIELDS,
        id: reviewIdForChain,
        status: 'PENDING_EMPLOYEE',
        recommendation: deriveOverallRecommendation(aggregate.ratings).recommendation,
        reviewedAt: null,
        reviewedBy: null,
        assignedHrUserId,
        assignedManagerUserId,
        routedByHrUserId: existing?.routedByHrUserId ?? null,
        routedAt: existing?.routedAt ?? null,
        managerSubmittedBy: input.reviewedBy ?? actor.userId,
        managerSubmittedAt: new Date(),
        employeeSubmittedBy: null,
        employeeSubmittedAt: null,
        hrNotes: null,
        outcomePayloadJson: JSON.stringify({ ...priorOutcome, managerEvaluation }),
      });
      try {
        const { notifyProbationEmployeeSelfEval } = await import('../workflowProbationApproverService.js');
        const empName =
          joinEmployeeNameParts(plain.first_name, plain.last_name) ||
          'Employee';
        await notifyProbationEmployeeSelfEval({
          reviewId: reviewIdForChain,
          employeeUserId: input.userId,
          employeeName: empName,
        });
      } catch {
        /* non-fatal */
      }
      return {
        message: 'Manager evaluation submitted — awaiting employee self-evaluation.',
        reviewId: reviewIdForChain,
        status: 'PENDING_EMPLOYEE',
      };
    }

    const managerEvaluation = {
      ratings,
      strengths: input.strengths?.trim() || null,
      areasForImprovement: input.areasForImprovement?.trim() || null,
      overallRecommendation: auto.label,
    };
    await EmployeeReview.upsert({
      ...basePayload,
      id: reviewIdForChain,
      status: 'PENDING_EMPLOYEE',
      recommendation: auto.recommendation,
      reviewedAt: null,
      reviewedBy: null,
      assignedHrUserId,
      assignedManagerUserId: isAssignedFlow ? assignedManagerUserId : null,
      routedByHrUserId: existing?.routedByHrUserId ?? null,
      routedAt: existing?.routedAt ?? null,
      managerSubmittedBy: input.reviewedBy ?? actor.userId,
      managerSubmittedAt: new Date(),
      employeeSubmittedBy: null,
      employeeSubmittedAt: null,
      hrNotes: null,
      outcomePayloadJson: JSON.stringify({ ...priorOutcome, managerEvaluation }),
    });
    try {
      const { notifyProbationEmployeeSelfEval } = await import('../workflowProbationApproverService.js');
      const empName =
        joinEmployeeNameParts(plain.first_name, plain.last_name) ||
        'Employee';
      await notifyProbationEmployeeSelfEval({
        reviewId: reviewIdForChain,
        employeeUserId: input.userId,
        employeeName: empName,
      });
    } catch {
      /* non-fatal */
    }
    return {
      message: 'Manager evaluation submitted — awaiting employee self-evaluation.',
      reviewId: reviewIdForChain,
      status: 'PENDING_EMPLOYEE',
    };
  }

  if (action === 'SUBMIT_SELF_EVALUATION') {
    const existing: any = input.reviewId
      ? await EmployeeReview.findByPk(input.reviewId)
      : await EmployeeReview.findOne({
          where: {
            userId: input.userId,
            reviewType: 'PROBATION',
            status: 'PENDING_EMPLOYEE',
          },
          order: [['updatedAt', 'DESC']],
        });
    if (!existing) {
      throw new Error('No probation review awaiting employee self-evaluation.');
    }
    if (String(existing.userId) !== String(actor.userId)) {
      throw new Error('Only the employee can submit their self-evaluation.');
    }
    if (!existing.managerSubmittedAt) {
      throw new Error('Manager evaluation must be completed before employee self-evaluation.');
    }
    if (existing.employeeSubmittedAt) {
      throw new Error('Employee self-evaluation was already submitted.');
    }
    let priorOutcome: Record<string, unknown> = parseJsonObject(existing.outcomePayloadJson) ?? {};
    if (priorOutcome.employeeEvaluation) {
      throw new Error('Employee self-evaluation was already submitted.');
    }
    if (!ratings) {
      throw new Error('Complete all evaluation ratings before submitting your self-evaluation.');
    }
    const employeeEvaluation = {
      ratings,
      strengths: input.strengths?.trim() || null,
      areasForImprovement: input.areasForImprovement?.trim() || null,
      submittedBy: actor.userId,
      submittedAt: new Date().toISOString(),
    };
    await EmployeeReview.upsert({
      ...basePayload,
      id: String(existing.id),
      status: 'PENDING_HR',
      recommendation: existing.recommendation,
      reviewedAt: null,
      reviewedBy: null,
      assignedHrUserId: existing.assignedHrUserId,
      assignedManagerUserId: existing.assignedManagerUserId,
      routedByHrUserId: existing.routedByHrUserId,
      routedAt: existing.routedAt,
      managerSubmittedBy: existing.managerSubmittedBy,
      managerSubmittedAt: existing.managerSubmittedAt,
      employeeSubmittedBy: actor.userId,
      employeeSubmittedAt: new Date(),
      hrNotes: null,
      outcomePayloadJson: JSON.stringify({ ...priorOutcome, employeeEvaluation }),
    });
    try {
      const { notifyProbationPendingHr } = await import('../workflowProbationApproverService.js');
      const hrUserId = String(existing.assignedHrUserId ?? existing.routedByHrUserId ?? '').trim();
      if (hrUserId) {
        const resolved = await resolveEmployeeFromReviewUserId(input.userId);
        const empName = resolved
          ? joinEmployeeNameParts(
              resolved.employee.get('first_name') as string | undefined,
              resolved.employee.get('last_name') as string | undefined
            )
          : 'Employee';
        await notifyProbationPendingHr({
          reviewId: String(existing.id),
          hrUserId,
          employeeName: empName || 'Employee',
        });
      }
    } catch {
      /* non-fatal */
    }
    return {
      message: 'Self-evaluation submitted — awaiting HR decision.',
      reviewId: String(existing.id),
      status: 'PENDING_HR',
    };
  }

  const submitForApproval =
    action === 'SUBMIT_FOR_APPROVAL' ||
    action === 'HR_DECIDE';

  if (submitForApproval) {
    if (actor.role !== 'HR' && actor.role !== 'ADMIN') {
      throw new Error('Only HR can submit probation reviews for approval.');
    }
    if (!ratings) {
      throw new Error('Complete all evaluation ratings before submitting.');
    }
    const recommendation = input.recommendation ?? auto.recommendation;
    if (!recommendation) {
      throw new Error('Select a review result before submitting.');
    }
    if (recommendation === 'EXTEND') {
      validateExtension(input);
    }

    const existing: any = input.reviewId
      ? await EmployeeReview.findByPk(input.reviewId)
      : await EmployeeReview.findOne({
          where: {
            userId: input.userId,
            reviewType: 'PROBATION',
            status: { [Op.in]: ['PENDING_HR', 'IN_REVIEW'] },
          },
          order: [['updatedAt', 'DESC']],
        });
    if (existing?.assignedManagerUserId && !existing?.managerSubmittedAt) {
      throw new Error('Manager evaluation must be completed before HR can submit for approval.');
    }
    const existingEmployeeEval = parseEmployeeEvaluationSnapshot(reviewPlain(existing));
    if (
      existing?.assignedManagerUserId &&
      existing?.managerSubmittedAt &&
      !existing?.employeeSubmittedAt &&
      !existingEmployeeEval?.ratings
    ) {
      throw new Error('Employee self-evaluation must be completed before HR can submit for approval.');
    }
    // Backfill timestamps for rows saved before the Sequelize model included these fields.
    const repairedEmployeeSubmittedAt = existing?.employeeSubmittedAt
      ? existing.employeeSubmittedAt
      : existingEmployeeEval?.submittedAt
        ? new Date(existingEmployeeEval.submittedAt)
        : existingEmployeeEval?.ratings
          ? new Date()
          : null;
    const repairedEmployeeSubmittedBy =
      existing?.employeeSubmittedBy ?? existingEmployeeEval?.submittedBy ?? null;
    if (existingEmployeeEval?.ratings && !existing?.employeeSubmittedAt && existing?.id) {
      await EmployeeReview.update(
        {
          employeeSubmittedAt: repairedEmployeeSubmittedAt,
          employeeSubmittedBy: repairedEmployeeSubmittedBy,
        },
        { where: { id: String(existing.id) } }
      );
    }
    const assignedHr = existing?.assignedHrUserId
      ? String(existing.assignedHrUserId)
      : input.assignedHrUserId ?? actor.userId;
    const routingHr = existing?.routedByHrUserId
      ? String(existing.routedByHrUserId)
      : assignedHr;
    if (!actorCanHrDecide(actor, routingHr)) {
      throw new Error('This review is assigned to another HR officer.');
    }

    const {
      resolveAssignedProbationApproversForSubmit,
      replaceProbationApprovers,
      loadProbationApprovers,
      notifyProbationApproversOnSubmit,
    } = await import('../workflowProbationApproverService.js');
    const { buildPendingHrDecisionPayload } = await import('./probationWorkflowService.js');

    const approverIds = await resolveAssignedProbationApproversForSubmit({
      assignedApproverUserIds: input.assignedApproverUserIds,
      actorId: actor.userId,
    });

    let priorOutcome: Record<string, unknown> = {};
    try {
      if (existing?.outcomePayloadJson) {
        priorOutcome = JSON.parse(String(existing.outcomePayloadJson));
      }
    } catch {
      priorOutcome = {};
    }

    const pendingHrDecision = buildPendingHrDecisionPayload({
      ...input,
      recommendation,
      actorUserId: actor.userId,
    });

    const finalReviewId = String(existing?.id ?? reviewId);
    await EmployeeReview.upsert({
      ...basePayload,
      id: finalReviewId,
      status: 'PENDING_FINAL_APPROVAL',
      recommendation,
      hrNotes: input.hrNotes?.trim() || null,
      reviewedAt: null,
      reviewedBy: null,
      assignedHrUserId: assignedHr,
      assignedManagerUserId: existing?.assignedManagerUserId ?? null,
      routedByHrUserId: existing?.routedByHrUserId ?? null,
      routedAt: existing?.routedAt ?? null,
      managerSubmittedBy: existing?.managerSubmittedBy ?? null,
      managerSubmittedAt: existing?.managerSubmittedAt ?? null,
      employeeSubmittedBy: repairedEmployeeSubmittedBy,
      employeeSubmittedAt: repairedEmployeeSubmittedAt,
      extensionDays: recommendation === 'EXTEND' ? Number(input.extensionDays) : null,
      extensionReason: recommendation === 'EXTEND' ? String(input.extensionReason).trim() : null,
      nextReviewDate:
        recommendation === 'EXTEND'
          ? input.nextReviewDate?.slice(0, 10) ??
            addDaysToDate(today, Number(input.extensionDays))
          : null,
      outcomePayloadJson: JSON.stringify({ ...priorOutcome, pendingHrDecision }),
    });

    await replaceProbationApprovers(finalReviewId, approverIds);
    const approvers = await loadProbationApprovers(finalReviewId);
    await notifyProbationApproversOnSubmit(finalReviewId, approvers);

    return {
      message: 'Probation review submitted for approval — approvers have been notified.',
      reviewId: finalReviewId,
      status: 'PENDING_FINAL_APPROVAL',
    };
  }

  const isHrFinalize =
    action === 'SUBMIT' && (actor.role === 'HR' || actor.role === 'ADMIN');
  if (isHrFinalize && !ratings) {
    throw new Error('Complete all evaluation ratings before submitting.');
  }

  const recommendation = input.recommendation ?? auto.recommendation;
  if (!recommendation) {
    throw new Error('Select a review result before submitting.');
  }

  const existing: any = input.reviewId
    ? await EmployeeReview.findByPk(input.reviewId)
    : await EmployeeReview.findOne({
        where: {
          userId: input.userId,
          reviewType: 'PROBATION',
          status: { [Op.in]: ['PENDING_HR', 'IN_REVIEW'] },
        },
        order: [['updatedAt', 'DESC']],
      });
  if (
    isHrFinalize &&
    existing?.assignedManagerUserId &&
    !existing?.managerSubmittedAt
  ) {
    throw new Error('Manager evaluation must be completed before HR can finalize this review.');
  }
  const finalizeEmployeeEval = parseEmployeeEvaluationSnapshot(reviewPlain(existing));
  if (
    isHrFinalize &&
    existing?.assignedManagerUserId &&
    existing?.managerSubmittedAt &&
    !existing?.employeeSubmittedAt &&
    !finalizeEmployeeEval?.ratings
  ) {
    throw new Error('Employee self-evaluation must be completed before HR can finalize this review.');
  }
  if (isHrFinalize && finalizeEmployeeEval && !existing?.employeeSubmittedAt && existing?.id) {
    await EmployeeReview.update(
      {
        employeeSubmittedAt: finalizeEmployeeEval.submittedAt
          ? new Date(finalizeEmployeeEval.submittedAt)
          : new Date(),
        employeeSubmittedBy: finalizeEmployeeEval.submittedBy ?? null,
      },
      { where: { id: String(existing.id) } }
    );
  }
  const assignedHr = existing?.assignedHrUserId
    ? String(existing.assignedHrUserId)
    : input.assignedHrUserId ?? (isHrFinalize ? actor.userId : null);
  const routingHr = existing?.routedByHrUserId
    ? String(existing.routedByHrUserId)
    : assignedHr;
  if (isHrFinalize && !actorCanHrDecide(actor, routingHr)) {
    throw new Error('This review is assigned to another HR officer.');
  }

  let priorOutcome: Record<string, unknown> = {};
  try {
    if (existing?.outcomePayloadJson) {
      priorOutcome = JSON.parse(String(existing.outcomePayloadJson));
    }
  } catch {
    priorOutcome = {};
  }

  const hrPayload = {
    ...basePayload,
    recommendation,
    hrNotes: input.hrNotes?.trim() || null,
    reviewedBy: input.reviewedBy ?? actor.userId,
    assignedHrUserId: assignedHr,
    assignedManagerUserId: existing?.assignedManagerUserId ?? null,
    routedByHrUserId: existing?.routedByHrUserId ?? null,
    routedAt: existing?.routedAt ?? null,
    managerSubmittedBy: existing?.managerSubmittedBy ?? null,
    managerSubmittedAt: existing?.managerSubmittedAt ?? null,
    employeeSubmittedBy:
      existing?.employeeSubmittedBy ?? finalizeEmployeeEval?.submittedBy ?? null,
    employeeSubmittedAt: existing?.employeeSubmittedAt
      ? existing.employeeSubmittedAt
      : finalizeEmployeeEval?.submittedAt
        ? new Date(finalizeEmployeeEval.submittedAt)
        : finalizeEmployeeEval?.ratings
          ? new Date()
          : null,
    outcomePayloadJson: existing?.outcomePayloadJson ?? null,
  };

  if (recommendation === 'PASS') {
    const movement = parseMovementOutcome(input.movementOutcome);
    const probationReviewId = String(existing?.id ?? reviewId);
    const passResult = await applyProbationPassOutcome({
      displayEmployeeId: String(employee.employee_id),
      probationReviewId,
      movement,
      createdBy: input.reviewedBy ?? actor.userId,
      submitterRole: actor.role,
      employeeSnapshot: {
        department_id: String(plain.department_id),
        position_id: String(plain.position_id),
      },
    });
    await employee.update({
      probation_confirmed_at: today,
      probation_next_review_date: null,
      updated_at: new Date(),
    });
    await EmployeeReview.upsert({
      ...hrPayload,
      status: 'PASSED',
      recommendation: 'PASS',
      reviewedAt: new Date(),
      outcomePayloadJson: JSON.stringify({ ...priorOutcome, movement, passResult }),
    });
    return {
      message: passResult.movementSkipped
        ? 'Probation passed — employee confirmed.'
        : 'Probation passed — movement recorded and employee confirmed.',
      reviewId,
      status: 'PASSED',
    };
  }

  if (recommendation === 'EXTEND') {
    validateExtension(input);
    const nextReviewDate =
      input.nextReviewDate?.slice(0, 10) ??
      addDaysToDate(today, Number(input.extensionDays));
    await employee.update({
      probation_next_review_date: nextReviewDate,
      updated_at: new Date(),
    });
    await EmployeeReview.upsert({
      ...hrPayload,
      status: 'EXTENDED',
      recommendation: 'EXTEND',
      extensionDays: Number(input.extensionDays),
      extensionReason: String(input.extensionReason).trim(),
      nextReviewDate,
      reviewedAt: new Date(),
      outcomePayloadJson: JSON.stringify({
        ...priorOutcome,
        extensionDays: input.extensionDays,
        extensionReason: input.extensionReason,
        nextReviewDate,
      }),
    });
    return {
      message: `Probation extended — next review scheduled for ${nextReviewDate}.`,
      reviewId,
      status: 'EXTENDED',
    };
  }

  const offboard = parseOffboardOutcome(input.offboardOutcome);
  if (!offboard.reason) {
    offboard.reason =
      String(input.areasForImprovement ?? input.strengths ?? '').trim() ||
      'Probation review failed — employment terminated per HR decision.';
  }
  await applyProbationFailOutcome({
    displayEmployeeId: String(employee.employee_id),
    offboard,
    offboardedBy: input.reviewedBy ?? actor.userId,
  });
  await EmployeeReview.upsert({
    ...hrPayload,
    status: 'FAILED',
    recommendation: 'FAIL',
    reviewedAt: new Date(),
    outcomePayloadJson: JSON.stringify({ ...priorOutcome, offboard }),
  });

  return {
    message: 'Probation failed — employee offboarded.',
    reviewId,
    status: 'FAILED',
  };
}

/** Backward-compatible wrapper for legacy pass/fail routes. */
export async function applyProbationReviewOutcome(params: {
  userId: string;
  status: 'PASSED' | 'FAILED';
  reviewedBy?: string | null;
  notes?: string;
  score?: number | null;
  periodEnd?: string | null;
}): Promise<{ employeeId: string; message: string }> {
  const recommendation = params.status === 'PASSED' ? 'PASS' : 'FAIL';
  const result = await submitProbationReview({
    userId: params.userId,
    action: 'SUBMIT',
    recommendation,
    reviewedBy: params.reviewedBy,
    areasForImprovement: params.notes,
    periodEnd: params.periodEnd,
    ratings: {
      jobPerformance: recommendation === 'PASS' ? 'GOOD' : 'NEEDS_IMPROVEMENT',
      attendance: recommendation === 'PASS' ? 'GOOD' : 'AVERAGE',
      workAttitude: recommendation === 'PASS' ? 'GOOD' : 'AVERAGE',
      teamwork: recommendation === 'PASS' ? 'GOOD' : 'AVERAGE',
    },
  });
  const resolved = await resolveEmployeeFromReviewUserId(params.userId);
  return {
    employeeId: String(resolved?.employee.employee_id ?? ''),
    message: result.message,
  };
}

export async function listMyPendingProbationSelfEvaluation(userId: string) {
  const { ensureProbationReviewSchema } = await import('./probationReviewSchema.js');
  await ensureProbationReviewSchema();
  const row: any = await EmployeeReview.findOne({
    where: {
      userId,
      reviewType: 'PROBATION',
      status: 'PENDING_EMPLOYEE',
    },
    order: [['updatedAt', 'DESC']],
  });
  if (!row) return null;
  const plain = reviewPlain(row);
  const managerEval = parseManagerEvaluationSnapshot(plain);
  return {
    reviewId: String(plain.id),
    userId: String(plain.userId),
    status: 'PENDING_EMPLOYEE' as const,
    managerSubmittedAt: plain.managerSubmittedAt ? String(plain.managerSubmittedAt) : null,
    managerRatings: managerEval?.ratings ?? null,
    managerStrengths: managerEval?.strengths ?? '',
    managerAreasForImprovement: managerEval?.areasForImprovement ?? '',
    managerOverallRecommendation: managerEval?.overallRecommendation ?? null,
  };
}
