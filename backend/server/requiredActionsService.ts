import { Op } from 'sequelize';
import { LeaveRequest, OvertimeRequest, User } from './db.js';

export type RequiredActionKind =
  | 'appraisal_manager_review'
  | 'appraisal_employee_self_eval'
  | 'appraisal_hr_finalize'
  | 'appraisal_hr_route'
  | 'appraisal_final_approval'
  | 'probation_manager_review'
  | 'probation_employee_self_eval'
  | 'probation_hr_decide'
  | 'probation_hr_route'
  | 'probation_final_approval'
  | 'movement_approval'
  | 'payroll_run_approval'
  | 'leave_approval'
  | 'overtime_approval';

export type RequiredActionItem = {
  id: string;
  kind: RequiredActionKind;
  module: 'appraisal' | 'probation' | 'movement' | 'payroll' | 'leave' | 'overtime';
  title: string;
  subtitle: string;
  href: string;
  urgency: 'high' | 'normal';
  entityId?: string;
  /** Portal user id for probation deep links and employee-scoped navigation. */
  targetUserId?: string;
  employeeName?: string;
};

export type RequiredActionGroupKey =
  | 'performance'
  | 'approvals'
  | 'leave'
  | 'overtime';

export type RequiredActionGroup = {
  key: RequiredActionGroupKey;
  label: string;
  count: number;
  href: string;
  items: RequiredActionItem[];
};

export type RequiredActionsResponse = {
  totalCount: number;
  groups: RequiredActionGroup[];
  items: RequiredActionItem[];
};

async function resolveTeamUserIdsForManager(userId: string): Promise<string[]> {
  const { resolveTeamUserIdsForManager: resolve } = await import('./managerTeamService.js');
  return resolve(userId);
}

async function listPendingLeaveActions(viewer: {
  id?: string;
  role?: string;
}): Promise<RequiredActionItem[]> {
  const role = String(viewer.role ?? '').toUpperCase();
  const actorId = String(viewer.id ?? '').trim();
  if (!actorId) return [];

  const where: Record<string, unknown> = {};
  if (role === 'MANAGER') {
    const teamUserIds = await resolveTeamUserIdsForManager(actorId);
    if (!teamUserIds.length) return [];
    where.userId = { [Op.in]: teamUserIds };
    where.status = 'PENDING';
  } else if (role === 'ADMIN' || role === 'HR') {
    where.status = { [Op.in]: ['PENDING', 'MANAGER_APPROVED'] };
  } else {
    return [];
  }

  const rows = await LeaveRequest.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: 20,
    raw: true,
  });
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map((r: { userId?: string }) => String(r.userId ?? '')).filter(Boolean))];
  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'display_name', 'email'],
        raw: true,
      })
    : [];
  const nameById = new Map(
    users.map((u: { id?: string; display_name?: string; email?: string }) => [
      String(u.id),
      String(u.display_name ?? u.email ?? 'Employee'),
    ])
  );

  return rows.map((row: { id?: string; userId?: string; type?: string; startDate?: string; endDate?: string }) => {
    const employeeName = nameById.get(String(row.userId ?? '')) ?? 'Employee';
    const dates = [row.startDate, row.endDate].filter(Boolean).join(' – ');
    return {
      id: `leave-${row.id}`,
      kind: 'leave_approval' as const,
      module: 'leave' as const,
      title: `Review leave request`,
      subtitle: `${employeeName}${dates ? ` · ${dates}` : ''}${row.type ? ` · ${row.type}` : ''}`,
      href: `/leaves?scope=manage&tab=requests&leaveId=${encodeURIComponent(String(row.id ?? ''))}`,
      urgency: 'normal' as const,
      entityId: String(row.id ?? ''),
      employeeName,
    };
  });
}

