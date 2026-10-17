import bcrypt from 'bcryptjs';
import { Op, type Transaction } from 'sequelize';
import { User, Employee, sequelize } from './db';
import { isPlaceholderDraftEmail } from './employeeDraft.js';
import { normalizePhone, phoneLookupVariants } from './phoneUtils';
import {
  findPortalUserByPhone,
  syncPortalPhoneFromEmployee,
} from './portalUserPhone.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService';
import { validatePortalPasswordWithPolicy } from './securityPasswordPolicy.js';
import { toCanonicalEmployeeDisplayId } from './employeeIdFormat.js';
import { resolveDefaultPortalPasswordForNewAccount } from './defaultPortalPassword.js';

export { normalizePhone, phoneLookupVariants };

/**
 * Badge / login Employee ID — trim + uppercase, and rewrite legacy EMP/IROC
 * badges to canonical ROC##### (and ADM###### → ADM#####).
 */
export function normalizeEmployeeLoginId(raw: unknown): string {
  return toCanonicalEmployeeDisplayId(raw);
}

/** Partially mask an email for display during OTP login (e.g. ki*****@gmail.com). */
export function maskEmail(rawEmail: unknown): string {
  const email = String(rawEmail ?? '').trim().toLowerCase();
  const at = email.indexOf('@');
  if (at <= 0) return '***@***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '***@***';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  const visibleLen = Math.min(4, local.length - 1);
  const visible = local.slice(0, visibleLen);
  const hiddenLen = Math.max(local.length - visibleLen, 2);
  return `${visible}${'*'.repeat(Math.min(hiddenLen, 5))}@${domain}`;
}

type EmployeeLinkRef = {
  id?: string;
  email?: string;
  phone?: string;
};

/** Find portal user linked to an employee (employeeId first, then real work email). */
export async function findPortalUserForEmployee(
  employee: EmployeeLinkRef,
  options?: { transaction?: Transaction }
): Promise<any | null> {
  const queryOpts = options?.transaction ? { transaction: options.transaction } : {};
  const rowId = String(employee.id ?? '').trim();
  if (rowId) {
    const byEmployeeId = await User.findOne({
      where: { employeeId: rowId },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
      ...queryOpts,
    });
    if (byEmployeeId) return byEmployeeId;

    // Legacy rows may store the badge code (IROC…) in users.employeeId instead of employees.id.
    const emp = await Employee.findByPk(rowId, { attributes: ['employee_id'] });
    const displayCode = String(emp?.get('employee_id') ?? '').trim();
    if (displayCode && displayCode !== rowId) {
      const byDisplayLink = await User.findOne({
        where: { employeeId: displayCode },
        attributes: [...USER_ACCOUNT_ATTRIBUTES],
        ...queryOpts,
      });
      if (byDisplayLink) {
        try {
          await byDisplayLink.update({ employeeId: rowId }, queryOpts);
        } catch {
          /* non-fatal — still return the matched user */
        }
        return byDisplayLink;
      }
    }
  }

  const email = String(employee.email ?? '').trim();
  if (!email || isPlaceholderDraftEmail(email)) return null;

  return User.findOne({
    where: { email },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
    ...queryOpts,
  });
}

/** Bulk-resolve portal users for payroll/list enrichment (avoids per-employee queries). */
export async function bulkFindPortalUsersForEmployees(
  employees: EmployeeLinkRef[]
): Promise<Map<string, Record<string, unknown>>> {
  const byEmployeePk = new Map<string, Record<string, unknown>>();
  if (!employees.length) return byEmployeePk;

  const pks = new Set<string>();
  const displayCodes = new Set<string>();
  const emails = new Set<string>();

  for (const emp of employees) {
    const pk = String(emp.id ?? '').trim();
    if (pk) pks.add(pk);
    const code = String((emp as { employee_id?: string }).employee_id ?? '').trim();
    if (code) displayCodes.add(code);
    const email = String(emp.email ?? '').trim().toLowerCase();
    if (email && !isPlaceholderDraftEmail(email)) emails.add(email);
  }

  const linkIds = [...new Set([...pks, ...displayCodes])];
  const orClauses: Array<Record<string, unknown>> = [];
  if (linkIds.length) orClauses.push({ employeeId: { [Op.in]: linkIds } });
  if (emails.size) orClauses.push({ email: { [Op.in]: [...emails] } });
  if (!orClauses.length) return byEmployeePk;

  const users = await User.findAll({
    where: { [Op.or]: orClauses },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });

  const byLinkId = new Map<string, Record<string, unknown>>();
  const byEmail = new Map<string, Record<string, unknown>>();
  for (const row of users) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const link = String(plain.employeeId ?? '').trim();
    if (link) byLinkId.set(link, plain);
    const email = String(plain.email ?? '').trim().toLowerCase();
    if (email) byEmail.set(email, plain);
  }

  for (const emp of employees) {
    const pk = String(emp.id ?? '').trim();
    if (!pk) continue;
    const displayCode = String((emp as { employee_id?: string }).employee_id ?? '').trim();
    const email = String(emp.email ?? '').trim().toLowerCase();

    let plain =
      byLinkId.get(pk) ??
      (displayCode ? byLinkId.get(displayCode) : undefined) ??
      (email && !isPlaceholderDraftEmail(email) ? byEmail.get(email) : undefined);

    if (plain) byEmployeePk.set(pk, plain);
  }

  return byEmployeePk;
}

