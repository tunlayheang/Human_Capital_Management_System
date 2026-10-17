import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import { validateAssignedApproverUserIds } from './workflowApproverService.js';
import {
  ensureWorkflowApprovalStepsConsolidated,
  WORKFLOW_APPROVAL_STEPS_TABLE,
  type WorkflowApprovalEntityType,
} from './workflowApprovalStepsSchema.js';

/**
 * Generic ordered multi-approver chain stored in `workflow_approval_steps`.
 *
 * All modules (leave, overtime, movement, appraisal, probation, payroll) share
 * one table keyed by (entity_type, entity_id). `sort_order` defines the sequence;
 * only the current pending approver may act.
 */
export type ChainApproverConfig = {
  entityType: WorkflowApprovalEntityType;
  /** Id prefix for generated rows, e.g. `la`. */
  idPrefix: string;
  /** Human label used in notifications, e.g. `Leave request`. */
  entityLabel: string;
  /** Link approvers are sent to from notifications. */
  dashboardLink: string;
};

export const LEAVE_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'leave',
  idPrefix: 'la',
  entityLabel: 'Leave request',
  dashboardLink: '/leaves?scope=manage&tab=requests',
};

export const OVERTIME_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'overtime',
  idPrefix: 'oa',
  entityLabel: 'Overtime request',
  dashboardLink: '/overtime?scope=manage&tab=requests',
};

export const MOVEMENT_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'movement',
  idPrefix: 'ma',
  entityLabel: 'Movement',
  dashboardLink: '/approvals/movements',
};

export const APPRAISAL_FINAL_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'appraisal_final',
  idPrefix: 'aa',
  entityLabel: 'Appraisal final approval',
  dashboardLink: '/performance?tab=kpi-appraisals',
};

/**
 * Ordered chain of management evaluators for a KPI appraisal. Unlike final
 * approvers, the appraisal workflow keeps `assigned_manager_user_id` pointed at
 * whichever evaluator's turn it currently is.
 */
export const APPRAISAL_EVALUATOR_CONFIG: ChainApproverConfig = {
  entityType: 'appraisal_eval',
  idPrefix: 'aev',
  entityLabel: 'Appraisal evaluation',
  dashboardLink: '/performance?tab=kpi-appraisals',
};

export const PROBATION_FINAL_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'probation_final',
  idPrefix: 'pa',
  entityLabel: 'Probation final approval',
  dashboardLink: '/performance?tab=probation',
};

/** Ordered chain of management evaluators for a probation review. */
export const PROBATION_EVALUATOR_CONFIG: ChainApproverConfig = {
  entityType: 'probation_eval',
  idPrefix: 'pev',
  entityLabel: 'Probation evaluation',
  dashboardLink: '/performance?tab=probation',
};

export const PAYROLL_RUN_APPROVER_CONFIG: ChainApproverConfig = {
  entityType: 'payroll_run',
  idPrefix: 'pra',
  entityLabel: 'Payroll run',
  dashboardLink: '/approvals/payroll',
};

export type ChainApproverRecord = {
  id: string;
  entityId: string;
  userId: string;
  userName: string | null;
  status: 'pending' | 'approved';
  approvedAt: string | null;
  sortOrder: number;
};


export async function ensureChainApproverTable(_cfg?: ChainApproverConfig): Promise<void> {
  await ensureWorkflowApprovalStepsConsolidated();
}

