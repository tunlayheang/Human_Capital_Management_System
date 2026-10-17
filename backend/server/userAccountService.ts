import { Op } from 'sequelize';
import { Department, Employee, Position, sequelize, User } from './db.js';
import { isEmployeeInactiveForPortal } from './employeePortalStatus.js';
import {
  PORTAL_USER_STATUS_FROZEN,
  PORTAL_USER_STATUS_INACTIVE,
} from './portalUserAccount.js';
import { normalizePhone } from './phoneUtils.js';
import { bulkLoadSalaryStructures, loadSalaryStructureForEmployeeId } from './salaryStructureService.js';
import { resolvePinSecurity } from './pinSecurity.js';
import { isUserOnline, lastSeenIso } from './chatPresence.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';
import { toCanonicalEmployeeDisplayId } from './employeeIdFormat.js';

/** Columns that belong on `users` (portal account only). */
export const USER_ACCOUNT_ATTRIBUTES = [
  'id',
  'email',
  'password',
  'role',
  'status',
  'isActive',
  'employeeId',
  'phone',
  'display_name',
  'login_id',
  'avatar_url',
  'otp',
  'otpExpiry',
  'sessionToken',
  'lastActivity',
  'passwordChangedAt',
  'passwordLength',
  'mustChangePassword',
  'resetToken',
  'resetTokenExpiry',
  'resetPasswordVerifiedAt',
  'securityPinHash',
  'pinAutoLockMinutes',
  'pinLockEnabled',
  'pinFailedAttempts',
  'pinLockedRequiresOtp',
  'pinRecoveryVerifiedAt',
  'preferred_currency',
] as const;

export function stripUserSecrets(user: any) {
  const plain = user?.toJSON ? user.toJSON() : { ...user };
  plain.hasPassword = Boolean(plain.password && String(plain.password).length > 0);
  plain.mustChangePassword = Boolean(plain.mustChangePassword);
  delete plain.password;
  delete plain.otp;
  delete plain.sessionToken;
  delete plain.resetToken;
  delete plain.resetPasswordVerifiedAt;
  delete plain.securityPinHash;
  delete plain.failedLoginAttempts;
  delete plain.loginLockedUntil;
  if (plain.role != null && plain.accessRole == null) {
    plain.accessRole = plain.role;
  }
  return plain;
}

/** Profile fields stored on `employees` / salary structure — not on `users`. */
const USER_LEGACY_COLUMNS = [
  'name',
  'departmentId',
  'position',
  'joinDate',
  'avatarUrl',
  'address',
  'salary',
  'dependents',
  'firstName',
  'lastName',
  'birthDate',
  'gender',
  'nationalId',
  'bio',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'bankAccountName',
  'bankAccountNumber',
  'bankName',
  'taxId',
  'startDate',
  'endDate',
  'workLocation',
  'employmentType',
  'managerId',
  'leaveBalance',
  'usedLeave',
] as const;

export type EmployeeProfilePayload = {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  first_name_kh: string;
  last_name_kh: string;
  full_name_kh: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  department_id: string;
  department_name: string | null;
  department_name_kh: string | null;
  position_id: string;
  position_title: string | null;
  position_title_kh: string | null;
  employment_type: string | null;
  work_location: string | null;
  join_date: string | null;
  status: string | null;
};

export type EnrichedUserResponse = {
  id: string;
  employeeId: string | null;
  /** HR display code from `employees.employee_id` (e.g. ROC00001), or admin `login_id` (ADM00001). */
  displayEmployeeId?: string | null;
  /** Portal-only admin login code (`users.login_id`). Null for employee-linked accounts. */
  loginId?: string | null;
  email: string;
  role: string;
  status?: string;
  isActive?: boolean;
  name: string;
  departmentId?: string;
  position?: string;
  avatarUrl?: string;
  phone?: string;
  joinDate?: string;
  salary?: number;
  dependents?: number;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  gender?: string;
  nationalId?: string;
  bio?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  taxId?: string;
  workLocation?: string;
  employmentType?: string;
  employee: EmployeeProfilePayload | null;
  /** system = Admin portal account with no employee record; employee_linked = HR employee profile */
  accountType?: 'system' | 'employee_linked' | 'user';
  /** False when portal login was enabled without a password — set in User Management. */
  hasPassword?: boolean;
  /** Character count of the current password (for masked UI only). */
  passwordLength?: number | null;
  /** True until the user sets their own password after first login / admin reset. */
  mustChangePassword?: boolean;
  pinLockEnabled?: boolean;
  pinRequired?: boolean;
  pinMandatory?: boolean;
  pinSet?: boolean;
  pinAutoLockMinutes?: number;
  preferredCurrency?: 'KHR' | 'USD';
};