export function portalLoginIsActive(user: { isActive?: boolean; status?: string } | null): boolean {
  if (!user) return false;
  if (user.isActive === false) return false;
  const status = String(user.status ?? 'ACTIVE').trim().toUpperCase();
  return status !== 'INACTIVE' && status !== 'DISABLED' && status !== 'FROZEN';
}

/** Resolve a portal user by phone (users.phone first, then employee record for legacy rows). */
export async function findUserByPhone(rawPhone: unknown): Promise<any | null> {
  const variants = phoneLookupVariants(rawPhone);
  if (!variants.length) return null;

  const direct = await findPortalUserByPhone(rawPhone);
  if (direct) return direct;

  const employee = await Employee.findOne({
    where: {
      [Op.or]: variants.flatMap((p) => [{ phone: p }, { work_phone: p }]),
    },
  });
  if (!employee) return null;

  const plain = employee.toJSON ? employee.toJSON() : employee;
  const byEmployeeId = await User.findOne({
    where: { employeeId: plain.id },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  if (!byEmployeeId) return null;

  await syncPortalPhoneFromEmployee(plain.id, plain.phone);
  await byEmployeeId.reload({ attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  return byEmployeeId;
}

/**
 * Resolve a portal user by badge Employee ID (`employees.employee_id`), or by
 * portal-only admin `users.login_id` (ADM#####) when no employee badge matches.
 *
 * Employee path is unchanged and runs first so HR/Manager/Employee login is unaffected.
 * Admin path never writes `users.employeeId` (system admins stay unlinked).
 */
export async function findUserByEmployeeLoginId(rawId: unknown): Promise<any | null> {
  const code = normalizeEmployeeLoginId(rawId);
  if (code.length < 3) return null;

  const { employeeDisplayIdLookupVariants } = await import('./employeeIdFormat.js');
  const codes = employeeDisplayIdLookupVariants(code);

  let emp: { id: string; phone?: string | null; email?: string | null } | undefined;
  try {
    const [rows] = (await sequelize.query(
      `SELECT id, phone, email FROM employees
     WHERE UPPER(TRIM(employee_id)) IN (:codes)
     LIMIT 1`,
      { replacements: { codes } }
    )) as [Array<{ id: string; phone?: string | null; email?: string | null }>, unknown];
    emp = rows?.[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { parent?: { code?: string }; original?: { code?: string } })?.parent?.code
      || (err as { original?: { code?: string } })?.original?.code
      || '';
    if (code !== 'ER_NO_SUCH_TABLE' && !/doesn't exist/i.test(msg)) {
      throw err;
    }
    emp = undefined;
  }

  if (emp?.id) {
    const empPk = String(emp.id);

    let user = await User.findOne({
      where: { employeeId: empPk },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });

    if (!user) {
      const phone = normalizePhone(emp.phone);
      if (phone) {
        user = await findPortalUserByPhone(phone);
      }
    }
    if (!user) {
      const email = String(emp.email || '')
        .trim()
        .toLowerCase();
      if (email && !isPlaceholderDraftEmail(email)) {
        user = await User.findOne({
          where: sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), email),
          attributes: [...USER_ACCOUNT_ATTRIBUTES],
        });
      }
    }
    if (!user) return null;

    // Never auto-link portal-only system admins to an employee row.
    const role = String(user.role || '').toUpperCase();
    const isPortalOnlyAdmin =
      (role === 'ADMIN' || role === 'SUPER_ADMIN') && !String(user.employeeId || '').trim();
    if (!isPortalOnlyAdmin && !String(user.employeeId || '').trim()) {
      user.employeeId = empPk;
      await user.save({ fields: ['employeeId'] });
    }

    if (!isPortalOnlyAdmin && emp.phone) {
      await syncPortalPhoneFromEmployee(empPk, emp.phone);
      await user.reload({ attributes: [...USER_ACCOUNT_ATTRIBUTES] });
    }
    return user;
  }

  // No employee badge — try portal-only admin login_id (ADM00001).
  // Keep this after the employee path so ROC##### logins never hit admin codes first.
  const { adminLoginIdLookupVariants } = await import('./systemAdminAccount.js');
  const adminCodes = adminLoginIdLookupVariants(code);
  if (!adminCodes.length) return null;
  const [adminRows] = (await sequelize.query(
    `SELECT id FROM users
     WHERE UPPER(TRIM(login_id)) IN (:codes)
       AND UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')
       AND (employeeId IS NULL OR TRIM(employeeId) = '')
     LIMIT 1`,
    { replacements: { codes: adminCodes } }
  )) as [{ id: string }[], unknown];
  const adminId = adminRows?.[0]?.id;
  if (!adminId) return null;
  return User.findByPk(adminId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
}

/** Phone used for OTP SMS / logging after Employee ID login. */
export async function resolveAuthPhoneForUser(user: any): Promise<string> {
  let phone = normalizePhone(user?.phone);
  if (phone) return phone;
  const empPk = String(user?.employeeId ?? '').trim();
  if (!empPk) return '';
  try {
    const emp = await Employee.findByPk(empPk, { attributes: ['phone', 'work_phone'] });
    const plain = emp?.toJSON ? emp.toJSON() : emp;
    return (
      normalizePhone((plain as { phone?: string })?.phone) ||
      normalizePhone((plain as { work_phone?: string })?.work_phone) ||
      ''
    );
  } catch (err) {
    const code = (err as { parent?: { code?: string }; original?: { code?: string } })?.parent?.code
      || (err as { original?: { code?: string } })?.original?.code
      || '';
    if (code === 'ER_NO_SUCH_TABLE') return '';
    throw err;
  }
}

export type CreateLoginUserInput = {
  employee: any;
  role?: string;
  /**
   * Explicit password (admin reset / custom create). When set, the account hash is
   * replaced and mustChangePassword is set so the user chooses their own password
   * on next sign-in. When omitted, existing hashes are never touched — the system
   * default is only applied for brand-new accounts (or rows that still have no password hash).
   */
  password?: string;
  nextUserId: () => Promise<string>;
};

function readPasswordHash(user: any): string {
  if (!user) return '';
  const raw =
    (typeof user.getDataValue === 'function' ? user.getDataValue('password') : null) ??
    (typeof user.get === 'function' ? user.get('password') : null) ??
    user.password ??
    '';
  return String(raw ?? '').trim();
}

/** Create or update the Users row for an employee (account fields only). */
export async function upsertLoginUserForEmployee({
  employee,
  role = 'EMPLOYEE',
  password,
  nextUserId,
}: CreateLoginUserInput): Promise<any> {
  const plain = employee.toJSON ? employee.toJSON() : employee;
  const email = String(plain.email || '').trim();
  if (!email) {
    throw new Error('Employee must have an email before enabling portal login.');
  }

  const pwd = String(password ?? '').trim();
  const loginPhone = normalizePhone(plain.phone);
  const userPatch: Record<string, unknown> = {
    email,
    employeeId: plain.id,
    role: String(role).toUpperCase(),
    isActive: true,
    status: 'ACTIVE',
    ...(loginPhone.length >= 8 ? { phone: loginPhone } : {}),
  };

  const existing = await User.findOne({
    where: {
      [Op.or]: [{ employeeId: plain.id }, { email }],
    },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });

  const applyPasswordHash = async (plainPassword: string, forceChange: boolean) => {
    const check = await validatePortalPasswordWithPolicy(plainPassword);
    if (!check.valid) {
      throw new Error(
        check.message ||
          'System default password does not meet the password policy. Update it in Settings → Security.'
      );
    }
    userPatch.password = await bcrypt.hash(plainPassword, 12);
    userPatch.passwordChangedAt = new Date();
    userPatch.mustChangePassword = forceChange;
    userPatch.passwordLength = plainPassword.length;
  };

  if (existing) {
    // Existing portal accounts keep their current password unless an explicit
    // password is provided (admin reset / generate). Changing Settings → Default
    // Password must never rewrite these hashes.
    // Admin-assigned passwords are temporary — user must choose their own on next sign-in.
    if (pwd) {
      await applyPasswordHash(pwd, true);
    } else if (!readPasswordHash(existing)) {
      await applyPasswordHash(await resolveDefaultPortalPasswordForNewAccount(), true);
    }
    await existing.update(userPatch as any);
    return existing;
  }

  // New portal account: first login must change the temporary/default password.
  // mustChangePassword applies only to newly created staff — never to existing resets.
  await applyPasswordHash(pwd || (await resolveDefaultPortalPasswordForNewAccount()), true);

  return User.create({
    id: await nextUserId(),
    ...userPatch,
  } as any);
}