async function listPendingOvertimeActions(viewer: {
  id?: string;
  role?: string;
}): Promise<RequiredActionItem[]> {
  const role = String(viewer.role ?? '').toUpperCase();
  const actorId = String(viewer.id ?? '').trim();
  if (!actorId) return [];

  const where: Record<string, unknown> = { status: 'PENDING' };
  if (role === 'MANAGER') {
    const teamUserIds = await resolveTeamUserIdsForManager(actorId);
    if (!teamUserIds.length) return [];
    where.userId = { [Op.in]: teamUserIds };
  } else if (role !== 'ADMIN' && role !== 'HR') {
    return [];
  }

  const rows = await OvertimeRequest.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: 20,
    raw: true,
  });
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map((r: { userId?: string }) => String(r.userId ?? '')).filter(Boolean))];
  const users = userIds.length
    ? await User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'display_name', 'email'],
        raw: true,
      })
    : [];
  const nameById = new Map(
    users.map((u: { id?: string; display_name?: string; email?: string }) => [
      String(u.id),
      String(u.display_name ?? u.email ?? 'Employee'),
    ])
  );

  return rows.map((row: { id?: string; userId?: string; workDate?: string; hours?: number }) => {
    const employeeName = nameById.get(String(row.userId ?? '')) ?? 'Employee';
    const hours = row.hours != null ? `${row.hours}h` : '';
    return {
      id: `overtime-${row.id}`,
      kind: 'overtime_approval' as const,
      module: 'overtime' as const,
      title: `Review overtime request`,
      subtitle: `${employeeName}${row.workDate ? ` · ${row.workDate}` : ''}${hours ? ` · ${hours}` : ''}`,
      href: `/overtime?scope=manage&tab=requests&requestId=${encodeURIComponent(String(row.id ?? ''))}`,
      urgency: 'normal' as const,
      entityId: String(row.id ?? ''),
      employeeName,
    };
  });
}

function pushUnique(items: RequiredActionItem[], item: RequiredActionItem): void {
  if (items.some((x) => x.id === item.id)) return;
  items.push(item);
}

/** Evaluations explicitly routed to the viewer (manager assignee or self-evaluation). */
const ROUTED_EVALUATION_KINDS = new Set<RequiredActionKind>([
  'appraisal_manager_review',
  'probation_manager_review',
  'appraisal_employee_self_eval',
  'probation_employee_self_eval',
]);

function isRoutedEvaluationAction(item: RequiredActionItem): boolean {
  return ROUTED_EVALUATION_KINDS.has(item.kind);
}

function groupItems(
  items: RequiredActionItem[],
  key: RequiredActionGroupKey,
  label: string,
  href: string
): RequiredActionGroup | null {
  const groupItems = items.filter((item) => {
    if (key === 'performance') {
      return isRoutedEvaluationAction(item);
    }
    if (key === 'approvals') {
      return item.kind.includes('final_approval') || item.kind === 'movement_approval' || item.kind === 'payroll_run_approval';
    }
    if (key === 'leave') return item.module === 'leave';
    if (key === 'overtime') return item.module === 'overtime';
    return false;
  });
  if (!groupItems.length) return null;
  return { key, label, count: groupItems.length, href, items: groupItems };
}

export async function getRequiredActionsForViewer(viewer: {
  id?: string;
  role?: string;
  displayName?: string;
}): Promise<RequiredActionsResponse> {
  const empty: RequiredActionsResponse = { totalCount: 0, groups: [], items: [] };
  try {
    return await getRequiredActionsForViewerUnsafe(viewer);
  } catch (err) {
    console.warn(
      '[actions/required] failed (returning empty):',
      err instanceof Error ? err.message : err
    );
    return empty;
  }
}

