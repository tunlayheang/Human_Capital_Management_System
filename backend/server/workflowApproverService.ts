import { Op } from 'sequelize';
import { Department, Employee, Position, User } from './db.js';
import { ACTIVE_EMPLOYEE_STATUS } from './dashboardChartStats.js';
import { isPlaceholderDraftEmail } from './employeeDraft.js';
import { hasAssignedEmployeeDisplayId } from './employeeDirectoryEligibility.js';
import { positionLevelLabel } from './positionCatalog.js';
import { loadPositionLevelsFromDb } from './positionLevelSettingsService.js';
import { listSystemAdminEmployeeExclusions } from './systemAdminAccount.js';
import { portalLoginIsActive } from './userAuth.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import { computeApproverTierRank } from './approverTierRank.js';
import { formatAccessRoleLabel } from './accessRole.js';

export type WorkflowApproverCandidate = {
  userId: string | null;
  employeePk: string;
  firstName?: string;
  lastName?: string;
  firstNameKh?: string;
  lastNameKh?: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  levelCode: string | null;
  levelLabel: string | null;
  employeeCode: string | null;
  positionTitle: string | null;
  departmentId: string;
  departmentName: string;
  isDepartmentHead?: boolean;
  hasPortalAccess: boolean;
};

export type WorkflowApproverDepartmentGroup = {
  departmentId: string;
  departmentName: string;
  candidates: WorkflowApproverCandidate[];
};

const GENERAL_DEPT_ID = '__general__';
const GENERAL_DEPT_NAME = 'Unassigned';

function portalRoleLabel(role: unknown): string {
  const r = String(role ?? 'EMPLOYEE').trim().toUpperCase();
  if (r === 'SUPER_ADMIN') return 'Super Admin';
  const labeled = formatAccessRoleLabel(r);
  if (labeled) return labeled;
  return r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function indexPortalUsers(users: any[]) {
  const byEmployeePk = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const user of users) {
    const plain = user.get ? user.get({ plain: true }) : user;
    if (!portalLoginIsActive(plain)) continue;
    const empPk = String(plain.employeeId ?? '').trim();
    if (empPk) byEmployeePk.set(empPk, plain);
    const email = String(plain.email ?? '').trim().toLowerCase();
    if (email) byEmail.set(email, plain);
  }
  return { byEmployeePk, byEmail };
}

function resolvePortalUserForEmployee(
  empPlain: Record<string, unknown>,
  users: ReturnType<typeof indexPortalUsers>
): any | null {
  const empPk = String(empPlain.id ?? '').trim();
  if (empPk && users.byEmployeePk.has(empPk)) {
    return users.byEmployeePk.get(empPk)!;
  }
  const email = String(empPlain.email ?? '').trim().toLowerCase();
  if (email && !isPlaceholderDraftEmail(email) && users.byEmail.has(email)) {
    return users.byEmail.get(email)!;
  }
  return null;
}

