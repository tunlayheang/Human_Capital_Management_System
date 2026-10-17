import { Employee, User } from './db.js';
import {
  employeeLookupWhere,
  toCanonicalEmployeeDisplayId,
} from './employeeIdFormat.js';

/** Portal user → employees.id (users.employeeId). */
export async function findEmployeePkByUserId(userId: string): Promise<string | null> {
  const uid = String(userId ?? '').trim();
  if (!uid) return null;
  const user = await User.findByPk(uid, { attributes: ['employeeId'] });
  const pk = user?.get('employeeId');
  return pk != null && String(pk).trim() ? String(pk).trim() : null;
}

/** employees.id → portal users.id. */
export async function findUserIdByEmployeePk(employeePk: string): Promise<string | null> {
  const pk = String(employeePk ?? '').trim();
  if (!pk) return null;
  const user = await User.findOne({ where: { employeeId: pk }, attributes: ['id'] });
  return user ? String(user.get('id')) : null;
}

/** Badge code (ROC / IROC / EMP aliases) → employees.id. */
export async function findEmployeePkByDisplayId(displayId: string): Promise<string | null> {
  const code = String(displayId ?? '').trim();
  if (!code) return null;
  const emp = await Employee.findOne({
    where: employeeLookupWhere(code) as never,
    attributes: ['id'],
  });
  return emp ? String(emp.get('id')) : null;
}

/** employees.id → canonical badge code (ROC#####). */
export async function findDisplayIdByEmployeePk(employeePk: string): Promise<string | null> {
  const pk = String(employeePk ?? '').trim();
  if (!pk) return null;
  const emp = await Employee.findByPk(pk, { attributes: ['employee_id'] });
  const code = emp?.get('employee_id');
  if (code == null || !String(code).trim()) return null;
  return toCanonicalEmployeeDisplayId(code) || String(code).trim();
}

/** Accept display code or employees.id; always returns employees.id. */
export async function resolveEmployeePk(ref: string): Promise<string | null> {
  const id = String(ref ?? '').trim();
  if (!id) return null;
  const byDisplay = await findEmployeePkByDisplayId(id);
  if (byDisplay) return byDisplay;
  const emp = await Employee.findByPk(id, { attributes: ['id'] });
  return emp ? String(emp.get('id')) : null;
}
