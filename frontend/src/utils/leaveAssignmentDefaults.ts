import type { LeaveAssignmentOption } from '../types';

export function isFemaleGender(gender: string | undefined | null): boolean {
  const g = String(gender ?? '').trim().toLowerCase();
  return g === 'female' || g === 'f';
}

export function isMaternityLeaveType(opt: {
  name: string;
  code?: string;
  leaveTypeId?: string;
}): boolean {
  const name = String(opt.name ?? '').toLowerCase();
  const code = String(opt.code ?? '').toLowerCase();
  const id = String(opt.leaveTypeId ?? '').toLowerCase();
  return name.includes('maternity') || code.includes('maternity') || id.includes('maternity');
}

/** Default yes for all types; Maternity only when gender is Female. */
export function defaultLeaveTypeAssigned(
  opt: Pick<LeaveAssignmentOption, 'leaveTypeId' | 'name' | 'code'>,
  gender?: string | null
): boolean {
  if (isMaternityLeaveType(opt)) {
    return isFemaleGender(gender);
  }
  return true;
}

export function mergeLeaveAssignmentsWithTypes(
  types: LeaveAssignmentOption[],
  saved?: Record<string, boolean> | null,
  gender?: string | null
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  const hasSaved = saved != null && typeof saved === 'object' && Object.keys(saved).length > 0;
  for (const t of types) {
    if (hasSaved && Object.prototype.hasOwnProperty.call(saved, t.leaveTypeId)) {
      map[t.leaveTypeId] = !!saved![t.leaveTypeId];
    } else {
      map[t.leaveTypeId] = defaultLeaveTypeAssigned(t, gender);
    }
  }
  return map;
}

export function findMaternityLeaveTypeId(types: LeaveAssignmentOption[]): string | null {
  const row = types.find(isMaternityLeaveType);
  return row?.leaveTypeId ?? null;
}
