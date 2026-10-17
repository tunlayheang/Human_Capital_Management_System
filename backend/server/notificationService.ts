import { Op } from 'sequelize';
import { Department, Notification, Payslip, User } from './db.js';
import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';
import { serializeUserForClient, USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import { employeeLookupWhere } from './employeeIdFormat.js';

export type NotificationType = 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
export type NotificationCategory =
  | 'AUTHENTICATION'
  | 'EMPLOYEE'
  | 'ATTENDANCE'
  | 'LEAVE'
  | 'OVERTIME'
  | 'PAYROLL'
  | 'PERFORMANCE'
  | 'PROJECT'
  | 'TASK'
  | 'APPROVAL'
  | 'ANNOUNCEMENT'
  | 'ACCESS'
  | 'ORGANIZATION'
  | 'SYSTEM'
  | 'CHAT';
export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type CreateNotificationInput = {
  userId: string;
  title: string;
  message: string;
  type?: NotificationType;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  entityId?: string | null;
  entityType?: string | null;
  senderId?: string | null;
  link?: string;
  /** Stable id enables upsert (e.g. daily payroll reminder). */
  id?: string;
};

function inferNotificationCategory(input: CreateNotificationInput): NotificationCategory {
  if (input.category) return input.category;
  const key = `${input.id || ''} ${input.link || ''} ${input.title}`.toLowerCase();
  if (key.includes('announcement') || key.includes('chat-ann')) return 'ANNOUNCEMENT';
  if (key.includes('/chat') || key.includes('chat-')) return 'CHAT';
  if (key.includes('leave')) return 'LEAVE';
  if (key.includes('overtime') || key.includes('ot-')) return 'OVERTIME';
  if (key.includes('attendance')) return 'ATTENDANCE';
  if (key.includes('payroll') || key.includes('payslip') || key.includes('settlement')) return 'PAYROLL';
  if (key.includes('appraisal') || key.includes('probation') || key.includes('performance')) {
    return 'PERFORMANCE';
  }
  if (key.includes('task')) return 'TASK';
  if (key.includes('project')) return 'PROJECT';
  if (key.includes('permission') || key.includes('role') || key.includes('access')) return 'ACCESS';
  if (key.includes('employee') || key.includes('movement') || key.includes('offboard')) return 'EMPLOYEE';
  if (key.includes('approval') || key.includes('pending')) return 'APPROVAL';
  if (key.includes('account') || key.includes('password') || key.includes('login')) {
    return 'AUTHENTICATION';
  }
  return 'SYSTEM';
}

function inferNotificationPriority(input: CreateNotificationInput): NotificationPriority {
  if (input.priority) return input.priority;
  if (input.type === 'ERROR') return 'CRITICAL';
  if (input.type === 'WARNING') return 'HIGH';
  return 'NORMAL';
}

export function serializeNotification(row: unknown): Record<string, unknown> {
  const p =
    row && typeof (row as { get?: unknown }).get === 'function'
      ? (row as { get: (o: { plain: boolean }) => Record<string, unknown> }).get({ plain: true })
      : (row as Record<string, unknown>);
  return {
    id: String(p.id),
    userId: String(p.userId),
    title: String(p.title ?? ''),
    message: String(p.message ?? ''),
    type: (p.type as NotificationType) || 'INFO',
    category: String(p.category || 'SYSTEM'),
    priority: String(p.priority || 'NORMAL'),
    entityId: p.entityId ? String(p.entityId) : undefined,
    entityType: p.entityType ? String(p.entityType) : undefined,
    senderId: p.senderId ? String(p.senderId) : undefined,
    isRead: Boolean(p.isRead),
    createdAt: String(p.createdAt || new Date().toISOString()),
    link: p.link ? String(p.link) : undefined,
  };
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const userId = String(input.userId || '').trim();
  if (!userId) return;

  const id = input.id?.trim() || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const category = inferNotificationCategory(input);
  const payload = {
    id,
    userId,
    title: input.title,
    message: input.message,
    type: input.type || 'INFO',
    category,
    priority: inferNotificationPriority(input),
    entityId: input.entityId || input.id || id,
    entityType: input.entityType || category,
    senderId: input.senderId || null,
    isRead: false,
    createdAt: new Date().toISOString(),
    link: input.link || null,
  };

  try {
    const existing = await Notification.findByPk(id);
    if (existing) {
      if (String(existing.get('userId')) !== userId) {
        console.error('[notification] stable id belongs to another user:', { id, userId });
        return;
      }
      // Idempotent retries refresh content but never resurrect a read notification or
      // move its timestamp to the top of the inbox.
      await existing.update({
        title: payload.title,
        message: payload.message,
        type: payload.type,
        category: payload.category,
        priority: payload.priority,
        entityId: payload.entityId,
        entityType: payload.entityType,
        senderId: payload.senderId,
        link: payload.link,
      });
      return;
    }
    await Notification.create(payload);
  } catch (err) {
    try {
      // A concurrent request may have inserted the same stable id.
      const existing = await Notification.findByPk(id);
      if (existing && String(existing.get('userId')) === userId) {
        await existing.update({
          title: payload.title,
          message: payload.message,
          type: payload.type,
          category: payload.category,
          priority: payload.priority,
          entityId: payload.entityId,
          entityType: payload.entityType,
          senderId: payload.senderId,
          link: payload.link,
        });
        return;
      }
      throw err;
    } catch (fallbackErr) {
      console.error('[notification] createNotification failed:', { id, userId, err, fallbackErr });
    }
  }
}

/**
 * Create if missing; if present, refresh title/message/link/type but keep read state
 * (used when syncing live required-action queues into the inbox).
 */
export async function ensureNotification(input: CreateNotificationInput): Promise<void> {
  const userId = String(input.userId || '').trim();
  if (!userId) return;
  const id = input.id?.trim();
  if (!id) {
    await createNotification(input);
    return;
  }

  try {
    const existing = await Notification.findByPk(id);
    if (existing) {
      await existing.update({
        title: input.title,
        message: input.message,
        type: input.type || existing.get('type') || 'INFO',
        category: input.category || existing.get('category') || inferNotificationCategory(input),
        priority: input.priority || existing.get('priority') || inferNotificationPriority(input),
        entityId: input.entityId || existing.get('entityId') || id,
        entityType:
          input.entityType ||
          existing.get('entityType') ||
          input.category ||
          inferNotificationCategory(input),
        senderId:
          input.senderId === undefined ? existing.get('senderId') || null : input.senderId,
        link: input.link || null,
      });
      return;
    }
    await createNotification({ ...input, id });
  } catch (err) {
    console.error('[notification] ensureNotification failed:', { id, userId, err });
  }
}

/** Clear inbox notifications created for company announcements (ticker / chat view). */
export async function markAnnouncementNotificationsRead(userId: string): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid) return;
  try {
    await Notification.update(
      { isRead: true },
      {
        where: {
          userId: uid,
          isRead: false,
          [Op.or]: [
            { id: { [Op.like]: 'chat-ann-%' } },
            { link: { [Op.like]: '%announcements=1%' } },
          ],
        },
      }
    );
  } catch (err) {
    console.warn(
      '[notification] markAnnouncementNotificationsRead failed:',
      (err as Error)?.message || err
    );
  }
}