/** Active employees grouped by department for workflow approver selection. */
export async function listWorkflowApproverGroups(
  excludeUserId?: string
): Promise<WorkflowApproverDepartmentGroup[]> {
  await loadPositionLevelsFromDb();

  const [departments, employees, adminExclusions] = await Promise.all([
    Department.findAll({
      attributes: ['id', 'name', 'managerId', 'department_head_id'],
      order: [['name', 'ASC']],
      raw: true,
    }) as Promise<
      { id: string; name?: string; managerId?: string | null; department_head_id?: string | null }[]
    >,
    Employee.findAll({
      where: { status: ACTIVE_EMPLOYEE_STATUS },
      attributes: [
        'id',
        'employee_id',
        'first_name',
        'last_name',
        'first_name_kh',
        'last_name_kh',
        'email',
        'phone',
        'department_id',
        'position_id',
      ],
      include: [
        {
          model: Position,
          as: 'position',
          attributes: ['title', 'level', 'access_role'],
          required: false,
        },
      ],
      order: [
        ['first_name', 'ASC'],
        ['last_name', 'ASC'],
      ],
    }),
    listSystemAdminEmployeeExclusions(),
  ]);

  const exclusionIds = new Set(adminExclusions.employeeIds.map(String));
  const exclusionEmails = new Set(adminExclusions.emails.map((e) => e.toLowerCase()));

  const deptNameById = new Map<string, string>();
  const deptHeadUserIds = new Set<string>();
  for (const dept of departments) {
    const deptId = String(dept.id ?? '').trim();
    if (!deptId) continue;
    deptNameById.set(deptId, String(dept.name ?? '').trim() || deptId);
    const headUserId = String(dept.managerId ?? '').trim();
    if (headUserId) deptHeadUserIds.add(headUserId);
  }

  const employeeRows = employees
    .map((row) => row.get({ plain: true }) as Record<string, unknown>)
    .filter((plain) => {
      const id = String(plain.id ?? '').trim();
      if (!id || exclusionIds.has(id)) return false;
      if (!hasAssignedEmployeeDisplayId(plain)) return false;
      const email = String(plain.email ?? '').trim().toLowerCase();
      return !(email && exclusionEmails.has(email));
    });

  const employeePks = employeeRows.map((plain) => String(plain.id ?? '').trim()).filter(Boolean);
  const employeeEmails = employeeRows
    .map((plain) => String(plain.email ?? '').trim())
    .filter((email) => email && !isPlaceholderDraftEmail(email));

  const portalUsers = employeePks.length
    ? await User.findAll({
        where: {
          [Op.or]: [
            { employeeId: { [Op.in]: employeePks } },
            ...(employeeEmails.length ? [{ email: { [Op.in]: employeeEmails } }] : []),
          ],
        },
        attributes: [...USER_ACCOUNT_ATTRIBUTES],
      })
    : [];

  const userIndex = indexPortalUsers(portalUsers);
  const candidatesByDept = new Map<string, Map<string, WorkflowApproverCandidate>>();

  for (const plain of employeeRows) {
    const employeePk = String(plain.id ?? '').trim();
    if (!employeePk) continue;

    const portalUser = resolvePortalUserForEmployee(plain, userIndex);
    const userId = portalUser ? String(portalUser.id ?? '').trim() : null;
    if (excludeUserId && userId === excludeUserId) continue;

    const deptId = String(plain.department_id ?? '').trim() || GENERAL_DEPT_ID;
    const departmentName =
      deptId === GENERAL_DEPT_ID
        ? GENERAL_DEPT_NAME
        : deptNameById.get(deptId) || deptId;

    if (!candidatesByDept.has(deptId)) {
      candidatesByDept.set(deptId, new Map());
    }

    const pos = (plain.position ?? {}) as Record<string, unknown>;
    const levelCode = pos.level != null ? String(pos.level).trim() : null;
    const first = String(plain.first_name ?? '').trim();
    const last = String(plain.last_name ?? '').trim();
    const name = `${first} ${last}`.trim() || String(plain.employee_id ?? employeePk);
    const portalRole = portalUser
      ? String(portalUser.role ?? 'EMPLOYEE').toUpperCase()
      : String(pos.access_role ?? 'EMPLOYEE').toUpperCase();

    const candidate: WorkflowApproverCandidate = {
      userId: userId || null,
      employeePk,
      firstName: first,
      lastName: last,
      firstNameKh: String(plain.first_name_kh ?? '').trim(),
      lastNameKh: String(plain.last_name_kh ?? '').trim(),
      name,
      email: portalUser ? String(portalUser.email ?? plain.email ?? '') : String(plain.email ?? ''),
      role: portalRole,
      roleLabel: portalRoleLabel(portalRole),
      levelCode,
      levelLabel: levelCode ? positionLevelLabel(levelCode) : null,
      employeeCode: plain.employee_id ? String(plain.employee_id) : null,
      positionTitle: pos.title ? String(pos.title) : null,
      departmentId: deptId,
      departmentName,
      isDepartmentHead: Boolean(userId && deptHeadUserIds.has(userId)),
      hasPortalAccess: Boolean(userId),
    };

    const bucket = candidatesByDept.get(deptId)!;
    const key = userId || `emp:${employeePk}`;
    bucket.set(key, candidate);
  }

  const groups: WorkflowApproverDepartmentGroup[] = [];
  for (const [departmentId, bucket] of candidatesByDept) {
    const candidates = [...bucket.values()].sort(
      (a, b) =>
        computeApproverTierRank({
          role: a.role,
          levelCode: a.levelCode,
          positionTitle: a.positionTitle,
          isDepartmentHead: a.isDepartmentHead,
        }) -
          computeApproverTierRank({
            role: b.role,
            levelCode: b.levelCode,
            positionTitle: b.positionTitle,
            isDepartmentHead: b.isDepartmentHead,
          }) || a.name.localeCompare(b.name)
    );
    if (!candidates.length) continue;
    groups.push({
      departmentId,
      departmentName:
        departmentId === GENERAL_DEPT_ID
          ? GENERAL_DEPT_NAME
          : deptNameById.get(departmentId) || departmentId,
      candidates,
    });
  }

  return groups.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
}