function formatJoinDate(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw.split('T')[0];
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  return String(raw);
}

function employeeRowToProfile(plain: Record<string, unknown>): EmployeeProfilePayload {
  const firstKh = String(plain.first_name_kh || '').trim();
  const lastKh = String(plain.last_name_kh || '').trim();
  const dept = plain.department as { name?: string; name_kh?: string } | undefined;
  const pos = plain.position as { title?: string; title_kh?: string } | undefined;
  return {
    id: String(plain.id),
    employee_id: toCanonicalEmployeeDisplayId(plain.employee_id) || String(plain.employee_id || ''),
    first_name: String(plain.first_name || ''),
    last_name: String(plain.last_name || ''),
    full_name: joinEmployeeNameParts(plain.first_name as string, plain.last_name as string),
    first_name_kh: firstKh,
    last_name_kh: lastKh,
    full_name_kh: joinEmployeeNameParts(firstKh, lastKh),
    email: String(plain.email || ''),
    phone: String(plain.phone || ''),
    avatar_url: (plain.avatar_url as string) || null,
    department_id: String(plain.department_id || ''),
    department_name: dept?.name || null,
    department_name_kh: String(dept?.name_kh || '').trim() || null,
    position_id: String(plain.position_id || ''),
    position_title: pos?.title || null,
    position_title_kh: String(pos?.title_kh || '').trim() || null,
    employment_type: (plain.employment_type as string) || null,
    work_location: (plain.work_location as string) || null,
    join_date: formatJoinDate(plain.join_date) || null,
    status: (plain.status as string) || null,
  };
}

export async function findEmployeeForUser(user: {
  id?: string;
  employeeId?: string | null;
  email?: string | null;
  role?: string | null;
}): Promise<any | null> {
  const role = String(user.role || '').toUpperCase();
  if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && !String(user.employeeId ?? '').trim()) {
    return null;
  }

  const employeeId = user.employeeId ? String(user.employeeId) : '';
  if (employeeId) {
    try {
      const byId = await Employee.findByPk(employeeId, {
        include: [
          { model: Department, as: 'department', attributes: ['id', 'name', 'name_kh'] },
          { model: Position, as: 'position', attributes: ['id', 'title', 'title_kh'] },
        ],
      });
      if (byId) return byId;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  const email = String(user.email || '').trim().toLowerCase();
  if (email) {
    try {
      const byEmail = await Employee.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('email')),
          email
        ),
        include: [
          { model: Department, as: 'department', attributes: ['id', 'name', 'name_kh'] },
          { model: Position, as: 'position', attributes: ['id', 'title', 'title_kh'] },
        ],
      });
      if (byEmail) return byEmail;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  return null;
}

function isMissingTableError(err: unknown): boolean {
  const code = (err as { parent?: { code?: string }; original?: { code?: string } })?.parent?.code
    || (err as { original?: { code?: string } })?.original?.code
    || '';
  if (code === 'ER_NO_SUCH_TABLE') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /doesn't exist/i.test(msg);
}

