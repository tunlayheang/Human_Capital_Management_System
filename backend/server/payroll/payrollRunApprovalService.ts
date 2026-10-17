import { Op, QueryTypes } from 'sequelize';
import { PayrollRun, sequelize } from '../db.js';
import {
  getEffectivePermissionsForUser,
  hasEffectivePermission,
} from '../effectivePermissions.js';
import {
  isPayrollSelfApprovalBlocked,
  isPayrollMakerCheckerEnforced,
} from './payrollMakerChecker.js';
import { normalizeLegacyRunStatus, transitionPayrollRun } from './payrollWorkflowService.js';

export type PayrollPendingApprovalItem = {
  runId: string;
  month: string;
  monthLabel: string;
  status: string;
  totalEmployees: number;
  totalNetPay: number;
  calculatedAt: string | null;
  calculatedBy: string | null;
  calculatedByName: string | null;
  assignedApproverUserIds: string[];
  assignedApprovers: Array<{
    userId: string;
    name: string | null;
    status: string;
    approvedAt: string | null;
    sortOrder: number;
    phase: 'approved' | 'current' | 'queued';
  }>;
  currentApproverUserId: string | null;
  currentApproverName: string | null;
  approvalProgress: { approved: number; total: number } | null;
  canApproverReview: boolean;
  selfApprovalBlocked: boolean;
  href: string;
  viewerApprovalCompletedAt?: string | null;
};

export type PayrollApprovalsInboxResponse = {
  queue: PayrollPendingApprovalItem[];
  history: PayrollPendingApprovalItem[];
  /** `all` for payroll staff viewing org-wide finalized runs; `personal` for approver sign-offs only. */
  historyScope: 'personal' | 'all';
};