export async function validateAssignedApproverUserId(
  assignedApproverUserId: unknown,
  excludeUserId?: string
): Promise<string> {
  const ids = await validateAssignedApproverUserIds(
    assignedApproverUserId != null && String(assignedApproverUserId).trim()
      ? [assignedApproverUserId]
      : [],
    excludeUserId
  );
  return ids[0];
}

export async function validateAssignedApproverUserIds(
  assignedApproverUserIds: unknown,
  excludeUserId?: string
): Promise<string[]> {
  const raw = Array.isArray(assignedApproverUserIds)
    ? assignedApproverUserIds
    : assignedApproverUserIds != null && String(assignedApproverUserIds).trim()
      ? [assignedApproverUserIds]
      : [];

  // Preserve selection order (first id remains first approver).
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const rawId of raw) {
    const id = String(rawId ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) {
    throw Object.assign(new Error('Select at least one approver before submitting.'), {
      status: 400,
      code: 'APPROVER_REQUIRED',
    });
  }
  if (excludeUserId && ids.includes(String(excludeUserId))) {
    throw Object.assign(new Error('You cannot assign yourself as an approver.'), { status: 400 });
  }

  for (const id of ids) {
    const user: any = await User.findByPk(id, { attributes: ['id', 'role', 'isActive'] });
    if (!user || user.isActive === false || !portalLoginIsActive(user)) {
      throw Object.assign(
        new Error('One or more selected approvers do not have active portal access.'),
        { status: 400 }
      );
    }
  }
  return ids;
}

export function canActAsMovementApprover(
  actor: { id?: string; role?: string },
  movement: { assigned_approver_user_id?: string | null; created_by?: string | null },
  options?: {
    assignedApproverUserIds?: string[];
    pendingOnly?: boolean;
    approverStatuses?: Map<string, string>;
    /** When true, only the current sequential approver may act (reject/return/approve). */
    sequential?: boolean;
    currentApproverUserId?: string | null;
  }
): boolean {
  const role = String(actor.role ?? '').toUpperCase();
  const actorId = String(actor.id ?? '').trim();
  if (!actorId) return false;

  const assignedIds =
    options?.assignedApproverUserIds?.length
      ? options.assignedApproverUserIds
      : movement.assigned_approver_user_id
        ? [String(movement.assigned_approver_user_id)]
        : [];

  if (!assignedIds.length) {
    return ['HR', 'ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(role);
  }

  if (!assignedIds.includes(actorId)) return false;

  if (options?.sequential && options.currentApproverUserId) {
    return options.currentApproverUserId === actorId;
  }

  if (options?.pendingOnly && options.approverStatuses) {
    return options.approverStatuses.get(actorId) === 'pending';
  }
  return true;
}

export function canActAsFinalAppraisalApprover(
  actor: { id?: string; role?: string; userId?: string },
  appraisal: {
    assigned_final_approver_user_id?: string | null;
    currentApproverUserId?: string | null;
  },
  options?: {
    assignedFinalApproverUserIds?: string[];
    sequential?: boolean;
  }
): boolean {
  const actorId = String(actor.id ?? actor.userId ?? '').trim();
  if (!actorId) return false;

  const assignedIds =
    options?.assignedFinalApproverUserIds?.length
      ? options.assignedFinalApproverUserIds
      : appraisal.assigned_final_approver_user_id
        ? [String(appraisal.assigned_final_approver_user_id)]
        : [];

  if (!assignedIds.length) return false;
  if (!assignedIds.includes(actorId)) return false;

  if (options?.sequential) {
    const current = String(
      appraisal.currentApproverUserId ?? assignedIds[0] ?? ''
    ).trim();
    return current === actorId;
  }

  return true;
}
