import {
  MOVEMENT_APPROVER_CONFIG,
  chainApproverPhase,
  getCurrentPendingChainApprover,
  loadChainApprovers,
  loadChainApproversBatch,
  markAllChainApproversApproved,
  markChainApproverApproved,
  replaceChainApprovers,
  serializeChainApproversForDto,
  type ChainApproverRecord,
} from './workflowChainApproverService.js';
import { ensureWorkflowApprovalStepsConsolidated } from './workflowApprovalStepsSchema.js';
import { validateAssignedApproverUserIds } from './workflowApproverService.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';

export type MovementApproverRecord = {
  id: string;
  movementId: string;
  userId: string;
  userName: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
};

function toMovementRecord(row: ChainApproverRecord): MovementApproverRecord {
  return {
    id: row.id,
    movementId: row.entityId,
    userId: row.userId,
    userName: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
  };
}

export async function ensureMovementApproversTable(): Promise<void> {
  await ensureWorkflowApprovalStepsConsolidated();
}

export async function resolveAssignedApproversForCreate(input: {
  assignedApproverUserIds?: unknown;
  assignedApproverUserId?: unknown;
  saveAsDraft?: boolean;
  createdBy?: string | null;
}): Promise<string[]> {
  if (input.saveAsDraft) return [];
  const raw =
    input.assignedApproverUserIds ??
    (input.assignedApproverUserId != null && String(input.assignedApproverUserId).trim()
      ? [input.assignedApproverUserId]
      : []);
  return validateAssignedApproverUserIds(raw, input.createdBy ?? undefined);
}

export async function replaceMovementApprovers(
  movementId: string,
  userIds: string[]
): Promise<void> {
  await replaceChainApprovers(MOVEMENT_APPROVER_CONFIG, movementId, userIds);
}

export async function loadMovementApprovers(
  movementId: string
): Promise<MovementApproverRecord[]> {
  const rows = await loadChainApprovers(MOVEMENT_APPROVER_CONFIG, movementId);
  return rows.map(toMovementRecord);
}

export async function loadMovementApproversBatch(
  movementIds: string[]
): Promise<Map<string, MovementApproverRecord[]>> {
  const map = await loadChainApproversBatch(MOVEMENT_APPROVER_CONFIG, movementIds);
  const out = new Map<string, MovementApproverRecord[]>();
  for (const [id, rows] of map) {
    out.set(id, rows.map(toMovementRecord));
  }
  return out;
}

export function getCurrentPendingApprover(
  approvers: MovementApproverRecord[]
): MovementApproverRecord | null {
  const current = getCurrentPendingChainApprover(
    approvers.map((row) => ({ ...row, entityId: row.movementId }))
  );
  return current ? toMovementRecord(current) : null;
}

export function isCurrentMovementApprover(
  approvers: MovementApproverRecord[],
  actorId: string
): boolean {
  return movementRequiresActorApproval(approvers, actorId);
}

export function movementRequiresActorApproval(
  approvers: MovementApproverRecord[],
  actorId: string
): boolean {
  const id = String(actorId ?? '').trim();
  if (!id || !approvers.length) return false;
  const current = getCurrentPendingApprover(approvers);
  return Boolean(current && current.userId === id);
}

export function approverChainPhase(
  approvers: MovementApproverRecord[],
  entry: MovementApproverRecord
): 'approved' | 'current' | 'queued' {
  return chainApproverPhase(
    approvers.map((row) => ({ ...row, entityId: row.movementId })),
    { ...entry, entityId: entry.movementId }
  );
}

export function allMovementApproversApproved(approvers: MovementApproverRecord[]): boolean {
  return approvers.length > 0 && approvers.every((row) => row.status === 'approved');
}

export async function markMovementApproverApproved(
  movementId: string,
  userId: string
): Promise<void> {
  await markChainApproverApproved(MOVEMENT_APPROVER_CONFIG, movementId, userId);
}

export async function markAllMovementApproversApproved(movementId: string): Promise<void> {
  await markAllChainApproversApproved(MOVEMENT_APPROVER_CONFIG, movementId);
}

