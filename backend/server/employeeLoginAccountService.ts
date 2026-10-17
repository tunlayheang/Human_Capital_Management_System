import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { Department, Employee, Position, User } from './db.js';
import { normalizePhone } from './phoneUtils.js';
import { syncPortalPhoneFromEmployee } from './portalUserPhone.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import { isSystemAdminAccount } from './systemAdminAccount.js';
import {
  isDefaultPortalPasswordEnabled,
  resolveDefaultPortalPasswordForNewAccount,
} from './defaultPortalPassword.js';
import { ownerEmployeeNamePatch } from './ownerAccountIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OWNER_SEED_PATH = path.resolve(__dirname, '../database/seed/owner-accounts.json');

const LOCAL_OWNER_PASSWORDS: Record<string, string> = {
  HCMS_ADMIN_PASSWORD: 'Admin@123#$%',
  HCMS_HR_PASSWORD: 'Hr@123#$%',
};

/**
 * Demo / seed portal roles for employee-linked emails.
 * Never map to ADMIN here — portal Admin is Create Admin only (systemAccount, no employee).
 */
const DEMO_ROLE_BY_EMAIL: Record<string, string> = {
  'hr@company.com': 'HR',
  'manager@company.com': 'MANAGER',
  'employee@company.com': 'EMPLOYEE',
  'hr@iroc.hcms': 'HR',
  'manager@iroc.hcms': 'MANAGER',
  'employee@iroc.hcms': 'EMPLOYEE',
  'kimsanear5@gmail.com': 'HR',
};

type OwnerSeed = {
  employeePk?: string;
  employeeId?: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  departmentId?: string;
  positionId?: string;
  positionTitle?: string;
  passwordEnv: string;
  /** Portal-only administrator — not linked to an employee row. */
  systemAccount?: boolean;
};

export async function nextPortalUserId(): Promise<string> {
  const rows = (await User.findAll({ attributes: ['id'], raw: true })) as { id: string }[];
  let maxSeq = 0;
  for (const row of rows) {
    const match = String(row.id || '').match(/^u-(\d+)$/i);
    if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
  }
  return `u-${maxSeq + 1}`;
}

function resolveOwnerPassword(envKey: string): string {
  const fallback = LOCAL_OWNER_PASSWORDS[envKey];
  const preferSeed = String(process.env.HCMS_USE_SEED_OWNER_PASSWORDS ?? '1')
    .trim()
    .toLowerCase();
  // Default: use repo seed passwords so a stale Render env var cannot block admin login.
  // Set HCMS_USE_SEED_OWNER_PASSWORDS=0 to honor HCMS_ADMIN_PASSWORD / HCMS_HR_PASSWORD.
  if (preferSeed !== '0' && preferSeed !== 'false' && preferSeed !== 'off' && fallback) {
    return fallback;
  }
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  if (!fallback) {
    throw new Error(`Missing password for ${envKey}. Set env or use local defaults.`);
  }
  return fallback;
}

async function defaultEmployeePortalPassword(): Promise<string> {
  return resolveDefaultPortalPasswordForNewAccount();
}

function roleForEmployeeEmail(email: string): string {
  const mapped = DEMO_ROLE_BY_EMAIL[email.toLowerCase()] ?? 'EMPLOYEE';
  // Defensive: Admin must never come from employee email demos.
  if (String(mapped).toUpperCase() === 'ADMIN') return 'EMPLOYEE';
  return mapped;
}

/**
 * Portal Admin is Create Admin only. Any ADMIN row still linked to an employee
 * (legacy demos / bad sync) is demoted to Staff/HR/Manager from the email map.
 */