export async function findEmployeeByUserId(userId: string): Promise<any | null> {
  const user: any = await User.findByPk(userId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  if (!user) return null;
  const plain = user.get ? user.get({ plain: true }) : user;
  return findEmployeeForUser(plain);
}

export async function enrichUsersWithEmployee<T extends { employeeId?: string | null; email?: string | null }>(
  users: T[]
): Promise<Array<T & { employee: EmployeeProfilePayload | null }>> {
  const employeeIds = Array.from(
    new Set(users.map((u) => String(u.employeeId || '').trim()).filter(Boolean))
  );
  const emails = Array.from(
    new Set(users.map((u) => String(u.email || '').trim().toLowerCase()).filter(Boolean))
  );

  const byId: Record<string, EmployeeProfilePayload> = {};
  const byEmail: Record<string, EmployeeProfilePayload> = {};

  if (employeeIds.length || emails.length) {
    try {
      const orClauses: Record<string, unknown>[] = [];
      if (employeeIds.length) orClauses.push({ id: { [Op.in]: employeeIds } });
      if (emails.length) orClauses.push({ email: { [Op.in]: emails } });

      const rows: any[] = await Employee.findAll({
        where: { [Op.or]: orClauses },
        include: [
          { model: Department, as: 'department', attributes: ['id', 'name', 'name_kh'] },
          { model: Position, as: 'position', attributes: ['id', 'title', 'title_kh'] },
        ],
      });

      for (const r of rows) {
        const plain = r.toJSON ? r.toJSON() : r;
        const payload = employeeRowToProfile(plain);
        byId[payload.id] = payload;
        const e = String(plain.email || '').trim().toLowerCase();
        if (e) byEmail[e] = payload;
      }
    } catch (e) {
      console.warn('enrichUsersWithEmployee lookup failed:', (e as Error)?.message || e);
    }
  }

  return users.map((u) => {
    const role = String((u as { role?: string }).role || '').toUpperCase();
    if (
      (role === 'ADMIN' || role === 'SUPER_ADMIN') &&
      !String(u.employeeId ?? '').trim()
    ) {
      return { ...u, employee: null };
    }
    const id = String(u.employeeId || '').trim();
    const e = String(u.email || '').trim().toLowerCase();
    const employee = (id && byId[id]) || (e && byEmail[e]) || null;
    return { ...u, employee };
  });
}

export type AuditActorSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Staff badge (ROC#####) or portal-only admin login_id (ADM#####). */
  employeeCode: string | null;
  role: string | null;
};

function looksLikePortalUserId(value: string | null | undefined): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  if (/^u-\d+$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  return false;
}

function resolveAuditActorDisplayName(
  account: { id?: string; email?: string | null; display_name?: string | null },
  profile: EmployeeProfilePayload | null
): string {
  const fromProfile = profile?.full_name?.trim();
  if (fromProfile && !looksLikePortalUserId(fromProfile)) return fromProfile;
  const fromDisplay = String(account.display_name ?? '').trim();
  if (fromDisplay && !looksLikePortalUserId(fromDisplay)) return fromDisplay;
  const email = String(profile?.email || account.email || '').trim();
  if (email) {
    const local = email.split('@')[0]?.trim();
    if (local && !looksLikePortalUserId(local)) return local;
  }
  // Never surface raw portal ids (`u-3`, UUIDs) as a person's display name.
  return 'User';
}

/** Resolve portal users to employee display names for audit log actor columns. */
export async function buildAuditActorMap(
  userIds: string[]
): Promise<Map<string, AuditActorSummary>> {
  const ids = Array.from(new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const result = new Map<string, AuditActorSummary>();
  if (!ids.length) return result;

  const rows = (await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'email', 'role', 'employeeId', 'display_name', 'phone', 'login_id'],
  })) as Array<{ get: (opts: { plain: true }) => Record<string, unknown> }>;

  const enriched = await enrichUsersWithEmployee(
    rows.map((row) => {
      const plain = row.get({ plain: true });
      return plain as {
        id: string;
        email?: string | null;
        role?: string | null;
        employeeId?: string | null;
        display_name?: string | null;
        phone?: string | null;
        login_id?: string | null;
        loginId?: string | null;
      };
    })
  );

  for (const account of enriched) {
    const profile = account.employee;
    const email = String(profile?.email || account.email || '').trim() || null;
    const phone =
      String(profile?.phone ?? account.phone ?? '').trim() || null;
    // Staff: employees.employee_id (ROC#####). Portal-only admins: users.login_id (ADM#####).
    const fromProfile = String(profile?.employee_id ?? '').trim();
    const fromAdminLogin = String(account.login_id ?? account.loginId ?? '').trim();
    const employeeCode =
      toCanonicalEmployeeDisplayId(fromProfile || fromAdminLogin) || null;
    result.set(String(account.id), {
      id: String(account.id),
      name: resolveAuditActorDisplayName(account, profile),
      email,
      phone,
      employeeCode,
      role: account.role ? String(account.role) : null,
    });
  }

  return result;
}

