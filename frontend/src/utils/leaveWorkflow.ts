import { LeaveRequest, LeaveStatus, Role } from '../types';
import {
  resolveLeaveApprovalSteps,
  workflowApprovalStepToTrackingLine,
} from './workflowRequestApproval';
import { formatDateTimeDisplay } from './formatDisplayDate';

/** Map API leave row (camelCase or legacy snake_case) to LeaveRequest. */
export function normalizeLeaveRequest(raw: unknown): LeaveRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as LeaveRequest),
    assignedManagerId: (r.assignedManagerId ?? r.assigned_manager_id ?? null) as
      | string
      | null
      | undefined,
    managerApprovedBy: (r.managerApprovedBy ?? r.manager_approved_by ?? null) as
      | string
      | null
      | undefined,
    managerApprovedAt: (r.managerApprovedAt ?? r.manager_approved_at ?? null) as
      | string
      | null
      | undefined,
    hrApprovedBy: (r.hrApprovedBy ?? r.hr_approved_by ?? null) as string | null | undefined,
    hrApprovedAt: (r.hrApprovedAt ?? r.hr_approved_at ?? null) as string | null | undefined,
    appliedOn: (r.appliedOn ?? r.applied_on ?? null) as string | null | undefined,
    createdAt: (r.createdAt ?? r.created_at ?? null) as string | null | undefined,
    updatedAt: (r.updatedAt ?? r.updated_at ?? null) as string | null | undefined,
  };
}

/** When the employee submitted the leave request (date + time). */
export function formatLeaveRequestedAt(leave: Pick<LeaveRequest, 'createdAt' | 'appliedOn'>): string {
  return formatDateTimeDisplay(leave.createdAt ?? leave.appliedOn);
}

/** True when the request was submitted with an ordered approver chain. */
export function leaveHasApproverChain(leave: Pick<LeaveRequest, 'assignedApprovers'>): boolean {
  return Array.isArray(leave.assignedApprovers) && leave.assignedApprovers.length > 0;
}

export function formatLeaveStatusLabel(status: string, leave?: Pick<LeaveRequest, 'assignedApprovers' | 'approvalProgress'>): string {
  const s = String(status).toUpperCase();
  if (leave && leaveHasApproverChain(leave) && s === LeaveStatus.PENDING) {
    const progress = leave.approvalProgress;
    return progress && progress.total > 0
      ? `Pending approval (${progress.approved}/${progress.total})`
      : 'Pending approval';
  }
  switch (s) {
    case LeaveStatus.PENDING:
      return 'Pending manager';
    case LeaveStatus.MANAGER_APPROVED:
      return 'Pending HR';
    case LeaveStatus.APPROVED:
      return 'Approved';
    case LeaveStatus.REJECTED:
      return 'Rejected';
    case LeaveStatus.RETURNED:
      return 'Returned';
    case LeaveStatus.CANCELLED:
      return 'Cancelled';
    default:
      return status;
  }
}

/** Compact leave type label for list tables (AL, Sick, Unpaid, …). */
export function formatLeaveTypeShort(type: string): string {
  const raw = String(type ?? '').trim();
  if (!raw) return '—';

  // Older seed rows stored leave-type ids (lt-annual).
  const withoutIdPrefix = raw.replace(/^lt[-_]/i, '').replace(/[-_]+/g, ' ').trim();
  const nameKey = withoutIdPrefix.toLowerCase().replace(/\s+/g, ' ');
  const byName: Record<string, string> = {
    annual: 'Annual',
    'annual leave': 'Annual',
    sick: 'Sick',
    'sick leave': 'Sick',
    unpaid: 'Unpaid',
    'unpaid leave': 'Unpaid',
    maternity: 'Maternity',
    'maternity leave': 'Maternity',
    paternity: 'Paternity',
    'paternity leave': 'Paternity',
    'public holiday': 'PH',
  };
  if (byName[nameKey]) return byName[nameKey];

  const codeKey = withoutIdPrefix.toUpperCase().replace(/[\s-]+/g, '_');
  const byCode: Record<string, string> = {
    ANNUAL: 'Annual',
    ANNUAL_LEAVE: 'Annual',
    AL: 'Annual',
    SICK: 'Sick',
    SICK_LEAVE: 'Sick',
    UNPAID: 'Unpaid',
    UNPAID_LEAVE: 'Unpaid',
    MATERNITY: 'Maternity',
    MATERNITY_LEAVE: 'Maternity',
    PATERNITY: 'Paternity',
    PATERNITY_LEAVE: 'Paternity',
    PUBLIC_HOLIDAY: 'PH',
    PH: 'PH',
    HOLIDAY: 'Hol',
  };
  if (byCode[codeKey]) return byCode[codeKey];

  if (withoutIdPrefix.length <= 10) {
    return withoutIdPrefix.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const words = withoutIdPrefix.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => w[0]?.toUpperCase() ?? '').join('');
  }
  return withoutIdPrefix.slice(0, 8);
}

