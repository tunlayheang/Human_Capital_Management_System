import type { EmployeeAppraisalRow } from './appraisalTypes.js';
import { canActAsFinalAppraisalApprover } from '../workflowApproverService.js';
import { toCanonicalEmployeeDisplayId } from '../employeeIdFormat.js';

export type AppraisalActor = {
  userId: string;
  role: string;
};

export type AppraisalRowCapabilities = {
  canRouteToManager: boolean;
  canManagerEdit: boolean;
  canEmployeeSelfEvaluate: boolean;
  canHrFinalize: boolean;
  canFinalApproverReview: boolean;
  canLegacyAdvance: boolean;
};

type AppraisalApproverContext = {
  assigned_final_approver_user_id?: string | null;
  currentApproverUserId?: string | null;
  assignedFinalApproverUserIds?: string[];
};

function finalApproverOptions(row: AppraisalApproverContext) {
  const ids =
    row.assignedFinalApproverUserIds?.length
      ? row.assignedFinalApproverUserIds
      : row.assigned_final_approver_user_id
        ? [String(row.assigned_final_approver_user_id)]
        : [];
  return {
    assignedFinalApproverUserIds: ids,
    sequential: ids.length > 0,
  };
}

function finalApproverAppraisalContext(row: AppraisalApproverContext) {
  return {
    assigned_final_approver_user_id: row.assigned_final_approver_user_id,
    currentApproverUserId: row.currentApproverUserId,
  };
}

function employeeSelfEvalComplete(row: Pick<EmployeeAppraisalRow, 'self_review_at'>): boolean {
  return Boolean(row.self_review_at);
}

/** HR explicitly routed this appraisal to a manager for evaluation. */
export function isAppraisalExplicitlyRoutedToManager(
  row: Pick<
    EmployeeAppraisalRow,
    'assigned_manager_user_id' | 'routed_by_hr_user_id' | 'routed_at'
  >
): boolean {
  const assigned = String(row.assigned_manager_user_id ?? '').trim();
  const routedBy = String(row.routed_by_hr_user_id ?? '').trim();
  return Boolean(assigned && (routedBy || row.routed_at));
}

export function isAppraisalManagerReviewPending(
  row: Pick<EmployeeAppraisalRow, 'workflow_status'>
): boolean {
  const status = String(row.workflow_status ?? '');
  return status === 'PENDING_MANAGER' || status === 'MANAGER_REVIEW';
}

/** Whether an employee may view their own appraisal in self-service. */
export function employeeCanSeeOwnAppraisal(
  row: Pick<
    EmployeeAppraisalRow,
    'user_id' | 'workflow_status' | 'self_review_at' | 'manager_submitted_at'
  >,
  userId: string
): boolean {
  if (String(row.user_id) !== String(userId)) return false;
  const status = String(row.workflow_status ?? '');
  if (status === 'PENDING_EMPLOYEE') return Boolean(row.manager_submitted_at);
  if (['APPROVED', 'CLOSED', 'REJECTED'].includes(status)) return true;
  if (status === 'PENDING_HR' && row.manager_submitted_at) return true;
  return Boolean(row.self_review_at);
}

function roleOf(actor?: AppraisalActor): string {
  return String(actor?.role ?? '').toUpperCase();
}

