import { Op } from 'sequelize';
import { Task } from './db.js';
import {
  canViewAllProjects,
  getCreatedProjectIdSet,
  resolveAssignmentIdentityIds,
} from './projectAccessService.js';
import { parseSoftDeleteMode, softDeleteWhere, type SoftDeleteListMode } from './softDelete.js';

const PRIVILEGED_TASK_ROLES = new Set(['ADMIN', 'HR', 'SUPER_ADMIN']);

export function isPrivilegedTaskRole(role: string | undefined): boolean {
  return PRIVILEGED_TASK_ROLES.has(String(role || '').toUpperCase());
}

/** True when `assigneeId` matches the portal user or a linked employee identity. */
export async function isTaskAssignee(
  userId: string,
  assigneeId: string | null | undefined
): Promise<boolean> {
  const assignee = String(assigneeId ?? '').trim();
  if (!assignee || !userId) return false;
  const identities = await resolveAssignmentIdentityIds(String(userId));
  return identities.includes(assignee);
}

export type ListTasksForUserOptions = {
  deleted?: string | SoftDeleteListMode;
  projectId?: string | null;
};

/**
 * Task list scoping:
 * - Admin/HR: all tasks
 * - Manager: tasks on projects they created, plus tasks assigned to them
 * - Staff/Employee: only tasks assigned to them
 */
export async function listTasksForUser(
  userId: string,
  role: string | undefined,
  options?: ListTasksForUserOptions
): Promise<Record<string, unknown>[]> {
  const deletedMode = parseSoftDeleteMode(options?.deleted);
  const where: Record<string, unknown> = {
    ...softDeleteWhere(deletedMode),
  };
  const projectId = String(options?.projectId ?? '').trim();
  if (projectId) where.projectId = projectId;

  const normalized = String(role || '').toUpperCase();

  if (isPrivilegedTaskRole(normalized) || canViewAllProjects(normalized)) {
    const rows = await Task.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((r) => r.get({ plain: true }) as Record<string, unknown>);
  }

  const identityIds = await resolveAssignmentIdentityIds(String(userId));
  if (!identityIds.length) return [];

  if (normalized === 'MANAGER') {
    const created = await getCreatedProjectIdSet(userId);
    const orClause: Array<Record<string, unknown>> = [
      { assigneeId: { [Op.in]: identityIds } },
    ];
    if (created.size) {
      orClause.push({ projectId: { [Op.in]: [...created] } });
    }
    const rows = await Task.findAll({
      where: { ...where, [Op.or]: orClause },
      order: [['createdAt', 'DESC']],
    });
    return rows.map((r) => r.get({ plain: true }) as Record<string, unknown>);
  }

  // Staff / Employee: assignee-only.
  const rows = await Task.findAll({
    where: {
      ...where,
      assigneeId: { [Op.in]: identityIds },
    },
    order: [['createdAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }) as Record<string, unknown>);
}

/** Fields staff may update on their own assigned tasks. */
export const STAFF_TASK_UPDATE_FIELDS = ['status', 'progress', 'loggedHours'] as const;

/**
 * Staff may only update assigned tasks (status/progress/logged hours).
 * Privileged roles return full edit.
 * Managers may fully edit tasks on projects they created, else assignee-only.
 */
export async function resolveTaskUpdateAccess(opts: {
  userId: string;
  role: string | undefined;
  task: { assigneeId?: string | null; projectId?: string | null };
}): Promise<
  | { mode: 'full' }
  | { mode: 'assignee'; fields: readonly string[] }
  | { mode: 'deny'; message: string }
> {
  const role = String(opts.role || '').toUpperCase();
  if (isPrivilegedTaskRole(role) || canViewAllProjects(role)) {
    return { mode: 'full' };
  }

  const assigned = await isTaskAssignee(opts.userId, opts.task.assigneeId);

  if (role === 'MANAGER') {
    const created = await getCreatedProjectIdSet(opts.userId);
    const projectId = String(opts.task.projectId ?? '').trim();
    if (projectId && created.has(projectId)) return { mode: 'full' };
    if (assigned) return { mode: 'assignee', fields: STAFF_TASK_UPDATE_FIELDS };
    return {
      mode: 'deny',
      message: 'You can only update tasks on projects you created, or tasks assigned to you.',
    };
  }

  if (!assigned) {
    return {
      mode: 'deny',
      message: 'You can only update tasks assigned to you.',
    };
  }
  return { mode: 'assignee', fields: STAFF_TASK_UPDATE_FIELDS };
}