/** Compact status for list tables — any awaiting step shows as Pending. */
export function formatLeaveStatusShort(status: string): string {
  const s = String(status).toUpperCase();
  if (s === LeaveStatus.PENDING || s === LeaveStatus.MANAGER_APPROVED) {
    return 'Pending';
  }
  switch (s) {
    case LeaveStatus.APPROVED:
      return 'Approved';
    case LeaveStatus.REJECTED:
      return 'Rejected';
    case LeaveStatus.RETURNED:
      return 'Returned';
    case LeaveStatus.CANCELLED:
      return 'Cancelled';
    default:
      return String(status);
  }
}

export function isHrLeaveApprover(role: Role | string | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === Role.ADMIN || r === Role.HR || r === 'SUPER_ADMIN';
}

export function isManagerRole(role: Role | string | undefined): boolean {
  return String(role ?? '').toUpperCase() === Role.MANAGER;
}

/** Leaves this manager is part of (legacy single-manager or anywhere in the chain). */
export function filterLeavesForManagerQueue(
  leaves: LeaveRequest[],
  managerUserId: string | undefined
): LeaveRequest[] {
  const id = String(managerUserId ?? '').trim();
  if (!id) return [];
  return leaves.filter((l) => {
    if (leaveHasApproverChain(l)) {
      return (l.assignedApprovers ?? []).some((a) => String(a.userId).trim() === id);
    }
    return String(l.assignedManagerId ?? '').trim() === id;
  });
}

export type LeaveApprovalAction = 'manager' | 'hr' | 'reject' | null;

export function leaveApprovalActionForUser(
  leave: LeaveRequest,
  userId: string | undefined,
  userRole: Role | string | undefined
): LeaveApprovalAction {
  const status = String(leave.status).toUpperCase();
  const id = String(userId ?? '').trim();

  // Ordered approver chain: only the current pending approver may advance.
  // Later steps (and HR/Admin who are waiting in the chain) see View only.
  // The 'hr' action maps to an APPROVED transition, which the backend treats
  // as "advance the chain by one step".
  if (leaveHasApproverChain(leave)) {
    if (status !== LeaveStatus.PENDING) return null;
    const current = String(leave.currentApproverUserId ?? '').trim();
    if (current && current === id) return 'hr';
    return null;
  }

  const assigned = String(leave.assignedManagerId ?? '').trim();
  if (status === LeaveStatus.PENDING && assigned && id === assigned) {
    return 'manager';
  }
  if (status === LeaveStatus.MANAGER_APPROVED && isHrLeaveApprover(userRole)) {
    return 'hr';
  }
  if (status === LeaveStatus.PENDING && !assigned && isHrLeaveApprover(userRole)) {
    return 'hr';
  }
  return null;
}

export function canRejectLeave(
  leave: LeaveRequest,
  userId: string | undefined,
  userRole: Role | string | undefined
): boolean {
  const status = String(leave.status).toUpperCase();
  const id = String(userId ?? '').trim();

  if (leaveHasApproverChain(leave)) {
    if (status !== LeaveStatus.PENDING) return false;
    const current = String(leave.currentApproverUserId ?? '').trim();
    return !!current && current === id;
  }

  if (!['PENDING', LeaveStatus.MANAGER_APPROVED].includes(status)) return false;
  if (isHrLeaveApprover(userRole)) return true;
  const assigned = String(leave.assignedManagerId ?? '').trim();
  return status === LeaveStatus.PENDING && !!assigned && id === assigned;
}

/** Same actors who can reject may return a request to the submitter. */
export function canReturnLeave(
  leave: LeaveRequest,
  userId: string | undefined,
  userRole: Role | string | undefined
): boolean {
  return canRejectLeave(leave, userId, userRole);
}

/** Accessible label for leave approve actions — always "Approve". */
export function leaveApproveActionTitle(
  _leave: Pick<LeaveRequest, 'assignedApprovers' | 'approvalProgress'>,
  _action: LeaveApprovalAction
): string {
  return 'Approve';
}

export function leaveNeedsActionFilter(leave: LeaveRequest, userId?: string, userRole?: Role): boolean {
  const action = leaveApprovalActionForUser(leave, userId, userRole);
  return action === 'manager' || action === 'hr';
}

export type LeaveApproverUserLike = { name?: string; email?: string; departmentId?: string };

export type LeaveApproverTrackingLine = {
  key: string;
  label: string;
  name: string;
};

/** Manager / HR names shown under status for approval tracking. */
export function leaveApproverTrackingLines(
  leave: LeaveRequest,
  usersMap: Record<string, LeaveApproverUserLike | undefined>
): LeaveApproverTrackingLine[] {
  return resolveLeaveApprovalSteps(leave, usersMap).map(workflowApprovalStepToTrackingLine);
}
