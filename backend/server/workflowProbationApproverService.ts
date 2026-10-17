import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import {
  PROBATION_FINAL_APPROVER_CONFIG,
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

export type ProbationApproverRecord = {
  id: string;
  reviewId: string;
  userId: string;
  userName: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
};

function toProbationRecord(row: ChainApproverRecord): ProbationApproverRecord {
  return {
    id: row.id,
    reviewId: row.entityId,
    userId: row.userId,
    userName: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
  };
}

export async function ensureProbationApproversTable(): Promise<void> {
  await ensureWorkflowApprovalStepsConsolidated();
}

export async function resolveAssignedProbationApproversForSubmit(input: {
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

export async function replaceProbationApprovers(
  reviewId: string,
  userIds: string[]
): Promise<void> {
  await replaceChainApprovers(PROBATION_FINAL_APPROVER_CONFIG, reviewId, userIds);
}

export async function loadProbationApprovers(
  reviewId: string
): Promise<ProbationApproverRecord[]> {
  const rows = await loadChainApprovers(PROBATION_FINAL_APPROVER_CONFIG, reviewId);
  return rows.map(toProbationRecord);
}

export async function loadProbationApproversBatch(
  reviewIds: string[]
): Promise<Map<string, ProbationApproverRecord[]>> {
  const map = await loadChainApproversBatch(PROBATION_FINAL_APPROVER_CONFIG, reviewIds);
  const out = new Map<string, ProbationApproverRecord[]>();
  for (const [id, rows] of map) {
    out.set(id, rows.map(toProbationRecord));
  }
  return out;
}

export function getCurrentPendingProbationApprover(
  approvers: ProbationApproverRecord[]
): ProbationApproverRecord | null {
  const current = getCurrentPendingChainApprover(
    approvers.map((row) => ({ ...row, entityId: row.reviewId }))
  );
  return current ? toProbationRecord(current) : null;
}

export function probationRequiresActorApproval(
  approvers: ProbationApproverRecord[],
  actorId: string
): boolean {
  const id = String(actorId ?? '').trim();
  if (!id || !approvers.length) return false;
  const current = getCurrentPendingProbationApprover(approvers);
  return Boolean(current && current.userId === id);
}

export function approverChainPhase(
  approvers: ProbationApproverRecord[],
  entry: ProbationApproverRecord
): 'approved' | 'current' | 'queued' {
  return chainApproverPhase(
    approvers.map((row) => ({ ...row, entityId: row.reviewId })),
    { ...entry, entityId: entry.reviewId }
  );
}

export function allProbationApproversApproved(approvers: ProbationApproverRecord[]): boolean {
  return approvers.length > 0 && approvers.every((row) => row.status === 'approved');
}

export async function markProbationApproverApproved(
  reviewId: string,
  userId: string
): Promise<void> {
  await markChainApproverApproved(PROBATION_FINAL_APPROVER_CONFIG, reviewId, userId);
}

export function serializeProbationApproversForDto(approvers: ProbationApproverRecord[]) {
  const sorted = [...approvers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = getCurrentPendingProbationApprover(sorted);
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
    approvalProgress:
      sorted.length > 0 ? { approved: approvedCount, total: sorted.length } : null,
  };
}

const PROBATION_APPROVAL_LINK = '/performance?tab=probation&view=approval';

function probationEvalLink(employeeUserId: string): string {
  return `/performance?tab=probation&userId=${encodeURIComponent(employeeUserId)}`;
}

function probationApprovalLink(reviewId?: string): string {
  if (reviewId) {
    return `${PROBATION_APPROVAL_LINK}&reviewId=${encodeURIComponent(reviewId)}`;
  }
  return PROBATION_APPROVAL_LINK;
}

export async function loadProbationNotificationMeta(reviewId: string): Promise<{
  employeeName: string;
  employeeUserId: string | null;
  hrSubmittedByUserId: string | null;
}> {
  const rows = (await sequelize.query(
    `SELECT er.userId AS employeeUserId, er.assignedHrUserId AS hrSubmittedByUserId,
            CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')) AS employeeName
     FROM employeereviews er
     LEFT JOIN users u ON u.id = er.userId
     LEFT JOIN employees e ON e.id = u.employeeId
     WHERE er.id = :id AND er.reviewType = 'PROBATION'
     LIMIT 1`,
    { replacements: { id: reviewId }, type: QueryTypes.SELECT }
  )) as Array<{
    employeeName?: string;
    employeeUserId?: string | null;
    hrSubmittedByUserId?: string | null;
  }>;
  const meta = rows[0];
  return {
    employeeName: String(meta?.employeeName ?? '').trim() || 'Employee',
    employeeUserId: meta?.employeeUserId ? String(meta.employeeUserId) : null,
    hrSubmittedByUserId: meta?.hrSubmittedByUserId ? String(meta.hrSubmittedByUserId) : null,
  };
}

export async function notifyProbationApprovalTurn(input: {
  reviewId: string;
  employeeName: string;
  approverUserId: string;
  stepLabel?: string;
}): Promise<void> {
  const userId = String(input.approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `probation-approval-turn-${input.reviewId}-${userId}`,
      title: 'Probation review awaiting your approval',
      message: `Probation decision for ${input.employeeName} is ready for your review.${input.stepLabel ? ` ${input.stepLabel}` : ''}`,
      type: 'WARNING',
      link: probationApprovalLink(input.reviewId),
      entityId: input.reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[probation] notifyProbationApprovalTurn failed:', err);
  }
}

export async function notifyProbationApproverAssigned(input: {
  reviewId: string;
  employeeName: string;
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
      id: `probation-approval-assigned-${input.reviewId}-${userId}`,
      title: 'Assigned as probation approver',
      message: `You are step ${input.stepNumber} of ${input.totalSteps} in the approval chain for ${input.employeeName}'s probation review. You will be notified when it is your turn.`,
      type: 'INFO',
      link: probationApprovalLink(input.reviewId),
      entityId: input.reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[probation] notifyProbationApproverAssigned failed:', err);
  }
}

export async function notifyProbationApproversOnSubmit(
  reviewId: string,
  approvers: ProbationApproverRecord[]
): Promise<void> {
  if (!approvers.length) return;
  try {
    const meta = await loadProbationNotificationMeta(reviewId);
    const total = approvers.length;
    for (let index = 0; index < approvers.length; index += 1) {
      const entry = approvers[index];
      const step = index + 1;
      if (step === 1) {
        await notifyProbationApprovalTurn({
          reviewId,
          employeeName: meta.employeeName,
          approverUserId: entry.userId,
          stepLabel: total > 1 ? `(Step 1 of ${total})` : undefined,
        });
      } else {
        await notifyProbationApproverAssigned({
          reviewId,
          employeeName: meta.employeeName,
          approverUserId: entry.userId,
          stepNumber: step,
          totalSteps: total,
        });
      }
    }
  } catch (err) {
    console.error('[probation] notifyProbationApproversOnSubmit failed:', err);
  }
}

export async function notifyNextProbationApproverTurn(
  reviewId: string,
  approvers: ProbationApproverRecord[]
): Promise<void> {
  const next = getCurrentPendingProbationApprover(approvers);
  if (!next) return;
  const approvedCount = approvers.filter((row) => row.status === 'approved').length;
  const meta = await loadProbationNotificationMeta(reviewId);
  await notifyProbationApprovalTurn({
    reviewId,
    employeeName: meta.employeeName,
    approverUserId: next.userId,
    stepLabel: `(Step ${approvedCount + 1} of ${approvers.length})`,
  });
}

export type ProbationWorkflowFinishOutcome = 'approved' | 'rejected' | 'returned';

export async function notifyProbationWorkflowFinished(input: {
  reviewId: string;
  outcome: ProbationWorkflowFinishOutcome;
  approvers?: ProbationApproverRecord[];
}): Promise<void> {
  try {
    const approvers =
      input.approvers ?? (await loadProbationApprovers(input.reviewId));
    const meta = await loadProbationNotificationMeta(input.reviewId);
    const { createNotification } = await import('./notificationService.js');

    const outcomeLabel =
      input.outcome === 'approved'
        ? 'approved and finalized'
        : input.outcome === 'rejected'
          ? 'rejected'
          : 'returned to HR';

    const notifyIds = new Set<string>();
    if (meta.hrSubmittedByUserId) notifyIds.add(meta.hrSubmittedByUserId);
    if (meta.employeeUserId) notifyIds.add(meta.employeeUserId);
    for (const entry of approvers) notifyIds.add(entry.userId);

    for (const userId of notifyIds) {
      const isEmployee = meta.employeeUserId && userId === meta.employeeUserId;
      await createNotification({
        userId,
        id: `probation-workflow-finished-${input.reviewId}-${input.outcome}-${userId}`,
        title: `Probation review ${outcomeLabel}`,
        message: `The probation review for ${meta.employeeName} has been ${outcomeLabel}.`,
        type: input.outcome === 'approved' ? 'SUCCESS' : 'INFO',
        link: isEmployee
          ? '/my-performance?tab=action'
          : input.outcome === 'approved'
            ? meta.employeeUserId
              ? probationEvalLink(meta.employeeUserId)
              : '/performance?tab=probation'
            : probationApprovalLink(input.reviewId),
        entityId: meta.employeeUserId || input.reviewId,
        entityType: 'PROBATION',
      });
    }
  } catch (err) {
    console.error('[probation] notifyProbationWorkflowFinished failed:', err);
  }
}

export async function notifyProbationRoutedToManager(input: {
  reviewId: string;
  employeeName: string;
  managerUserId: string;
  employeeUserId?: string;
}): Promise<void> {
  const userId = String(input.managerUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    const meta = input.employeeUserId
      ? { employeeUserId: input.employeeUserId }
      : await loadProbationNotificationMeta(input.reviewId);
    const employeeUserId = String(meta.employeeUserId ?? '').trim();
    await createNotification({
      userId,
      id: `probation-routed-${input.reviewId}-${userId}`,
      title: 'Probation review assigned to you',
      message: `You have been assigned to evaluate ${input.employeeName}'s probation review.`,
      type: 'WARNING',
      link: employeeUserId ? probationEvalLink(employeeUserId) : '/performance?tab=probation',
      entityId: employeeUserId || input.reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[probation] notifyProbationRoutedToManager failed:', err);
  }
}

export async function notifyProbationEmployeeSelfEval(input: {
  reviewId: string;
  employeeUserId: string;
  employeeName: string;
}): Promise<void> {
  const userId = String(input.employeeUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `probation-self-eval-${input.reviewId}`,
      title: 'Complete your probation self-evaluation',
      message: 'Your manager has submitted their evaluation. Please complete your self-evaluation.',
      type: 'WARNING',
      link: '/my-performance?tab=action',
      entityId: input.reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[probation] notifyProbationEmployeeSelfEval failed:', err);
  }
}

export async function notifyProbationPendingHr(input: {
  reviewId: string;
  hrUserId: string;
  employeeName: string;
  employeeUserId?: string;
}): Promise<void> {
  const userId = String(input.hrUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    const meta = input.employeeUserId
      ? { employeeUserId: input.employeeUserId }
      : await loadProbationNotificationMeta(input.reviewId);
    const employeeUserId = String(meta.employeeUserId ?? input.employeeUserId ?? '').trim();
    await createNotification({
      userId,
      id: `probation-pending-hr-${input.reviewId}`,
      title: 'Probation review ready for HR decision',
      message: `${input.employeeName} has completed self-evaluation. The probation review is ready for your decision.`,
      type: 'WARNING',
      link: employeeUserId ? probationEvalLink(employeeUserId) : '/performance?tab=probation',
      entityId: employeeUserId || input.reviewId,
      entityType: 'PROBATION',
    });
  } catch (err) {
    console.error('[probation] notifyProbationPendingHr failed:', err);
  }
}
