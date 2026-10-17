import { Op } from 'sequelize';
import { Employee, User } from './db.js';
import { toCanonicalEmployeeDisplayId } from './employeeIdFormat.js';

export type EmployeeKeys = {
  employeeId: string | null;
  employeeDisplayId: string | null;
};

function keysFromEmployeePlain(ep: { id: string; employee_id: string }): EmployeeKeys {
  return {
    employeeId: String(ep.id),
    employeeDisplayId: toCanonicalEmployeeDisplayId(ep.employee_id) || String(ep.employee_id ?? ''),
  };
}

/** Resolve employees.id (and HR code) for a portal user — used to match planning roster entries. */
export async function resolveEmployeeKeysForUser(userId: string): Promise<EmployeeKeys> {
  const map = await resolveEmployeeKeysForUsers([userId]);
  return map.get(String(userId).trim()) ?? { employeeId: null, employeeDisplayId: null };
}

/** Batch variant — avoids N User/Employee lookups when building attendance status maps. */
export async function resolveEmployeeKeysForUsers(
  userIds: string[]
): Promise<Map<string, EmployeeKeys>> {
  const result = new Map<string, EmployeeKeys>();
  const ids = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  for (const id of ids) result.set(id, { employeeId: null, employeeDisplayId: null });
  if (!ids.length) return result;

  const users: any[] = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'employeeId', 'email'],
  });

  const linkIds = new Set<string>();
  const emails = new Set<string>();
  const metaByUser = new Map<string, { employeeId: string; email: string }>();
  for (const user of users) {
    const plain = user.get({ plain: true }) as Record<string, unknown>;
    const userId = String(plain.id ?? '').trim();
    if (!userId) continue;
    const employeeId = String(plain.employeeId ?? plain.employee_id ?? '').trim();
    const email = String(plain.email ?? '')
      .trim()
      .toLowerCase();
    metaByUser.set(userId, { employeeId, email });
    if (employeeId) linkIds.add(employeeId);
    if (email) emails.add(email);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (linkIds.size) {
    const links = [...linkIds];
    orClauses.push({ id: { [Op.in]: links } });
    orClauses.push({ employee_id: { [Op.in]: links } });
  }
  if (emails.size) {
    orClauses.push({ email: { [Op.in]: [...emails] } });
  }
  if (!orClauses.length) return result;

  const employees: any[] = await Employee.findAll({
    where: { [Op.or]: orClauses },
    attributes: ['id', 'employee_id', 'email'],
  });

  const byId = new Map<string, EmployeeKeys>();
  const byDisplayId = new Map<string, EmployeeKeys>();
  const byEmail = new Map<string, EmployeeKeys>();
  for (const emp of employees) {
    const ep = emp.get({ plain: true }) as { id: string; employee_id: string; email?: string };
    const keys = keysFromEmployeePlain(ep);
    byId.set(String(ep.id), keys);
    const displayId = String(ep.employee_id ?? '').trim();
    if (displayId) byDisplayId.set(displayId, keys);
    const email = String(ep.email ?? '')
      .trim()
      .toLowerCase();
    if (email) byEmail.set(email, keys);
  }

  for (const [userId, meta] of metaByUser) {
    const keys =
      (meta.employeeId && byId.get(meta.employeeId)) ||
      (meta.employeeId && byDisplayId.get(meta.employeeId)) ||
      (meta.email && byEmail.get(meta.email)) ||
      null;
    if (keys) result.set(userId, keys);
  }

  return result;
}
