import { DataTypes, Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import { User, sequelize } from './db.js';
import { USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import { normalizeAccessRole, type SystemAccessRole } from './accessRole.js';
import { validatePortalPasswordWithPolicy } from './securityPasswordPolicy.js';
import { normalizePhone } from './phoneUtils.js';

export const ADMIN_LOGIN_ID_PREFIX = 'ADM';
export const ADMIN_LOGIN_ID_PAD = 5;

function normalizeAdminLoginId(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  const m = code.match(/^ADM(\d+)$/);
  if (m) return formatAdminLoginId(parseInt(m[1], 10) || 0);
  return code;
}

let displayNameColumnReady = false;
let loginIdColumnReady = false;

export async function ensureUserDisplayNameColumn(): Promise<void> {
  if (displayNameColumnReady) return;
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('users');
    if (!desc.display_name) {
      await qi.addColumn('users', 'display_name', {
        type: DataTypes.STRING(120),
        allowNull: true,
      });
      console.log('[db] users.display_name column added.');
    }
    displayNameColumnReady = true;
  } catch (err) {
    console.warn('[db] ensureUserDisplayNameColumn:', (err as Error).message);
  }
}

export async function ensureUserLoginIdColumn(): Promise<void> {
  if (loginIdColumnReady) return;
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('users');
    if (!desc.login_id) {
      await qi.addColumn('users', 'login_id', {
        type: DataTypes.STRING(32),
        allowNull: true,
        unique: true,
      });
      console.log('[db] users.login_id column added.');
    }
    loginIdColumnReady = true;
  } catch (err) {
    console.warn('[db] ensureUserLoginIdColumn:', (err as Error).message);
  }
}

export function formatAdminLoginId(serial: number): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  return `${ADMIN_LOGIN_ID_PREFIX}${String(n).padStart(ADMIN_LOGIN_ID_PAD, '0')}`;
}

