import { Op } from 'sequelize';
import { Employee, User } from './db.js';
import { isEmployeeActiveForChat } from './employeePortalStatus.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';

function isPortalAccountActiveForChat(account: Record<string, unknown>): boolean {
  if (account.isActive === false) return false;
  const status = String(account.status ?? 'ACTIVE').trim().toUpperCase();
  return status !== 'INACTIVE' && status !== 'FROZEN' && status !== 'DISABLED';
}

/**
 * Chat directory eligibility: Active employees (+ system admins with no employee record).
 * Draft / inactive / terminated employees are excluded.
 */
export async function filterUsersEligibleForChat(
  accounts: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  if (!accounts.length) return [];
  const employeeIds = [
    ...new Set(accounts.map((a) => String(a.employeeId ?? '').trim()).filter(Boolean)),
  ];
  const statusByEmployeeId = new Map<string, string>();
  if (employeeIds.length) {
    const rows = (await Employee.findAll({
      where: { id: { [Op.in]: employeeIds } },
      attributes: ['id', 'status'],
      raw: true,
    })) as Array<{ id: string; status: string }>;
    for (const row of rows) {
      statusByEmployeeId.set(String(row.id), String(row.status ?? ''));
    }
  }

  return accounts.filter((account) => {
    if (!isPortalAccountActiveForChat(account)) return false;
    const role = String(account.role ?? '').trim().toUpperCase();
    const employeeId = String(account.employeeId ?? '').trim();
    if (!employeeId) {
      return role === 'ADMIN' || role === 'SUPER_ADMIN';
    }
    const empStatus = statusByEmployeeId.get(employeeId);
    if (empStatus == null) return false;
    return isEmployeeActiveForChat(empStatus);
  });
}

export async function assertUserEligibleForChat(userId: string): Promise<void> {
  const user: any = await User.findByPk(userId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }
  const plain = user.get ? user.get({ plain: true }) : user;
  const [eligible] = await filterUsersEligibleForChat([plain]);
  if (!eligible) {
    throw Object.assign(new Error('Only Active employees can use chat'), { status: 403 });
  }
}
