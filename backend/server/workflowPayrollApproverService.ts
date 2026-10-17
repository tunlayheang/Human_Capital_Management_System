import {
  PAYROLL_RUN_APPROVER_CONFIG,
  chainApproverPhase,
  getCurrentPendingChainApprover,
  loadChainApprovers,
  loadChainApproversBatch,
  markChainApproverApproved,
  replaceChainApprovers,
  type ChainApproverRecord,
} from './workflowChainApproverService.js';
import { ensureWorkflowApprovalStepsConsolidated } from './workflowApprovalStepsSchema.js';
import { validateAssignedApproverUserIds } from './workflowApproverService.js';

export type PayrollApproverRecord = {
  id: string;
  runId: string;
  userId: string;
  userName: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
};

function toPayrollRecord(row: ChainApproverRecord): PayrollApproverRecord {
  return {
    id: row.id,
    runId: row.entityId,
    userId: row.userId,
    userName: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
  };
}

const PAYROLL_APPROVAL_LINK = '/approvals/payroll';

export async function ensurePayrollApproversTable(): Promise<void> {
  await ensureWorkflowApprovalStepsConsolidated();
}

export async function resolveAssignedPayrollApproversForSubmit(input: {
  assignedApproverUserIds?: unknown;
  assignedApproverUserId?: unknown;
  actorId?: string | null;
}): Promise<string[]> {
  const raw =
    input.assignedApproverUserIds ??
    (input.assignedApproverUserId != null && String(input.assignedApproverUserId).trim()
      ? [input.assignedApproverUserId]
      : []);
  return validateAssignedApproverUserIds(raw, input.actorId ?? undefined);
}

export async function replacePayrollApprovers(runId: string, userIds: string[]): Promise<void> {
  await replaceChainApprovers(PAYROLL_RUN_APPROVER_CONFIG, runId, userIds);
}

export async function loadPayrollApprovers(runId: string): Promise<PayrollApproverRecord[]> {
  const rows = await loadChainApprovers(PAYROLL_RUN_APPROVER_CONFIG, runId);
  return rows.map(toPayrollRecord);
}

export async function loadPayrollApproversBatch(
  runIds: string[]
): Promise<Map<string, PayrollApproverRecord[]>> {
  const map = await loadChainApproversBatch(PAYROLL_RUN_APPROVER_CONFIG, runIds);
  const out = new Map<string, PayrollApproverRecord[]>();
  for (const [id, rows] of map) {
    out.set(id, rows.map(toPayrollRecord));
  }
  return out;
}

export function getCurrentPendingPayrollApprover(
  approvers: PayrollApproverRecord[]
): PayrollApproverRecord | null {
  const current = getCurrentPendingChainApprover(
    approvers.map((row) => ({ ...row, entityId: row.runId }))
  );
  return current ? toPayrollRecord(current) : null;
}

export function payrollRequiresActorApproval(
  approvers: PayrollApproverRecord[],
  actorId: string
): boolean {
  const id = String(actorId ?? '').trim();
  if (!id || !approvers.length) return false;
  const current = getCurrentPendingPayrollApprover(approvers);
  return Boolean(current && current.userId === id);
}

export function approverChainPhase(
  approvers: PayrollApproverRecord[],
  entry: PayrollApproverRecord
): 'approved' | 'current' | 'queued' {
  return chainApproverPhase(
    approvers.map((row) => ({ ...row, entityId: row.runId })),
    { ...entry, entityId: entry.runId }
  );
}

export function allPayrollApproversApproved(approvers: PayrollApproverRecord[]): boolean {
  return approvers.length > 0 && approvers.every((row) => row.status === 'approved');
}

export async function markPayrollApproverApproved(runId: string, userId: string): Promise<void> {
  await markChainApproverApproved(PAYROLL_RUN_APPROVER_CONFIG, runId, userId);
}

export function serializePayrollApproversForDto(approvers: PayrollApproverRecord[]) {
  const sorted = [...approvers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = getCurrentPendingPayrollApprover(sorted);
  const assignedApproverUserIds = sorted.map((row) => row.userId);
  const assignedApprovers = sorted.map((row) => ({
    userId: row.userId,
    name: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
    phase: approverChainPhase(sorted, row),
  }));
  const approvedCount = sorted.filter((row) => row.status === 'approved').length;
  return {
    assignedApproverUserIds,
    assignedApprovers,
    currentApproverUserId: current?.userId ?? null,
    currentApproverName: current?.userName ?? null,
    approvalProgress: sorted.length > 0 ? { approved: approvedCount, total: sorted.length } : null,
  };
}

export function viewerIsAssignedPayrollApprover(
  approverFields: { assignedApproverUserIds?: string[] },
  actorId: string
): boolean {
  const ids = approverFields.assignedApproverUserIds ?? [];
  return ids.includes(actorId);
}

export async function notifyPayrollApprovalTurn(input: {
  runId: string;
  monthLabel: string;
  approverUserId: string;
  stepLabel?: string;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `payroll-approval-turn-${input.runId}-${userId}`,
      title: 'Payroll run awaiting your approval',
      message: `Payroll for ${input.monthLabel} is ready for your review.${input.stepLabel ? ` ${input.stepLabel}` : ''}`,
      type: 'WARNING',
      link: `/payroll/approvals/${input.runId}`,
    });
  } catch (err) {
    console.error('[payroll] notifyPayrollApprovalTurn failed:', err);
  }
}