function formatMonthLabel(month: string): string {
  const raw = String(month ?? '').trim();
  const match = /^(\d{4})-(\d{2})/.exec(raw);
  if (!match) return raw || 'Payroll period';
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const date = new Date(year, monthIndex, 1);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export async function actorCanProcessPayroll(viewer: {
  id?: string;
  role?: string;
}): Promise<boolean> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return false;
  const role = String(viewer?.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
  const perms = await getEffectivePermissionsForUser(actorId);
  return hasEffectivePermission(perms, 'hr.payroll.process', role);
}

async function actorCanViewAllPayrollApprovalHistory(viewer: {
  id?: string;
  role?: string;
}): Promise<boolean> {
  if (await actorCanProcessPayroll(viewer)) return true;
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return false;
  const role = String(viewer?.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
  const perms = await getEffectivePermissionsForUser(actorId);
  return hasEffectivePermission(perms, 'hr.payroll.view', role);
}

export async function actorCanApprovePayroll(viewer: {
  id?: string;
  userId?: string;
  role?: string;
}): Promise<boolean> {
  const actorId = String(viewer?.id ?? viewer?.userId ?? '').trim();
  if (!actorId) return false;
  const role = String(viewer?.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
  const perms = await getEffectivePermissionsForUser(actorId);
  return (
    hasEffectivePermission(perms, 'hr.payroll.approve', role) ||
    hasEffectivePermission(perms, 'hr.payroll.process', role) ||
    hasEffectivePermission(perms, 'hr.payroll.view', role)
  );
}

export async function assertPayrollRunReadAccess(
  runId: string,
  viewer: { id?: string; role?: string }
): Promise<void> {
  const actorId = String(viewer?.id ?? '').trim();
  const role = String(viewer?.role ?? '').toUpperCase();
  if (!actorId) {
    throw Object.assign(new Error('Forbidden: insufficient role permissions'), { statusCode: 403 });
  }
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return;

  const perms = await getEffectivePermissionsForUser(actorId);
  if (
    hasEffectivePermission(perms, 'hr.payroll.view', role) ||
    hasEffectivePermission(perms, 'hr.payroll.process', role)
  ) {
    return;
  }

  if (!hasEffectivePermission(perms, 'hr.payroll.approve', role)) {
    throw Object.assign(new Error('Forbidden: insufficient role permissions'), { statusCode: 403 });
  }

  const {
    ensurePayrollApproversTable,
    loadPayrollApprovers,
    serializePayrollApproversForDto,
  } = await import('../workflowPayrollApproverService.js');
  await ensurePayrollApproversTable();
  const approvers = await loadPayrollApprovers(String(runId).trim());
  const fields = serializePayrollApproversForDto(approvers);
  if (!viewerIsInApproverChain(fields, actorId)) {
    throw Object.assign(new Error('You are not assigned as an approver for this payroll run.'), {
      statusCode: 403,
    });
  }
}

export async function resolvePayrollApproverUserIdsForSubmit(input: {
  assignedApproverUserIds?: unknown;
  calculatedByUserId?: string | null;
}): Promise<string[]> {
  const { resolveAssignedPayrollApproversForSubmit } = await import(
    '../workflowPayrollApproverService.js'
  );
  const explicit = Array.isArray(input.assignedApproverUserIds)
    ? input.assignedApproverUserIds
    : [];
  if (!explicit.length) {
    throw Object.assign(
      new Error('Select at least one approver before submitting for approval.'),
      { statusCode: 400, code: 'APPROVER_REQUIRED' }
    );
  }
  return resolveAssignedPayrollApproversForSubmit({
    assignedApproverUserIds: explicit,
    actorId: input.calculatedByUserId ?? undefined,
  });
}

export async function updatePayrollRunApprovers(input: {
  runId: string;
  assignedApproverUserIds: unknown;
  actor: { userId: string; role?: string };
}): Promise<{ message: string }> {
  const runId = String(input.runId).trim();
  const actorId = String(input.actor.userId ?? '').trim();
  const role = String(input.actor.role ?? '').toUpperCase();

  const run: any = await PayrollRun.findByPk(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { statusCode: 404 });

  const status = String(run.status ?? '').toUpperCase();
  if (status !== 'PENDING_APPROVAL') {
    throw new Error('Only payroll runs awaiting approval can be routed to approvers.');
  }

  if (!(await actorCanProcessPayroll({ id: actorId, role }))) {
    throw Object.assign(new Error('You do not have permission to route payroll approvals.'), {
      statusCode: 403,
    });
  }

  const calculatedBy = run.calculatedBy ?? run.processedBy ?? null;
  const isPreparer = calculatedBy && String(calculatedBy) === actorId;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  if (!isPreparer && !isAdmin) {
    throw Object.assign(
      new Error('Only the payroll preparer or an administrator can change approver routing.'),
      { statusCode: 403 }
    );
  }

  const {
    ensurePayrollApproversTable,
    loadPayrollApprovers,
    replacePayrollApprovers,
    notifyPayrollApproversOnSubmit,
  } = await import('../workflowPayrollApproverService.js');

  await ensurePayrollApproversTable();
  const existing = await loadPayrollApprovers(runId);
  if (existing.some((row) => row.status === 'approved')) {
    throw new Error('Cannot change approvers after someone has already signed off.');
  }

  const userIds = await resolvePayrollApproverUserIdsForSubmit({
    assignedApproverUserIds: input.assignedApproverUserIds,
    calculatedByUserId: calculatedBy ? String(calculatedBy) : actorId,
  });

  await replacePayrollApprovers(runId, userIds);
  const approvers = await loadPayrollApprovers(runId);
  await notifyPayrollApproversOnSubmit(
    runId,
    formatMonthLabel(String(run.month ?? '')),
    approvers
  );

  return { message: 'Payroll run routed to the selected approver(s).' };
}

export async function assignPayrollRunApproversOnSubmit(
  runId: string,
  input: {
    month: string;
    assignedApproverUserIds?: unknown;
    calculatedByUserId?: string | null;
  }
): Promise<void> {
  const {
    ensurePayrollApproversTable,
    replacePayrollApprovers,
    loadPayrollApprovers,
    notifyPayrollApproversOnSubmit,
  } = await import('../workflowPayrollApproverService.js');

  await ensurePayrollApproversTable();
  const userIds = await resolvePayrollApproverUserIdsForSubmit({
    assignedApproverUserIds: input.assignedApproverUserIds,
    calculatedByUserId: input.calculatedByUserId,
  });
  await replacePayrollApprovers(runId, userIds);
  const approvers = await loadPayrollApprovers(runId);
  await notifyPayrollApproversOnSubmit(runId, formatMonthLabel(input.month), approvers);
}

function viewerIsInApproverChain(
  approverFields: { assignedApproverUserIds?: string[] },
  actorId: string
): boolean {
  return (approverFields.assignedApproverUserIds ?? []).includes(actorId);
}

async function buildPayrollApprovalItem(input: {
  row: Record<string, unknown>;
  actorId: string;
  actorRole?: string;
  approvers: Awaited<
    ReturnType<
      typeof import('../workflowPayrollApproverService.js').loadPayrollApprovers
    >
  >;
  canApproverReview?: boolean;
  viewerApprovalCompletedAt?: string | null;
}): Promise<PayrollPendingApprovalItem> {
  const { row, actorId, actorRole, approvers } = input;
  const runId = String(row.id ?? '');
  const {
    serializePayrollApproversForDto,
    payrollRequiresActorApproval,
  } = await import('../workflowPayrollApproverService.js');
  const { getUserDisplayName } = await import('../notificationService.js');

  const approverFields = serializePayrollApproversForDto(approvers);
  const calculatedBy = row.calculatedBy ?? row.processedBy ?? null;
  const selfApprovalBlocked = isPayrollSelfApprovalBlocked({
    calculatedBy: calculatedBy ? String(calculatedBy) : null,
    actorUserId: actorId,
    actorRole,
  });
  const mine = approvers.find((entry) => entry.userId === actorId);
  const canApproverReview =
    input.canApproverReview ??
    (payrollRequiresActorApproval(approvers, actorId) && !selfApprovalBlocked);
  const calculatedByName = calculatedBy
    ? await getUserDisplayName(String(calculatedBy)).catch(() => null)
    : null;

  return {
    runId,
    month: String(row.month ?? ''),
    monthLabel: formatMonthLabel(String(row.month ?? '')),
    status: normalizeLegacyRunStatus(String(row.status ?? 'DRAFT')),
    totalEmployees: Number(row.totalEmployees ?? 0),
    totalNetPay: Number(row.totalNetPay ?? 0),
    calculatedAt: row.calculatedAt ? String(row.calculatedAt) : row.createdAt ? String(row.createdAt) : null,
    calculatedBy: calculatedBy ? String(calculatedBy) : null,
    calculatedByName,
    assignedApproverUserIds: approverFields.assignedApproverUserIds,
    assignedApprovers: approverFields.assignedApprovers,
    currentApproverUserId: approverFields.currentApproverUserId,
    currentApproverName: approverFields.currentApproverName,
    approvalProgress: approverFields.approvalProgress,
    canApproverReview,
    selfApprovalBlocked,
    href: `/payroll/approvals/${runId}`,
    viewerApprovalCompletedAt:
      input.viewerApprovalCompletedAt ??
      (mine?.status === 'approved' ? mine.approvedAt ?? null : null),
  };
}

export async function listPendingPayrollRunsForCurrentApprover(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];
  if (!(await actorCanApprovePayroll(viewer))) return [];

  const {
    ensurePayrollApproversTable,
    loadPayrollApproversBatch,
    serializePayrollApproversForDto,
  } = await import('../workflowPayrollApproverService.js');

  await ensurePayrollApproversTable();

  const rows = (await PayrollRun.findAll({
    where: { status: 'PENDING_APPROVAL' },
    order: [['calculatedAt', 'DESC'], ['createdAt', 'DESC']],
    limit: 100,
    raw: true,
  })) as Array<Record<string, unknown>>;

  const approverMap = await loadPayrollApproversBatch(
    rows.map((row) => String(row.id ?? ''))
  );

  const items: PayrollPendingApprovalItem[] = [];
  for (const row of rows) {
    const runId = String(row.id ?? '');
    const approvers = approverMap.get(runId) ?? [];
    const approverFields = serializePayrollApproversForDto(approvers);
    if (!viewerIsInApproverChain(approverFields, actorId)) continue;

    items.push(
      await buildPayrollApprovalItem({
        row,
        actorId,
        actorRole: viewer.role,
        approvers,
      })
    );
  }

  return items.sort((a, b) => {
    const aAction = a.canApproverReview ? 0 : 1;
    const bAction = b.canApproverReview ? 0 : 1;
    if (aAction !== bAction) return aAction - bAction;
    return String(b.month).localeCompare(String(a.month));
  });
}

/** All payroll runs visible on the Payroll Approval page (every status, scoped by role). */
export async function listPayrollRunsForApprovalBoard(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) {
    throw Object.assign(new Error('Forbidden: insufficient role permissions'), { statusCode: 403 });
  }
  if (!(await actorCanApprovePayroll(viewer))) {
    throw Object.assign(new Error('You do not have permission to view payroll approvals.'), {
      statusCode: 403,
    });
  }

  const canViewAll = await actorCanViewAllPayrollApprovalHistory(viewer);
  let rows: Array<Record<string, unknown>>;

  if (canViewAll) {
    rows = (await PayrollRun.findAll({
      order: [
        ['calculatedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      limit: 200,
      raw: true,
    })) as Array<Record<string, unknown>>;
  } else {
    const {
      ensurePayrollApproversTable,
    } = await import('../workflowPayrollApproverService.js');
    await ensurePayrollApproversTable();

    const runIdRows = (await sequelize.query(
      `SELECT DISTINCT run.id AS runId,
              COALESCE(run.calculatedAt, run.createdAt, run.lockedAt) AS sortAt
       FROM payrollruns run
       WHERE EXISTS (
         SELECT 1
         FROM workflow_approval_steps was
         WHERE was.entity_type = 'payroll_run'
           AND was.entity_id = run.id
           AND was.user_id = :actorId
       )
       ORDER BY sortAt DESC
       LIMIT 200`,
      { replacements: { actorId }, type: QueryTypes.SELECT }
    )) as Array<{ runId: string }>;

    const ids = runIdRows.map((row) => String(row.runId ?? '').trim()).filter(Boolean);
    if (!ids.length) return [];

    rows = (await PayrollRun.findAll({
      where: { id: { [Op.in]: ids } },
      order: [
        ['calculatedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      raw: true,
    })) as Array<Record<string, unknown>>;
  }

  if (!rows.length) return [];

  const { enrichPayrollRunsList } = await import('./payrollRunDisplayService.js');
  const {
    ensurePayrollApproversTable,
    loadPayrollApproversBatch,
  } = await import('../workflowPayrollApproverService.js');
  await ensurePayrollApproversTable();

  const enriched = await enrichPayrollRunsList(rows);
  const approverMap = await loadPayrollApproversBatch(
    enriched.map((row) => String(row.id ?? ''))
  );

  const items: PayrollPendingApprovalItem[] = [];
  for (const row of enriched) {
    const runId = String(row.id ?? '');
    const approvers = approverMap.get(runId) ?? [];
    const mine = approvers.find((entry) => entry.userId === actorId);
    items.push(
      await buildPayrollApprovalItem({
        row,
        actorId,
        actorRole: viewer.role,
        approvers,
        viewerApprovalCompletedAt: mine?.status === 'approved' ? mine.approvedAt ?? null : null,
      })
    );
  }

  return items.sort((a, b) => String(b.month).localeCompare(String(a.month)));
}

type HistoryRunRef = { runId: string; viewerApprovalCompletedAt: string | null };

async function buildPayrollApprovalHistoryItems(
  viewer: { id?: string; role?: string },
  runRefs: HistoryRunRef[]
): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  const runIds = runRefs.map((row) => String(row.runId ?? '').trim()).filter(Boolean);
  if (!runIds.length) return [];

  const completedAtByRunId = new Map(
    runRefs.map((row) => [String(row.runId), row.viewerApprovalCompletedAt ?? null])
  );

  const runs = (await PayrollRun.findAll({
    where: { id: { [Op.in]: runIds } },
    raw: true,
  })) as Array<Record<string, unknown>>;
  const runById = new Map(runs.map((row) => [String(row.id ?? ''), row]));

  const { loadPayrollApproversBatch } = await import('../workflowPayrollApproverService.js');
  const approverMap = await loadPayrollApproversBatch(runIds);

  const items: PayrollPendingApprovalItem[] = [];
  for (const runId of runIds) {
    const row = runById.get(runId);
    if (!row) continue;
    const approvers = approverMap.get(runId) ?? [];
    items.push(
      await buildPayrollApprovalItem({
        row,
        actorId,
        actorRole: viewer.role,
        approvers,
        canApproverReview: false,
        viewerApprovalCompletedAt: completedAtByRunId.get(runId) ?? null,
      })
    );
  }

  return items;
}

async function listPayrollApprovalHistoryPersonal(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];

  const {
    ensurePayrollApproversTable,
  } = await import('../workflowPayrollApproverService.js');
  await ensurePayrollApproversTable();

  const runIdRows = (await sequelize.query(
    `SELECT runId, viewerApprovalCompletedAt
     FROM (
       SELECT was.entity_id AS runId,
              MAX(was.approved_at) AS viewerApprovalCompletedAt,
              MAX(COALESCE(run.calculatedAt, run.createdAt, run.lockedAt)) AS sortAt
       FROM workflow_approval_steps was
       INNER JOIN payrollruns run ON run.id = was.entity_id
       WHERE was.entity_type = 'payroll_run'
         AND was.user_id = :actorId
         AND was.status = 'approved'
         AND UPPER(run.status) NOT IN ('DRAFT', 'PENDING_APPROVAL')
       GROUP BY was.entity_id
       UNION
       SELECT run.id AS runId,
              COALESCE(run.lockedAt, run.calculatedAt, run.createdAt) AS viewerApprovalCompletedAt,
              COALESCE(run.calculatedAt, run.createdAt, run.lockedAt) AS sortAt
       FROM payrollruns run
       WHERE (run.approvedBy = :actorId OR run.reviewedBy = :actorId)
         AND UPPER(run.status) NOT IN ('DRAFT', 'PENDING_APPROVAL')
         AND NOT EXISTS (
           SELECT 1
           FROM workflow_approval_steps was
           WHERE was.entity_type = 'payroll_run'
             AND was.entity_id = run.id
             AND was.user_id = :actorId
             AND was.status = 'approved'
         )
     ) historyRuns
     ORDER BY sortAt DESC
     LIMIT 100`,
    { replacements: { actorId }, type: QueryTypes.SELECT }
  )) as HistoryRunRef[];

  return buildPayrollApprovalHistoryItems(viewer, runIdRows);
}

async function listPayrollApprovalHistoryAll(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];

  const {
    ensurePayrollApproversTable,
  } = await import('../workflowPayrollApproverService.js');
  await ensurePayrollApproversTable();

  const runIdRows = (await sequelize.query(
    `SELECT run.id AS runId,
            (
              SELECT MAX(was.approved_at)
              FROM workflow_approval_steps was
              WHERE was.entity_type = 'payroll_run'
                AND was.entity_id = run.id
                AND was.user_id = :actorId
                AND was.status = 'approved'
            ) AS viewerApprovalCompletedAt
     FROM payrollruns run
     WHERE UPPER(run.status) NOT IN ('DRAFT', 'PENDING_APPROVAL')
       AND (
         run.approvedBy IS NOT NULL
         OR run.reviewedBy IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM workflow_approval_steps was
           WHERE was.entity_type = 'payroll_run' AND was.entity_id = run.id
         )
       )
     ORDER BY COALESCE(run.calculatedAt, run.createdAt, run.lockedAt) DESC
     LIMIT 100`,
    { replacements: { actorId }, type: QueryTypes.SELECT }
  )) as HistoryRunRef[];

  return buildPayrollApprovalHistoryItems(viewer, runIdRows);
}

export async function listPayrollApprovalHistoryForCurrentApprover(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollPendingApprovalItem[]> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];
  if (!(await actorCanApprovePayroll(viewer))) return [];

  if (await actorCanViewAllPayrollApprovalHistory(viewer)) {
    return listPayrollApprovalHistoryAll(viewer);
  }
  return listPayrollApprovalHistoryPersonal(viewer);
}

export async function listPayrollApprovalsInboxForCurrentApprover(viewer: {
  id?: string;
  role?: string;
}): Promise<PayrollApprovalsInboxResponse> {
  const historyScope = (await actorCanViewAllPayrollApprovalHistory(viewer)) ? 'all' : 'personal';
  const [queue, historyResult] = await Promise.all([
    listPendingPayrollRunsForCurrentApprover(viewer),
    listPayrollApprovalHistoryForCurrentApprover(viewer).catch((error) => {
      console.error('Payroll approval history lookup failed:', error);
      return [] as PayrollPendingApprovalItem[];
    }),
  ]);
  return { queue, history: historyResult, historyScope };
}

export async function enrichPayrollRunApprovalFields(
  run: Record<string, unknown>,
  viewer?: { userId: string; role?: string }
): Promise<Record<string, unknown>> {
  const runId = String(run.id ?? '');
  const status = normalizeLegacyRunStatus(String(run.status ?? 'DRAFT'));
  const calculatedBy = run.calculatedBy ?? run.processedBy ?? null;
  const viewerId = viewer?.userId ? String(viewer.userId) : '';
  const role = String(viewer?.role ?? '').toUpperCase();
  const isPreparer = Boolean(calculatedBy && viewerId && String(calculatedBy) === viewerId);
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const selfApprovalBlocked =
    viewerId &&
    isPayrollSelfApprovalBlocked({
      calculatedBy: calculatedBy ? String(calculatedBy) : null,
      actorUserId: viewerId,
      actorRole: viewer?.role,
    });

  let calculatedByName =
    run.calculatedByName != null && String(run.calculatedByName).trim()
      ? String(run.calculatedByName).trim()
      : null;
  if (!calculatedByName && calculatedBy) {
    const { getUserDisplayName } = await import('../notificationService.js');
    calculatedByName = await getUserDisplayName(String(calculatedBy)).catch(() => null);
  }

  const base = {
    ...run,
    status,
    calculatedBy: calculatedBy ? String(calculatedBy) : null,
    calculatedByName,
    makerCheckerEnforced: isPayrollMakerCheckerEnforced(),
    selfApprovalBlocked: Boolean(selfApprovalBlocked),
    canCancel: false,
  };

  const approvalChainStatuses = new Set([
    'PENDING_APPROVAL',
    'APPROVED',
    'PAID',
    'LOCKED',
    'PAYMENT_PROCESSING',
  ]);
  if (!runId || !approvalChainStatuses.has(status)) {
    return {
      ...base,
      canCancel:
        status === 'PENDING_APPROVAL' && Boolean(viewerId) && (isPreparer || isAdmin),
    };
  }

  const {
    ensurePayrollApproversTable,
    loadPayrollApprovers,
    serializePayrollApproversForDto,
    payrollRequiresActorApproval,
  } = await import('../workflowPayrollApproverService.js');
  await ensurePayrollApproversTable();
  const approvers = await loadPayrollApprovers(runId);

  if (!approvers.length && status !== 'PENDING_APPROVAL') {
    const approvedBy = run.approvedBy ?? run.lockedBy ?? null;
    if (!approvedBy) return base;
    const { getUserDisplayName } = await import('../notificationService.js');
    const name = await getUserDisplayName(String(approvedBy)).catch(() => null);
    const lockedAt = run.lockedAt ? String(run.lockedAt) : null;
    return {
      ...base,
      assignedApproverUserIds: [String(approvedBy)],
      assignedApprovers: [
        {
          userId: String(approvedBy),
          name,
          status: 'approved',
          approvedAt: lockedAt,
          sortOrder: 0,
          phase: 'approved',
        },
      ],
      currentApproverUserId: null,
      currentApproverName: null,
      approvalProgress: { approved: 1, total: 1 },
      canApproverReview: false,
      canEditApprovers: false,
      needsApproverRouting: false,
      canCancel: false,
    };
  }

  const approverFields = serializePayrollApproversForDto(approvers);

  if (status !== 'PENDING_APPROVAL') {
    if (!approvers.length) return base;
    return {
      ...base,
      ...approverFields,
      canApproverReview: false,
      canEditApprovers: false,
      needsApproverRouting: false,
      canCancel: false,
    };
  }

  const canApproverReview =
    Boolean(viewerId) &&
    payrollRequiresActorApproval(approvers, viewerId) &&
    !selfApprovalBlocked;
  const canEditApprovers =
    Boolean(viewerId) &&
    (isPreparer || isAdmin) &&
    !approvers.some((row) => row.status === 'approved');
  const needsApproverRouting = approvers.length === 0;
  const canCancel = Boolean(viewerId) && (isPreparer || isAdmin);

  return {
    ...base,
    ...approverFields,
    canApproverReview,
    canEditApprovers,
    needsApproverRouting,
    canCancel,
  };
}

/** Preparer (or admin) withdraws a run that is still awaiting approval. */
export async function cancelPayrollRunByPreparer(input: {
  runId: string;
  actor: { userId: string; role?: string };
  reason?: string | null;
}): Promise<{ message: string; status: string }> {
  const runId = String(input.runId).trim();
  const actorId = String(input.actor.userId ?? '').trim();
  const role = String(input.actor.role ?? '').toUpperCase();

  if (!actorId) {
    throw Object.assign(new Error('Authentication required.'), { statusCode: 401 });
  }

  const run: any = await PayrollRun.findByPk(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { statusCode: 404 });

  const status = normalizeLegacyRunStatus(String(run.status ?? 'DRAFT'));
  if (status !== 'PENDING_APPROVAL') {
    throw Object.assign(
      new Error('Only payroll runs pending approval can be cancelled by the preparer.'),
      { statusCode: 409 }
    );
  }

  const calculatedBy = String(run.calculatedBy ?? run.processedBy ?? '').trim();
  const isPreparer = calculatedBy && calculatedBy === actorId;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  if (!isPreparer && !isAdmin) {
    throw Object.assign(
      new Error('Only the person who ran this payroll (or an admin) can cancel it.'),
      { statusCode: 403 }
    );
  }

  const {
    ensurePayrollApproversTable,
    loadPayrollApprovers,
    replacePayrollApprovers,
    notifyPayrollWorkflowFinished,
  } = await import('../workflowPayrollApproverService.js');

  await ensurePayrollApproversTable();
  const approvers = await loadPayrollApprovers(runId);
  const monthLabel = formatMonthLabel(String(run.month ?? ''));
  const reason = String(input.reason ?? '').trim();
  if (!reason) {
    throw Object.assign(new Error('A reason is required to cancel a payroll run.'), {
      statusCode: 400,
    });
  }

  await transitionPayrollRun({
    runId,
    toStatus: 'CANCELLED',
    actorUserId: actorId,
    actorRole: role,
    reason,
  });
  await replacePayrollApprovers(runId, []);
  await notifyPayrollWorkflowFinished({
    runId,
    monthLabel,
    outcome: 'cancelled',
    calculatedByUserId: calculatedBy || null,
    approverUserIds: approvers.map((row) => row.userId),
  });

  return { message: 'Payroll run cancelled.', status: 'CANCELLED' };
}

export async function executePayrollWorkflowAction(input: {
  runId: string;
  action: 'approve' | 'reject' | 'return';
  actor: { userId: string; role?: string };
  notes?: string | null;
  reason?: string | null;
}): Promise<{ message: string; status: string }> {
  const runId = String(input.runId).trim();
  const actorId = String(input.actor.userId ?? '').trim();
  const role = String(input.actor.role ?? '').toUpperCase();

  if (!(await actorCanApprovePayroll(input.actor))) {
    throw Object.assign(new Error('You do not have permission to approve payroll runs.'), {
      statusCode: 403,
    });
  }

  const run: any = await PayrollRun.findByPk(runId);
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { statusCode: 404 });

  const status = String(run.status ?? '').toUpperCase();
  if (status !== 'PENDING_APPROVAL') {
    throw new Error('This payroll run is not awaiting approval.');
  }

  const {
    ensurePayrollApproversTable,
    loadPayrollApprovers,
    markPayrollApproverApproved,
    allPayrollApproversApproved,
    payrollRequiresActorApproval,
    notifyNextPayrollApproverTurn,
    notifyPayrollWorkflowFinished,
    serializePayrollApproversForDto,
  } = await import('../workflowPayrollApproverService.js');

  await ensurePayrollApproversTable();
  const monthLabel = formatMonthLabel(String(run.month ?? ''));
  const approvers = await loadPayrollApprovers(runId);

  if (!approvers.length) {
    throw Object.assign(
      new Error('This payroll run has not been routed to approvers yet.'),
      { statusCode: 409, code: 'APPROVERS_NOT_ROUTED' }
    );
  }

  const approverFields = serializePayrollApproversForDto(approvers);
  if (!viewerIsInApproverChain(approverFields, actorId)) {
    throw Object.assign(new Error('You are not assigned as an approver for this payroll run.'), {
      statusCode: 403,
    });
  }

  const calculatedBy = run.calculatedBy ?? run.processedBy ?? null;
  if (
    isPayrollSelfApprovalBlocked({
      calculatedBy: calculatedBy ? String(calculatedBy) : null,
      actorUserId: actorId,
      actorRole: role,
    })
  ) {
    throw Object.assign(new Error('Maker-checker: you cannot approve a payroll run you calculated.'), {
      statusCode: 403,
    });
  }

  if (input.action === 'approve') {
    const approveComment = String(input.notes ?? input.reason ?? '').trim();
    if (approveComment.length < 3) {
      throw new Error('Approval comment is required (min 3 characters).');
    }
    if (approvers.length && !payrollRequiresActorApproval(approvers, actorId)) {
      throw new Error(
        ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role)
          ? 'This payroll run is waiting on another approver in the chain. Only the current approver can sign off.'
          : 'It is not your turn to approve this payroll run yet.'
      );
    }

    if (approvers.length) {
      const mine = approvers.find((entry) => entry.userId === actorId);
      if (mine?.status === 'approved') {
        throw new Error('You have already approved this payroll run.');
      }
      await markPayrollApproverApproved(runId, actorId);
      const refreshed = await loadPayrollApprovers(runId);
      if (!allPayrollApproversApproved(refreshed)) {
        await notifyNextPayrollApproverTurn(runId, monthLabel, refreshed);
        return {
          message: 'Your approval was recorded. The next approver will be notified.',
          status: 'PENDING_APPROVAL',
        };
      }
    }

    await transitionPayrollRun({
      runId,
      toStatus: 'APPROVED',
      actorUserId: actorId,
      actorRole: role,
      reason: approveComment,
    });
    await notifyPayrollWorkflowFinished({
      runId,
      monthLabel,
      outcome: 'approved',
      calculatedByUserId: calculatedBy ? String(calculatedBy) : null,
    });

    const { notifyPayrollRunCompleted } = await import('../notificationService.js');
    void notifyPayrollRunCompleted({
      id: runId,
      month: String(run.month ?? ''),
    }).catch(() => undefined);

    return { message: 'Payroll run approved and finalized.', status: 'APPROVED' };
  }

  if (input.action === 'return') {
    const trimmed = String(input.notes ?? input.reason ?? '').trim();
    if (trimmed.length < 3) {
      throw new Error('Return notes are required (min 3 characters).');
    }
    if (approvers.length && !payrollRequiresActorApproval(approvers, actorId)) {
      throw new Error('Only the current approver can return this payroll run.');
    }

    await transitionPayrollRun({
      runId,
      toStatus: 'DRAFT',
      actorUserId: actorId,
      actorRole: role,
      reason: trimmed,
    });
    // Keep approver chain so returned runs remain visible on the personal approval board.
    await notifyPayrollWorkflowFinished({
      runId,
      monthLabel,
      outcome: 'returned',
      calculatedByUserId: calculatedBy ? String(calculatedBy) : null,
    });
    return { message: 'Payroll run returned to the preparer for revision.', status: 'DRAFT' };
  }

  const rejectReason = String(input.reason ?? input.notes ?? '').trim();
  if (rejectReason.length < 3) {
    throw new Error('Rejection reason is required (min 3 characters).');
  }
  if (approvers.length && !payrollRequiresActorApproval(approvers, actorId)) {
    throw new Error('Only the current approver can reject this payroll run.');
  }

  await transitionPayrollRun({
    runId,
    toStatus: 'REJECTED',
    actorUserId: actorId,
    actorRole: role,
    reason: rejectReason,
  });
  // Keep approver chain so rejected runs remain visible on the personal approval board.
  await notifyPayrollWorkflowFinished({
    runId,
    monthLabel,
    outcome: 'rejected',
    calculatedByUserId: calculatedBy ? String(calculatedBy) : null,
  });
  return { message: 'Payroll run rejected.', status: 'REJECTED' };
}
