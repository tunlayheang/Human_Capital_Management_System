/**
 * Password login lockout — enforces Settings → Security max attempts + locked period.
 */
import { User, sequelize } from './db.js';
import {
  getLockedPeriodMinutes,
  getMaxLoginAttempts,
} from './securitySessionPolicy.js';

let columnsReady = false;

async function columnExists(column: string): Promise<boolean> {
  const [rows] = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [column] }
  )) as [unknown[], unknown];
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureLoginLockoutColumns(): Promise<void> {
  if (columnsReady) return;
  if (!(await columnExists('failedLoginAttempts'))) {
    await sequelize.query(
      `ALTER TABLE \`users\` ADD COLUMN \`failedLoginAttempts\` INT NOT NULL DEFAULT 0`
    );
  }
  if (!(await columnExists('loginLockedUntil'))) {
    await sequelize.query(`ALTER TABLE \`users\` ADD COLUMN \`loginLockedUntil\` DATETIME NULL`);
  }
  columnsReady = true;
}

export type LoginLockState = {
  locked: boolean;
  lockedUntil: Date | null;
  remainingMs: number;
  failedAttempts: number;
};

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getLoginLockState(user: {
  failedLoginAttempts?: number | null;
  loginLockedUntil?: Date | string | null;
  get?: (opts?: { plain?: boolean }) => Record<string, unknown>;
}): Promise<LoginLockState> {
  await ensureLoginLockoutColumns();
  const plain = user.get ? user.get({ plain: true }) : (user as Record<string, unknown>);
  const failedAttempts = Math.max(0, Number(plain.failedLoginAttempts ?? 0) || 0);
  const lockedUntil = asDate(plain.loginLockedUntil);
  const now = Date.now();
  if (lockedUntil && lockedUntil.getTime() > now) {
    return {
      locked: true,
      lockedUntil,
      remainingMs: lockedUntil.getTime() - now,
      failedAttempts,
    };
  }
  return {
    locked: false,
    lockedUntil: lockedUntil && lockedUntil.getTime() <= now ? null : lockedUntil,
    remainingMs: 0,
    failedAttempts,
  };
}

export function formatLockoutMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Account temporarily locked after too many failed login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/** Record a failed password attempt; may lock the account. */
export async function recordFailedPasswordLogin(user: any): Promise<LoginLockState> {
  await ensureLoginLockoutColumns();
  const maxAttempts = await getMaxLoginAttempts();
  const lockMinutes = await getLockedPeriodMinutes();
  const plain = user.get ? user.get({ plain: true }) : user;
  let attempts = Math.max(0, Number(plain.failedLoginAttempts ?? 0) || 0) + 1;
  const now = new Date();
  let lockedUntil: Date | null = asDate(plain.loginLockedUntil);
  if (lockedUntil && lockedUntil.getTime() <= now.getTime()) {
    lockedUntil = null;
    attempts = 1;
  }

  if (attempts >= maxAttempts) {
    lockedUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);
  }

  user.failedLoginAttempts = attempts;
  user.loginLockedUntil = lockedUntil;
  await user.save();

  return getLoginLockState(user);
}

/** Clear attempt counter after a successful password (or OTP) login. */
export async function clearLoginLockout(user: any): Promise<void> {
  await ensureLoginLockoutColumns();
  const plain = user.get ? user.get({ plain: true }) : user;
  const attempts = Number(plain.failedLoginAttempts ?? 0) || 0;
  const lockedUntil = asDate(plain.loginLockedUntil);
  if (attempts === 0 && !lockedUntil) return;
  user.failedLoginAttempts = 0;
  user.loginLockedUntil = null;
  await user.save();
}

/** Admin / maintenance helper — unlock without a successful login. */
export async function unlockUserLogin(userId: string): Promise<boolean> {
  await ensureLoginLockoutColumns();
  const [n] = await User.update(
    { failedLoginAttempts: 0, loginLockedUntil: null },
    { where: { id: userId } }
  );
  return Number(n) > 0;
}

/** Soft dependency so scripts can probe without importing User model cycles. */
export async function loginLockoutColumnsExist(): Promise<boolean> {
  try {
    const [rows] = (await sequelize.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('failedLoginAttempts', 'loginLockedUntil')`
    )) as [{ COLUMN_NAME: string }[], unknown];
    const names = new Set((rows || []).map((r) => r.COLUMN_NAME));
    return names.has('failedLoginAttempts') && names.has('loginLockedUntil');
  } catch {
    return false;
  }
}
