import { sequelize, User } from './db.js';

/** Password reset: verify email OTP before allowing a new password. */
export const RESET_PASSWORD_VERIFIED_TTL_MS = 20 * 60 * 1000;

let resetPasswordVerifiedColumnReady: boolean | null = null;

async function hasResetPasswordVerifiedColumn(): Promise<boolean> {
  if (resetPasswordVerifiedColumnReady != null) return resetPasswordVerifiedColumnReady;
  try {
    const [rows]: unknown = await sequelize.query(
      `SELECT 1 AS ok FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'resetPasswordVerifiedAt' LIMIT 1`
    );
    resetPasswordVerifiedColumnReady = Array.isArray(rows) && rows.length > 0;
  } catch {
    resetPasswordVerifiedColumnReady = false;
  }
  return resetPasswordVerifiedColumnReady;
}

export async function ensureResetPasswordVerifiedColumn(): Promise<void> {
  const { ensureColumn } = await import('./v40Schema.js');
  await ensureColumn('users', 'resetPasswordVerifiedAt', 'DATETIME NULL');
  resetPasswordVerifiedColumnReady = true;
}

/** Call before password-reset routes that read/write resetPasswordVerifiedAt. */
export async function preparePasswordResetStorage(): Promise<void> {
  await ensureResetPasswordVerifiedColumn();
}

export async function isResetPasswordVerified(user: any): Promise<boolean> {
  if (!(await hasResetPasswordVerifiedColumn())) return false;
  if (!user?.id) return false;

  let verifiedAt = user.resetPasswordVerifiedAt ?? user.get?.('resetPasswordVerifiedAt');
  if (!verifiedAt) {
    const row: any = await User.findByPk(user.id, { attributes: ['resetPasswordVerifiedAt'] });
    verifiedAt = row?.resetPasswordVerifiedAt ?? row?.get?.('resetPasswordVerifiedAt');
  }
  if (!verifiedAt) return false;

  const at = new Date(verifiedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < RESET_PASSWORD_VERIFIED_TTL_MS;
}

export function markResetPasswordVerified(user: any) {
  user.resetPasswordVerifiedAt = new Date();
}

export function clearResetPasswordVerification(user: any) {
  user.resetPasswordVerifiedAt = null;
}