export async function notifyUserIds(
  userIds: string[],
  payload: Omit<CreateNotificationInput, 'userId' | 'id'> & { idPrefix?: string }
): Promise<void> {
  const unique = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  await Promise.all(
    unique.map((userId) =>
      createNotification({
        ...payload,
        userId,
        id: payload.idPrefix ? `${payload.idPrefix}-${userId}` : undefined,
      })
    )
  );
}

export async function notifyRoles(
  roles: string[],
  payload: Omit<CreateNotificationInput, 'userId' | 'id'> & { idPrefix?: string }
): Promise<void> {
  const users = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: roles.map((r) => String(r).toUpperCase()) },
    },
    attributes: ['id'],
  });
  await notifyUserIds(
    users.map((u) => String(u.get('id'))),
    payload
  );
}

export async function notifyRolesExcept(
  roles: string[],
  excludedUserIds: string[],
  payload: Omit<CreateNotificationInput, 'userId' | 'id'> & { idPrefix?: string }
): Promise<void> {
  const excluded = new Set(excludedUserIds.map((id) => String(id || '').trim()).filter(Boolean));
  const users = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: roles.map((role) => String(role).toUpperCase()) },
    },
    attributes: ['id'],
  });
  await notifyUserIds(
    users.map((user) => String(user.get('id'))).filter((id) => !excluded.has(id)),
    payload
  );
}

export async function notifyOrganizationChanged(input: {
  entityId: string;
  entityType: 'DEPARTMENT' | 'POSITION';
  name: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  actorUserId?: string;
  affectedUserIds?: string[];
  revision: string;
}): Promise<void> {
  const label = input.entityType === 'DEPARTMENT' ? 'Department' : 'Position';
  const title = `${label} ${input.action.toLowerCase()}`;
  const message = `${label} “${input.name}” was ${input.action.toLowerCase()}.`;
  const payload = {
    idPrefix: `org-${input.entityType.toLowerCase()}-${input.action.toLowerCase()}-${input.entityId}-${input.revision}`,
    title,
    message,
    type: input.action === 'DELETED' ? ('WARNING' as const) : ('INFO' as const),
    category: 'ORGANIZATION' as const,
    entityId: input.entityId,
    entityType: input.entityType,
    senderId: input.actorUserId || null,
    link: '/company-structure',
  };
  const affected = (input.affectedUserIds || []).filter(
    (id) => id && id !== input.actorUserId
  );
  if (affected.length) await notifyUserIds(affected, payload);
  await notifyRolesExcept(
    ['ADMIN', 'HR'],
    [input.actorUserId || '', ...affected],
    payload
  );
}

function looksLikePortalUserId(value: string | null | undefined): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (/^u-\d+$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  return false;
}

function humanizeUserLabel(value: string | null | undefined, fallback = 'A team member'): string {
  const s = String(value ?? '').trim();
  if (!s || looksLikePortalUserId(s)) return fallback;
  if (s.includes('@')) {
    const local = s.split('@')[0]?.trim() ?? '';
    if (local && !looksLikePortalUserId(local)) return local;
    return fallback;
  }
  return s;
}

export async function getUserDisplayName(userId: string): Promise<string> {
  const user: any = await User.findByPk(userId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  if (!user) return 'A team member';
  try {
    const profile = await serializeUserForClient(user.get({ plain: true }));
    return (
      humanizeUserLabel(profile.name, '') ||
      humanizeUserLabel(profile.email, '') ||
      'A team member'
    );
  } catch {
    return humanizeUserLabel(user.email, 'A team member');
  }
}

/** HR/Admin/Manager approvers for an employee's requests (excludes the requester). */
export async function listWorkflowApproverUserIds(employeeUserId: string): Promise<string[]> {
  const ids = new Set<string>();
  const approvers = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: ['ADMIN', 'HR', 'MANAGER'] },
    },
    attributes: ['id'],
  });
  for (const u of approvers) ids.add(String(u.get('id')));

  try {
    const employee = await findEmployeeByUserId(employeeUserId);
    const deptId = String(employee?.department_id ?? employee?.get?.('department_id') ?? '').trim();
    if (deptId) {
      const dept: any = await Department.findByPk(deptId, {
        attributes: ['managerId', 'department_head_id'],
      });
      const managerPortalId = String(dept?.managerId ?? dept?.get?.('managerId') ?? '').trim();
      if (managerPortalId) ids.add(managerPortalId);
    }
  } catch {
    /* optional */
  }

  ids.delete(String(employeeUserId));
  return [...ids];
}

