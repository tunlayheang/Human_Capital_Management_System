import { Op, QueryTypes } from 'sequelize';
import type { WhereOptions } from 'sequelize';
import { LeaveRequest, OvertimeRequest, sequelize } from './db.js';
import {
  countCurrentChainActionsForActor,
  ensureChainApproverTable,
  LEAVE_APPROVER_CONFIG,
  OVERTIME_APPROVER_CONFIG,
} from './workflowChainApproverService.js';
import { WORKFLOW_APPROVAL_STEPS_TABLE } from './workflowApprovalStepsSchema.js';

export type ApprovalInboxSummary = {
  /** Items that need the viewer's sign-off now (appraisals, movements, leave, overtime). */
  actionRequired: number;
  /** All assigned workflow items including tracking-only appraisal steps. */
  totalAssigned: number;
  breakdown: {
    appraisalsAction: number;
    appraisalsTracking: number;
    movements: number;
    probationAction: number;
    probationTracking: number;
    payrollAction: number;
    payrollTracking: number;
    leaveRequests: number;
    overtimeRequests: number;
  };
};

function emptySummary(): ApprovalInboxSummary {
  return {
    actionRequired: 0,
    totalAssigned: 0,
    breakdown: {
      appraisalsAction: 0,
      appraisalsTracking: 0,
      movements: 0,
      probationAction: 0,
      probationTracking: 0,
      payrollAction: 0,
      payrollTracking: 0,
      leaveRequests: 0,
      overtimeRequests: 0,
    },
  };
}

async function resolveTeamUserIdsForManager(userId: string): Promise<string[]> {
  const { resolveTeamUserIdsForManager: resolve } = await import('./managerTeamService.js');
  return resolve(userId);
}

