import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { Department, Employee, User, sequelize } from './db';
import { serializeUserForClient } from './userAccountService.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';

export class DepartmentManagerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type DepartmentHeadDisplay = {
  managerId?: string;
  managerName?: string;
  department_head_id?: string;
};

type EmpPlain = {
  id: string;
  first_name?: string;
  last_name?: string;
  employee_id?: string;
  email?: string;
};

type UserPlain = {
  id: string;
  employeeId?: string | null;
  email?: string;
};

function employeeDisplayName(emp: { first_name?: string; last_name?: string } | null): string | null {
  if (!emp) return null;
  const name = joinEmployeeNameParts(emp.first_name, emp.last_name);
  return name || null;
}

function pickHeadEmployeeId(deptPlain: Record<string, unknown>): string {
  return String(deptPlain.department_head_id ?? deptPlain.departmentHeadId ?? '').trim();
}

function pickManagerUserId(deptPlain: Record<string, unknown>): string {
  return String(deptPlain.managerId ?? deptPlain.manager_id ?? '').trim();
}

function normalizeDeptPlain(dept: any): Record<string, unknown> {
  const plain = dept?.toJSON ? dept.toJSON() : { ...dept };
  if (dept?.get) {
    plain.department_head_id =
      plain.department_head_id ?? dept.get('department_head_id') ?? dept.get('departmentHeadId');
    plain.managerId = plain.managerId ?? dept.get('managerId') ?? dept.get('manager_id');
  }
  return plain;
}

function displayNameFromUserAndEmp(user: UserPlain | undefined, empById: Map<string, EmpPlain>): string | null {
  if (!user) return null;
  const empPk = String(user.employeeId ?? '').trim();
  if (empPk) {
    const name = employeeDisplayName(empById.get(empPk) ?? null);
    if (name) return name;
  }
  const email = String(user.email ?? '').trim();
  if (email) return email.split('@')[0] || null;
  return null;
}

function indexUsers(users: UserPlain[], empById: Map<string, EmpPlain>) {
  const byId = new Map<string, UserPlain>();
  const byEmployeeKey = new Map<string, UserPlain>();
  const byEmail = new Map<string, UserPlain>();

  for (const u of users) {
    byId.set(String(u.id), u);
    const empPk = String(u.employeeId ?? '').trim();
    if (empPk) {
      byEmployeeKey.set(empPk, u);
      const emp = empById.get(empPk);
      const code = String(emp?.employee_id ?? '').trim();
      if (code) byEmployeeKey.set(code, u);
    }
    const email = String(u.email ?? '').trim().toLowerCase();
    if (email) byEmail.set(email, u);
  }

  return { byId, byEmployeeKey, byEmail };
}

function resolveHeadFromIndexes(
  plain: Record<string, unknown>,
  empById: Map<string, EmpPlain>,
  users: ReturnType<typeof indexUsers>
): DepartmentHeadDisplay {
  const headEmployeeId = pickHeadEmployeeId(plain);
  if (headEmployeeId) {
    const emp = empById.get(headEmployeeId);
    const nameFromEmp = employeeDisplayName(emp ?? null);
    const user =
      users.byEmployeeKey.get(headEmployeeId) ??
      (emp?.employee_id ? users.byEmployeeKey.get(String(emp.employee_id)) : undefined) ??
      (emp?.email ? users.byEmail.get(String(emp.email).toLowerCase()) : undefined);

    if (user) {
      return {
        managerId: String(user.id),
        managerName: nameFromEmp || displayNameFromUserAndEmp(user, empById) || undefined,
        department_head_id: headEmployeeId,
      };
    }
    if (nameFromEmp) {
      return { managerName: nameFromEmp, department_head_id: headEmployeeId };
    }
  }

  const legacyUserId = pickManagerUserId(plain);
  if (legacyUserId) {
    let user = users.byId.get(legacyUserId) ?? users.byEmployeeKey.get(legacyUserId);
    if (!user) {
      const empOnly = empById.get(legacyUserId);
      if (empOnly?.employee_id) user = users.byEmployeeKey.get(String(empOnly.employee_id));
      if (!user && empOnly?.email) user = users.byEmail.get(String(empOnly.email).toLowerCase());
    }

    if (user) {
      const empId = String(user.employeeId ?? headEmployeeId ?? '').trim();
      return {
        managerId: String(user.id),
        managerName:
          displayNameFromUserAndEmp(user, empById) ||
          employeeDisplayName(empById.get(empId) ?? null) ||
          undefined,
        ...(empId ? { department_head_id: empId } : {}),
      };
    }

    const nameOnly = employeeDisplayName(empById.get(legacyUserId) ?? null);
    if (nameOnly) {
      return { managerName: nameOnly, department_head_id: legacyUserId };
    }
  }

  return {};
}