async function getRequiredActionsForViewerUnsafe(viewer: {
  id?: string;
  role?: string;
  displayName?: string;
}): Promise<RequiredActionsResponse> {
  const actorId = String(viewer?.id ?? '').trim();
  const role = String(viewer?.role ?? '').toUpperCase();
  if (!actorId) {
    return { totalCount: 0, groups: [], items: [] };
  }

  const items: RequiredActionItem[] = [];

  const settled = await Promise.allSettled([
    import('./appraisal/appraisalWorkflowService.js'),
    import('./probation/probationReviewService.js'),
    import('./payroll/payrollRunApprovalService.js'),
    import('./employeeMovementService.js'),
    import('./probation/probationWorkflowService.js'),
    listPendingLeaveActions(viewer),
    listPendingOvertimeActions(viewer),
  ]);

  const appraisalMod = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const probationReviewMod = settled[1].status === 'fulfilled' ? settled[1].value : null;
  const payrollMod = settled[2].status === 'fulfilled' ? settled[2].value : null;
  const movementMod = settled[3].status === 'fulfilled' ? settled[3].value : null;
  const probationWorkflowMod = settled[4].status === 'fulfilled' ? settled[4].value : null;
  const leaveActions = settled[5].status === 'fulfilled' ? settled[5].value : [];
  const overtimeActions = settled[6].status === 'fulfilled' ? settled[6].value : [];

  const actor = { userId: actorId, role };

  const lists = await Promise.allSettled([
    appraisalMod
      ? appraisalMod.listRoutedManagerAppraisalReviews(actor)
      : Promise.resolve([]),
    appraisalMod
      ? appraisalMod.listMyPendingAppraisalSelfEvaluations(actorId)
      : Promise.resolve([]),
    appraisalMod
      ? appraisalMod.listFinalAppraisalsForAssignedApprover({ id: actorId, role })
      : Promise.resolve([]),
    role === 'EMPLOYEE' || !probationReviewMod
      ? Promise.resolve({ items: [] as Awaited<
          ReturnType<NonNullable<typeof probationReviewMod>['listProbationReviewQueue']>
        >['items'] })
      : probationReviewMod.listProbationReviewQueue(actor),
    probationReviewMod
      ? probationReviewMod.listMyPendingProbationSelfEvaluation(actorId)
      : Promise.resolve(null),
    payrollMod
      ? payrollMod.listPendingPayrollRunsForCurrentApprover({ id: actorId, role })
      : Promise.resolve([]),
    movementMod
      ? movementMod.listPendingMovementsForCurrentApprover({ id: actorId, role })
      : Promise.resolve([]),
    probationWorkflowMod
      ? probationWorkflowMod.listPendingProbationReviewsForCurrentApprover({ id: actorId, role })
      : Promise.resolve([]),
  ]);

  const value = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === 'fulfilled' ? r.value : fallback;

  const routedManagerAppraisals = value(lists[0], [] as Awaited<ReturnType<NonNullable<typeof appraisalMod>['listRoutedManagerAppraisalReviews']>>);
  const pendingSelfKpi = value(lists[1], [] as Awaited<ReturnType<NonNullable<typeof appraisalMod>['listMyPendingAppraisalSelfEvaluations']>>);
  const finalAppraisals = value(lists[2], [] as Awaited<ReturnType<NonNullable<typeof appraisalMod>['listFinalAppraisalsForAssignedApprover']>>);
  const probationQueue = value(lists[3], { items: [] as Awaited<ReturnType<NonNullable<typeof probationReviewMod>['listProbationReviewQueue']>>['items'] });
  const pendingProbationSelf = value(lists[4], null as Awaited<ReturnType<NonNullable<typeof probationReviewMod>['listMyPendingProbationSelfEvaluation']>> | null);
  const payrollRuns = value(lists[5], [] as Awaited<ReturnType<NonNullable<typeof payrollMod>['listPendingPayrollRunsForCurrentApprover']>>);
  const movements = value(lists[6], [] as Awaited<ReturnType<NonNullable<typeof movementMod>['listPendingMovementsForCurrentApprover']>>);
  const probationPendingApprovals = value(lists[7], [] as Awaited<ReturnType<NonNullable<typeof probationWorkflowMod>['listPendingProbationReviewsForCurrentApprover']>>);

  for (const row of routedManagerAppraisals) {
    const name = String(row.employeeName ?? 'Employee');
    const period = String(row.periodName ?? 'Appraisal');
    const appraisalId = String(row.id ?? '');

    pushUnique(items, {
      id: `appraisal-mgr-${appraisalId}`,
      kind: 'appraisal_manager_review',
      module: 'appraisal',
      title: 'Evaluate employee',
      subtitle: `${name} · ${period}`,
      href: `/performance?tab=kpi-appraisals&appraisalId=${appraisalId}`,
      urgency: 'high',
      entityId: appraisalId,
      targetUserId: String(row.user_id ?? ''),
      employeeName: name,
    });
  }

  for (const row of finalAppraisals) {
    if (!row.canFinalApproverReview) continue;
    const name = String(row.employeeName ?? 'Employee');
    const period = String(row.periodName ?? 'Appraisal');
    const appraisalId = String(row.id ?? '');
    pushUnique(items, {
      id: `appraisal-approve-${appraisalId}`,
      kind: 'appraisal_final_approval',
      module: 'appraisal',
      title: 'Approve appraisal',
      subtitle: `${name} · ${period}`,
      href: `/performance?tab=kpi-appraisals&view=approval&appraisalId=${encodeURIComponent(appraisalId)}`,
      urgency: 'high',
      entityId: appraisalId,
      employeeName: name,
    });
  }

  for (const row of pendingSelfKpi) {
    const period = String(row.periodName ?? 'KPI period');
    const appraisalId = String(row.id ?? '');
    pushUnique(items, {
      id: `appraisal-self-${appraisalId}`,
      kind: 'appraisal_employee_self_eval',
      module: 'appraisal',
      title: 'Complete self-evaluation',
      subtitle: period,
      href: `/my-performance?tab=action&appraisalId=${appraisalId}`,
      urgency: 'high',
      entityId: appraisalId,
    });
  }

  for (const item of probationQueue.items) {
    const name = String(item.name ?? 'Employee');
    const reviewId = String(item.reviewId ?? item.userId ?? '');

    if (
      item.canManagerEdit &&
      item.assignedManagerUserId &&
      item.routedByHrUserId &&
      String(item.userId) !== actorId &&
      item.employeeId
    ) {
      pushUnique(items, {
        id: `probation-mgr-${reviewId}`,
        kind: 'probation_manager_review',
        module: 'probation',
        title: 'Evaluate probation',
        subtitle: name,
        urgency: item.overdue ? 'high' : 'normal',
        href: `/performance?tab=probation&userId=${encodeURIComponent(String(item.userId ?? ''))}`,
        entityId: String(item.userId ?? reviewId),
        targetUserId: String(item.userId ?? ''),
        employeeName: name,
      });
    }
    if (item.canApproverReview) {
      pushUnique(items, {
        id: `probation-approve-${reviewId}`,
        kind: 'probation_final_approval',
        module: 'probation',
        title: 'Approve probation review',
        subtitle: name,
        href: `/performance?tab=probation&view=approval&reviewId=${encodeURIComponent(reviewId)}`,
        urgency: 'high',
        entityId: reviewId,
        employeeName: name,
      });
    }
  }

  for (const row of probationPendingApprovals) {
    if (!row.canApproverReview) continue;
    const reviewId = String(row.reviewId ?? '');
    if (items.some((item) => item.id === `probation-approve-${reviewId}`)) continue;
    pushUnique(items, {
      id: `probation-approve-${reviewId}`,
      kind: 'probation_final_approval',
      module: 'probation',
      title: 'Approve probation review',
      subtitle: String(row.employeeName ?? 'Employee'),
      href: `/performance?tab=probation&view=approval&reviewId=${encodeURIComponent(reviewId)}`,
      urgency: 'high',
      entityId: reviewId,
      employeeName: String(row.employeeName ?? 'Employee'),
    });
  }

  if (pendingProbationSelf) {
    pushUnique(items, {
      id: `probation-self-${pendingProbationSelf.reviewId}`,
      kind: 'probation_employee_self_eval',
      module: 'probation',
      title: 'Complete probation self-evaluation',
      subtitle: String(viewer.displayName ?? 'Your review'),
      href: '/my-performance?tab=action',
      urgency: 'high',
      entityId: pendingProbationSelf.reviewId,
      targetUserId: actorId,
    });
  }

  for (const row of payrollRuns) {
    if (!row.canApproverReview) continue;
    pushUnique(items, {
      id: `payroll-run-${row.runId}`,
      kind: 'payroll_run_approval',
      module: 'payroll',
      title: 'Approve payroll run',
      subtitle: `${row.monthLabel} · ${row.totalEmployees} employees`,
      href: `/payroll/approvals/${row.runId}`,
      urgency: 'high',
      entityId: row.runId,
    });
  }

  for (const row of movements) {
    const name = String(row.employeeName ?? row.employeeId ?? 'Employee');
    const movementId = String(row.id ?? '');
    const typeLabel = String(row.movementType ?? 'Movement').replace(/_/g, ' ');
    pushUnique(items, {
      id: `movement-${movementId}`,
      kind: 'movement_approval',
      module: 'movement',
      title: 'Approve employee movement',
      subtitle: `${name} · ${typeLabel}`,
      href: `/approvals/movements?movementId=${encodeURIComponent(movementId)}`,
      urgency: 'high',
      entityId: movementId,
      employeeName: name,
    });
  }

  for (const item of leaveActions) pushUnique(items, item);
  for (const item of overtimeActions) pushUnique(items, item);

  const urgencyRank = (u: RequiredActionItem['urgency']) => (u === 'high' ? 0 : 1);
  items.sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency) || a.title.localeCompare(b.title));

  const groups = [
    groupItems(items, 'performance', 'Performance reviews', '/dashboard'),
    groupItems(items, 'approvals', 'Approvals', '/dashboard'),
    groupItems(items, 'leave', 'Leave requests', '/leaves?scope=manage&tab=requests'),
    groupItems(items, 'overtime', 'Overtime requests', '/overtime?scope=manage&tab=requests'),
  ].filter((g): g is RequiredActionGroup => Boolean(g));

  return {
    totalCount: items.length,
    groups,
    items,
  };
}
