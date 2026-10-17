import { Op } from 'sequelize';
import { Employee, User } from './db.js';
import { isPlaceholderDraftEmail } from './employeeDraft.js';
import { normalizePhone, phoneLookupVariants } from './phoneUtils.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';

/** Copy normalized employee mobile onto the linked portal user (login identifier). */
export async function syncPortalPhoneFromEmployee(
  employeeRowId: string,
  phoneRaw?: unknown
): Promise<void> {
  const empId = String(employeeRowId ?? '').trim();
  if (!empId) return;

  let phone = phoneRaw !== undefined ? normalizePhone(phoneRaw) : '';
  if (!phone) {
    const emp: any = await Employee.findByPk(empId, { attributes: ['phone'] });
    if (!emp) return;
    phone = normalizePhone(emp.get('phone'));
  }
  if (phone.length < 8) return;

  await User.update({ phone }, { where: { employeeId: empId } });
}

/** Copy employee work email onto the linked portal user (login identifier). */
export async function syncPortalEmailFromEmployee(
  employeeRowId: string,
  emailRaw?: unknown
): Promise<void> {
  const empId = String(employeeRowId ?? '').trim();
  if (!empId) return;

  let email = emailRaw !== undefined ? String(emailRaw ?? '').trim() : '';
  if (!email) {
    const emp: any = await Employee.findByPk(empId, { attributes: ['email'] });
    if (!emp) return;
    email = String(emp.get('email') ?? '').trim();
  }
  if (!email || isPlaceholderDraftEmail(email)) return;

  await User.update({ email }, { where: { employeeId: empId } });
}

/** Backfill users.phone from employees.phone for all linked accounts. */
export async function backfillPortalPhonesFromEmployees(): Promise<number> {
  const users = (await User.findAll({
    attributes: ['id', 'employeeId'],
    where: {
      employeeId: { [Op.ne]: null },
    },
  })) as any[];

  let updated = 0;
  for (const user of users) {
    const empId = String(user.employeeId ?? '').trim();
    if (!empId) continue;
    const emp: any = await Employee.findByPk(empId, { attributes: ['phone'] });
    if (!emp) continue;
    const phone = normalizePhone(emp.get('phone'));
    if (phone.length < 8) continue;
    await user.update({ phone });
    updated += 1;
  }
  return updated;
}

export function portalPhoneMatchWhere(rawPhone: unknown) {
  const variants = phoneLookupVariants(rawPhone);
  if (!variants.length) return null;
  return {
    [Op.or]: variants.map((p) => ({ phone: p })),
  };
}

/** Find portal user by users.phone (canonical login lookup). */
export async function findPortalUserByPhone(rawPhone: unknown): Promise<any | null> {
  const where = portalPhoneMatchWhere(rawPhone);
  if (!where) return null;

  return User.findOne({
    where,
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
}