function isHrStaffRole(role: string): boolean {
  return role === 'HR' || role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/** Routed assignee, with legacy fallback to manager_id on post-route rows. */
export function effectiveAssignedManagerUserId(
  row: Pick<EmployeeAppraisalRow, 'assigned_manager_user_id' | 'manager_id' | 'workflow_status'>
): string | null {
  if (row.assigned_manager_user_id) return String(row.assigned_manager_user_id);
  if (!row.manager_id) return null;
  const status = String(row.workflow_status ?? '');
  if (
    status === 'PENDING_MANAGER' ||
    status === 'MANAGER_REVIEW' ||
    status === 'PENDING_EMPLOYEE' ||
    status === 'PENDING_HR' ||
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'CLOSED' ||
    status === 'SUBMITTED' ||
    status === 'HR_REVIEW'
  ) {
    return String(row.manager_id);
  }
  return null;
}

export function actorIsAssignedManager(
  actor: AppraisalActor | undefined,
  assignedManagerUserId: string | null | undefined
): boolean {
  if (!actor?.userId || !assignedManagerUserId) return false;
  return String(assignedManagerUserId) === String(actor.userId);
}

export function parseAppraisalOutcomePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function resolveAppraisalCapabilities(
  row: Pick<
    EmployeeAppraisalRow,
    | 'workflow_status'
    | 'user_id'
    | 'assigned_manager_user_id'
    | 'manager_id'
    | 'manager_submitted_at'
    | 'self_review_at'
    | 'locked'
    | 'routed_by_hr_user_id'
  >,
  actor?: AppraisalActor
): AppraisalRowCapabilities {
  const role = roleOf(actor);
  const isHr = isHrStaffRole(role);
  const status = String(row.workflow_status ?? '');
  const locked = Number(row.locked) === 1;
  const assignedManager = effectiveAssignedManagerUserId(row);
  const managerSubmitted = Boolean(row.manager_submitted_at);
  const employeeSubmitted = employeeSelfEvalComplete(row);

  if (locked) {
    return {
      canRouteToManager: false,
      canManagerEdit: false,
      canEmployeeSelfEvaluate: false,
      canHrFinalize: false,
      canFinalApproverReview: false,
      canLegacyAdvance: false,
    };
  }

  const canRouteToManager =
    isHr &&
    (!managerSubmitted || status === 'DRAFT' || status === 'REOPENED') &&
    status !== 'PENDING_MANAGER' &&
    status !== 'PENDING_EMPLOYEE' &&
    status !== 'PENDING_HR' &&
    status !== 'PENDING_FINAL_APPROVAL' &&
    status !== 'APPROVED' &&
    status !== 'CLOSED' &&
    status !== 'REJECTED';

  // The current evaluator (whoever HR placed at this position in the chain) may
  // edit, regardless of their base role. `assigned_manager_user_id` always points
  // at the evaluator whose turn it is, so this stays scoped to one person.
  const canManagerEdit =
    isAppraisalManagerReviewPending(row) &&
    isAppraisalExplicitlyRoutedToManager(row) &&
    actorIsAssignedManager(actor, assignedManager) &&
    Boolean(actor?.userId) &&
    String(row.user_id) !== String(actor.userId);

  const canEmployeeSelfEvaluate =
    status === 'PENDING_EMPLOYEE' &&
    Boolean(actor?.userId) &&
    String(row.user_id) === String(actor.userId) &&
    managerSubmitted &&
    !employeeSubmitted;

  const canHrFinalize =
    isHr &&
    ((status === 'PENDING_HR' && managerSubmitted && employeeSubmitted) ||
      (!assignedManager && (status === 'SUBMITTED' || status === 'HR_REVIEW')));

  const canFinalApproverReview =
    status === 'PENDING_FINAL_APPROVAL' &&
    canActAsFinalAppraisalApprover(
      { userId: actor?.userId, role: actor?.role },
      finalApproverAppraisalContext(row as AppraisalApproverContext),
      finalApproverOptions(row as AppraisalApproverContext)
    );

  const canLegacyAdvance =
    isHr &&
    !assignedManager &&
    status !== 'PENDING_MANAGER' &&
    status !== 'PENDING_EMPLOYEE' &&
    status !== 'PENDING_HR' &&
    status !== 'PENDING_FINAL_APPROVAL' &&
    status !== 'APPROVED' &&
    status !== 'CLOSED';

  return { canRouteToManager, canManagerEdit, canEmployeeSelfEvaluate, canHrFinalize, canFinalApproverReview, canLegacyAdvance };
}

/** Whether the actor may edit scores / narrative on this appraisal (not workflow transitions). */
export function canActorEditAppraisalContent(
  row: Pick<
    EmployeeAppraisalRow,
    | 'workflow_status'
    | 'user_id'
    | 'assigned_manager_user_id'
    | 'manager_id'
    | 'manager_submitted_at'
    | 'self_review_at'
    | 'locked'
    | 'routed_by_hr_user_id'
  >,
  actor?: AppraisalActor
): boolean {
  if (Number(row.locked) === 1) return false;
  const caps = resolveAppraisalCapabilities(row, actor);
  if (
    caps.canManagerEdit ||
    caps.canEmployeeSelfEvaluate ||
    caps.canHrFinalize ||
    caps.canRouteToManager ||
    caps.canLegacyAdvance
  ) {
    return true;
  }
  if (isHrStaffRole(roleOf(actor)) && String(row.workflow_status ?? '') === 'REOPENED') {
    return true;
  }
  return roleOf(actor) === 'ADMIN';
}

type AppraisalVisibilityRow = Pick<
  EmployeeAppraisalRow,
  | 'workflow_status'
  | 'user_id'
  | 'assigned_manager_user_id'
  | 'manager_id'
  | 'manager_submitted_at'
  | 'manager_submitted_by'
  | 'self_review_at'
  | 'outcome_payload_json'
> &
  AppraisalApproverContext & {
    assignedEvaluatorUserIds?: string[];
    assignedEvaluators?: Array<{ userId: string; status?: string }>;
  };

/** True when the actor was (or still is) on the management-evaluator chain for this appraisal. */
export function actorIsOrWasAppraisalEvaluator(
  row: AppraisalVisibilityRow,
  actor?: AppraisalActor
): boolean {
  const actorId = String(actor?.userId ?? '').trim();
  if (!actorId) return false;

  const chainIds = Array.isArray(row.assignedEvaluatorUserIds)
    ? row.assignedEvaluatorUserIds.map((id) => String(id))
    : [];
  if (chainIds.includes(actorId)) return true;

  if (
    Array.isArray(row.assignedEvaluators) &&
    row.assignedEvaluators.some((ev) => String(ev.userId) === actorId)
  ) {
    return true;
  }

  if (String(row.manager_submitted_by ?? '').trim() === actorId) return true;

  // Fallback when chain rows were cleared but narrative proof remains in outcome payload.
  try {
    const raw = row.outcome_payload_json;
    if (!raw) return false;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const evals = parsed?.managementEvaluations;
    if (evals && typeof evals === 'object' && !Array.isArray(evals)) {
      return Object.prototype.hasOwnProperty.call(evals, actorId);
    }
  } catch {
    /* ignore malformed payload */
  }
  return false;
}

export function actorCanSeeAppraisalRow(
  row: AppraisalVisibilityRow,
  actor?: AppraisalActor
): boolean {
  if (!actor) return true;
  const role = roleOf(actor);
  if (isHrStaffRole(role)) return true;
  // The current assigned evaluator may always view the appraisal while it is
  // awaiting their evaluation, even if their base role is not MANAGER.
  if (
    isAppraisalManagerReviewPending(row) &&
    isAppraisalExplicitlyRoutedToManager(row) &&
    actorIsAssignedManager(actor, effectiveAssignedManagerUserId(row))
  ) {
    return true;
  }
  // Prior evaluators keep read access after submit so they can prove / track their action
  // (Leave-style history). Edit rights remain gated by canManagerEdit.
  if (actorIsOrWasAppraisalEvaluator(row, actor)) {
    return true;
  }
  // Subject employees may view their own appraisal regardless of base role (e.g. MANAGER).
  if (String(row.user_id) === String(actor.userId)) {
    return employeeCanSeeOwnAppraisal(row, String(actor.userId));
  }
  if (role === 'MANAGER') {
    const status = String(row.workflow_status ?? '');
    if (status === 'PENDING_MANAGER' || status === 'MANAGER_REVIEW') {
      return (
        isAppraisalExplicitlyRoutedToManager(row) &&
        actorIsAssignedManager(actor, effectiveAssignedManagerUserId(row))
      );
    }
    if (status === 'PENDING_FINAL_APPROVAL') {
      const ids = finalApproverOptions(row as AppraisalApproverContext).assignedFinalApproverUserIds;
      return ids.includes(String(actor.userId));
    }
    return false;
  }
  if (String(row.workflow_status ?? '') === 'PENDING_FINAL_APPROVAL') {
    const ids = finalApproverOptions(row as AppraisalApproverContext).assignedFinalApproverUserIds;
    if (ids.includes(String(actor.userId))) return true;
  }
  return false;
}

export function enrichAppraisalRow<T extends EmployeeAppraisalRow>(
  row: T,
  actor?: AppraisalActor
): T & AppraisalRowCapabilities {
  const caps = resolveAppraisalCapabilities(row, actor);
  const code = (row as { employeeCode?: string | null }).employeeCode;
  const canonicalCode = code
    ? toCanonicalEmployeeDisplayId(code) || String(code)
    : code;
  return {
    ...row,
    ...caps,
    ...(canonicalCode != null ? { employeeCode: canonicalCode } : {}),
  } as T & AppraisalRowCapabilities;
}