/** Preserve requester selection order (first selected = sort_order 0 = approves first). */
function uniqueIdsInOrder(ids: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Validate + normalise requester-selected approver ids (no self-assignment). */
export async function resolveAssignedChainApprovers(input: {
  assignedApproverUserIds?: unknown;
  assignedApproverUserId?: unknown;
  requesterUserId?: string | null;
}): Promise<string[]> {
  const rawList = Array.isArray(input.assignedApproverUserIds)
    ? input.assignedApproverUserIds
    : input.assignedApproverUserIds != null && String(input.assignedApproverUserIds).trim()
      ? [input.assignedApproverUserIds]
      : input.assignedApproverUserId != null && String(input.assignedApproverUserId).trim()
        ? [input.assignedApproverUserId]
        : [];
  const cleaned = uniqueIdsInOrder(rawList);
  // Empty selection is allowed here: callers treat it as "no chain / legacy".
  if (!cleaned.length) return [];
  // Keep selection order — do not reorder by role/tier.
  return validateAssignedApproverUserIds(cleaned, input.requesterUserId ?? undefined);
}

export async function replaceChainApprovers(
  cfg: ChainApproverConfig,
  entityId: string,
  userIds: string[]
): Promise<void> {
  await ensureChainApproverTable(cfg);
  const entity = String(entityId).trim();
  if (!entity) return;

  await sequelize.query(
    `DELETE FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     WHERE entity_type = ? AND entity_id = ?`,
    { replacements: [cfg.entityType, entity] }
  );

  if (!userIds.length) return;

  // Selection order only: index 0 is the first approver in the chain.
  const ordered = uniqueIdsInOrder(userIds);

  const now = new Date().toISOString();
  for (let i = 0; i < ordered.length; i += 1) {
    const userId = ordered[i];
    await sequelize.query(
      `INSERT INTO \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
        (id, entity_type, entity_id, user_id, status, approved_at, sort_order, created_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      { replacements: [`${cfg.idPrefix}-${entity}-${userId}`, cfg.entityType, entity, userId, i, now] }
    );
  }
}

async function hydrateApproverNames(
  rows: Omit<ChainApproverRecord, 'userName'>[]
): Promise<ChainApproverRecord[]> {
  if (!rows.length) return [];
  // Prefer employee full name over users.display_name (often empty for staff accounts).
  const { buildAuditActorMap } = await import('./userAccountService.js');
  const actors = await buildAuditActorMap(rows.map((row) => row.userId));
  return rows.map((row) => {
    const actor = actors.get(String(row.userId));
    const fromActor = String(actor?.name ?? '').trim();
    const fromEmail = String(actor?.email ?? '').trim();
    const label =
      (fromActor && fromActor !== 'User' ? fromActor : '') ||
      (fromEmail.includes('@') ? fromEmail.split('@')[0]?.trim() : fromEmail) ||
      null;
    return {
      ...row,
      // Keep null only when the user truly cannot be resolved; UI must not fall back to raw ids.
      userName: label || null,
    };
  });
}

export async function loadChainApprovers(
  cfg: ChainApproverConfig,
  entityId: string
): Promise<ChainApproverRecord[]> {
  await ensureChainApproverTable(cfg);
  const entity = String(entityId).trim();
  if (!entity) return [];

  const rows = (await sequelize.query(
    `SELECT id, entity_id AS entityId, user_id AS userId, status,
            approved_at AS approvedAt, sort_order AS sortOrder
     FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY sort_order ASC, created_at ASC`,
    { replacements: [cfg.entityType, entity], type: QueryTypes.SELECT }
  )) as Omit<ChainApproverRecord, 'userName'>[];

  return hydrateApproverNames(rows);
}

export async function loadChainApproversBatch(
  cfg: ChainApproverConfig,
  entityIds: string[]
): Promise<Map<string, ChainApproverRecord[]>> {
  await ensureChainApproverTable(cfg);
  const ids = [...new Set(entityIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, ChainApproverRecord[]>();
  if (!ids.length) return map;

  const rows = (await sequelize.query(
    `SELECT id, entity_id AS entityId, user_id AS userId, status,
            approved_at AS approvedAt, sort_order AS sortOrder
     FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     WHERE entity_type = :entityType AND entity_id IN (:entityIds)
     ORDER BY sort_order ASC, created_at ASC`,
    {
      replacements: { entityType: cfg.entityType, entityIds: ids },
      type: QueryTypes.SELECT,
    }
  )) as Omit<ChainApproverRecord, 'userName'>[];

  const grouped = new Map<string, Omit<ChainApproverRecord, 'userName'>[]>();
  for (const row of rows) {
    const list = grouped.get(row.entityId) ?? [];
    list.push(row);
    grouped.set(row.entityId, list);
  }
  for (const [entityId, list] of grouped) {
    map.set(entityId, await hydrateApproverNames(list));
  }
  return map;
}

export function getCurrentPendingChainApprover(
  approvers: ChainApproverRecord[]
): ChainApproverRecord | null {
  const sorted = [...approvers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  return sorted.find((row) => row.status === 'pending') ?? null;
}

export function chainRequiresActorApproval(
  approvers: ChainApproverRecord[],
  actorId: string
): boolean {
  const id = String(actorId ?? '').trim();
  if (!id || !approvers.length) return false;
  const current = getCurrentPendingChainApprover(approvers);
  return Boolean(current && current.userId === id);
}

/** Actor is somewhere in the chain (used for inbox visibility, not authority). */
export function actorInChain(approvers: ChainApproverRecord[], actorId: string): boolean {
  const id = String(actorId ?? '').trim();
  return Boolean(id) && approvers.some((row) => row.userId === id);
}

export function allChainApproversApproved(approvers: ChainApproverRecord[]): boolean {
  return approvers.length > 0 && approvers.every((row) => row.status === 'approved');
}

export function chainApproverPhase(
  approvers: ChainApproverRecord[],
  entry: ChainApproverRecord
): 'approved' | 'current' | 'queued' {
  if (entry.status === 'approved') return 'approved';
  const current = getCurrentPendingChainApprover(approvers);
  if (current?.userId === entry.userId) return 'current';
  return 'queued';
}

export async function markChainApproverApproved(
  cfg: ChainApproverConfig,
  entityId: string,
  userId: string
): Promise<void> {
  const actorId = String(userId ?? '').trim();
  if (!actorId) return;

  // Only the current pending step (lowest sort_order still pending) may approve.
  const approvers = await loadChainApprovers(cfg, entityId);
  const current = getCurrentPendingChainApprover(approvers);
  if (!current || current.userId !== actorId) {
    throw Object.assign(
      new Error('It is not your turn to approve. Wait for the previous approver to finish.'),
      { status: 403, code: 'APPROVER_OUT_OF_SEQUENCE' }
    );
  }

  const now = new Date().toISOString();
  await sequelize.query(
    `UPDATE \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     SET status = 'approved', approved_at = ?
     WHERE entity_type = ? AND entity_id = ? AND user_id = ? AND status = 'pending'
       AND sort_order = ?`,
    { replacements: [now, cfg.entityType, entityId, actorId, current.sortOrder] }
  );
}

export async function markAllChainApproversApproved(
  cfg: ChainApproverConfig,
  entityId: string
): Promise<void> {
  const now = new Date().toISOString();
  await sequelize.query(
    `UPDATE \`${WORKFLOW_APPROVAL_STEPS_TABLE}\`
     SET status = 'approved', approved_at = COALESCE(approved_at, ?)
     WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
    { replacements: [now, cfg.entityType, entityId] }
  );
}

export function serializeChainApproversForDto(approvers: ChainApproverRecord[]) {
  const sorted = [...approvers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.userId.localeCompare(b.userId)
  );
  const current = getCurrentPendingChainApprover(sorted);
  const assignedApproverUserIds = sorted.map((row) => row.userId);
  const assignedApprovers = sorted.map((row) => ({
    userId: row.userId,
    name: row.userName,
    status: row.status,
    approvedAt: row.approvedAt,
    sortOrder: row.sortOrder,
    phase: chainApproverPhase(sorted, row),
  }));
  const approvedCount = sorted.filter((row) => row.status === 'approved').length;
  return {
    assignedApproverUserIds,
    assignedApprovers,
    assignedApproverUserId: assignedApproverUserIds[0] ?? null,
    assignedApproverName: assignedApprovers[0]?.name ?? null,
    currentApproverUserId: current?.userId ?? null,
    currentApproverName: current?.userName ?? null,
    approvalProgress:
      sorted.length > 0 ? { approved: approvedCount, total: sorted.length } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

async function notifyApprovalTurn(
  cfg: ChainApproverConfig,
  entityId: string,
  approverUserId: string,
  summary: string,
  stepLabel?: string
): Promise<void> {
  const userId = String(approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `${cfg.idPrefix}-turn-${entityId}-${userId}`,
      title: `${cfg.entityLabel} awaiting your approval`,
      message: `${summary} is ready for your review.${stepLabel ? ` ${stepLabel}` : ''}`,
      type: 'WARNING',
      link: cfg.dashboardLink,
    });
  } catch (err) {
    console.error(`[${cfg.idPrefix}] notifyApprovalTurn failed:`, err);
  }
}

async function notifyApproverAssigned(
  cfg: ChainApproverConfig,
  entityId: string,
  approverUserId: string,
  summary: string,
  stepNumber: number,
  totalSteps: number
): Promise<void> {
  const userId = String(approverUserId ?? '').trim();
  if (!userId) return;
  try {
    const { createNotification } = await import('./notificationService.js');
    await createNotification({
      userId,
      id: `${cfg.idPrefix}-assigned-${entityId}-${userId}`,
      title: `Assigned as ${cfg.entityLabel.toLowerCase()} approver`,
      message: `You are step ${stepNumber} of ${totalSteps} in the approval chain for ${summary}. You will be notified when it is your turn.`,
      type: 'INFO',
      link: cfg.dashboardLink,
    });
  } catch (err) {
    console.error(`[${cfg.idPrefix}] notifyApproverAssigned failed:`, err);
  }
}

export async function notifyChainApproversOnSubmit(
  cfg: ChainApproverConfig,
  entityId: string,
  approvers: ChainApproverRecord[],
  summary: string
): Promise<void> {
  if (!approvers.length) return;
  const total = approvers.length;
  for (let index = 0; index < approvers.length; index += 1) {
    const entry = approvers[index];
    const step = index + 1;
    if (step === 1) {
      await notifyApprovalTurn(
        cfg,
        entityId,
        entry.userId,
        summary,
        total > 1 ? `(Step 1 of ${total})` : undefined
      );
    } else {
      await notifyApproverAssigned(cfg, entityId, entry.userId, summary, step, total);
    }
  }
}

export async function notifyNextChainApproverTurn(
  cfg: ChainApproverConfig,
  entityId: string,
  approvers: ChainApproverRecord[],
  summary: string
): Promise<void> {
  const next = getCurrentPendingChainApprover(approvers);
  if (!next) return;
  const approvedCount = approvers.filter((row) => row.status === 'approved').length;
  await notifyApprovalTurn(
    cfg,
    entityId,
    next.userId,
    summary,
    `(Step ${approvedCount + 1} of ${approvers.length})`
  );
}

export type ChainWorkflowOutcome = 'approved' | 'rejected' | 'cancelled';

export async function countCurrentChainActionsForActor(
  cfg: ChainApproverConfig,
  actorId: string,
  join: {
    table: string;
    statusColumn?: string;
    allowedStatuses: string[];
  }
): Promise<number> {
  await ensureChainApproverTable(cfg);
  const id = String(actorId ?? '').trim();
  if (!id) return 0;

  const statusColumn = join.statusColumn ?? 'status';
  const allowed = join.allowedStatuses.map((s) => String(s).toUpperCase());
  if (!allowed.length) return 0;

  const rows = (await sequelize.query(
    `SELECT COUNT(DISTINCT was.entity_id) AS cnt
     FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\` was
     INNER JOIN \`${join.table}\` parent ON parent.id = was.entity_id
     WHERE was.entity_type = :entityType
       AND was.user_id = :actorId
       AND was.status = 'pending'
       AND UPPER(parent.\`${statusColumn}\`) IN (:allowedStatuses)
       AND was.sort_order = (
         SELECT MIN(w2.sort_order)
         FROM \`${WORKFLOW_APPROVAL_STEPS_TABLE}\` w2
         WHERE w2.entity_type = was.entity_type
           AND w2.entity_id = was.entity_id
           AND w2.status = 'pending'
       )`,
    {
      replacements: { entityType: cfg.entityType, actorId: id, allowedStatuses: allowed },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ cnt?: number | string }>;

  return Number(rows[0]?.cnt ?? 0);
}

export async function notifyChainWorkflowFinished(input: {
  cfg: ChainApproverConfig;
  entityId: string;
  outcome: ChainWorkflowOutcome;
  approvers: ChainApproverRecord[];
  submitterUserId?: string | null;
  summary: string;
}): Promise<void> {
  try {
    const recipientIds = new Set<string>();
    for (const row of input.approvers) {
      if (row.userId) recipientIds.add(row.userId);
    }
    if (input.submitterUserId) recipientIds.add(String(input.submitterUserId));
    if (!recipientIds.size) return;

    const { createNotification } = await import('./notificationService.js');
    const copy = {
      approved: {
        title: `${input.cfg.entityLabel} approved`,
        message: `${input.summary} is fully approved.`,
        type: 'SUCCESS' as const,
      },
      rejected: {
        title: `${input.cfg.entityLabel} rejected`,
        message: `${input.summary} was rejected and will not proceed.`,
        type: 'WARNING' as const,
      },
      cancelled: {
        title: `${input.cfg.entityLabel} cancelled`,
        message: `${input.summary} was withdrawn by the requester.`,
        type: 'INFO' as const,
      },
    }[input.outcome];

    for (const userId of recipientIds) {
      await createNotification({
        userId,
        id: `${input.cfg.idPrefix}-finished-${input.outcome}-${input.entityId}-${userId}`,
        title: copy.title,
        message: copy.message,
        type: copy.type,
        link: input.cfg.dashboardLink,
      });
    }
  } catch (err) {
    console.error(`[${input.cfg.idPrefix}] notifyChainWorkflowFinished failed:`, err);
  }
}