export async function notifyLeaveSubmitted(leave: {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  assignedManagerId?: string | null;
}): Promise<void> {
  const { formatLeaveDateRange } = await import('./leaveDuration.js');
  const range = formatLeaveDateRange(leave);
  const name = await getUserDisplayName(leave.userId);
  const managerId = String(leave.assignedManagerId ?? '').trim();
  if (managerId) {
    await notifyUserIds([managerId], {
      idPrefix: `leave-pending-mgr-${leave.id}`,
      title: 'Leave needs your approval',
      message: `${name} requested ${leave.type} leave (${range}). Approve as manager first.`,
      type: 'INFO',
      link: `/leaves?scope=manage&tab=requests&leaveId=${encodeURIComponent(leave.id)}`,
      entityId: leave.id,
      entityType: 'LEAVE',
    });
    return;
  }
  const approvers = await listWorkflowApproverUserIds(leave.userId);
  await notifyUserIds(approvers, {
    idPrefix: `leave-pending-${leave.id}`,
    title: 'Leave request pending',
    message: `${name} requested ${leave.type} leave (${range}). Review in Leaves.`,
    type: 'INFO',
    link: `/leaves?scope=manage&tab=requests&leaveId=${encodeURIComponent(leave.id)}`,
    entityId: leave.id,
    entityType: 'LEAVE',
  });
}

export async function notifyLeaveManagerApproved(leave: {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
}): Promise<void> {
  const { formatLeaveDateRange } = await import('./leaveDuration.js');
  const range = formatLeaveDateRange(leave);
  const name = await getUserDisplayName(leave.userId);
  await notifyRoles(['HR', 'ADMIN'], {
    idPrefix: `leave-pending-hr-${leave.id}`,
    title: 'Leave awaiting HR approval',
    message: `${name}'s ${leave.type} leave (${range}) was approved by the manager. Finalize in Leaves.`,
    type: 'INFO',
    link: `/leaves?scope=manage&tab=requests&leaveId=${encodeURIComponent(leave.id)}`,
    entityId: leave.id,
    entityType: 'LEAVE',
  });
  await createNotification({
    id: `leave-mgr-ok-${leave.id}-${leave.userId}`,
    userId: leave.userId,
    title: 'Manager approved your leave',
    message: `Your ${leave.type} leave (${range}) was approved by your manager and is pending HR.`,
    type: 'INFO',
    link: `/leaves?scope=my&leaveId=${encodeURIComponent(leave.id)}`,
    entityId: leave.id,
    entityType: 'LEAVE',
  });
}

export async function notifyLeaveStatusChange(leave: {
  id: string;
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  status: string;
  rejectionReason?: string | null;
}): Promise<void> {
  const { formatLeaveDateRange } = await import('./leaveDuration.js');
  const range = formatLeaveDateRange(leave);
  const status = String(leave.status || '').toUpperCase();
  const approved = status === 'APPROVED';
  const rejected = status === 'REJECTED';
  if (!approved && !rejected) return;

  await createNotification({
    id: `leave-status-${leave.id}-${leave.userId}`,
    userId: leave.userId,
    title: approved ? 'Leave approved' : 'Leave declined',
    message: approved
      ? `Your ${leave.type} leave (${range}) was approved.`
      : `Your ${leave.type} leave (${range}) was declined.${
          leave.rejectionReason ? ` Reason: ${leave.rejectionReason}` : ''
        }`,
    type: approved ? 'SUCCESS' : 'WARNING',
    link: `/leaves?scope=my&leaveId=${encodeURIComponent(leave.id)}`,
    entityId: leave.id,
    entityType: 'LEAVE',
  });
}

export async function notifyOvertimeSubmitted(row: {
  id: string;
  userId: string;
  workDate: string;
  hours: number;
}): Promise<void> {
  const name = await getUserDisplayName(row.userId);
  const approvers = await listWorkflowApproverUserIds(row.userId);
  await notifyUserIds(approvers, {
    idPrefix: `ot-pending-${row.id}`,
    title: 'Overtime request pending',
    message: `${name} submitted ${row.hours}h OT for ${row.workDate}. Approve before payroll.`,
    type: 'INFO',
    link: `/overtime?scope=manage&tab=requests&requestId=${encodeURIComponent(row.id)}`,
    entityId: row.id,
    entityType: 'OVERTIME',
  });
}

export async function notifyOvertimeStatusChange(row: {
  id: string;
  userId: string;
  workDate: string;
  hours: number;
  status: string;
  rejectionReason?: string | null;
}): Promise<void> {
  const status = String(row.status || '').toUpperCase();
  if (status !== 'APPROVED' && status !== 'REJECTED') return;

  await createNotification({
    id: `ot-status-${row.id}-${row.userId}`,
    userId: row.userId,
    title: status === 'APPROVED' ? 'Overtime approved' : 'Overtime declined',
    message:
      status === 'APPROVED'
        ? `Your overtime (${row.hours}h on ${row.workDate}) was approved.`
        : `Your overtime (${row.hours}h on ${row.workDate}) was declined.${
            row.rejectionReason ? ` Reason: ${row.rejectionReason}` : ''
          }`,
    type: status === 'APPROVED' ? 'SUCCESS' : 'WARNING',
    link: `/overtime?scope=self&requestId=${encodeURIComponent(row.id)}`,
    entityId: row.id,
    entityType: 'OVERTIME',
  });
}

export async function notifyPermissionOverridePending(request: {
  id: string;
  userId: string;
  permissionName?: string;
  overrideType?: string;
}): Promise<void> {
  const targetName = await getUserDisplayName(request.userId);
  await notifyRoles(['ADMIN', 'HR'], {
    idPrefix: `perm-req-${request.id}`,
    title: 'Permission override pending',
    message: `Approval needed: ${request.overrideType || 'GRANT'} for ${targetName}${
      request.permissionName ? ` (${request.permissionName})` : ''
    }.`,
    type: 'WARNING',
    link: '/permissions?tab=overrides',
    entityId: request.id,
    entityType: 'PERMISSION_REQUEST',
  });
}