export async function notifyPayrollApproverAssigned(input: {
  runId: string;
  monthLabel: string;
  approverUserId: string;
  stepNumber: number;
  totalSteps: number;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `payroll-approval-assigned-${input.runId}-${userId}`,
      title: 'Assigned as payroll approver',
      message: `You are step ${input.stepNumber} of ${input.totalSteps} in the approval chain for ${input.monthLabel} payroll. You will be notified when it is your turn.`,
      type: 'INFO',
      link: PAYROLL_APPROVAL_LINK,
    });
  } catch (err) {
    console.error('[payroll] notifyPayrollApproverAssigned failed:', err);
  }
}

export async function notifyPayrollApproversOnSubmit(
  runId: string,
  monthLabel: string,
  approvers: PayrollApproverRecord[]
): Promise<void> {
  if (!approvers.length) return;
  try {
    const total = approvers.length;
    for (let index = 0; index < approvers.length; index += 1) {
      const entry = approvers[index];
      const step = index + 1;
      if (step === 1) {
        await notifyPayrollApprovalTurn({
          runId,
          monthLabel,
          approverUserId: entry.userId,
          stepLabel: total > 1 ? `(Step 1 of ${total})` : undefined,
        });
      } else {
        await notifyPayrollApproverAssigned({
          runId,
          monthLabel,
          approverUserId: entry.userId,
          stepNumber: step,
          totalSteps: total,
        });
      }
    }
  } catch (err) {
    console.error('[payroll] notifyPayrollApproversOnSubmit failed:', err);
  }
}

export async function notifyNextPayrollApproverTurn(
  runId: string,
  monthLabel: string,
  approvers: PayrollApproverRecord[]
): Promise<void> {
  const next = getCurrentPendingPayrollApprover(approvers);
  if (!next) return;
  const approvedCount = approvers.filter((row) => row.status === 'approved').length;
  await notifyPayrollApprovalTurn({
    runId,
    monthLabel,
    approverUserId: next.userId,
    stepLabel: `(Step ${approvedCount + 1} of ${approvers.length})`,
  });
}

export async function notifyPayrollWorkflowFinished(input: {
  runId: string;
  monthLabel: string;
  outcome: 'approved' | 'rejected' | 'returned' | 'cancelled';
  calculatedByUserId?: string | null;
  approverUserIds?: string[];
}): Promise<void> {
  try {
    const { notifyUserIds } = await import('./notificationService.js');
    const titles = {
      approved: 'Payroll run approved',
      rejected: 'Payroll run rejected',
      returned: 'Payroll run returned for revision',
      cancelled: 'Payroll run cancelled',
    };
    const messages = {
      approved: `Payroll for ${input.monthLabel} was approved and finalized.`,
      rejected: `Payroll for ${input.monthLabel} was rejected.`,
      returned: `Payroll for ${input.monthLabel} was returned to the preparer for revision.`,
      cancelled: `Payroll for ${input.monthLabel} was cancelled by the preparer.`,
    };
    const type = input.outcome === 'approved' ? 'SUCCESS' : 'WARNING';
    const calculatedBy = String(input.calculatedByUserId ?? '').trim();
    const recipientIds = new Set<string>();
    if (calculatedBy) recipientIds.add(calculatedBy);
    let approverIds = input.approverUserIds;
    if (!approverIds?.length) {
      const { loadPayrollApprovers } = await import('./workflowPayrollApproverService.js');
      approverIds = (await loadPayrollApprovers(input.runId)).map((row) => row.userId);
    }
    for (const approverId of approverIds ?? []) {
      const trimmed = String(approverId).trim();
      if (trimmed) recipientIds.add(trimmed);
    }
    if (!recipientIds.size) return;
    await notifyUserIds([...recipientIds], {
      idPrefix: `payroll-workflow-finished-${input.runId}-${input.outcome}`,
      title: titles[input.outcome],
      message: messages[input.outcome],
      type,
      link: `/payroll/approvals/${input.runId}`,
    });
  } catch (err) {
    console.error('[payroll] notifyPayrollWorkflowFinished failed:', err);
  }
}