export function parseAdminLoginIdSuffix(loginId: string): number | null {
  const m = String(loginId || '')
    .trim()
    .toUpperCase()
    .match(/^ADM(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Canonical ADM00001 plus legacy padded forms (e.g. ADM000001) for login lookup. */
export function adminLoginIdLookupVariants(raw: unknown): string[] {
  const code = normalizeAdminLoginId(raw);
  if (!code) return [];
  const suffix = parseAdminLoginIdSuffix(code);
  if (suffix == null) return [code];
  const variants = new Set<string>([code, formatAdminLoginId(suffix)]);
  // Accept legacy 6-digit padding until all DBs are migrated.
  variants.add(`${ADMIN_LOGIN_ID_PREFIX}${String(suffix).padStart(6, '0')}`);
  return [...variants];
}

/** Next portal-only admin EmpID (ADM00001…). Never creates an employees row. */
export async function nextAdminLoginId(): Promise<string> {
  await ensureUserLoginIdColumn();
  const [rows] = (await sequelize.query(
    `SELECT login_id AS loginId FROM users
     WHERE login_id IS NOT NULL AND login_id REGEXP '^[Aa][Dd][Mm][0-9]+$'`,
    { raw: true }
  )) as [{ loginId?: string }[], unknown];

  let max = 0;
  for (const row of rows ?? []) {
    const n = parseAdminLoginIdSuffix(String(row.loginId ?? ''));
    if (n != null) max = Math.max(max, n);
  }

  let candidate = formatAdminLoginId(max + 1);
  // Avoid rare collisions with an employee badge if someone reused ADM* there.
  for (let i = 0; i < 20; i += 1) {
    const code = normalizeAdminLoginId(candidate);
    const clashUser = await User.findOne({
      where: { login_id: code },
      attributes: ['id'],
    });
    const [empRows] = (await sequelize.query(
      `SELECT id FROM employees WHERE UPPER(TRIM(employee_id)) = :code LIMIT 1`,
      { replacements: { code } }
    )) as [{ id: string }[], unknown];
    if (!clashUser && !(empRows?.length)) return code;
    candidate = formatAdminLoginId(max + 2 + i);
  }
  throw new Error('Could not allocate a unique admin login ID.');
}

export function isSystemAdminAccount(user: {
  role?: unknown;
  employeeId?: unknown;
}): boolean {
  const role = normalizeAccessRole(user.role) as SystemAccessRole;
  const employeeId = String(user.employeeId ?? '').trim();
  return role === 'ADMIN' && !employeeId;
}

let adminExclusionCache: {
  at: number;
  value: { employeeIds: string[]; emails: string[] };
} | null = null;
const ADMIN_EXCLUSION_CACHE_MS = 60_000;

export function clearSystemAdminExclusionCache(): void {
  adminExclusionCache = null;
}

export async function listSystemAdminEmployeeExclusions(): Promise<{
  employeeIds: string[];
  emails: string[];
}> {
  const now = Date.now();
  if (adminExclusionCache && now - adminExclusionCache.at < ADMIN_EXCLUSION_CACHE_MS) {
    return adminExclusionCache.value;
  }

  const rows = (await User.findAll({
    where: { role: { [Op.in]: ['ADMIN', 'SUPER_ADMIN'] } },
    attributes: ['employeeId', 'email'],
    raw: true,
  })) as { employeeId?: string; email?: string }[];

  const employeeIds = new Set<string>();
  const emails = new Set<string>();
  for (const row of rows) {
    if (!isSystemAdminAccount(row)) continue;
    const em = String(row.email ?? '').trim().toLowerCase();
    if (em) emails.add(em);
  }
  const value = { employeeIds: [...employeeIds], emails: [...emails] };
  adminExclusionCache = { at: now, value };
  return value;
}

/**
 * Backfill ADM##### login IDs for portal-only system admins (no employeeId).
 * Also normalizes legacy ADM000001 (6-digit) codes to ADM00001 (5-digit).
 * Does NOT unlink employee-linked ADMIN accounts — those keep EmpID login unchanged.
 */
export async function migrateLegacySystemAdminAccounts(): Promise<number> {
  await ensureUserDisplayNameColumn();
  await ensureUserLoginIdColumn();
  const rows = await User.findAll({
    where: { role: { [Op.in]: ['ADMIN', 'SUPER_ADMIN'] } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
    order: [['createdAt', 'ASC']],
  });

  let fixed = 0;
  for (const row of rows) {
    const plain = row.get({ plain: true }) as {
      id: string;
      email?: string;
      employeeId?: string | null;
      display_name?: string | null;
      login_id?: string | null;
      role?: string;
    };
    const employeeId = String(plain.employeeId ?? '').trim();
    // Employee-linked ADMIN/SUPER_ADMIN keep EmpID login — leave them alone.
    if (employeeId) continue;

    const role = String(plain.role || '').toUpperCase();
    const portalOnly = role === 'ADMIN' || role === 'SUPER_ADMIN';
    if (!portalOnly) continue;

    const patch: Record<string, unknown> = {};
    let displayName = String(plain.display_name ?? '').trim();
    if (!displayName) {
      const fromEmail = String(plain.email ?? '')
        .split('@')[0]
        ?.replace(/[._-]/g, ' ')
        .trim();
      if (fromEmail) {
        patch.display_name = fromEmail;
        displayName = fromEmail;
      }
    }
    const loginId = normalizeAdminLoginId(plain.login_id);
    if (!loginId) {
      patch.login_id = await nextAdminLoginId();
    } else {
      const suffix = parseAdminLoginIdSuffix(loginId);
      if (suffix != null) {
        const canonical = formatAdminLoginId(suffix);
        if (canonical !== loginId) {
          const clash = await User.findOne({
            where: { login_id: canonical, id: { [Op.ne]: plain.id } },
            attributes: ['id'],
          });
          if (!clash) patch.login_id = canonical;
        }
      }
    }
    if (Object.keys(patch).length) {
      await row.update(patch as any);
      fixed += 1;
    }
  }

  if (fixed > 0) {
    console.log(
      `[db] Backfilled ${fixed} portal-only system administrator login id(s).`
    );
    clearSystemAdminExclusionCache();
  }
  return fixed;
}

/** Portal-only ADMIN/SUPER_ADMIN accounts (no employee link), newest first. */
export async function listSystemAdminAccounts(): Promise<any[]> {
  await ensureUserLoginIdColumn();
  await ensureUserDisplayNameColumn();
  const [idRows] = (await sequelize.query(
    `SELECT id FROM users
     WHERE UPPER(role) IN ('ADMIN', 'SUPER_ADMIN')
       AND (employeeId IS NULL OR TRIM(employeeId) = '')
     ORDER BY createdAt DESC`
  )) as [{ id: string }[], unknown];
  const ids = (idRows ?? []).map((r) => String(r.id)).filter(Boolean);
  if (!ids.length) return [];
  const rows = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  const byId = new Map(rows.map((row) => [String(row.get('id')), row.get({ plain: true })]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export type CreateSystemAdminInput = {
  email: string;
  phone: string;
  password: string;
  displayName?: string;
  isActive?: boolean;
  id?: string;
  loginId?: string;
  nextUserId: () => Promise<string>;
};

export async function createSystemAdminAccount(input: CreateSystemAdminInput): Promise<any> {
  await ensureUserDisplayNameColumn();
  await ensureUserLoginIdColumn();

  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('A valid email is required for the system administrator account.');
  }
  const phone = normalizePhone(input.phone);
  if (!phone || phone.length < 8) {
    throw new Error('A valid phone number is required for the system administrator account.');
  }
  const password = String(input.password ?? '');
  const pwdCheck = await validatePortalPasswordWithPolicy(password);
  if (!pwdCheck.valid) {
    throw new Error(pwdCheck.message);
  }

  const existing = await User.findOne({
    where: { email },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  if (existing) {
    throw new Error('A user account with this email already exists.');
  }

  const existingPhone = await User.findOne({
    where: { phone },
    attributes: ['id'],
  });
  if (existingPhone) {
    throw new Error('A user account with this phone number already exists.');
  }

  const displayName =
    String(input.displayName ?? '').trim() ||
    email.split('@')[0]?.replace(/[._-]/g, ' ') ||
    'System Administrator';

  const requested = normalizeAdminLoginId(input.loginId);
  const requestedSuffix = requested ? parseAdminLoginIdSuffix(requested) : null;
  const loginId =
    requestedSuffix != null
      ? formatAdminLoginId(requestedSuffix)
      : requested || (await nextAdminLoginId());
  if (!/^ADM\d{5,}$/.test(loginId)) {
    throw new Error('Admin login ID must use format ADM00001.');
  }
  const loginClash = await User.findOne({
    where: { login_id: loginId },
    attributes: ['id'],
  });
  if (loginClash) {
    throw new Error(`Admin login ID ${loginId} is already in use.`);
  }
  const [empClash] = (await sequelize.query(
    `SELECT id FROM employees WHERE UPPER(TRIM(employee_id)) = :code LIMIT 1`,
    { replacements: { code: loginId } }
  )) as [{ id: string }[], unknown];
  if (empClash?.length) {
    throw new Error(`Login ID ${loginId} conflicts with an employee badge.`);
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await User.create({
    id: input.id || (await input.nextUserId()),
    email,
    phone,
    employeeId: null,
    login_id: loginId,
    password: hashedPassword,
    passwordLength: password.length,
    role: 'ADMIN',
    display_name: displayName,
    isActive: input.isActive !== false,
    status: 'ACTIVE',
    passwordChangedAt: new Date(),
    // Temporary password at creation — admin must choose their own on first sign-in.
    mustChangePassword: true,
  } as any);

  clearSystemAdminExclusionCache();
  return user;
}