async function excludeRequestsWithApproverChains(
  entityType: 'leave' | 'overtime',
  requestIds: string[]
): Promise<number> {
  if (!requestIds.length) return 0;
  await ensureChainApproverTable();
  const rows = (await sequelize.query(
    `SELECT DISTINCT entity_id AS entityId
     FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     WHERE entity_type = :entityType
       AND entity_id IN (:requestIds)`,
    {
      replacements: { entityType, requestIds },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ entityId?: string }>;
  const chainedIds = new Set(rows.map((row) => String(row.entityId ?? '')).filter(Boolean));
  return requestIds.filter((id) => !chainedIds.has(id)).length;
}

/**
 * Count only legacy leave requests the viewer can act on. Requests with an ordered approver chain
 * are excluded here and counted by countCurrentChainActionsForActor instead.
 */
async function countLegacyLeaveActions(viewer: {
  id?: string;
  role?: string;
}): Promise<number> {
  const role = String(viewer.role ?? '').toUpperCase();
  const actorId = String(viewer.id ?? '').trim();
  if (!actorId) return 0;

  let where: WhereOptions;
  if (role === 'MANAGER') {
    where = { status: 'PENDING', assignedManagerId: actorId };
  } else if (role === 'ADMIN' || role === 'HR') {
    where = {
      [Op.or]: [
        { status: 'MANAGER_APPROVED' },
        { status: 'PENDING', assignedManagerId: null },
      ],
    };
  } else {
    return 0;
  }

  const rows = (await LeaveRequest.findAll({ where, attributes: ['id'], raw: true })) as Array<{
    id?: string;
  }>;
  return excludeRequestsWithApproverChains(
    'leave',
    rows.map((row) => String(row.id ?? '')).filter(Boolean)
  );
}

/** Count actionable legacy overtime requests, excluding all requests that use an approver chain. */
async function countLegacyOvertimeActions(viewer: {
  id?: string;
  role?: string;
}): Promise<number> {
  const role = String(viewer.role ?? '').toUpperCase();
  const actorId = String(viewer.id ?? '').trim();
  if (!actorId) return 0;

  let where: WhereOptions = { status: 'PENDING' };
  if (role === 'MANAGER') {
    const teamUserIds = await resolveTeamUserIdsForManager(actorId);
    if (!teamUserIds.length) return 0;
    where = { ...where, userId: { [Op.in]: teamUserIds } };
  } else if (role !== 'ADMIN' && role !== 'HR') {
    return 0;
  }

  const rows = (await OvertimeRequest.findAll({ where, attributes: ['id'], raw: true })) as Array<{
    id?: string;
  }>;
  return excludeRequestsWithApproverChains(
    'overtime',
    rows.map((row) => String(row.id ?? '')).filter(Boolean)
  );
}

async function countChainLeaveActions(actorId: string): Promise<number> {
  return countCurrentChainActionsForActor(LEAVE_APPROVER_CONFIG, actorId, {
    table: 'leaverequests',
    allowedStatuses: ['PENDING'],
  });
}

async function countChainOvertimeActions(actorId: string): Promise<number> {
  return countCurrentChainActionsForActor(OVERTIME_APPROVER_CONFIG, actorId, {
    table: 'overtimerequests',
    allowedStatuses: ['PENDING'],
  });
}

export async function getApprovalInboxSummary(viewer: {
  id?: string;
  role?: string;
}): Promise<ApprovalInboxSummary> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return emptySummary();

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      console.warn(
        `[approvals/summary] ${label} failed:`,
        err instanceof Error ? err.message : err
      );
      return fallback;
    }
  };

  const [
    appraisalMod,
    movementMod,
    probationMod,
    payrollMod,
    legacyLeaveActions,
    legacyOvertimeActions,
    chainLeave,
    chainOvertime,
  ] = await Promise.all([
    safe('appraisal module', () => import('./appraisal/appraisalWorkflowService.js'), null),
    safe('movement module', () => import('./employeeMovementService.js'), null),
    safe('probation module', () => import('./probation/probationWorkflowService.js'), null),
    safe('payroll module', () => import('./payroll/payrollRunApprovalService.js'), null),
    safe('legacy leave count', () => countLegacyLeaveActions(viewer), 0),
    safe('legacy overtime count', () => countLegacyOvertimeActions(viewer), 0),
    safe('chain leave count', () => countChainLeaveActions(actorId), 0),
    safe('chain overtime count', () => countChainOvertimeActions(actorId), 0),
  ]);

  const [appraisals, movements, probation, payrollRuns] = await Promise.all([
    appraisalMod
      ? safe(
          'appraisal list',
          () =>
            appraisalMod.listFinalAppraisalsForAssignedApprover({
              id: actorId,
              role: viewer.role,
            }),
          []
        )
      : Promise.resolve([] as Awaited<
          ReturnType<
            typeof import('./appraisal/appraisalWorkflowService.js').listFinalAppraisalsForAssignedApprover
          >
        >),
    movementMod
      ? safe(
          'movement list',
          () =>
            movementMod.listPendingMovementsForCurrentApprover({
              id: actorId,
              role: viewer.role,
            }),
          []
        )
      : Promise.resolve([] as Awaited<
          ReturnType<
            typeof import('./employeeMovementService.js').listPendingMovementsForCurrentApprover
          >
        >),
    probationMod
      ? safe(
          'probation list',
          () =>
            probationMod.listPendingProbationReviewsForCurrentApprover({
              id: actorId,
              role: viewer.role,
            }),
          []
        )
      : Promise.resolve([] as Awaited<
          ReturnType<
            typeof import('./probation/probationWorkflowService.js').listPendingProbationReviewsForCurrentApprover
          >
        >),
    payrollMod
      ? safe(
          'payroll list',
          () =>
            payrollMod.listPendingPayrollRunsForCurrentApprover({
              id: actorId,
              role: viewer.role,
            }),
          []
        )
      : Promise.resolve([] as Awaited<
          ReturnType<
            typeof import('./payroll/payrollRunApprovalService.js').listPendingPayrollRunsForCurrentApprover
          >
        >),
  ]);

  const appraisalsAction = appraisals.filter((row) => row.canFinalApproverReview).length;
  const appraisalsTracking = appraisals.length - appraisalsAction;
  const movementsCount = movements.length;
  const probationAction = probation.filter((row) => row.canApproverReview).length;
  const probationTracking = probation.length - probationAction;
  const payrollAction = payrollRuns.filter((row) => row.canApproverReview).length;
  const payrollTracking = payrollRuns.length - payrollAction;

  // The sets are disjoint: legacy counters explicitly exclude requests that have chain rows.
  const leaveRequests = legacyLeaveActions + chainLeave;
  const overtimeRequests = legacyOvertimeActions + chainOvertime;

  const workflowAction =
    appraisalsAction + movementsCount + probationAction + payrollAction;
  const actionRequired = workflowAction + leaveRequests + overtimeRequests;
  const totalAssigned =
    appraisalsAction +
    appraisalsTracking +
    movementsCount +
    probationAction +
    probationTracking +
    payrollAction +
    payrollTracking +
    leaveRequests +
    overtimeRequests;

  return {
    actionRequired,
    totalAssigned,
    breakdown: {
      appraisalsAction,
      appraisalsTracking,
      movements: movementsCount,
      probationAction,
      probationTracking,
      payrollAction,
      payrollTracking,
      leaveRequests,
      overtimeRequests,
    },
  };
}