export function serializeMovementApproversForDto(approvers: MovementApproverRecord[]) {
  return serializeChainApproversForDto(
    approvers.map((row) => ({ ...row, entityId: row.movementId }))
  );
}

const MOVEMENT_APPROVAL_DASHBOARD_LINK = '/approvals/movements';

function movementApprovalLink(movementId: string): string {
  return `${MOVEMENT_APPROVAL_DASHBOARD_LINK}?movementId=${encodeURIComponent(movementId)}`;
}

export async function notifyMovementApprovalTurn(input: {
  movementId: string;
  employeeName: string;
  movementTypeLabel: string;
  approverUserId: string;
  stepLabel?: string;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `movement-approval-turn-${input.movementId}-${userId}`,
      title: 'Movement awaiting your approval',
      message: `${input.movementTypeLabel} for ${input.employeeName} is ready for your review.${input.stepLabel ? ` ${input.stepLabel}` : ''}`,
      type: 'WARNING',
      link: movementApprovalLink(input.movementId),
      entityId: input.movementId,
      entityType: 'MOVEMENT',
    });
  } catch (err) {
    console.error('[movement] notifyMovementApprovalTurn failed:', err);
  }
}

export async function notifyMovementApproverAssigned(input: {
  movementId: string;
  employeeName: string;
  movementTypeLabel: string;
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
      id: `movement-approval-assigned-${input.movementId}-${userId}`,
      title: 'Assigned as movement approver',
      message: `You are step ${input.stepNumber} of ${input.totalSteps} in the approval chain for ${input.movementTypeLabel} (${input.employeeName}). You will be notified when it is your turn to review.`,
      type: 'INFO',
      link: movementApprovalLink(input.movementId),
      entityId: input.movementId,
      entityType: 'MOVEMENT',
    });
  } catch (err) {
    console.error('[movement] notifyMovementApproverAssigned failed:', err);
  }
}

export async function notifyMovementApproversOnSubmit(
  movementId: string,
  approvers: MovementApproverRecord[],
  meta: { employeeName: string; movementTypeLabel: string }
): Promise<void> {
  if (!approvers.length) return;
  try {
    const total = approvers.length;
    for (let index = 0; index < approvers.length; index += 1) {
      const entry = approvers[index];
      const step = index + 1;
      if (step === 1) {
        await notifyMovementApprovalTurn({
          movementId,
          employeeName: meta.employeeName,
          movementTypeLabel: meta.movementTypeLabel,
          approverUserId: entry.userId,
          stepLabel: total > 1 ? `(Step 1 of ${total})` : undefined,
        });
      } else {
        await notifyMovementApproverAssigned({
          movementId,
          employeeName: meta.employeeName,
          movementTypeLabel: meta.movementTypeLabel,
          approverUserId: entry.userId,
          stepNumber: step,
          totalSteps: total,
        });
      }
    }
  } catch (err) {
    console.error('[movement] notifyMovementApproversOnSubmit failed:', err);
  }
}

export async function notifyNextMovementApproverTurn(
  movementId: string,
  approvers: MovementApproverRecord[],
  meta: { employeeName: string; movementTypeLabel: string }
): Promise<void> {
  const next = getCurrentPendingApprover(approvers);
  if (!next) return;
  const approvedCount = approvers.filter((row) => row.status === 'approved').length;
  await notifyMovementApprovalTurn({
    movementId,
    employeeName: meta.employeeName,
    movementTypeLabel: meta.movementTypeLabel,
    approverUserId: next.userId,
    stepLabel: `(Step ${approvedCount + 1} of ${approvers.length})`,
  });
}

export type MovementNotificationContext = {
  employeeName: string;
  movementTypeLabel: string;
  submitterUserId: string | null;
};

export type MovementWorkflowFinishOutcome = 'approved' | 'rejected' | 'returned';