export async function demoteEmployeeLinkedAdminAccounts(): Promise<number> {
  const rows = await User.findAll({
    where: {
      role: 'ADMIN',
      employeeId: { [Op.ne]: null },
    },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  let fixed = 0;
  for (const user of rows) {
    const plain = user.get({ plain: true }) as {
      email?: string | null;
      employeeId?: string | null;
      role?: string | null;
    };
    if (isSystemAdminAccount(plain)) continue;
    const email = String(plain.email ?? '')
      .trim()
      .toLowerCase();
    const nextRole = roleForEmployeeEmail(email);
    await user.update({ role: nextRole } as any);
    fixed += 1;
    console.log(
      `[db] Demoted employee-linked Admin → ${nextRole} for ${email || plain.employeeId}`
    );
  }
  return fixed;
}

/** Restore IROC owner rows (Ear Kimseng / Ear Kimsan) — idempotent. */
export async function restoreOwnerAccounts(): Promise<number> {
  if (!fs.existsSync(OWNER_SEED_PATH)) return 0;

  const owners = JSON.parse(fs.readFileSync(OWNER_SEED_PATH, 'utf8')) as OwnerSeed[];
  const now = new Date();
  const joinDate = new Date('2025-05-01');
  const birthDate = new Date('1995-05-05');

  for (const owner of owners) {
    const isSystemAccount = owner.systemAccount === true || owner.role === 'ADMIN';

    if (!isSystemAccount) {
      let departmentId = owner.departmentId || null;
      let positionId = owner.positionId || null;
      if (departmentId) {
        const dept = await Department.findByPk(departmentId);
        if (!dept) {
          const byName = await Department.findOne({
            where: {
              name: owner.role === 'HR' ? 'Human Resources' : 'Administration',
            } as any,
          });
          departmentId = byName ? String(byName.get('id')) : null;
        }
      }
      if (positionId) {
        const pos = await Position.findByPk(positionId);
        if (!pos) {
          const byTitle = owner.positionTitle
            ? await Position.findOne({ where: { title: owner.positionTitle } as any })
            : null;
          positionId = byTitle ? String(byTitle.get('id')) : null;
        }
      }

      const [employee, createdEmployee] = await Employee.findOrCreate({
        where: { id: owner.employeePk! },
        defaults: {
          id: owner.employeePk!,
          employee_id: owner.employeeId!,
          first_name: owner.firstName,
          last_name: owner.lastName,
          email: owner.email,
          phone: owner.phone,
          gender: 'Male',
          birth_date: birthDate,
          nationality: 'Cambodia',
          marital_status: 'single',
          department_id: departmentId,
          position_id: positionId,
          employment_type: 'Full-Time',
          join_date: joinDate,
          probation_period_months: 3,
          work_location: 'office',
          status: 'active',
          created_at: now,
          updated_at: now,
        } as any,
      });

      // Credential / link restore only — never clobber profile name (or phone) edits on boot.
      // Previously first_name/last_name were reset from seed every initDb → "Officer HR" returned.
      const patch: Record<string, unknown> = {
        employee_id: owner.employeeId!,
        email: owner.email,
        status: 'active',
        updated_at: now,
      };
      if (createdEmployee) {
        Object.assign(
          patch,
          ownerEmployeeNamePatch({
            created: true,
            seedFirst: owner.firstName,
            seedLast: owner.lastName,
          })
        );
        patch.phone = owner.phone;
      } else {
        const plain = employee.get({ plain: true }) as {
          phone?: string | null;
          first_name?: string | null;
          last_name?: string | null;
        };
        if (!String(plain.phone ?? '').trim()) {
          patch.phone = owner.phone;
        }
        Object.assign(
          patch,
          ownerEmployeeNamePatch({
            created: false,
            currentFirst: plain.first_name,
            currentLast: plain.last_name,
            seedFirst: owner.firstName,
            seedLast: owner.lastName,
          })
        );
      }
      // Only overwrite org FKs when the target rows exist (avoids breaking local DBs
      // that use DEPT*/POS* ids instead of legacy dep-*/pos-* seed ids).
      if (departmentId) patch.department_id = departmentId;
      if (positionId) patch.position_id = positionId;
      await employee.update(patch as any);
    }

    const password = resolveOwnerPassword(owner.passwordEnv);
    const passwordSource = process.env[owner.passwordEnv]?.trim()
      ? `env:${owner.passwordEnv}`
      : 'local-default';
    const displayName = `${owner.firstName} ${owner.lastName}`.trim();
    let user = await User.findOne({
      where: {
        [Op.or]: [
          { id: owner.userId },
          { email: owner.email },
          ...(owner.employeePk ? [{ employeeId: owner.employeePk }] : []),
        ],
      },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });

    const hashed = await bcrypt.hash(password, 12);
    // Password first — never block credential restore on login_id unique conflicts.
    const corePatch: Record<string, unknown> = {
      email: owner.email,
      password: hashed,
      passwordLength: password.length,
      role: owner.role,
      employeeId: isSystemAccount ? null : owner.employeePk!,
      phone: normalizePhone(owner.phone),
      isActive: true,
      status: 'ACTIVE',
      passwordChangedAt: now,
      ...(isSystemAccount ? { display_name: displayName } : {}),
    };

    if (user) {
      await user.update(corePatch as any);
    } else {
      user = await User.create({
        id: owner.userId,
        ...corePatch,
      } as any);
    }

    let loginId = '';
    if (isSystemAccount && user) {
      const { ensureUserLoginIdColumn, nextAdminLoginId, formatAdminLoginId } = await import(
        './systemAdminAccount.js'
      );
      await ensureUserLoginIdColumn();
      await user.reload({ attributes: [...USER_ACCOUNT_ATTRIBUTES] });
      const plainUser = user.get({ plain: true }) as { login_id?: string | null; id?: string };
      loginId = String(plainUser.login_id ?? '')
        .trim()
        .toUpperCase();
      if (!loginId) {
        const preferred = owner.userId === 'u-1' ? formatAdminLoginId(1) : await nextAdminLoginId();
        const clash = await User.findOne({
          where: { login_id: preferred },
          attributes: ['id'],
        });
        loginId =
          clash && String(clash.get('id')) !== String(user.get('id'))
            ? await nextAdminLoginId()
            : preferred;
        try {
          await user.update({ login_id: loginId } as any);
        } catch (err) {
          loginId = await nextAdminLoginId();
          await user.update({ login_id: loginId } as any);
          console.warn(
            '[db] Owner admin login_id retry:',
            (err as Error)?.message || err
          );
        }
      }
      console.log(
        `[db] Owner admin ready: EmpID ${loginId} email ${owner.email} (password from ${passwordSource})`
      );
    }
  }

  // Unblock portal-only admins (e.g. Create Admin accounts) that share no owner email —
  // otherwise ADM00001 may belong to "Theany" while only leang.codes was password-reset.
  await syncPortalOnlyAdminPasswords();

  return owners.length;
}

/**
 * Reset every portal-only ADMIN password to HCMS_ADMIN_PASSWORD / Admin@123#$%.
 * Opt out with HCMS_SYNC_ALL_SYSTEM_ADMIN_PASSWORDS=0.
 */
export async function syncPortalOnlyAdminPasswords(): Promise<number> {
  const flag = String(process.env.HCMS_SYNC_ALL_SYSTEM_ADMIN_PASSWORDS ?? '1')
    .trim()
    .toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return 0;

  const { listSystemAdminAccounts, ensureUserLoginIdColumn, nextAdminLoginId } = await import(
    './systemAdminAccount.js'
  );
  await ensureUserLoginIdColumn();
  const password = resolveOwnerPassword('HCMS_ADMIN_PASSWORD');
  const hashed = await bcrypt.hash(password, 12);
  const now = new Date();
  const rows = await listSystemAdminAccounts();
  let updated = 0;

  for (const row of rows) {
    const id = String(row.id || '').trim();
    if (!id) continue;
    let loginId = String(row.login_id ?? '')
      .trim()
      .toUpperCase();
    if (!loginId) {
      loginId = await nextAdminLoginId();
    }
    await User.update(
      {
        password: hashed,
        passwordLength: password.length,
        passwordChangedAt: now,
        isActive: true,
        status: 'ACTIVE',
        login_id: loginId,
      } as any,
      { where: { id } }
    );
    updated += 1;
    console.log(
      `[db] Synced system admin password: EmpID ${loginId} email ${row.email || id}`
    );
  }
  return updated;
}

/**
 * Ensure every active employee with an email has a portal user linked via employeeId.
 * Links demo users u-1…u-4 by email; creates missing accounts with HCMS_DEFAULT_EMPLOYEE_PASSWORD.
 */
export async function ensureEmployeeLoginAccounts(): Promise<{
  owners: number;
  linked: number;
  created: number;
}> {
  const owners = await restoreOwnerAccounts();
  await demoteEmployeeLinkedAdminAccounts();

  const employees = (await Employee.findAll({
    where: {
      status: {
        [Op.notIn]: [
          'terminated',
          'inactive',
          'TERMINATED',
          'INACTIVE',
          'draft',
          'DRAFT',
          'profile_incomplete',
          'PROFILE_INCOMPLETE',
        ],
      },
    },
  })) as any[];

  const defaultEnabled = await isDefaultPortalPasswordEnabled();
  let defaultHash: string | undefined;
  if (defaultEnabled) {
    const defaultPassword = await defaultEmployeePortalPassword();
    defaultHash = await bcrypt.hash(defaultPassword, 12);
  }

  let linked = 0;
  let created = 0;

  for (const emp of employees) {
    // When default password is disabled, only link existing users — do not create
    // accounts without an explicit password.
    const result = await syncPortalUserForEmployeeRecord(
      emp,
      defaultEnabled ? defaultHash : undefined,
      { allowCreateWithDefault: defaultEnabled }
    );
    if (!result) continue;
    if (result.linked) linked += 1;
    if (result.created) created += 1;
  }

  if (created > 0 || linked > 0 || owners > 0) {
    console.log(
      `[db] Portal logins: ${owners} owner(s), ${linked} linked, ${created} created` +
        (defaultEnabled
          ? ' (default portal password from settings/env).'
          : ' (default portal password disabled; skipped new creates without password).')
    );
  }

  return { owners, linked, created };
}

async function syncPortalUserForEmployeeRecord(
  emp: { toJSON?: () => Record<string, unknown> } & Record<string, unknown>,
  passwordHash?: string,
  options?: { allowCreateWithDefault?: boolean }
): Promise<{ linked: boolean; created: boolean } | null> {
  const empPlain = emp.toJSON ? emp.toJSON() : emp;
  const lifecycle = String(empPlain.status ?? '')
    .trim()
    .toLowerCase();
  if (!lifecycle || lifecycle === 'draft' || lifecycle === 'profile_incomplete') {
    return null;
  }
  const email = String(empPlain.email || '').trim().toLowerCase();
  if (!email) return null;

  const role = roleForEmployeeEmail(email);
  const user = await User.findOne({
    where: {
      [Op.or]: [{ employeeId: empPlain.id }, { email }],
    },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });

  if (user) {
    const userPlain = user.get({ plain: true });
    if (isSystemAdminAccount(userPlain)) {
      return { linked: false, created: false };
    }
    const loginPhone = normalizePhone(empPlain.phone);
    const patch: Record<string, unknown> = {
      employeeId: empPlain.id,
      email,
      isActive: true,
      status: 'ACTIVE',
      ...(loginPhone.length >= 8 ? { phone: loginPhone } : {}),
    };
    const linked = !user.employeeId || user.employeeId !== empPlain.id;
    const currentRole = String(user.role ?? 'EMPLOYEE').toUpperCase();
    // Never keep or promote ADMIN on employee-linked portal users.
    if (currentRole === 'ADMIN' || (role !== 'EMPLOYEE' && currentRole !== role)) {
      patch.role = role;
    }
    await user.update(patch as any);
    if (loginPhone.length >= 8) {
      await syncPortalPhoneFromEmployee(String(empPlain.id), loginPhone);
    }
    return { linked, created: false };
  }

  let hash = passwordHash;
  let passwordLength: number | null = null;
  if (!hash) {
    if (options?.allowCreateWithDefault === false) {
      return null;
    }
    const defaultPassword = await defaultEmployeePortalPassword();
    hash = await bcrypt.hash(defaultPassword, 12);
    passwordLength = defaultPassword.length;
  }
  const loginPhone = normalizePhone(empPlain.phone);
  await User.create({
    id: await nextPortalUserId(),
    email,
    password: hash,
    passwordLength,
    role,
    employeeId: empPlain.id,
    phone: loginPhone.length >= 8 ? loginPhone : null,
    status: 'ACTIVE',
    isActive: true,
    passwordChangedAt: new Date(),
    // New portal account only — first login must set their own password.
    mustChangePassword: true,
  } as any);
  return { linked: false, created: true };
}

/** Ensure a single active employee has a linked portal login after approval. */
export async function ensurePortalUserForEmployee(
  employee: { toJSON?: () => Record<string, unknown> } & Record<string, unknown>
): Promise<{ linked: boolean; created: boolean; skipped: boolean }> {
  const allowCreateWithDefault = await isDefaultPortalPasswordEnabled();
  const result = await syncPortalUserForEmployeeRecord(employee, undefined, {
    allowCreateWithDefault,
  });
  if (!result) return { linked: false, created: false, skipped: true };
  return { ...result, skipped: false };
}

/** Read-only health for /api/health and ops checks. */
export async function getPortalAccountHealth(): Promise<{
  employeeCount: number;
  userCount: number;
  employeesWithoutLogin: number;
  usersMissingEmployeeId: number;
  ownersPresent: boolean;
  systemAdmins: Array<{ loginId: string; email: string; name: string; active: boolean }>;
}> {
  const employeeCount = await Employee.count();
  const userCount = await User.count();
  const users = (await User.findAll({ attributes: ['employeeId'], raw: true })) as {
    employeeId: string | null;
  }[];
  const usersMissingEmployeeId = users.filter((u) => !u.employeeId).length;

  const employees = (await Employee.findAll({
    attributes: ['id', 'email', 'status'],
    raw: true,
  })) as { id: string; email: string; status: string }[];

  const activeWithEmail = employees.filter(
    (e) =>
      String(e.email || '').trim() &&
      !['terminated', 'inactive', 'TERMINATED', 'INACTIVE'].includes(String(e.status || ''))
  );

  let employeesWithoutLogin = 0;
  for (const emp of activeWithEmail) {
    const linked = await User.findOne({
      where: { employeeId: emp.id },
      attributes: ['id'],
    });
    if (!linked) employeesWithoutLogin += 1;
  }

  const ownerRows = await Employee.count({
    where: {
      employee_id: {
        [Op.in]: ['ROC00013', 'ROC00014', 'IROC00013', 'IROC00014'],
      },
    },
  });

  let systemAdmins: Array<{ loginId: string; email: string; name: string; active: boolean }> = [];
  try {
    const { listSystemAdminAccounts } = await import('./systemAdminAccount.js');
    const rows = await listSystemAdminAccounts();
    systemAdmins = rows.map((row) => ({
      loginId: String(row.login_id || '')
        .trim()
        .toUpperCase(),
      email: String(row.email || ''),
      name: String(row.display_name || row.email || row.id || ''),
      active: row.isActive !== false && String(row.status || '').toUpperCase() !== 'INACTIVE',
    }));
  } catch {
    systemAdmins = [];
  }

  return {
    employeeCount,
    userCount,
    employeesWithoutLogin,
    usersMissingEmployeeId,
    ownersPresent: ownerRows >= 2,
    systemAdmins,
  };
}