export async function notifyPermissionOverrideResolved(request: {
  id: string;
  userId: string;
  status: string;
  permissionName?: string;
}): Promise<void> {
  const approved = String(request.status).toUpperCase() === 'APPROVED';
  await createNotification({
    id: `perm-resolved-${request.id}-${request.userId}`,
    userId: request.userId,
    title: approved ? 'Permission request approved' : 'Permission request declined',
    message: approved
      ? `Your access request${request.permissionName ? ` for ${request.permissionName}` : ''} was approved.`
      : `Your access request${request.permissionName ? ` for ${request.permissionName}` : ''} was declined.`,
    type: approved ? 'SUCCESS' : 'WARNING',
    link: '/permissions?tab=overrides',
    entityId: request.id,
    entityType: 'PERMISSION_REQUEST',
  });
}

export async function notifyPayrollRunPendingApproval(run: {
  id: string;
  month: string;
}): Promise<void> {
  await notifyRoles(['ADMIN', 'HR'], {
    idPrefix: `payroll-run-pending-${run.id}`,
    title: 'Payroll run ready for review',
    message: `Payroll run for ${run.month} is pending approval. Open Payroll to review payslips.`,
    type: 'INFO',
    link: '/payroll',
  });
}

export async function notifyPayrollRunCompleted(run: {
  id: string;
  month: string;
}): Promise<void> {
  const payslips = await Payslip.findAll({
    where: { payrollRunId: run.id },
    attributes: ['userId'],
  });
  const userIds = [...new Set(payslips.map((p) => String(p.get('userId'))).filter(Boolean))];
  await notifyUserIds(userIds, {
    idPrefix: `payslip-ready-${run.id}`,
    title: 'Payslip available',
    message: `Your payslip for ${run.month} is ready. View it in Payroll.`,
    type: 'SUCCESS',
    link: '/payroll',
  });
}

export async function notifyTaskAssigned(task: {
  id: string;
  title?: string;
  assigneeId?: string | null;
  createdByUserId?: string;
  projectId?: string | null;
  eventKey?: string;
}): Promise<void> {
  const assigneeId = String(task.assigneeId || '').trim();
  if (!assigneeId || assigneeId === task.createdByUserId) return;
  await createNotification({
    id: `task-assigned-${task.id}-${task.eventKey || 'created'}-${assigneeId}`,
    userId: assigneeId,
    title: 'New task assigned',
    message: `You were assigned: ${task.title || 'a task'}. Open Projects to view details.`,
    type: 'INFO',
    category: 'TASK',
    entityId: task.id,
    entityType: 'TASK',
    senderId: task.createdByUserId || null,
    link: task.projectId
      ? `/projects?project=${encodeURIComponent(task.projectId)}&task=${encodeURIComponent(task.id)}`
      : '/projects',
  });
}

export async function notifyTaskChanged(input: {
  taskId: string;
  projectId?: string | null;
  title: string;
  actorUserId?: string;
  creatorId?: string | null;
  previousAssigneeId?: string | null;
  assigneeId?: string | null;
  previousDueDate?: string | null;
  dueDate?: string | null;
  previousStatus?: string | null;
  status?: string | null;
  updatedAt?: string | Date | null;
}): Promise<void> {
  const actorId = String(input.actorUserId || '').trim();
  const assigneeId = String(input.assigneeId || '').trim();
  const previousAssigneeId = String(input.previousAssigneeId || '').trim();
  const creatorId = String(input.creatorId || '').trim();
  const revision = input.updatedAt
    ? new Date(input.updatedAt).getTime().toString(36)
    : Date.now().toString(36);
  const link = input.projectId
    ? `/projects?project=${encodeURIComponent(input.projectId)}&task=${encodeURIComponent(input.taskId)}`
    : '/projects';
  const base = {
    category: 'TASK' as const,
    entityId: input.taskId,
    entityType: 'TASK',
    senderId: actorId || null,
    link,
  };

  if (previousAssigneeId && previousAssigneeId !== assigneeId && previousAssigneeId !== actorId) {
    await createNotification({
      ...base,
      id: `task-unassigned-${input.taskId}-${revision}-${previousAssigneeId}`,
      userId: previousAssigneeId,
      title: 'Task reassigned',
      message: `You are no longer assigned to ${input.title || 'this task'}.`,
      type: 'INFO',
    });
  }

  if (assigneeId && assigneeId !== previousAssigneeId) {
    await notifyTaskAssigned({
      id: input.taskId,
      title: input.title,
      assigneeId,
      createdByUserId: actorId,
      projectId: input.projectId,
      eventKey: `reassigned-${revision}`,
    });
    return;
  }

  if (assigneeId && assigneeId !== actorId && input.previousDueDate !== input.dueDate) {
    await createNotification({
      ...base,
      id: `task-due-${input.taskId}-${revision}-${assigneeId}`,
      userId: assigneeId,
      title: 'Task due date changed',
      message: `${input.title || 'Your task'} is now due ${input.dueDate || 'without a set date'}.`,
      type: 'WARNING',
    });
  } else if (
    assigneeId &&
    assigneeId !== actorId &&
    input.previousStatus !== input.status
  ) {
    await createNotification({
      ...base,
      id: `task-status-${input.taskId}-${revision}-${assigneeId}`,
      userId: assigneeId,
      title: 'Task status updated',
      message: `${input.title || 'Your task'} is now ${String(input.status || '').replace(/_/g, ' ').toLowerCase()}.`,
      type: input.status === 'DONE' ? 'SUCCESS' : 'INFO',
    });
  }

  if (
    String(input.status || '').toUpperCase() === 'DONE' &&
    String(input.previousStatus || '').toUpperCase() !== 'DONE' &&
    creatorId &&
    creatorId !== actorId &&
    creatorId !== assigneeId
  ) {
    await createNotification({
      ...base,
      id: `task-completed-${input.taskId}-${revision}-${creatorId}`,
      userId: creatorId,
      title: 'Task completed',
      message: `${input.title || 'A task'} was marked complete.`,
      type: 'SUCCESS',
    });
  }
}

