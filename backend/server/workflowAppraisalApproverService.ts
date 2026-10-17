import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import {
  APPRAISAL_FINAL_APPROVER_CONFIG,
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

export type AppraisalApproverRecord = {
  id: string;
  appraisalId: string;
  userId: string;
  userName: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
};

function toAppraisalRecord(row: ChainApproverRecord): AppraisalApproverRecord {
  return {
    id: row.id,
    appraisalId: row.entityId,
    userId: row.userId,
    userName: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
  };
}

export async function ensureAppraisalApproversTable(): Promise<void> {
  await ensureWorkflowApprovalStepsConsolidated();
}

export async function resolveAssignedFinalApproversForSubmit(input: {
  assignedFinalApproverUserIds?: unknown;
  assignedFinalApproverUserId?: unknown;
  actorId?: string | null;
}): Promise<string[]> {
  const raw =
    input.assignedFinalApproverUserIds ??
    (input.assignedFinalApproverUserId != null && String(input.assignedFinalApproverUserId).trim()
      ? [input.assignedFinalApproverUserId]
      : []);
  return validateAssignedApproverUserIds(raw, input.actorId ?? undefined);
}

export async function replaceAppraisalApprovers(
  appraisalId: string,
  userIds: string[]
): Promise<void> {
  await replaceChainApprovers(APPRAISAL_FINAL_APPROVER_CONFIG, appraisalId, userIds);
}

export async function loadAppraisalApprovers(
  appraisalId: string
): Promise<AppraisalApproverRecord[]> {
  const rows = await loadChainApprovers(APPRAISAL_FINAL_APPROVER_CONFIG, appraisalId);
  return rows.map(toAppraisalRecord);
}

export async function loadAppraisalApproversBatch(
  appraisalIds: string[]
): Promise<Map<string, AppraisalApproverRecord[]>> {
  const map = await loadChainApproversBatch(APPRAISAL_FINAL_APPROVER_CONFIG, appraisalIds);
  const out = new Map<string, AppraisalApproverRecord[]>();
  for (const [id, rows] of map) {
    out.set(id, rows.map(toAppraisalRecord));
  }
  return out;
}

export function getCurrentPendingAppraisalApprover(
  approvers: AppraisalApproverRecord[]
): AppraisalApproverRecord | null {
  const current = getCurrentPendingChainApprover(
    approvers.map((row) => ({ ...row, entityId: row.appraisalId }))
  );
  return current ? toAppraisalRecord(current) : null;
}

export function isCurrentAppraisalApprover(
  approvers: AppraisalApproverRecord[],
  actorId: string
): boolean {
  return appraisalRequiresActorApproval(approvers, actorId);
}

export function appraisalRequiresActorApproval(
  approvers: AppraisalApproverRecord[],
  actorId: string
): boolean {
  const id = String(actorId ?? '').trim();
  if (!id || !approvers.length) return false;
  const current = getCurrentPendingAppraisalApprover(approvers);
  return Boolean(current && current.userId === id);
}

export function approverChainPhase(
  approvers: AppraisalApproverRecord[],
  entry: AppraisalApproverRecord
): 'approved' | 'current' | 'queued' {
  return chainApproverPhase(
    approvers.map((row) => ({ ...row, entityId: row.appraisalId })),
    { ...entry, entityId: entry.appraisalId }
  );
}

export function allAppraisalApproversApproved(approvers: AppraisalApproverRecord[]): boolean {
  return approvers.length > 0 && approvers.every((row) => row.status === 'approved');
}

export async function markAppraisalApproverApproved(
  appraisalId: string,
  userId: string
): Promise<void> {
  await markChainApproverApproved(APPRAISAL_FINAL_APPROVER_CONFIG, appraisalId, userId);
}

export function serializeAppraisalApproversForDto(approvers: AppraisalApproverRecord[]) {
  const sorted = [...approvers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = getCurrentPendingAppraisalApprover(sorted);
  const assignedFinalApproverUserIds = sorted.map((row) => row.userId);
  const assignedFinalApprovers = sorted.map((row) => ({
    userId: row.userId,
    name: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
    phase: approverChainPhase(sorted, row),
  }));
  const approvedCount = sorted.filter((row) => row.status === 'approved').length;
  return {
    assignedFinalApproverUserIds,
    assignedFinalApprovers,
    assigned_final_approver_user_id: assignedFinalApproverUserIds[0] ?? null,
    assignedFinalApproverName: assignedFinalApprovers[0]?.name ?? null,
    currentApproverUserId: current?.userId ?? null,
    currentApproverName: current?.userName ?? null,
    approvalProgress:
      sorted.length > 0 ? { approved: approvedCount, total: sorted.length } : null,
  };
}

export type AppraisalNotificationMeta = {
  employeeName: string;
  periodName: string | null;
};

export type AppraisalNotificationContext = AppraisalNotificationMeta & {
  employeeUserId: string | null;
  hrSubmittedByUserId: string | null;
  finalApprovedByUserId: string | null;
  rejectedByUserId: string | null;
  returnedByUserId: string | null;
};

const APPRAISAL_APPROVAL_DASHBOARD_LINK = '/performance?tab=kpi-appraisals&view=approval';
const APPRAISAL_EMPLOYEE_LINK = '/my-performance?tab=action';

function appraisalApprovalLink(appraisalId: string): string {
  return `${APPRAISAL_APPROVAL_DASHBOARD_LINK}&appraisalId=${encodeURIComponent(appraisalId)}`;
}

function appraisalEmployeeLink(appraisalId: string): string {
  return `${APPRAISAL_EMPLOYEE_LINK}&appraisalId=${encodeURIComponent(appraisalId)}`;
}

export async function loadAppraisalNotificationMeta(
  appraisalId: string
): Promise<AppraisalNotificationMeta> {
  const ctx = await loadAppraisalNotificationContext(appraisalId);
  return {
    employeeName: ctx.employeeName,
    periodName: ctx.periodName,
  };
}

export async function loadAppraisalNotificationContext(
  appraisalId: string
): Promise<AppraisalNotificationContext> {
  const { QueryTypes } = await import('sequelize');
  const { sequelize } = await import('./db.js');
  const { APPRAISAL_EMPLOYEE_NAME_EXPR, APPRAISAL_EMPLOYEE_JOINS } = await import(
    './appraisal/appraisalQuerySql.js'
  );
  const rows = (await sequelize.query(
    `SELECT ${APPRAISAL_EMPLOYEE_NAME_EXPR}, ap.name AS periodName,
            ea.user_id AS employeeUserId, ea.hr_approved_by AS hrSubmittedByUserId,
            ea.final_approved_by AS finalApprovedByUserId,
            ea.rejected_by AS rejectedByUserId, ea.returned_by AS returnedByUserId
     FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     ${APPRAISAL_EMPLOYEE_JOINS}
     WHERE ea.id = :id LIMIT 1`,
    { replacements: { id: appraisalId }, type: QueryTypes.SELECT }
  )) as Array<{
    employeeName?: string;
    periodName?: string;
    employeeUserId?: string | null;
    hrSubmittedByUserId?: string | null;
    finalApprovedByUserId?: string | null;
    rejectedByUserId?: string | null;
    returnedByUserId?: string | null;
  }>;
  const meta = rows[0];
  return {
    employeeName: String(meta?.employeeName ?? '').trim() || 'Employee',
    periodName: meta?.periodName ? String(meta.periodName) : null,
    employeeUserId: meta?.employeeUserId ? String(meta.employeeUserId) : null,
    hrSubmittedByUserId: meta?.hrSubmittedByUserId ? String(meta.hrSubmittedByUserId) : null,
    finalApprovedByUserId: meta?.finalApprovedByUserId
      ? String(meta.finalApprovedByUserId)
      : null,
    rejectedByUserId: meta?.rejectedByUserId ? String(meta.rejectedByUserId) : null,
    returnedByUserId: meta?.returnedByUserId ? String(meta.returnedByUserId) : null,
  };
}

/** Alert the current approver that an appraisal is ready for their review. */
export async function notifyAppraisalApprovalTurn(input: {
  appraisalId: string;
  employeeName: string;
  periodName?: string | null;
  approverUserId: string;
  stepLabel?: string;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    const period = input.periodName ? ` (${input.periodName})` : '';
    await createNotification({
      userId,
      id: `appraisal-approval-turn-${input.appraisalId}-${userId}`,
      title: 'Appraisal awaiting your approval',
      message: `Final approval for ${input.employeeName}${period} is ready for your review.${input.stepLabel ? ` ${input.stepLabel}` : ''}`,
      type: 'WARNING',
      link: appraisalApprovalLink(input.appraisalId),
      entityId: input.appraisalId,
      entityType: 'APPRAISAL',
    });
  } catch (err) {
    console.error('[appraisal] notifyAppraisalApprovalTurn failed:', err);
  }
}

/** Inform a queued approver they are assigned in the chain (not their turn yet). */
export async function notifyAppraisalApproverAssigned(input: {
  appraisalId: string;
  employeeName: string;
  periodName?: string | null;
  approverUserId: string;
  stepNumber: number;
  totalSteps: number;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    const period = input.periodName ? ` (${input.periodName})` : '';
    await createNotification({
      userId,
      id: `appraisal-approval-assigned-${input.appraisalId}-${userId}`,
      title: 'Assigned as appraisal approver',
      message: `You are step ${input.stepNumber} of ${input.totalSteps} in the final approval chain for ${input.employeeName}${period}. You will be notified when it is your turn to review.`,
      type: 'INFO',
      link: appraisalApprovalLink(input.appraisalId),
      entityId: input.appraisalId,
      entityType: 'APPRAISAL',
    });
  } catch (err) {
    console.error('[appraisal] notifyAppraisalApproverAssigned failed:', err);
  }
}

/** Notify every selected approver when HR submits for final approval. */
export async function notifyAppraisalApproversOnSubmit(
  appraisalId: string,
  approvers: AppraisalApproverRecord[]
): Promise<void> {
  if (!approvers.length) return;
  try {
    const meta = await loadAppraisalNotificationMeta(appraisalId);
    const total = approvers.length;
    for (let index = 0; index < approvers.length; index += 1) {
      const entry = approvers[index];
      const step = index + 1;
      if (step === 1) {
        await notifyAppraisalApprovalTurn({
          appraisalId,
          employeeName: meta.employeeName,
          periodName: meta.periodName,
          approverUserId: entry.userId,
          stepLabel: total > 1 ? `(Step 1 of ${total})` : undefined,
        });
      } else {
        await notifyAppraisalApproverAssigned({
          appraisalId,
          employeeName: meta.employeeName,
          periodName: meta.periodName,
          approverUserId: entry.userId,
          stepNumber: step,
          totalSteps: total,
        });
      }
    }
  } catch (err) {
    console.error('[appraisal] notifyAppraisalApproversOnSubmit failed:', err);
  }
}

/** Notify the next approver after a partial sign-off in the chain. */
export async function notifyNextAppraisalApproverTurn(
  appraisalId: string,
  approvers: AppraisalApproverRecord[]
): Promise<void> {
  const next = getCurrentPendingAppraisalApprover(approvers);
  if (!next) return;
  const approvedCount = approvers.filter((row) => row.status === 'approved').length;
  const meta = await loadAppraisalNotificationMeta(appraisalId);
  await notifyAppraisalApprovalTurn({
    appraisalId,
    employeeName: meta.employeeName,
    periodName: meta.periodName,
    approverUserId: next.userId,
    stepLabel: `(Step ${approvedCount + 1} of ${approvers.length})`,
  });
}

export type AppraisalWorkflowFinishOutcome = 'approved' | 'rejected' | 'returned';

/** Notify everyone involved when final approval workflow reaches a terminal outcome. */
export async function notifyAppraisalWorkflowFinished(input: {
  appraisalId: string;
  outcome: AppraisalWorkflowFinishOutcome;
  approvers?: AppraisalApproverRecord[];
}): Promise<void> {
  try {
    const approvers =
      input.approvers ??
      (await loadAppraisalApprovers(input.appraisalId));
    const ctx = await loadAppraisalNotificationContext(input.appraisalId);
    const period = ctx.periodName ? ` (${ctx.periodName})` : '';
    const recipientIds = new Set<string>();

    for (const row of approvers) {
      if (row.userId) recipientIds.add(row.userId);
    }
    if (ctx.hrSubmittedByUserId) recipientIds.add(ctx.hrSubmittedByUserId);
    if (input.outcome === 'approved' && ctx.finalApprovedByUserId) {
      recipientIds.add(ctx.finalApprovedByUserId);
    }
    if (input.outcome === 'rejected' && ctx.rejectedByUserId) {
      recipientIds.add(ctx.rejectedByUserId);
    }
    if (input.outcome === 'returned' && ctx.returnedByUserId) {
      recipientIds.add(ctx.returnedByUserId);
    }
    if (input.outcome === 'approved' && ctx.employeeUserId) {
      recipientIds.add(ctx.employeeUserId);
    }

    if (!recipientIds.size) return;

    const { createNotification } = await import('./notificationService.js');
    const copy = {
      approved: {
        title: 'Appraisal approval complete',
        message: `Final approval for ${ctx.employeeName}${period} is complete. All required sign-offs are recorded and the appraisal is approved.`,
        type: 'SUCCESS' as const,
      },
      rejected: {
        title: 'Appraisal approval rejected',
        message: `Final approval for ${ctx.employeeName}${period} was rejected and will not proceed.`,
        type: 'WARNING' as const,
      },
      returned: {
        title: 'Appraisal returned to HR',
        message: `Final approval for ${ctx.employeeName}${period} was returned to HR for revision.`,
        type: 'WARNING' as const,
      },
    }[input.outcome];

    for (const userId of recipientIds) {
      const link =
        input.outcome === 'approved' && userId === ctx.employeeUserId
          ? appraisalEmployeeLink(input.appraisalId)
          : appraisalApprovalLink(input.appraisalId);
      await createNotification({
        userId,
        id: `appraisal-finished-${input.outcome}-${input.appraisalId}-${userId}`,
        title: copy.title,
        message: copy.message,
        type: copy.type,
        link,
        entityId: input.appraisalId,
        entityType: 'APPRAISAL',
      });
    }
  } catch (err) {
    console.error('[appraisal] notifyAppraisalWorkflowFinished failed:', err);
  }
}