export async function loadMovementNotificationContext(
  movementId: string
): Promise<MovementNotificationContext> {
  const { QueryTypes } = await import('sequelize');
  const { sequelize } = await import('./db.js');
  const { Employee } = await import('./db.js');
  const { movementTypeLabelForNotify } = await import('./employeeMovementNotify.js');

  const movement: any = await sequelize.query(
    `SELECT movement_type, employee_id, created_by FROM employee_movements WHERE id = :id LIMIT 1`,
    { replacements: { id: movementId }, type: QueryTypes.SELECT }
  );
  const plain = (movement as Array<Record<string, unknown>>)[0];
  if (!plain) {
    return { employeeName: 'Employee', movementTypeLabel: 'Movement', submitterUserId: null };
  }

  const emp: any = await Employee.findOne({
    where: { employee_id: String(plain.employee_id ?? '') },
    attributes: ['first_name', 'last_name'],
    raw: true,
  });
  const employeeName = emp
    ? joinEmployeeNameParts(emp.first_name, emp.last_name) || 'Employee'
    : 'Employee';

  return {
    employeeName,
    movementTypeLabel: movementTypeLabelForNotify(String(plain.movement_type ?? '')),
    submitterUserId: plain.created_by ? String(plain.created_by) : null,
  };
}

export async function notifyMovementWorkflowFinished(input: {
  movementId: string;
  outcome: MovementWorkflowFinishOutcome;
  approvers?: MovementApproverRecord[];
  appliedImmediately?: boolean;
}): Promise<void> {
  try {
    const approvers =
      input.approvers ?? (await loadMovementApprovers(input.movementId));
    const ctx = await loadMovementNotificationContext(input.movementId);
    const recipientIds = new Set<string>();

    for (const row of approvers) {
      if (row.userId) recipientIds.add(row.userId);
    }
    if (ctx.submitterUserId) recipientIds.add(ctx.submitterUserId);

    if (!approvers.length) {
      const { QueryTypes } = await import('sequelize');
      const { sequelize } = await import('./db.js');
      const legacyRows = (await sequelize.query(
        `SELECT assigned_approver_user_id, approved_by, created_by
         FROM employee_movements WHERE id = :id LIMIT 1`,
        { replacements: { id: input.movementId }, type: QueryTypes.SELECT }
      )) as Array<{
        assigned_approver_user_id?: string | null;
        approved_by?: string | null;
        created_by?: string | null;
      }>;
      const legacy = legacyRows[0];
      if (legacy?.assigned_approver_user_id) {
        recipientIds.add(String(legacy.assigned_approver_user_id));
      }
      if (legacy?.approved_by) recipientIds.add(String(legacy.approved_by));
      if (legacy?.created_by) recipientIds.add(String(legacy.created_by));
    }

    if (!recipientIds.size) return;

    const { createNotification } = await import('./notificationService.js');
    const appliedNote = input.appliedImmediately
      ? ' The change has been applied.'
      : input.outcome === 'approved'
        ? ' It is approved and will apply on the effective date.'
        : '';

    const copy = {
      approved: {
        title: 'Movement approval complete',
        message: `${ctx.movementTypeLabel} for ${ctx.employeeName} is fully approved.${appliedNote}`,
        type: 'SUCCESS' as const,
      },
      rejected: {
        title: 'Movement approval rejected',
        message: `${ctx.movementTypeLabel} for ${ctx.employeeName} was rejected and will not proceed.`,
        type: 'WARNING' as const,
      },
      returned: {
        title: 'Movement returned for revision',
        message: `${ctx.movementTypeLabel} for ${ctx.employeeName} was returned to the submitter for revision.`,
        type: 'WARNING' as const,
      },
    }[input.outcome];

    for (const userId of recipientIds) {
      const isSubmitter = Boolean(ctx.submitterUserId && userId === ctx.submitterUserId);
      const link =
        input.outcome === 'returned' && isSubmitter
          ? `/employees/movements/view?movementId=${encodeURIComponent(input.movementId)}&step=1`
          : movementApprovalLink(input.movementId);
      await createNotification({
        userId,
        id: `movement-finished-${input.outcome}-${input.movementId}-${userId}`,
        title: copy.title,
        message: copy.message,
        type: copy.type,
        link,
        entityId: input.movementId,
        entityType: 'MOVEMENT',
      });
    }
  } catch (err) {
    console.error('[movement] notifyMovementWorkflowFinished failed:', err);
  }
}