async function loadCompensation(employeeRowId: string) {
  try {
    return await loadSalaryStructureForEmployeeId(employeeRowId);
  } catch {
    return null;
  }
}

type SerializeUserOptions = {
  preloadedProfile?: EmployeeProfilePayload | null;
  preloadedStructure?: Record<string, unknown> | null;
  skipStatusSync?: boolean;
};

export async function serializeUserForClient(
  account: Record<string, unknown>,
  employeeRow?: any | null,
  options?: SerializeUserOptions
): Promise<EnrichedUserResponse> {
  const roleUpper = String(account.role || 'EMPLOYEE').toUpperCase();
  const linkedEmployeeId = String(account.employeeId ?? '').trim();
  const systemOnlyAdmin =
    (roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN') && !linkedEmployeeId;

  const employee =
    employeeRow ||
    (systemOnlyAdmin
      ? null
      : await findEmployeeForUser({
          id: String(account.id || ''),
          employeeId: account.employeeId as string | null,
          email: account.email as string | null,
          role: account.role as string | null,
        }));

  const empPlain = employee?.toJSON ? employee.toJSON() : employee;
  const profile =
    options?.preloadedProfile ??
    (empPlain ? employeeRowToProfile(empPlain as Record<string, unknown>) : null);
  const structure =
    options?.preloadedStructure !== undefined
      ? options.preloadedStructure
      : empPlain?.id
        ? await loadCompensation(String(empPlain.id))
        : null;

  // Employee work email is canonical when a portal account is linked to a record.
  const email = profile?.email
    ? String(profile.email).trim()
    : String(account.email || '').trim();
  const displayName =
    profile?.full_name ||
    String(account.display_name ?? account.displayName ?? '').trim() ||
    String(account.email || 'User')
      .split('@')[0]
      .trim() ||
    'User';

  const street = empPlain?.street_address ? String(empPlain.street_address) : '';
  const city = empPlain?.city ? String(empPlain.city) : '';
  const address = [street, city].filter(Boolean).join(', ') || undefined;

  let isActive = account.isActive !== false;
  let status = String(account.status || 'ACTIVE');
  if (profile && isEmployeeInactiveForPortal(profile.status)) {
    const terminated =
      String(profile.status ?? '')
        .trim()
        .toLowerCase() === 'terminated';
    isActive = false;
    status = terminated ? PORTAL_USER_STATUS_FROZEN : PORTAL_USER_STATUS_INACTIVE;
    if (
      !options?.skipStatusSync &&
      (account.isActive !== false || String(account.status) !== status)
    ) {
      try {
        await User.update(
          {
            isActive: false,
            status,
            ...(terminated ? { sessionToken: null } : {}),
          },
          { where: { id: String(account.id) } }
        );
      } catch (err) {
        console.warn(
          '[userAccount] Could not sync inactive user for employee:',
          (err as Error)?.message || err
        );
      }
    }
  }

  const displayEmployeeId =
    profile?.employee_id && String(profile.employee_id).trim()
      ? toCanonicalEmployeeDisplayId(profile.employee_id) || String(profile.employee_id).trim()
      : null;

  const base: EnrichedUserResponse = {
    id: String(account.id),
    employeeId: systemOnlyAdmin ? null : (account.employeeId as string) || profile?.id || null,
    displayEmployeeId: systemOnlyAdmin ? null : displayEmployeeId,
    email,
    role: String(account.role || 'EMPLOYEE').toUpperCase(),
    accountType: systemOnlyAdmin ? 'system' : profile ? 'employee_linked' : 'user',
    hasPassword:
      account.hasPassword === true ||
      Boolean(account.password && String(account.password).length > 0),
    passwordLength: (() => {
      const n = Number(account.passwordLength);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    })(),
    mustChangePassword: Boolean(account.mustChangePassword),
    status,
    isActive,
    isOnline: isUserOnline(account.lastActivity),
    lastSeenAt: lastSeenIso(account.lastActivity),
    name: displayName,
    departmentId: profile?.department_id,
    position: profile?.position_title || undefined,
    avatarUrl: profile?.avatar_url || (account.avatar_url as string) || '',
    phone:
      (account.phone != null && String(account.phone).trim()
        ? normalizePhone(account.phone)
        : '') ||
      profile?.phone ||
      undefined,
    joinDate: profile?.join_date || undefined,
    salary: structure?.base_salary != null ? Number(structure.base_salary) : undefined,
    dependents: structure?.tax_dependents != null ? Number(structure.tax_dependents) : undefined,
    firstName: profile?.first_name,
    lastName: profile?.last_name,
    birthDate: empPlain?.birth_date ? formatJoinDate(empPlain.birth_date) : undefined,
    gender: (empPlain?.gender as string) || undefined,
    nationalId: (empPlain?.national_id as string) || undefined,
    bio:
      empPlain?.bio != null && String(empPlain.bio).trim()
        ? String(empPlain.bio)
        : undefined,
    address,
    emergencyContactName: (empPlain?.emergency_contact_name as string) || undefined,
    emergencyContactPhone: (empPlain?.emergency_contact_phone as string) || undefined,
    emergencyContactRelation: (empPlain?.emergency_contact_relationship as string) || undefined,
    bankName: (empPlain?.bank_name as string) || (structure?.bank_name as string) || undefined,
    bankAccountNumber:
      (empPlain?.bank_account_number as string) || (structure?.bank_account_number as string) || undefined,
    taxId: (empPlain?.tax_id as string) || (structure?.tax_id as string) || undefined,
    workLocation: profile?.work_location || undefined,
    employmentType: profile?.employment_type || undefined,
    employee: profile,
    preferredCurrency:
      String(account.preferred_currency ?? account.preferredCurrency ?? 'USD').toUpperCase() ===
      'USD'
        ? 'USD'
        : 'KHR',
    ...resolvePinSecurity(account),
  };

  if (!systemOnlyAdmin) return base;

  const adminLoginId = String(account.login_id ?? account.loginId ?? '')
    .trim()
    .toUpperCase() || null;
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  return {
    ...base,
    employeeId: null,
    displayEmployeeId: adminLoginId,
    loginId: adminLoginId,
    accountType: 'system',
    employee: null,
    departmentId: undefined,
    position: undefined,
    joinDate: undefined,
    salary: undefined,
    dependents: undefined,
    firstName: nameParts[0] || displayName,
    lastName: nameParts.slice(1).join(' ') || undefined,
    birthDate: undefined,
    gender: undefined,
    nationalId: undefined,
    address: undefined,
    bio: undefined,
    emergencyContactName: undefined,
    emergencyContactPhone: undefined,
    emergencyContactRelation: undefined,
    bankName: undefined,
    bankAccountName: undefined,
    bankAccountNumber: undefined,
    taxId: undefined,
    workLocation: undefined,
    employmentType: undefined,
    avatarUrl: String(account.avatar_url ?? '').trim() || '',
  };
}

export function mergeUserWithEmployeeProfile<T extends { employee: EmployeeProfilePayload | null }>(
  row: T
): EnrichedUserResponse {
  const emp = row.employee;
  const account = row as Record<string, unknown>;
  const displayName = emp?.full_name || String(account.email || 'User').split('@')[0] || 'User';
  return {
    ...(row as unknown as EnrichedUserResponse),
    name: displayName,
    avatarUrl: emp?.avatar_url || '',
    position: emp?.position_title || (row as { position?: string }).position,
    departmentId: emp?.department_id || (row as { departmentId?: string }).departmentId,
    phone:
      ((row as { phone?: string }).phone &&
        String((row as { phone?: string }).phone).trim()) ||
      emp?.phone ||
      undefined,
    employee: emp,
  };
}

export async function serializeUsersForClient(
  accounts: Array<Record<string, unknown>>,
  options?: { skipStatusSync?: boolean; skipSalary?: boolean }
): Promise<EnrichedUserResponse[]> {
  const enriched = await enrichUsersWithEmployee(accounts);
  const structures =
    options?.skipSalary === true
      ? new Map<string, Record<string, unknown>>()
      : await bulkLoadSalaryStructures(
          enriched
            .map((row) => row.employee?.id)
            .filter((id): id is string => Boolean(id))
        );

  return Promise.all(
    enriched.map((row) =>
      serializeUserForClient(row as Record<string, unknown>, null, {
        preloadedProfile: row.employee,
        preloadedStructure:
          options?.skipSalary === true
            ? null
            : row.employee?.id
              ? structures.get(row.employee.id) ?? null
              : null,
        skipStatusSync: options?.skipStatusSync,
      })
    )
  );
}

const SELF_PROFILE_TO_EMPLOYEE: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  phone: 'phone',
  address: 'street_address',
  birthDate: 'birth_date',
  gender: 'gender',
  nationalId: 'national_id',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  emergencyContactRelation: 'emergency_contact_relationship',
  bankName: 'bank_name',
  bankAccountNumber: 'bank_account_number',
  avatarUrl: 'avatar_url',
  bio: 'bio',
  workLocation: 'work_location',
  employmentType: 'employment_type',
};

