import { Op } from 'sequelize';
import { Employee, Project, ProjectAssignment, Task, User } from './db.js';
import { parseSoftDeleteMode, softDeleteWhere, type SoftDeleteListMode } from './softDelete.js';

/** Org-wide project visibility — Admin/HR only. Managers and staff are assignment-scoped. */
const VIEW_ALL_PROJECTS_ROLES = new Set(['ADMIN', 'HR', 'SUPER_ADMIN']);

export function canViewAllProjects(role: string | undefined): boolean {
  return VIEW_ALL_PROJECTS_ROLES.has(String(role || '').toUpperCase());
}

/** @deprecated Use canViewAllProjects — permissions no longer grant org-wide project lists. */
export async function userHasElevatedProjectAccess(
  _userId: string,
  role: string | undefined
): Promise<boolean> {
  return canViewAllProjects(role);
}

/** Portal user id + linked employee row id(s) for assignment matching. */
export async function resolveAssignmentIdentityIds(userId: string): Promise<string[]> {
  const ids = new Set<string>([String(userId)]);
  const user = await User.findByPk(userId);
  if (!user) return [...ids];

  const plain = user.get({ plain: true }) as Record<string, unknown>;
  const employeeId = plain.employeeId ?? plain.employee_id;
  if (employeeId) ids.add(String(employeeId));

  const email = String(plain.email || '').trim().toLowerCase();
  if (email) {
    const emp = await Employee.findOne({ where: { email } });
    if (emp) ids.add(String(emp.get('id')));
  }

  return [...ids];
}

