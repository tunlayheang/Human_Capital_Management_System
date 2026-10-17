import type { LeaveRequest, OvertimeRequest, WorkflowAssignedApprover } from '../types';
import { LeaveStatus } from '../types';
import { leaveHasApproverChain, type LeaveApproverUserLike } from './leaveWorkflow';

export type WorkflowApprovalStepPhase =
  | 'approved'
  | 'current'
  | 'queued'
  | 'rejected'
  /** Later steps that will not run after an earlier rejection. */
  | 'skipped';

export type WorkflowApprovalStep = {
  key: string;
  label: string;
  name: string;
  phase: WorkflowApprovalStepPhase;
};

/**
 * When the request is rejected:
 * - the active reviewer becomes Rejected
 * - later queued steps become Skipped (will not run)
 */
function applyTerminalRequestStatus(
  steps: WorkflowApprovalStep[],
  status: string
): WorkflowApprovalStep[] {
  const s = String(status).toUpperCase();
  if (s === 'REJECTED') {
    return steps.map((step) => {
      if (step.phase === 'current') return { ...step, phase: 'rejected' as const };
      if (step.phase === 'queued') return { ...step, phase: 'skipped' as const };
      return step;
    });
  }
  if (s === 'CANCELLED') {
    return [];
  }
  return steps;
}

function resolveUserName(
  userId: string | null | undefined,
  usersMap: Record<string, LeaveApproverUserLike | undefined>
): string | undefined {
  const id = String(userId ?? '').trim();
  if (!id) return undefined;
  const u = usersMap[id];
  return u?.name?.trim() || u?.email?.trim() || id;
}

function chainToSteps(
  chain: WorkflowAssignedApprover[],
  usersMap: Record<string, LeaveApproverUserLike | undefined>
): WorkflowApprovalStep[] {
  const ordered = [...chain].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  return ordered.map((entry, index) => ({
    key: entry.userId,
    label: ordered.length > 1 ? `Step ${index + 1}` : 'Approver',
    name: entry.name?.trim() || resolveUserName(entry.userId, usersMap) || entry.userId,
    phase:
      entry.phase === 'approved'
        ? 'approved'
        : entry.phase === 'current'
          ? 'current'
          : 'queued',
  }));
}

/** Ordered approval steps for leave requests (chain or legacy manager → HR). */
export function resolveLeaveApprovalSteps(
  leave: LeaveRequest,
  usersMap: Record<string, LeaveApproverUserLike | undefined> = {}
): WorkflowApprovalStep[] {
  const status = String(leave.status).toUpperCase();

  if (leaveHasApproverChain(leave)) {
    return applyTerminalRequestStatus(
      chainToSteps(leave.assignedApprovers ?? [], usersMap),
      status
    );
  }

  if (status === LeaveStatus.REJECTED || status === LeaveStatus.CANCELLED) {
    return [];
  }

  const assignedName = resolveUserName(leave.assignedManagerId, usersMap);
  const managerName = resolveUserName(leave.managerApprovedBy, usersMap);
  const hrName = resolveUserName(leave.hrApprovedBy, usersMap);

  if (status === LeaveStatus.APPROVED) {
    return [
      {
        key: 'manager',
        label: 'Manager',
        name: managerName || assignedName || '—',
        phase: 'approved',
      },
      { key: 'hr', label: 'HR', name: hrName || '—', phase: 'approved' },
    ];
  }

  if (status === LeaveStatus.MANAGER_APPROVED) {
    return [
      {
        key: 'manager',
        label: 'Manager',
        name: managerName || assignedName || '—',
        phase: 'approved',
      },
      { key: 'hr', label: 'HR', name: 'Pending review', phase: 'current' },
    ];
  }

  if (status === LeaveStatus.PENDING) {
    if (assignedName) {
      return [
        { key: 'manager', label: 'Manager', name: assignedName, phase: 'current' },
        { key: 'hr', label: 'HR', name: 'Up next', phase: 'queued' },
      ];
    }
    return [
      {
        key: 'hr',
        label: 'HR',
        name: 'Pending (no manager assigned)',
        phase: 'current',
      },
    ];
  }

  return [];
}

/** Ordered approval steps for overtime requests (approver chain only). */
export function resolveOvertimeApprovalSteps(
  request: Pick<OvertimeRequest, 'assignedApprovers' | 'status'>,
  usersMap: Record<string, LeaveApproverUserLike | undefined> = {}
): WorkflowApprovalStep[] {
  const chain = request.assignedApprovers ?? [];
  if (!chain.length) return [];
  return applyTerminalRequestStatus(chainToSteps(chain, usersMap), request.status);
}

/** Text lines for PDF / compact legacy displays. */
export function workflowApprovalStepToTrackingLine(step: WorkflowApprovalStep): {
  key: string;
  label: string;
  name: string;
} {
  let name = step.name;
  if (step.phase === 'approved') name = `${step.name} ✓`;
  else if (step.phase === 'rejected') name = `${step.name} ✕`;
  else if (step.phase === 'current') {
    if (step.name !== 'Up next' && step.name !== 'Pending review') {
      name = `${step.name} (pending)`;
    }
  }   else if (step.phase === 'skipped') {
    name = `${step.name} (skipped)`;
  } else if (step.phase === 'queued' && step.name === 'Up next') {
    name = '(waiting)';
  } else if (step.phase === 'queued') {
    name = `${step.name} (waiting)`;
  }
  return { key: step.key, label: step.label, name };
}