export async function notifyTaskDeleted(input: {
  taskId: string;
  projectId?: string | null;
  title: string;
  assigneeId?: string | null;
  actorUserId?: string;
}): Promise<void> {
  const assigneeId = String(input.assigneeId || '').trim();
  if (!assigneeId || assigneeId === String(input.actorUserId || '')) return;
  await createNotification({
    id: `task-deleted-${input.taskId}-${assigneeId}`,
    userId: assigneeId,
    title: 'Task removed',
    message: `${input.title || 'A task'} was removed from the project.`,
    type: 'WARNING',
    category: 'TASK',
    entityId: input.taskId,
    entityType: 'TASK',
    senderId: input.actorUserId || null,
    link: input.projectId
      ? `/projects?project=${encodeURIComponent(input.projectId)}`
      : '/projects',
  });
}

export async function notifyProjectMembership(input: {
  projectId: string;
  projectTitle: string;
  addedUserIds?: string[];
  removedUserIds?: string[];
  actorUserId?: string;
  eventKey: string;
}): Promise<void> {
  const actorId = String(input.actorUserId || '');
  const link = `/projects?project=${encodeURIComponent(input.projectId)}`;
  const added = (input.addedUserIds || []).filter((id) => id && id !== actorId);
  const removed = (input.removedUserIds || []).filter((id) => id && id !== actorId);
  await notifyUserIds(added, {
    idPrefix: `project-added-${input.projectId}-${input.eventKey}`,
    title: 'Added to project',
    message: `You were added to ${input.projectTitle || 'a project'}.`,
    type: 'INFO',
    category: 'PROJECT',
    entityId: input.projectId,
    entityType: 'PROJECT',
    senderId: actorId || null,
    link,
  });
  await notifyUserIds(removed, {
    idPrefix: `project-removed-${input.projectId}-${input.eventKey}`,
    title: 'Removed from project',
    message: `You were removed from ${input.projectTitle || 'a project'}.`,
    type: 'WARNING',
    category: 'PROJECT',
    entityId: input.projectId,
    entityType: 'PROJECT',
    senderId: actorId || null,
    link: '/projects',
  });
}

export async function notifyProjectUpdated(input: {
  projectId: string;
  projectTitle: string;
  userIds: string[];
  actorUserId?: string;
  eventKey: string;
  summary: string;
}): Promise<void> {
  const actorId = String(input.actorUserId || '');
  await notifyUserIds(input.userIds.filter((id) => id && id !== actorId), {
    idPrefix: `project-updated-${input.projectId}-${input.eventKey}`,
    title: 'Project updated',
    message: `${input.projectTitle || 'A project'}: ${input.summary}`,
    type: 'INFO',
    category: 'PROJECT',
    entityId: input.projectId,
    entityType: 'PROJECT',
    senderId: actorId || null,
    link: `/projects?project=${encodeURIComponent(input.projectId)}`,
  });
}

/** Portal user id for an employees.id primary key (or display code fallback). */
export async function resolvePortalUserIdForEmployeeRef(
  employeeRef: string
): Promise<string | null> {
  const ref = String(employeeRef ?? '').trim();
  if (!ref) return null;
  const { Employee } = await import('./db.js');
  const emp: any =
    (await Employee.findByPk(ref, { attributes: ['id', 'employee_id'] })) ??
    (await Employee.findOne({ where: employeeLookupWhere(ref) as never, attributes: ['id', 'employee_id'] }));
  if (!emp) return null;
  const pk = String(emp.id ?? emp.get?.('id') ?? '').trim();
  const displayId = String(emp.employee_id ?? emp.get?.('employee_id') ?? '').trim();
  const orClause: Array<{ employeeId: string }> = [];
  if (pk) orClause.push({ employeeId: pk });
  if (displayId && displayId !== pk) orClause.push({ employeeId: displayId });
  if (!orClause.length) return null;
  const user: any = await User.findOne({
    where: {
      isActive: true,
      [Op.or]: orClause,
    },
    attributes: ['id'],
  });
  return user ? String(user.id) : null;
}

export async function resolvePortalUserIdsForRefs(refs: unknown[]): Promise<string[]> {
  const resolved = await Promise.all(
    refs.map(async (raw) => {
      const ref = String(raw ?? '').trim();
      if (!ref) return null;
      const direct = await User.findByPk(ref, { attributes: ['id'] });
      if (direct) return String(direct.get('id'));
      return resolvePortalUserIdForEmployeeRef(ref);
    })
  );
  return [...new Set(resolved.filter((id): id is string => Boolean(id)))];
}

export async function notifyDeductionAuthorizationResolved(row: {
  id: string;
  employeePk?: string | null;
  createdBy?: string | null;
  deductionLabel?: string | null;
  amountUsd?: number | string | null;
  status: string;
}): Promise<void> {
  const creatorId = String(row.createdBy ?? '').trim();
  const approved = String(row.status).toUpperCase() === 'APPROVED';
  const amount = Number(row.amountUsd);
  const amountLabel = Number.isFinite(amount) ? ` ($${amount})` : '';
  if (creatorId) {
    await createNotification({
      id: `pded-resolved-${row.id}-${creatorId}`,
      userId: creatorId,
      title: approved ? 'Deduction authorization approved' : 'Deduction authorization declined',
      message: approved
        ? `${row.deductionLabel || 'Payroll deduction'}${amountLabel} was approved.`
        : `${row.deductionLabel || 'Payroll deduction'}${amountLabel} was declined.`,
      type: approved ? 'SUCCESS' : 'WARNING',
      link: '/payroll/final-settlement',
    });
  }
  const employeeUserId = row.employeePk
    ? await resolvePortalUserIdForEmployeeRef(row.employeePk)
    : null;
  if (employeeUserId && employeeUserId !== creatorId) {
    await createNotification({
      id: `pded-employee-${row.id}-${employeeUserId}`,
      userId: employeeUserId,
      title: approved ? 'Payroll deduction approved' : 'Payroll deduction declined',
      message: approved
        ? `${row.deductionLabel || 'Payroll deduction'}${amountLabel} was approved and may be applied to your settlement.`
        : `${row.deductionLabel || 'Payroll deduction'}${amountLabel} was declined.`,
      type: approved ? 'WARNING' : 'INFO',
      category: 'PAYROLL',
      priority: approved ? 'HIGH' : 'NORMAL',
      entityId: row.id,
      entityType: 'PAYROLL_DEDUCTION',
      link: '/my-pay',
    });
  }
}

