import crypto from 'crypto';
import { resolveOtpEmailForUser } from './otpEmailResolve.js';
import { otpExpiryMs } from './otpExpiryConfig.js';
import {
  generateLocalOtp,
  isEmailConfigured,
  logLocalOtp,
  sendOtpViaEmail,
  type OtpPurpose,
} from './services/OtpDeliveryService.js';

const PIN_RECOVERY_OTP_PURPOSE = 'pin-recovery' as OtpPurpose;

const PIN_RECOVERY_OTP_TTL_MS = otpExpiryMs('pinRecovery');
export const PIN_RECOVERY_VERIFIED_TTL_MS = 20 * 60 * 1000;

const otpSecret = () => process.env.JWT_SECRET || 'local-dev-only-secret-change-me';

const hashOtp = (code: string) =>
  crypto.createHmac('sha256', otpSecret()).update(code).digest('hex');

/** Admins recover via email OTP; other roles must request an Admin PIN reset. */
export function isAdminPinSelfRecoveryRole(role: string | null | undefined): boolean {
  const r = String(role ?? '')
    .trim()
    .toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN';
}

/**
 * When Gmail/SMTP is not configured (common on misconfigured deploys), an already
 * authenticated Admin may create a new PIN without email OTP — login already
 * proved account ownership.
 */
export function canBypassAdminPinEmailRecovery(user: {
  role?: string | null;
  pinLockedRequiresOtp?: boolean;
} | null | undefined): boolean {
  if (!user?.pinLockedRequiresOtp) return false;
  if (!isAdminPinSelfRecoveryRole(user.role)) return false;
  return !isEmailConfigured();
}

/** Mark admin PIN recovery complete without sending email (email unavailable). */
export async function markAdminPinRecoveryReadyWithoutEmail(user: any): Promise<void> {
  user.pinRecoveryOtpHash = null;
  user.pinRecoveryOtpExpiry = null;
  user.pinRecoveryVerifiedAt = new Date();
  await user.save();
}

export function maskEmail(email: string): string {
  const trimmed = String(email || '').trim();
  const at = trimmed.indexOf('@');
  if (at < 1) return '***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const head = local.length <= 2 ? `${local[0] ?? ''}*` : `${local.slice(0, 2)}***`;
  return `${head}@${domain}`;
}

export function isPinRecoveryVerified(user: any): boolean {
  if (!user?.pinRecoveryVerifiedAt) return false;
  const at = new Date(user.pinRecoveryVerifiedAt).getTime();
  return Date.now() - at < PIN_RECOVERY_VERIFIED_TTL_MS;
}

export async function sendPinRecoveryOtp(user: any): Promise<{
  email: string;
  maskedEmail: string;
  devOtp?: string;
}> {
  if (!isAdminPinSelfRecoveryRole(user?.role)) {
    throw Object.assign(
      new Error('PIN recovery by email is only available for Admin accounts. Contact an administrator to reset your PIN.'),
      { code: 'ADMIN_RESET_REQUIRED' }
    );
  }

  const email = await resolveOtpEmailForUser(user, user?.phone);
  if (!email) {
    throw new Error('No email on file for this account. Contact your administrator.');
  }

  const otp = generateLocalOtp();
  let devOtp: string | undefined;

  try {
    await sendOtpViaEmail(email, PIN_RECOVERY_OTP_PURPOSE, otp);
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn('[pin-recovery] Email send failed; using dev OTP log.', error);
    logLocalOtp(PIN_RECOVERY_OTP_PURPOSE, String(user?.phone || user?.id || ''), otp);
    devOtp = otp;
  }

  user.pinRecoveryOtpHash = hashOtp(otp);
  user.pinRecoveryOtpExpiry = new Date(Date.now() + PIN_RECOVERY_OTP_TTL_MS);
  await user.save();

  return { email, maskedEmail: maskEmail(email), devOtp };
}

export async function verifyPinRecoveryOtp(user: any, otp: string): Promise<boolean> {
  if (!isAdminPinSelfRecoveryRole(user?.role)) return false;

  const code = String(otp || '').trim();
  if (!/^\d{4,8}$/.test(code)) return false;

  if (!user.pinRecoveryOtpHash) return false;
  if (user.pinRecoveryOtpExpiry && new Date(user.pinRecoveryOtpExpiry) < new Date()) {
    user.pinRecoveryOtpHash = null;
    user.pinRecoveryOtpExpiry = null;
    await user.save();
    return false;
  }

  if (user.pinRecoveryOtpHash !== hashOtp(code)) return false;

  user.pinRecoveryOtpHash = null;
  user.pinRecoveryOtpExpiry = null;
  user.pinRecoveryVerifiedAt = new Date();
  await user.save();
  return true;
}

export type PinLockoutResult = {
  mode: 'otp' | 'admin_reset';
  maskedEmail?: string;
  devOtp?: string;
};

/**
 * After 3 failed PIN attempts:
 * - Admin / Super Admin → clear PIN, require email OTP for a new PIN
 * - Everyone else → clear PIN, require Admin to reset (no self OTP)
 * Caller should force logout the session.
 */
export async function triggerPinLockout(user: any): Promise<PinLockoutResult> {
  user.securityPinHash = null;
  user.pinFailedAttempts = 0;
  user.pinRecoveryVerifiedAt = null;
  user.pinRecoveryOtpHash = null;
  user.pinRecoveryOtpExpiry = null;

  if (isAdminPinSelfRecoveryRole(user.role)) {
    user.pinLockedRequiresOtp = true;
    user.pinLockedRequiresAdminReset = false;
    await user.save();
    try {
      const sent = await sendPinRecoveryOtp(user);
      return { mode: 'otp', maskedEmail: sent.maskedEmail, devOtp: sent.devOtp };
    } catch (err) {
      // Still locked for OTP; admin can retry send after sign-in.
      console.warn('[pin-lockout] Admin OTP send failed after lockout:', err);
      return { mode: 'otp' };
    }
  }

  user.pinLockedRequiresOtp = false;
  user.pinLockedRequiresAdminReset = true;
  await user.save();

  try {
    const { notifyRoles, getUserDisplayName } = await import('./notificationService.js');
    const name = await getUserDisplayName(String(user.id));
    const empCode = String(user.employeeId || user.employee_id || '').trim();
    const who = empCode ? `${name} (${empCode})` : name;
    await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
      title: 'PIN reset requested',
      message: `${who} was locked out after 3 incorrect PIN attempts. Reset their security PIN in User Management.`,
      type: 'WARNING',
      link: '/users',
      idPrefix: `pin-admin-reset-${user.id}-${Date.now().toString(36)}`,
    });
  } catch (err) {
    console.warn('[pin-lockout] Failed to notify admins of PIN reset request:', err);
  }

  return { mode: 'admin_reset' };
}

export function clearPinRecoveryState(user: any) {
  user.pinLockedRequiresOtp = false;
  user.pinLockedRequiresAdminReset = false;
  user.pinRecoveryVerifiedAt = null;
  user.pinRecoveryOtpHash = null;
  user.pinRecoveryOtpExpiry = null;
}
