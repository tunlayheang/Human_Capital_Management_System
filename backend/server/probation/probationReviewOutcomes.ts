import { createEmployeeMovement } from '../employeeMovementService.js';
import { offboardEmployee } from '../employeeLifecycle.js';

export type ProbationMovementOutcome = {
  movementType?: 'promotion' | 'transfer' | 'salary_update';
  effectiveDate: string;
  toDepartmentId?: string;
  toPositionId?: string;
  toBaseSalary?: number;
  toCurrency?: string;
  notes?: string;
};

export type ProbationOffboardOutcome = {
  reason: string;
  lastWorkingDate?: string;
};

export type ProbationExtendOutcome = {
  extensionDays: number;
  extensionReason: string;
  nextReviewDate?: string;
};

function movementHasChanges(
  emp: { department_id: string; position_id: string },
  payload: ProbationMovementOutcome
): boolean {
  const toDept = String(payload.toDepartmentId ?? emp.department_id).trim();
  const toPos = String(payload.toPositionId ?? emp.position_id).trim();
  if (toDept !== String(emp.department_id) || toPos !== String(emp.position_id)) return true;
  if (payload.toBaseSalary != null && Number.isFinite(Number(payload.toBaseSalary))) return true;
  return false;
}

export async function applyProbationPassOutcome(params: {
  displayEmployeeId: string;
  probationReviewId: string;
  movement?: ProbationMovementOutcome | null;
  createdBy?: string | null;
  submitterRole?: string;
  employeeSnapshot: { department_id: string; position_id: string };
}): Promise<{ movementId?: string; movementSkipped: boolean }> {
  const payload = params.movement;
  if (!payload?.effectiveDate?.trim()) {
    throw new Error('Effective date is required for probation pass.');
  }

  if (!movementHasChanges(params.employeeSnapshot, payload)) {
    return { movementSkipped: true };
  }

  const movementType = payload.movementType ?? 'promotion';
  const row = await createEmployeeMovement({
    employeeId: params.displayEmployeeId,
    movementType,
    effectiveDate: payload.effectiveDate,
    toDepartmentId: payload.toDepartmentId ?? params.employeeSnapshot.department_id,
    toPositionId: payload.toPositionId ?? params.employeeSnapshot.position_id,
    toBaseSalary: payload.toBaseSalary,
    toCurrency: payload.toCurrency,
    notes: payload.notes,
    changeReason: 'Probation passed — role confirmation',
    sourceProbationReviewId: params.probationReviewId,
    createdBy: params.createdBy ?? undefined,
    submitterRole: params.submitterRole ?? 'HR',
  });

  return { movementId: row.id, movementSkipped: false };
}

export async function applyProbationFailOutcome(params: {
  displayEmployeeId: string;
  offboard: ProbationOffboardOutcome;
  offboardedBy?: string | null;
}): Promise<void> {
  const reason = String(params.offboard.reason ?? '').trim();
  if (!reason) {
    throw new Error('Termination reason is required.');
  }
  await offboardEmployee({
    displayEmployeeId: params.displayEmployeeId,
    type: 'terminate',
    reason,
    offboardedBy: params.offboardedBy ?? null,
    lastWorkingDate: params.offboard.lastWorkingDate?.slice(0, 10) ?? null,
    source: 'probation',
  });
}