export async function notifyAttendancePeriodFrozen(input: {
  month: string;
  payrollGroupId?: string;
  trigger?: string;
}): Promise<void> {
  const label = input.payrollGroupId && input.payrollGroupId !== 'default'
    ? `${input.month} (${input.payrollGroupId})`
    : input.month;
  await notifyRoles(['HR', 'ADMIN'], {
    idPrefix: `attendance-frozen-${input.month}-${input.payrollGroupId || 'default'}`,
    title: 'Attendance period frozen',
    message: `Attendance for ${label} was frozen${input.trigger === 'SCHEDULER' ? ' automatically' : ''}. Review before payroll.`,
    type: 'INFO',
    link: '/payroll',
  });
}

export async function notifyLateCheckIn(input: {
  attendanceId: string;
  userId: string;
  date: string;
  lateMinutes: number;
}): Promise<void> {
  if (!input.userId || input.lateMinutes <= 0) return;
  await createNotification({
    id: `attendance-late-${input.attendanceId}-${input.userId}`,
    userId: input.userId,
    title: 'Late check-in recorded',
    message: `Your check-in on ${input.date} was ${input.lateMinutes} minute${input.lateMinutes === 1 ? '' : 's'} late.`,
    type: 'WARNING',
    category: 'ATTENDANCE',
    priority: 'NORMAL',
    entityId: input.attendanceId,
    entityType: 'ATTENDANCE_RECORD',
    link: '/attendance',
  });
}

export async function notifyMissedCheckIn(input: {
  attendanceId: string;
  userId: string;
  date: string;
}): Promise<void> {
  if (!input.userId) return;
  await createNotification({
    id: `attendance-missed-${input.attendanceId}-${input.userId}`,
    userId: input.userId,
    title: 'Missed check-in',
    message: `No check-in was recorded for ${input.date}. Contact your manager or HR if this is incorrect.`,
    type: 'WARNING',
    category: 'ATTENDANCE',
    priority: 'HIGH',
    entityId: input.attendanceId,
    entityType: 'ATTENDANCE_RECORD',
    link: '/attendance',
  });
}

export async function notifyAttendanceCorrected(input: {
  attendanceId: string;
  userId: string;
  date: string;
  actorUserId?: string;
  summary?: string;
  revision: string;
}): Promise<void> {
  if (!input.userId || input.userId === input.actorUserId) return;
  await createNotification({
    id: `attendance-corrected-${input.attendanceId}-${input.revision}-${input.userId}`,
    userId: input.userId,
    title: 'Attendance record updated',
    message: `Your attendance for ${input.date} was updated${input.summary ? `: ${input.summary}` : '.'}`,
    type: 'INFO',
    category: 'ATTENDANCE',
    entityId: input.attendanceId,
    entityType: 'ATTENDANCE_RECORD',
    senderId: input.actorUserId || null,
    link: '/attendance',
  });
}

export async function notifyMovementApplied(input: {
  movementId: string;
  employeePk: string;
  movementType: string;
  effectiveDate: string;
}): Promise<void> {
  const portalUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
  if (!portalUserId) return;
  const { movementTypeLabelForNotify } = await import('./employeeMovementNotify.js');
  const label = movementTypeLabelForNotify(input.movementType);
  await createNotification({
    id: `movement-applied-${input.movementId}-${portalUserId}`,
    userId: portalUserId,
    title: 'Job change applied',
    message: `Your ${label.toLowerCase()} is now effective as of ${input.effectiveDate.slice(0, 10)}.`,
    type: 'SUCCESS',
    link: '/profile',
  });
}

export async function notifyMovementSubmitted(input: {
  movementId: string;
  employeePk: string;
  movementType: string;
  effectiveDate: string;
}): Promise<void> {
  const portalUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
  if (!portalUserId) return;
  const { movementTypeLabelForNotify } = await import('./employeeMovementNotify.js');
  const label = movementTypeLabelForNotify(input.movementType);
  const effective = String(input.effectiveDate || '').slice(0, 10);
  await createNotification({
    id: `movement-pending-${input.movementId}-${portalUserId}`,
    userId: portalUserId,
    title: 'Job change submitted',
    message: `Your ${label.toLowerCase()} request${
      effective ? ` (effective ${effective})` : ''
    } is pending approval.`,
    type: 'INFO',
    link: '/profile',
  });
}

export async function notifyAppraisalEmployeeSelfEval(input: {
  appraisalId: string;
  employeeUserId: string;
  periodName?: string;
}): Promise<void> {
  const userId = String(input.employeeUserId ?? '').trim();
  if (!userId) return;
  const period = String(input.periodName ?? '').trim();
  await createNotification({
    id: `appraisal-self-eval-${input.appraisalId}`,
    userId,
    title: 'Complete your KPI self-evaluation',
    message: period
      ? `Your manager completed their evaluation for ${period}. Submit your self-evaluation in My Performance.`
      : 'Your manager completed their evaluation. Submit your self-evaluation in My Performance.',
    type: 'WARNING',
    link: '/my-performance',
  });
}

export async function notifyOffboardingCompleted(input: {
  employeePk: string;
  employeeDisplayId: string;
  offboardType: 'resign' | 'terminate';
  reason?: string;
}): Promise<void> {
  const portalUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
  const action = input.offboardType === 'resign' ? 'resignation' : 'termination';
  if (portalUserId) {
    await createNotification({
      id: `offboard-employee-${input.employeeDisplayId}-${portalUserId}`,
      userId: portalUserId,
      title: 'Employment status updated',
      message: `Your ${action} has been processed. Contact HR if you have questions about final settlement.`,
      type: 'INFO',
      link: '/my-pay',
    });
  }
  await notifyRoles(['HR', 'ADMIN'], {
    idPrefix: `offboard-hr-${input.employeeDisplayId}`,
    title: 'Employee offboarded',
    message: `${input.employeeDisplayId} was offboarded (${action}).${input.reason ? ` Reason: ${input.reason}` : ''}`,
    type: 'WARNING',
    link: '/employees?status=inactive',
  });
}