/** Batch-resolve department heads (fixed query count, no per-row lookups). */
export async function resolveDepartmentHeadsBatch(
  deptRows: any[]
): Promise<Map<string, DepartmentHeadDisplay>> {
  const plains = deptRows.map((d) => normalizeDeptPlain(d));
  const result = new Map<string, DepartmentHeadDisplay>();
  if (!plains.length) return result;

  const employeePkSet = new Set<string>();
  const portalUserIdSet = new Set<string>();

  for (const plain of plains) {
    const headId = pickHeadEmployeeId(plain);
    if (headId) employeePkSet.add(headId);
    const managerId = pickManagerUserId(plain);
    if (managerId) {
      portalUserIdSet.add(managerId);
      employeePkSet.add(managerId);
    }
  }

  const employeePks = [...employeePkSet];
  const employees = employeePks.length
    ? ((await Employee.findAll({
        where: { id: { [Op.in]: employeePks } },
        attributes: ['id', 'first_name', 'last_name', 'employee_id', 'email'],
      })) as any[])
    : [];

  const empById = new Map<string, EmpPlain>();
  const employeeKeysForUsers = new Set<string>(employeePks);
  for (const row of employees) {
    const plain = row.get({ plain: true }) as EmpPlain;
    empById.set(String(plain.id), plain);
    const code = String(plain.employee_id ?? '').trim();
    if (code) employeeKeysForUsers.add(code);
    const email = String(plain.email ?? '').trim().toLowerCase();
    if (email) {
      /* resolved via emp map + user email index */
    }
  }

  const emails = [
    ...new Set(
      [...empById.values()]
        .map((e) => String(e.email ?? '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const userWhere: Record<string, unknown>[] = [];
  if (portalUserIdSet.size) {
    userWhere.push({ id: { [Op.in]: [...portalUserIdSet] } });
  }
  if (employeeKeysForUsers.size) {
    userWhere.push({ employeeId: { [Op.in]: [...employeeKeysForUsers] } });
  }
  if (emails.length) {
    userWhere.push({ email: { [Op.in]: emails } });
  }

  const users =
    userWhere.length > 0
      ? ((await User.findAll({
          where: { [Op.or]: userWhere },
          attributes: ['id', 'role', 'employeeId', 'email'],
        })) as any[])
      : [];

  const userPlains: UserPlain[] = users.map((u) => u.get({ plain: true }) as UserPlain);
  const userIndex = indexUsers(userPlains, empById);

  for (const plain of plains) {
    const id = String(plain.id ?? '');
    if (!id) continue;
    result.set(id, resolveHeadFromIndexes(plain, empById, userIndex));
  }

  return result;
}

async function findUserForEmployeePk(employeePk: string): Promise<any | null> {
  const byPk = await User.findOne({
    where: { employeeId: employeePk },
    attributes: ['id', 'role', 'employeeId', 'email'],
  });
  if (byPk) return byPk;

  const emp: any = await Employee.findByPk(employeePk, {
    attributes: ['id', 'employee_id', 'email'],
  });
  if (!emp) return null;

  const code = String(emp.get?.('employee_id') ?? emp.employee_id ?? '').trim();
  if (code && code !== employeePk) {
    const byCode = await User.findOne({
      where: { employeeId: code },
      attributes: ['id', 'role', 'employeeId', 'email'],
    });
    if (byCode) return byCode;
  }

  const email = String(emp.get?.('email') ?? emp.email ?? '').trim().toLowerCase();
  if (email) {
    return User.findOne({
      where: { email },
      attributes: ['id', 'role', 'employeeId', 'email'],
    });
  }

  return null;
}

/** Resolve portal user id + display name from department head fields (single row). */
export async function resolveDepartmentHeadDisplay(
  deptPlain: Record<string, unknown>
): Promise<DepartmentHeadDisplay> {
  const normalized = normalizeDeptPlain(deptPlain);
  const id = String(normalized.id ?? 'single');
  const batch = await resolveDepartmentHeadsBatch([{ ...normalized, id }]);
  const fromBatch = batch.get(id);
  if (fromBatch && (fromBatch.managerName || fromBatch.managerId)) {
    return fromBatch;
  }

  // Rare edge cases: fall back to full profile serialization
  const headEmployeeId = pickHeadEmployeeId(normalized);
  if (headEmployeeId) {
    const emp: any = await Employee.findByPk(headEmployeeId, {
      attributes: ['id', 'first_name', 'last_name', 'employee_id', 'email'],
    });
    const nameFromEmp = employeeDisplayName(emp?.get?.({ plain: true }) ?? emp);
    const user = await findUserForEmployeePk(headEmployeeId);

    if (user) {
      const profile = await serializeUserForClient(user.get({ plain: true }), emp);
      return {
        managerId: String(user.id),
        managerName: nameFromEmp || profile.name,
        department_head_id: headEmployeeId,
      };
    }

    if (nameFromEmp) {
      return { managerName: nameFromEmp, department_head_id: headEmployeeId };
    }
  }

  const legacyUserId = pickManagerUserId(normalized);
  if (legacyUserId) {
    let user: any = await User.findByPk(legacyUserId, {
      attributes: ['id', 'role', 'employeeId', 'email'],
    });

    if (!user) {
      user = await findUserForEmployeePk(legacyUserId);
    }

    if (user) {
      const profile = await serializeUserForClient(user.get({ plain: true }));
      const empId = String(user.employeeId ?? headEmployeeId ?? '').trim();
      return {
        managerId: String(user.id),
        managerName: profile.name,
        ...(empId ? { department_head_id: empId } : {}),
      };
    }

    const empOnly: any = await Employee.findByPk(legacyUserId, {
      attributes: ['id', 'first_name', 'last_name'],
    });
    const nameOnly = employeeDisplayName(empOnly?.get?.({ plain: true }) ?? empOnly);
    if (nameOnly) {
      return { managerName: nameOnly, department_head_id: legacyUserId };
    }
  }

  return {};
}

/** Active employee counts per department id (one grouped query). */
export async function countActiveEmployeesByDepartment(): Promise<Map<string, number>> {
  const rows = (await Employee.findAll({
    attributes: ['department_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    where: {
      status: { [Op.in]: ['active', 'pending_approval', 'ACTIVE'] },
    },
    group: ['department_id'],
    raw: true,
  })) as { department_id: string; cnt: string | number }[];

  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const deptId = String(row.department_id ?? '').trim();
    if (!deptId) continue;
    map.set(deptId, Number(row.cnt) || 0);
  }
  return map;
}

/**
 * Assign exactly one department head (manager portal user).
 * One manager → one department; clearing head from any other department using the same person.
 */
export async function assignDepartmentManager(
  departmentId: string,
  portalUserId: string | null | undefined,
  options?: { transaction?: Transaction }
): Promise<void> {
  const transaction = options?.transaction;
  const dept: any = await Department.findByPk(departmentId, { transaction });
  if (!dept) {
    throw new DepartmentManagerError('Department not found', 404);
  }

  const userId = portalUserId ? String(portalUserId).trim() : '';

  if (!userId) {
    await dept.update({ managerId: null, department_head_id: null }, { transaction });
    return;
  }

  const user: any = await User.findByPk(userId, { transaction });
  if (!user) {
    throw new DepartmentManagerError('Selected manager account was not found', 400);
  }

  const role = String(user.role ?? '').trim().toUpperCase();
  if (role !== 'MANAGER') {
    throw new DepartmentManagerError('Department head must be a Manager account', 400);
  }

  const employeeId = String(user.employeeId ?? '').trim();
  if (!employeeId) {
    throw new DepartmentManagerError(
      'This user is not linked to an employee record. Link the account to an employee first.',
      400
    );
  }

  const emp: any = await Employee.findByPk(employeeId, { transaction });
  if (!emp) {
    throw new DepartmentManagerError('Linked employee record was not found', 400);
  }

  const otherDeptWithSameHead = await Department.findOne({
    where: {
      department_head_id: employeeId,
      id: { [Op.ne]: departmentId },
    },
    attributes: ['id', 'name'],
    transaction,
  });
  if (otherDeptWithSameHead) {
    const otherName = String(otherDeptWithSameHead.get('name') ?? 'another department');
    throw new DepartmentManagerError(
      `${employeeDisplayName(emp.get({ plain: true })) ?? 'This manager'} is already department head for ${otherName}. Unassign them there first.`,
      409
    );
  }

  await Department.update(
    { managerId: null, department_head_id: null },
    { where: { managerId: userId, id: { [Op.ne]: departmentId } }, transaction }
  );

  await Department.update(
    { managerId: null, department_head_id: null },
    { where: { department_head_id: employeeId, id: { [Op.ne]: departmentId } }, transaction }
  );

  await dept.update(
    {
      managerId: userId,
      department_head_id: employeeId,
    },
    { transaction }
  );
}

/** Portal user id assigned as leave approver on a department (departments.managerId). */
export async function portalUserIdForDepartment(
  deptId: string | null | undefined
): Promise<string | null> {
  const id = String(deptId ?? '').trim();
  if (!id) return null;
  const dept: any = await Department.findByPk(id, { attributes: ['managerId'] });
  const portalId = String(dept?.managerId ?? dept?.get?.('managerId') ?? '').trim();
  return portalId || null;
}

/** True when the portal user is the department leave manager for the employee's department. */
export async function isDepartmentManagerOfEmployee(
  portalUserId: string,
  employee: { department_id?: string | null }
): Promise<boolean> {
  const uid = String(portalUserId ?? '').trim();
  if (!uid) return false;
  const mgrId = await portalUserIdForDepartment(employee.department_id);
  return Boolean(mgrId && mgrId === uid);
}

/** True when the employee PK is the org-chart head of the employee's department. */
export async function isDepartmentHeadOfEmployee(
  actorEmployeePk: string,
  employee: { department_id?: string | null }
): Promise<boolean> {
  const pk = String(actorEmployeePk ?? '').trim();
  if (!pk) return false;
  const deptId = String(employee.department_id ?? '').trim();
  if (!deptId) return false;
  const dept: any = await Department.findByPk(deptId, { attributes: ['department_head_id'] });
  const headPk = String(dept?.department_head_id ?? dept?.get?.('department_head_id') ?? '').trim();
  return Boolean(headPk && headPk === pk);
}
