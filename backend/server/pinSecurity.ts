/** All portal access roles must use security PIN lock. */
import {
  canBypassAdminPinEmailRecovery,
  isPinRecoveryVerified,
  maskEmail,
} from './pinRecoveryService.js';
import { resolveOtpEmailForUser } from './otpEmailResolve.js';

export const PIN_PORTAL_ROLES = [
  'ADMIN',
  'SUPER_ADMIN',
  'HR',
  'MANAGER',
  'EMPLOYEE',
  'APPLICANT',
] as const;

export const PIN_MAX_FAILED_ATTEMPTS = 3;

export type PinPortalRole = (typeof PIN_PORTAL_ROLES)[number];

/** @deprecated Use PIN_PORTAL_ROLES */
export const PIN_REQUIRED_ROLES = PIN_PORTAL_ROLES;

export const isPinRequiredRole = (role: string | null | undefined): role is PinPortalRole => {
  if (!role) return false;
  const r = String(role).trim().toUpperCase();
  return (PIN_PORTAL_ROLES as readonly string[]).includes(r);
};

export const defaultPinLockEnabledForRole = (role: string) => isPinRequiredRole(role);

/** Ensures PIN-required roles always have PIN lock enabled in the database. */
export const enforcePinPolicyForUser = async (user: {
  role?: string;
  pinLockEnabled?: boolean;
  save?: () => Promise<unknown>;
}) => {
  if (!user?.save || !isPinRequiredRole(user.role)) return;
  if (user.pinLockEnabled === false || user.pinLockEnabled == null) {
    user.pinLockEnabled = true;
    await user.save();
  }
};

export const resolvePinSecurity = (user: any) => {
  const pinAutoLockMinutes = user?.pinAutoLockMinutes ?? 15;
  const pinFailedAttempts = Math.max(0, Number(user?.pinFailedAttempts) || 0);
  const pinSet = !!user?.securityPinHash;
  const pinLockedRequiresOtp = Boolean(user?.pinLockedRequiresOtp);
  const pinLockedRequiresAdminReset = Boolean(user?.pinLockedRequiresAdminReset);
  const pinRecoveryReady = isPinRecoveryVerified(user);

  if (!user || !isPinRequiredRole(user.role)) {
    return {
      pinLockEnabled: false,
      pinRequired: false,
      pinMandatory: false,
      pinSet: false,
      pinAutoLockMinutes,
      pinFailedAttempts: 0,
      pinMustReset: false,
      pinRequiresOtpRecovery: false,
      pinRequiresAdminReset: false,
      pinRecoveryReady: false,
      needsPinSetup: false,
      pinMaxAttempts: PIN_MAX_FAILED_ATTEMPTS,
    };
  }

  const pinLockEnabled = true;
  const emailRecoveryBypass = canBypassAdminPinEmailRecovery(user);
  const recoveryReady = pinRecoveryReady || emailRecoveryBypass;
  const pinRequiresOtpRecovery = pinLockedRequiresOtp && !recoveryReady;
  const pinRequiresAdminReset = pinLockedRequiresAdminReset;
  // Cannot create a PIN while waiting for Admin reset; OTP path allows setup after verify.
  const needsPinSetup =
    !pinSet && !pinRequiresOtpRecovery && !pinRequiresAdminReset;

  return {
    pinLockEnabled,
    pinRequired: true,
    pinMandatory: true,
    pinSet,
    pinAutoLockMinutes,
    pinFailedAttempts,
    pinMustReset: !pinSet && recoveryReady,
    pinRequiresOtpRecovery,
    pinRequiresAdminReset,
    pinRecoveryReady: recoveryReady,
    needsPinSetup,
    pinMaxAttempts: PIN_MAX_FAILED_ATTEMPTS,
  };
};

/** Best-effort masked email for OTP UI (does not send mail). */
export async function resolveMaskedRecoveryEmail(user: any): Promise<string | undefined> {
  try {
    const email = await resolveOtpEmailForUser(user, user?.phone);
    return email ? maskEmail(email) : undefined;
  } catch {
    return undefined;
  }
}
