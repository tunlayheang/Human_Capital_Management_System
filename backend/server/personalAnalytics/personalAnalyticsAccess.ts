import { Employee, User } from '../db.js';
import { findEmployeeByUserId } from '../employeeAttendanceSchedule.js';
import { isAdminRole } from '../adminNavScope.js';
import {
  isDepartmentHeadOfEmployee,
  isDepartmentManagerOfEmployee,
} from '../departmentManager.js';

export class PersonalAnalyticsAccessError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function canViewUserAnalytics(
  viewer: { id: string; role?: string },
  targetUserId: string
): Promise<boolean> {
  if (!viewer?.id) return false;
  if (viewer.id === targetUserId) return true;

  const role = String(viewer.role ?? '').toUpperCase();
  if (isAdminRole(role) || role === 'HR') return true;

  if (role === 'MANAGER') {
    const managerEmp = await findEmployeeByUserId(viewer.id);
    if (!managerEmp) return false;
    const mgrPlain = managerEmp.get({ plain: true }) as Record<string, unknown>;
    const deptId = mgrPlain.department_id ?? mgrPlain.departmentId;
    const mgrPk = String(mgrPlain.id ?? '');

    const targetUser = await User.findByPk(targetUserId, { attributes: ['employeeId'] });
    const targetEmpPk = targetUser?.get('employeeId');
    if (!targetEmpPk) return false;

    const targetEmp = await Employee.findByPk(String(targetEmpPk));
    if (!targetEmp) return false;
    const targetPlain = targetEmp.get({ plain: true }) as Record<string, unknown>;

    const sameDept = deptId && String(targetPlain.department_id) === String(deptId);
    const isDeptManager = await isDepartmentManagerOfEmployee(viewer.id, targetPlain);
    const isDeptHead =
      mgrPk && (await isDepartmentHeadOfEmployee(mgrPk, targetPlain));
    return Boolean(sameDept || isDeptManager || isDeptHead);
  }

  return false;
}

export async function resolveAnalyticsTargetUserId(
  viewer: { id: string; role?: string } | null | undefined,
  requestedUserId?: string | null
): Promise<string> {
  if (!viewer?.id) {
    throw new PersonalAnalyticsAccessError('Unauthorized', 401);
  }
  const target = (requestedUserId?.trim() || viewer.id).trim();
  if (!target) {
    throw new PersonalAnalyticsAccessError('User not specified', 400);
  }
  const allowed = await canViewUserAnalytics(viewer, target);
  if (!allowed) {
    throw new PersonalAnalyticsAccessError('You may only view your own analytics', 403);
  }
  return target;
}