/** Apply self-service profile patch to the linked employee row (or users for system accounts). */
export async function applySelfProfilePatchToEmployee(
  userId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const user: any = await User.findByPk(userId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  if (!user) return;

  const employee = await findEmployeeForUser(user.get({ plain: true }));
  if (!employee) {
    // System-only portal accounts have no employees row — keep photo on users.avatar_url.
    const accountPatch: Record<string, unknown> = {};
    if (patch.avatarUrl !== undefined) {
      accountPatch.avatar_url = String(patch.avatarUrl ?? '').trim() || null;
    }
    if (Object.keys(accountPatch).length) {
      await user.update(accountPatch);
    }
    return;
  }

  const empUpdate: Record<string, unknown> = { updated_at: new Date() };
  for (const [from, to] of Object.entries(SELF_PROFILE_TO_EMPLOYEE)) {
    if (patch[from] !== undefined) {
      empUpdate[to] = from === 'phone' ? normalizePhone(patch[from]) : patch[from];
    }
  }

  if (Object.keys(empUpdate).length > 1) {
    await employee.update(empUpdate);
    if (patch.phone !== undefined) {
      const empId = String(employee.get('id') ?? '').trim();
      if (empId) {
        const { syncPortalPhoneFromEmployee } = await import('./portalUserPhone.js');
        await syncPortalPhoneFromEmployee(empId, patch.phone);
      }
    }
  }

  const salaryPatch: Record<string, unknown> = {};
  if (patch.taxId !== undefined) salaryPatch.tax_id = patch.taxId;
  if (patch.bankName !== undefined) salaryPatch.bank_name = patch.bankName;
  if (patch.bankAccountNumber !== undefined) {
    salaryPatch.bank_account_number = patch.bankAccountNumber;
  }

  if (Object.keys(salaryPatch).length) {
    const { upsertSalaryStructure } = await import('./salaryStructureService.js');
    const empId = employee.get('id') as string;
    const existing = await loadSalaryStructureForEmployeeId(empId);
    await upsertSalaryStructure(empId, {
      ...existing,
      ...salaryPatch,
    }, {
      effectiveFrom: new Date().toISOString().slice(0, 10),
      changeReason: 'User account profile sync',
    });
  }
}

async function loadUsersColumnNames(): Promise<Set<string>> {
  const [cols] = (await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  )) as [{ COLUMN_NAME: string }[], unknown];
  return new Set((cols ?? []).map((c) => c.COLUMN_NAME));
}