export async function syncProjectAssignments(
  projectId: string,
  memberUserIds: string[],
  leadId?: string
): Promise<void> {
  const wanted = new Set<string>();
  for (const id of memberUserIds) {
    const v = String(id || '').trim();
    if (v) wanted.add(v);
  }
  if (leadId) wanted.add(String(leadId));

  const identityLists = await Promise.all(
    [...wanted].map((uid) => resolveAssignmentIdentityIds(uid))
  );
  const employeeKeys = new Set<string>();
  for (const list of identityLists) {
    for (const id of list) employeeKeys.add(id);
  }

  const existing = await ProjectAssignment.findAll({
    where: { projectId, isActive: true },
  });

  const keepKeys = new Set<string>();
  for (const key of employeeKeys) {
    keepKeys.add(key);
    const found = existing.find((row) => String(row.get('employeeId')) === key);
    if (!found) {
      await ProjectAssignment.create({
        id: `pa-${projectId}-${key}-${Date.now()}`,
        projectId,
        employeeId: key,
        role: key === leadId ? 'LEAD' : 'MEMBER',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  for (const row of existing) {
    const empId = String(row.get('employeeId'));
    if (!keepKeys.has(empId)) {
      await row.update({ isActive: false, updatedAt: new Date() });
    }
  }
}

export async function ensureAssigneeOnProject(
  projectId: string,
  assigneeUserId: string
): Promise<void> {
  if (!projectId || !assigneeUserId) return;
  const ids = await resolveAssignmentIdentityIds(assigneeUserId);
  for (const employeeId of ids) {
    const existing = await ProjectAssignment.findOne({
      where: { projectId, employeeId, isActive: true },
    });
    if (existing) continue;
    await ProjectAssignment.create({
      id: `pa-${projectId}-${employeeId}-${Date.now()}`,
      projectId,
      employeeId,
      role: 'MEMBER',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

async function loadMembersByProjectIds(
  projectIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!projectIds.length) return map;

  const rows = await ProjectAssignment.findAll({
    where: { projectId: { [Op.in]: projectIds }, isActive: true },
  });

  for (const row of rows) {
    const pid = String(row.get('projectId'));
    const empId = String(row.get('employeeId'));
    const list = map.get(pid) ?? [];
    if (!list.includes(empId)) list.push(empId);
    map.set(pid, list);
  }
  return map;
}

export type ListProjectsOptions = {
  /** Self-service My Project: only projects where user has assigned tasks */
  tasksOnly?: boolean;
  /** Soft-delete listing: exclude (default), only deleted, or include both. */
  deleted?: SoftDeleteListMode | string;
};

export async function listProjectsForUser(
  userId: string,
  role: string | undefined,
  options?: ListProjectsOptions
): Promise<Record<string, unknown>[]> {
  const deletedMode = parseSoftDeleteMode(options?.deleted);
  const all = await Project.findAll({
    where: softDeleteWhere(deletedMode),
    order: [['createdAt', 'DESC']],
  });
  const plains = all.map((p) => p.get({ plain: true }) as Record<string, unknown>);

  // Self-service: projects the user is assigned to (membership / lead / task assignee).
  if (options?.tasksOnly === true) {
    const allowedIds = await getAssignedProjectIdSet(userId);
    return attachMembers(plains.filter((p) => allowedIds.has(String(p.id))));
  }

  // Management view: Admin/HR see everything; Managers see only projects they created;
  // other staff see lead/assignment/task-assigned projects.
  if (canViewAllProjects(role)) {
    return attachMembers(plains);
  }

  const normalizedRole = String(role || '').toUpperCase();
  const allowedIds =
    normalizedRole === 'MANAGER'
      ? await getCreatedProjectIdSet(userId)
      : await getAssignedProjectIdSet(userId);
  return attachMembers(plains.filter((p) => allowedIds.has(String(p.id))));
}

/** Projects where the user has at least one task assigned to them (legacy helper). */
export async function getTaskAssignedProjectIdSet(userId: string): Promise<Set<string>> {
  const allowed = new Set<string>();
  const identityIds = await resolveAssignmentIdentityIds(userId);
  if (!identityIds.length) return allowed;

  try {
    const tasks = (await Task.findAll({
      where: {
        assigneeId: { [Op.in]: identityIds },
        ...softDeleteWhere('exclude'),
      },
      attributes: ['id', 'projectId'],
    })) as Array<{ get: (k: string) => unknown }>;
    for (const t of tasks) {
      const pid = t.get('projectId');
      if (pid) allowed.add(String(pid));
    }
  } catch {
    /* projectId or assigneeId column may be missing until migration runs */
  }

  return allowed;
}

/**
 * Management-scoped projects for Manager: only projects they created.
 */
export async function getCreatedProjectIdSet(userId: string): Promise<Set<string>> {
  const allowed = new Set<string>();
  const identityIds = await resolveAssignmentIdentityIds(userId);
  if (!identityIds.length) return allowed;

  const rows = await Project.findAll({
    where: { createdBy: { [Op.in]: identityIds } },
    attributes: ['id'],
  });
  for (const p of rows) allowed.add(String(p.get('id')));
  return allowed;
}

/**
 * Management-scoped projects for Staff:
 * lead, active assignment, or task assignee.
 */
export async function getAssignedProjectIdSet(userId: string): Promise<Set<string>> {
  const allowed = new Set<string>();
  const identityIds = await resolveAssignmentIdentityIds(userId);
  if (!identityIds.length) return allowed;

  const asLead = await Project.findAll({
    where: { leadId: { [Op.in]: identityIds } },
  });
  for (const p of asLead) allowed.add(String(p.get('id')));

  const assignments = await ProjectAssignment.findAll({
    where: { employeeId: { [Op.in]: identityIds }, isActive: true },
  });
  for (const a of assignments) allowed.add(String(a.get('projectId')));

  try {
    const tasks = (await Task.findAll({
      where: {
        assigneeId: { [Op.in]: identityIds },
        ...softDeleteWhere('exclude'),
      },
      attributes: ['id', 'projectId'],
    })) as Array<{ get: (k: string) => unknown }>;
    for (const t of tasks) {
      const pid = t.get('projectId');
      if (pid) allowed.add(String(pid));
    }
  } catch {
    /* projectId column may be missing until migration runs */
  }

  return allowed;
}

/** Count ACTIVE projects visible on the Manager/Staff dashboard card. */
export async function countActiveAssignedProjects(
  userId: string,
  role?: string
): Promise<number> {
  const ids =
    String(role || '').toUpperCase() === 'MANAGER'
      ? await getCreatedProjectIdSet(userId)
      : await getAssignedProjectIdSet(userId);
  if (!ids.size) return 0;
  return Project.count({
    where: {
      id: { [Op.in]: [...ids] },
      status: 'ACTIVE',
    },
  });
}

/** Compact progress rows for Manager dashboard project card. */
export async function listAssignedProjectProgress(
  userId: string,
  limit = 5,
  role?: string
): Promise<Array<{ name: string; deadline: string; status: string; progress: number }>> {
  const ids =
    String(role || '').toUpperCase() === 'MANAGER'
      ? await getCreatedProjectIdSet(userId)
      : await getAssignedProjectIdSet(userId);
  if (!ids.size) return [];
  const rows = await Project.findAll({
    where: { id: { [Op.in]: [...ids] }, status: 'ACTIVE' },
    order: [['deadline', 'ASC']],
    limit,
  });
  return rows.map((p) => {
    const plain = p.get({ plain: true }) as Record<string, unknown>;
    const progress = Number(plain.progress ?? 0);
    const deadline = plain.deadline != null ? String(plain.deadline).slice(0, 10) : '—';
    return {
      name: String(plain.title ?? 'Project'),
      deadline,
      status: progress >= 70 ? 'on-track' : 'at-risk',
      progress: Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)),
    };
  });
}

export async function userCanAccessProject(
  userId: string,
  role: string | undefined,
  projectId: string,
  options?: ListProjectsOptions
): Promise<boolean> {
  if (options?.tasksOnly === true) {
    const allowed = await getAssignedProjectIdSet(userId);
    return allowed.has(projectId);
  }
  if (canViewAllProjects(role)) return true;
  const allowed =
    String(role || '').toUpperCase() === 'MANAGER'
      ? await getCreatedProjectIdSet(userId)
      : await getAssignedProjectIdSet(userId);
  return allowed.has(projectId);
}

async function attachMembers(
  projects: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = projects.map((p) => String(p.id));
  const membersMap = await loadMembersByProjectIds(ids);

  return projects.map((p) => {
    const id = String(p.id);
    const fromAssignments = membersMap.get(id) ?? [];
    const leadId = p.leadId ? String(p.leadId) : '';
    const members = Array.from(new Set([...fromAssignments, ...(leadId ? [leadId] : [])]));
    return { ...p, members };
  });
}

/**
 * Ensure every project lead + task assignee has an active ProjectAssignment row.
 * Fixes empty Manager/Staff project lists after visibility scoping.
 */
export async function backfillProjectMemberships(): Promise<{
  projects: number;
  leadsEnsured: number;
  assigneesEnsured: number;
}> {
  const projects = await Project.findAll();
  let leadsEnsured = 0;
  let assigneesEnsured = 0;

  for (const project of projects) {
    const projectId = String(project.get('id'));
    const leadId = project.get('leadId') ? String(project.get('leadId')) : '';
    const existing = await ProjectAssignment.findAll({
      where: { projectId, isActive: true },
    });
    const memberIds = existing.map((row) => String(row.get('employeeId')));

    if (leadId) {
      const before = memberIds.length;
      await syncProjectAssignments(projectId, memberIds, leadId);
      const after = await ProjectAssignment.count({
        where: { projectId, isActive: true },
      });
      if (after > before || !memberIds.includes(leadId)) leadsEnsured += 1;
    }
  }

  try {
    const tasks = (await Task.findAll({
      attributes: ['projectId', 'assigneeId'],
      where: softDeleteWhere('exclude'),
    })) as Array<{ get: (k: string) => unknown }>;

    const seen = new Set<string>();
    for (const task of tasks) {
      const projectId = String(task.get('projectId') || '');
      const assigneeId = String(task.get('assigneeId') || '');
      if (!projectId || !assigneeId) continue;
      const key = `${projectId}:${assigneeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = await ProjectAssignment.count({
        where: { projectId, employeeId: assigneeId, isActive: true },
      });
      await ensureAssigneeOnProject(projectId, assigneeId);
      const after = await ProjectAssignment.count({
        where: { projectId, isActive: true },
      });
      if (after > before) assigneesEnsured += 1;
    }
  } catch {
    /* tasks.projectId may be missing until migration */
  }

  return { projects: projects.length, leadsEnsured, assigneesEnsured };
}