export async function notifyEmployeeProfileChanged(input: {
  employeePk: string;
  employeeDisplayId: string;
  actorUserId?: string;
  changedFields: string[];
  compensationChanged?: boolean;
  revision: string;
}): Promise<void> {
  const userId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
  if (!userId || userId === input.actorUserId || input.changedFields.length === 0) return;
  const fields = input.changedFields
    .slice(0, 5)
    .map((field) => field.replace(/_/g, ' '))
    .join(', ');
  await createNotification({
    id: `employee-profile-${input.employeePk}-${input.revision}-${userId}`,
    userId,
    title: input.compensationChanged ? 'Compensation updated' : 'Employee profile updated',
    message: input.compensationChanged
      ? `Your compensation details were updated. Review your profile or contact HR with questions.`
      : `Your employee profile (${input.employeeDisplayId}) was updated: ${fields}.`,
    type: 'INFO',
    category: input.compensationChanged ? 'PAYROLL' : 'EMPLOYEE',
    priority: input.compensationChanged ? 'HIGH' : 'NORMAL',
    entityId: input.employeePk,
    entityType: 'EMPLOYEE',
    senderId: input.actorUserId || null,
    link: '/profile',
  });
}

export async function notifyPortalAccountReady(input: {
  userId: string;
  employeeDisplayId?: string;
}): Promise<void> {
  const userId = String(input.userId ?? '').trim();
  if (!userId) return;
  await createNotification({
    id: `portal-ready-${userId}`,
    userId,
    title: 'Your portal account is ready',
    message: input.employeeDisplayId
      ? `Welcome to HCMS. Your employee profile (${input.employeeDisplayId}) is active — explore the dashboard to get started.`
      : 'Welcome to HCMS. Your portal account is active — explore the dashboard to get started.',
    type: 'SUCCESS',
    link: '/dashboard',
  });
}

export async function notifyAccountEvent(input: {
  userId: string;
  event:
    | 'PASSWORD_RESET'
    | 'PASSWORD_CHANGED'
    | 'ACTIVATED'
    | 'DEACTIVATED'
    | 'FROZEN'
    | 'UNFROZEN'
    | 'ROLE_CHANGED'
    | 'NEW_DEVICE';
  actorUserId?: string | null;
  detail?: string;
  eventKey?: string;
}): Promise<void> {
  const userId = String(input.userId || '').trim();
  if (!userId) return;
  const definitions: Record<
    typeof input.event,
    { title: string; message: string; type: NotificationType; priority: NotificationPriority }
  > = {
    PASSWORD_RESET: {
      title: 'Password reset completed',
      message: 'Your password was reset successfully. If this was not you, contact an administrator.',
      type: 'SUCCESS',
      priority: 'HIGH',
    },
    PASSWORD_CHANGED: {
      title: 'Password changed',
      message: 'Your account password was changed. Other device sessions were signed out.',
      type: 'SUCCESS',
      priority: 'HIGH',
    },
    ACTIVATED: {
      title: 'Account activated',
      message: 'Your portal account is active and ready to use.',
      type: 'SUCCESS',
      priority: 'NORMAL',
    },
    DEACTIVATED: {
      title: 'Account deactivated',
      message: 'Your portal account was deactivated. Contact an administrator if you need access.',
      type: 'WARNING',
      priority: 'HIGH',
    },
    FROZEN: {
      title: 'Account frozen',
      message: 'Your portal account was frozen by an administrator.',
      type: 'WARNING',
      priority: 'HIGH',
    },
    UNFROZEN: {
      title: 'Account restored',
      message: 'Your portal account was restored and is active again.',
      type: 'SUCCESS',
      priority: 'NORMAL',
    },
    ROLE_CHANGED: {
      title: 'Account role changed',
      message: input.detail || 'Your access role was updated by an administrator.',
      type: 'INFO',
      priority: 'HIGH',
    },
    NEW_DEVICE: {
      title: 'New device login',
      message: input.detail
        ? `A successful login was recorded from ${input.detail}.`
        : 'A successful login was recorded from a new device.',
      type: 'WARNING',
      priority: 'HIGH',
    },
  };
  const def = definitions[input.event];
  await createNotification({
    id: `account-${input.event.toLowerCase()}-${input.eventKey || Date.now()}-${userId}`,
    userId,
    title: def.title,
    message: def.message,
    type: def.type,
    category: 'AUTHENTICATION',
    priority: def.priority,
    entityId: userId,
    entityType: 'USER_ACCOUNT',
    senderId: input.actorUserId || null,
    link: '/account-settings',
  });
}

export async function notifyPermissionOverrideApplied(input: {
  userId: string;
  permissionName?: string;
  overrideType?: string;
  eventKey?: string;
}): Promise<void> {
  const userId = String(input.userId ?? '').trim();
  if (!userId) return;
  await createNotification({
    id: `perm-applied-${userId}-${input.eventKey || Date.now()}`,
    userId,
    title: 'Permissions updated',
    message: `An administrator ${input.overrideType === 'REVOKE' ? 'revoked' : 'granted'} access${
      input.permissionName ? ` for ${input.permissionName}` : ''
    } on your account.`,
    type: 'INFO',
    link: '/account-settings',
  });
}

export async function notifyRolePermissionsChanged(input: {
  role: string;
  actorUserId?: string;
  revision: string;
}): Promise<void> {
  const users = await User.findAll({
    where: { isActive: true, role: String(input.role).toUpperCase() },
    attributes: ['id'],
  });
  await notifyUserIds(
    users
      .map((user) => String(user.get('id')))
      .filter((userId) => userId !== String(input.actorUserId || '')),
    {
      idPrefix: `role-permissions-${String(input.role).toLowerCase()}-${input.revision}`,
      title: 'Role permissions changed',
      message: `Access permissions for the ${input.role} role were updated.`,
      type: 'INFO',
      category: 'ACCESS',
      priority: 'HIGH',
      entityId: String(input.role).toUpperCase(),
      entityType: 'ROLE',
      senderId: input.actorUserId || null,
      link: '/permissions?tab=matrix',
    }
  );
}