export async function ensureUserAccountSchema(): Promise<void> {
  const [tableRows] = (await sequelize.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  )) as [{ TABLE_NAME: string }[], unknown];

  if (!tableRows?.length) {
    await User.sync();
    console.log('[db] Created missing users table.');
  }

  let names = await loadUsersColumnNames();
  if (!names.size) {
    await User.sync({ force: false });
    names = await loadUsersColumnNames();
  }

  if (!names.has('display_name')) {
    try {
      await sequelize.query(
        `ALTER TABLE users ADD COLUMN display_name VARCHAR(120) NULL`
      );
      console.log('[db] users.display_name column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (!names.has('login_id')) {
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN login_id VARCHAR(32) NULL`);
      console.log('[db] users.login_id column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (!names.has('avatar_url')) {
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512) NULL`);
      console.log('[db] users.avatar_url column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (names.has('login_id')) {
    const [loginIdxRows] = (await sequelize.query(`SHOW INDEX FROM users`)) as [
      Array<{ Key_name: string; Column_name: string }>,
      unknown,
    ];
    const hasLoginUnique = (loginIdxRows ?? []).some(
      (r) => r.Column_name === 'login_id' && String(r.Key_name).toLowerCase().includes('login')
    );
    if (!hasLoginUnique) {
      try {
        await sequelize.query(
          `ALTER TABLE users ADD UNIQUE INDEX users_login_id_unique (login_id)`
        );
      } catch {
        /* ignore duplicate / null multi-row edge cases until backfill */
      }
    }
  }

  if (!names.has('employeeId')) {
    try {
      await sequelize.query(
        `ALTER TABLE users ADD COLUMN employeeId VARCHAR(255) NULL`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
    if (names.has('employeeId')) {
      const [idxRows] = (await sequelize.query(`SHOW INDEX FROM users`)) as [
        Array<{ Key_name: string; Column_name: string }>,
        unknown,
      ];
      const hasEmpIdx = (idxRows ?? []).some(
        (r) => r.Column_name === 'employeeId' && r.Key_name !== 'PRIMARY'
      );
      if (!hasEmpIdx) {
        await sequelize.query(`ALTER TABLE users ADD INDEX users_employee_id (employeeId)`);
      }
      console.log('[db] users.employeeId column added.');
    }
  }

  if (!names.has('phone')) {
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL`);
      console.log('[db] users.phone column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (!names.has('mustChangePassword')) {
    try {
      await sequelize.query(
        `ALTER TABLE users ADD COLUMN mustChangePassword TINYINT(1) NOT NULL DEFAULT 0`
      );
      console.log('[db] users.mustChangePassword column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (!names.has('passwordLength')) {
    try {
      await sequelize.query(`ALTER TABLE users ADD COLUMN passwordLength INT NULL`);
      console.log('[db] users.passwordLength column added.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Duplicate column')) throw err;
    }
    names = await loadUsersColumnNames();
  }

  if (names.has('phone')) {
    const [phoneIdxRows] = (await sequelize.query(`SHOW INDEX FROM users`)) as [
      Array<{ Key_name: string; Column_name: string }>,
      unknown,
    ];
    const hasPhoneIdx = (phoneIdxRows ?? []).some(
      (r) => r.Column_name === 'phone' && r.Key_name !== 'PRIMARY'
    );
    if (!hasPhoneIdx) {
      try {
        await sequelize.query(`ALTER TABLE users ADD INDEX users_phone (phone)`);
      } catch {
        /* ignore */
      }
    }
  }

  if (names.has('email') && names.has('employeeId')) {
    await sequelize.query(
      `UPDATE users u
       INNER JOIN employees e ON LOWER(TRIM(u.email)) = LOWER(TRIM(e.email))
       SET u.employeeId = e.id
       WHERE u.employeeId IS NULL OR u.employeeId = ''`
    );
  }

  if (names.has('phone') && names.has('employeeId')) {
    try {
      const { backfillPortalPhonesFromEmployees } = await import('./portalUserPhone.js');
      const n = await backfillPortalPhonesFromEmployees();
      if (n > 0) {
        console.log(`[db] Synced users.phone from employees for ${n} portal account(s).`);
      }
    } catch (backfillErr) {
      console.warn(
        '[db] users.phone backfill skipped:',
        (backfillErr as Error)?.message || backfillErr
      );
    }
  }

  const [indexes] = (await sequelize.query(`SHOW INDEX FROM users`)) as [
    Array<{ Key_name: string; Column_name: string; Non_unique: number }>,
    unknown,
  ];
  for (const idx of indexes ?? []) {
    if (idx.Column_name === 'phone' && idx.Non_unique === 0 && idx.Key_name !== 'PRIMARY') {
      try {
        await sequelize.query(`ALTER TABLE users DROP INDEX \`${idx.Key_name}\``);
        console.log(`[db] users: dropped phone unique index ${idx.Key_name}.`);
      } catch {
        /* ignore */
      }
    }
  }

  names = await loadUsersColumnNames();
  for (const col of USER_LEGACY_COLUMNS) {
    if (!names.has(col)) continue;
    try {
      await sequelize.query(`ALTER TABLE users DROP COLUMN \`${col}\``);
      console.log(`[db] users: dropped legacy column ${col}.`);
      names.delete(col);
    } catch (err) {
      console.warn(
        `[db] users: could not drop column ${col}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log('[db] users table is account-focused.');
}
