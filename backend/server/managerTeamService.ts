import { Op } from 'sequelize';
import { Department, Employee, User } from './db.js';
import { ACTIVE_EMPLOYEE_STATUS } from './dashboardChartStats.js';
import { findEmployeeByUserId } from './userAccountService.js';

export type ManagerTeamResolution = {
  departmentIds: string[];
  employeeIds: string[];
  userIds: string[];
};

/**
 * Resolve the Manager's team for dashboard / approval queues.
 * Prefer departments they manage (managerId / department head), then fall back
 * to their own department. Never returns an unfiltered company-wide list.
 */
export async function resolveManagerTeam(managerUserId: string): Promise<ManagerTeamResolution> {
  const empty: ManagerTeamResolution = {
    departmentIds: [],
    employeeIds: [],
    userIds: [],
  };
  const uid = String(managerUserId ?? '').trim();
  if (!uid) return empty;

  const deptIdSet = new Set<string>();

  const managedByPortal = (await Department.findAll({
    where: { managerId: uid },
    attributes: ['id'],
    raw: true,
  })) as Array<{ id?: unknown }>;
  for (const row of managedByPortal) {
    const id = String(row.id ?? '').trim();
    if (id) deptIdSet.add(id);
  }

  const managerEmployee = await findEmployeeByUserId(uid);
  const managerPlain = managerEmployee?.toJSON
    ? managerEmployee.toJSON()
    : managerEmployee?.get
      ? managerEmployee.get({ plain: true })
      : managerEmployee;
  const empPk = String(managerPlain?.id ?? '').trim();
  const ownDeptId = String(managerPlain?.department_id ?? '').trim();

  if (empPk) {
    const headed = (await Department.findAll({
      where: { department_head_id: empPk },
      attributes: ['id'],
      raw: true,
    })) as Array<{ id?: unknown }>;
    for (const row of headed) {
      const id = String(row.id ?? '').trim();
      if (id) deptIdSet.add(id);
    }
  }

  // Fallback: manager's home department (matches prior inbox behavior).
  if (!deptIdSet.size && ownDeptId) {
    deptIdSet.add(ownDeptId);
  }

  const departmentIds = [...deptIdSet];
  if (!departmentIds.length) return empty;

  const teamEmployees = (await Employee.findAll({
    where: {
      status: ACTIVE_EMPLOYEE_STATUS,
      department_id: { [Op.in]: departmentIds },
    },
    attributes: ['id'],
    raw: true,
  })) as Array<{ id?: unknown }>;

  const employeeIds = teamEmployees
    .map((row) => String(row.id ?? '').trim())
    .filter(Boolean);
  if (!employeeIds.length) {
    return { departmentIds, employeeIds: [], userIds: [] };
  }

  const portalUsers = (await User.findAll({
    where: { employeeId: { [Op.in]: employeeIds } },
    attributes: ['id'],
    raw: true,
  })) as Array<{ id?: unknown }>;

  const userIds = portalUsers.map((row) => String(row.id ?? '').trim()).filter(Boolean);

  return { departmentIds, employeeIds, userIds };
}

/** Portal user ids on the manager's team (empty when no managed department). */
export async function resolveTeamUserIdsForManager(managerUserId: string): Promise<string[]> {
  const team = await resolveManagerTeam(managerUserId);
  return team.userIds;
}
