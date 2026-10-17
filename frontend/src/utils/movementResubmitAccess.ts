import type { EmployeeMovementRow } from '../types/employeeMovement';

type MovementActorFields = Pick<EmployeeMovementRow, 'status' | 'canonicalStatus' | 'createdBy'>;

/** True when the movement was returned for revision. */
export function isReturnedMovementStatus(
  row: Pick<EmployeeMovementRow, 'status' | 'canonicalStatus'> | null | undefined
): boolean {
  if (!row) return false;
  const status = String(row.canonicalStatus ?? row.status ?? '').toLowerCase();
  return status === 'returned';
}

/**
 * Only the original submitter (actor) may edit & resubmit a returned movement.
 * Approvers and other HR users must not revise someone else's submission.
 */
export function canActorResubmitReturnedMovement(
  row: MovementActorFields | null | undefined,
  actor: { id?: string | null; role?: string | null } | null | undefined
): boolean {
  if (!row || !isReturnedMovementStatus(row)) return false;
  const actorId = String(actor?.id ?? '').trim();
  const createdBy = String(row.createdBy ?? '').trim();
  return Boolean(actorId && createdBy && actorId === createdBy);
}