export async function notifyChatDirectMessage(input: {
  messageId: string;
  senderId: string;
  receiverId: string;
  preview: string;
}): Promise<void> {
  const receiverId = String(input.receiverId ?? '').trim();
  const senderId = String(input.senderId ?? '').trim();
  if (!receiverId || receiverId === senderId) return;
  const senderName = await getUserDisplayName(senderId);
  const preview = String(input.preview || '').trim().slice(0, 120) || 'New message';
  await createNotification({
    id: `chat-dm-${input.messageId}-${receiverId}`,
    userId: receiverId,
    title: `Message from ${senderName}`,
    message: preview,
    type: 'INFO',
    link: `/chat?user=${encodeURIComponent(senderId)}`,
  });
}

export async function notifyChatGroupMessage(input: {
  messageId: string;
  groupId: string;
  groupName: string;
  senderId: string;
  memberUserIds: string[];
  preview: string;
}): Promise<void> {
  const senderId = String(input.senderId ?? '').trim();
  const senderName = await getUserDisplayName(senderId);
  const preview = String(input.preview || '').trim().slice(0, 120) || 'New message';
  const recipients = [...new Set(input.memberUserIds.map((id) => String(id).trim()).filter(Boolean))].filter(
    (id) => id !== senderId
  );
  if (!recipients.length) return;
  await notifyUserIds(recipients, {
    idPrefix: `chat-grp-${input.messageId}`,
    title: `${input.groupName || 'Group chat'}`,
    message: `${senderName}: ${preview}`,
    type: 'INFO',
    link: `/chat?group=${encodeURIComponent(input.groupId)}`,
  });
}

export async function notifyFinalSettlementTransition(input: {
  settlementId: string;
  employeePk: string;
  month: string;
  action: string;
  actorUserId: string;
  createdByUserId?: string | null;
  status: string;
}): Promise<void> {
  const settlementId = String(input.settlementId);
  const month = String(input.month || '').trim() || 'payroll period';
  const action = String(input.action || '').toLowerCase();
  const link = `/payroll/final-settlement?settlement=${encodeURIComponent(settlementId)}`;

  if (action === 'submit') {
    await notifyRoles(['HR', 'ADMIN'], {
      idPrefix: `fs-hr-review-${settlementId}`,
      title: 'Final settlement needs HR review',
      message: `A final settlement for ${month} was submitted and awaits HR review.`,
      type: 'WARNING',
      link,
    });
    return;
  }

  if (action === 'hr_approve') {
    await notifyRoles(['ADMIN', 'HR'], {
      idPrefix: `fs-finance-review-${settlementId}`,
      title: 'Final settlement needs finance review',
      message: `HR approved the ${month} final settlement. Finance review is next.`,
      type: 'WARNING',
      link,
    });
    return;
  }

  if (action === 'finance_approve') {
    await notifyRoles(['ADMIN'], {
      idPrefix: `fs-mgmt-approval-${settlementId}`,
      title: 'Final settlement needs final approval',
      message: `Finance approved the ${month} final settlement. Management sign-off is required.`,
      type: 'WARNING',
      link,
    });
    return;
  }

  if (action === 'management_approve') {
    const notifyIds = new Set<string>();
    const createdBy = String(input.createdByUserId ?? '').trim();
    if (createdBy) notifyIds.add(createdBy);
    const employeeUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
    if (employeeUserId) notifyIds.add(employeeUserId);
    await notifyUserIds([...notifyIds], {
      idPrefix: `fs-approved-${settlementId}`,
      title: 'Final settlement approved',
      message: `The final settlement for ${month} was approved.`,
      type: 'SUCCESS',
      link,
    });
    return;
  }

  if (action === 'reject') {
    const notifyIds = new Set<string>();
    const createdBy = String(input.createdByUserId ?? '').trim();
    if (createdBy) notifyIds.add(createdBy);
    const employeeUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
    if (employeeUserId) notifyIds.add(employeeUserId);
    await notifyUserIds([...notifyIds], {
      idPrefix: `fs-rejected-${settlementId}`,
      title: 'Final settlement rejected',
      message: `The final settlement for ${month} was rejected.`,
      type: 'WARNING',
      link,
    });
    return;
  }

  if (action === 'record_payment') {
    const notifyIds = new Set<string>();
    const createdBy = String(input.createdByUserId ?? '').trim();
    if (createdBy) notifyIds.add(createdBy);
    const employeeUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
    if (employeeUserId) notifyIds.add(employeeUserId);
    await notifyUserIds([...notifyIds], {
      idPrefix: `fs-paid-${settlementId}`,
      title: 'Final settlement payment recorded',
      message: `Payment for the ${month} final settlement has been recorded.`,
      type: 'SUCCESS',
      link,
    });
    return;
  }

  if (action === 'skip_payment') {
    await notifyRoles(['ADMIN', 'HR'], {
      idPrefix: `fs-removal-approval-${settlementId}`,
      title: 'Final settlement removal approval needed',
      message: `Payment was skipped for the ${month} final settlement. Approve employee removal to close the case.`,
      type: 'WARNING',
      link,
    });
    const createdBy = String(input.createdByUserId ?? '').trim();
    if (createdBy) {
      await createNotification({
        id: `fs-skip-payment-${settlementId}-${createdBy}`,
        userId: createdBy,
        title: 'Final settlement payment skipped',
        message: `Your skip-payment request for ${month} is awaiting removal approval.`,
        type: 'INFO',
        link,
      });
    }
    return;
  }

  if (action === 'approve_final_removal') {
    const notifyIds = new Set<string>();
    const createdBy = String(input.createdByUserId ?? '').trim();
    if (createdBy) notifyIds.add(createdBy);
    const employeeUserId = await resolvePortalUserIdForEmployeeRef(input.employeePk);
    if (employeeUserId) notifyIds.add(employeeUserId);
    await notifyUserIds([...notifyIds], {
      idPrefix: `fs-locked-${settlementId}`,
      title: 'Final settlement closed without payment',
      message: `The ${month} final settlement was closed without payment after removal approval.`,
      type: 'INFO',
      link,
    });
  }
}
