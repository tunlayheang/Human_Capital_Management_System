export const PIN_MAX_ATTEMPTS = 3;

export type PinVerifyMeta = {
  mustResetPin?: boolean;
  needsPinSetup?: boolean;
  requiresOtpRecovery?: boolean;
  pinRequiresOtpRecovery?: boolean;
  requiresAdminPinReset?: boolean;
  pinRequiresAdminReset?: boolean;
  pinRecoveryReady?: boolean;
  forceLogout?: boolean;
  maskedEmail?: string;
  devOtp?: string;
  remainingAttempts?: number;
  failedAttempts?: number;
};

export type PinSecurityState = {
  pinLockEnabled?: boolean;
  pinRequired?: boolean;
  pinMandatory?: boolean;
  pinSet?: boolean;
  pinAutoLockMinutes?: number;
  pinFailedAttempts?: number;
  pinMustReset?: boolean;
  pinMaxAttempts?: number;
  pinRequiresOtpRecovery?: boolean;
  pinRequiresAdminReset?: boolean;
  pinRecoveryReady?: boolean;
  needsPinSetup?: boolean;
  maskedEmail?: string;
};

export const PIN_LOCKOUT_MESSAGE_KEY = 'hcms:pin-lockout-message';

export function stashPinLockoutMessage(message: string) {
  try {
    sessionStorage.setItem(PIN_LOCKOUT_MESSAGE_KEY, message);
  } catch {
    /* ignore */
  }
}

export function takePinLockoutMessage(): string | null {
  try {
    const msg = sessionStorage.getItem(PIN_LOCKOUT_MESSAGE_KEY);
    if (msg) sessionStorage.removeItem(PIN_LOCKOUT_MESSAGE_KEY);
    return msg;
  } catch {
    return null;
  }
}

export function parsePinApiError(e: unknown): {
  message: string;
  meta: PinVerifyMeta;
  code?: string;
} {
  if (e && typeof e === 'object') {
    const err = e as Error & { data?: PinVerifyMeta & { message?: string; code?: string } };
    const data = err.data ?? {};
    return {
      message: err.message || data.message || 'Request failed',
      code: typeof data.code === 'string' ? data.code : undefined,
      meta: {
        mustResetPin: Boolean(data.mustResetPin),
        needsPinSetup: Boolean(data.needsPinSetup),
        requiresOtpRecovery: Boolean(data.requiresOtpRecovery ?? data.pinRequiresOtpRecovery),
        pinRequiresOtpRecovery: Boolean(data.pinRequiresOtpRecovery ?? data.requiresOtpRecovery),
        requiresAdminPinReset: Boolean(
          data.requiresAdminPinReset ?? data.pinRequiresAdminReset
        ),
        pinRequiresAdminReset: Boolean(
          data.pinRequiresAdminReset ?? data.requiresAdminPinReset
        ),
        pinRecoveryReady: Boolean(data.pinRecoveryReady),
        forceLogout: Boolean(data.forceLogout),
        maskedEmail: typeof data.maskedEmail === 'string' ? data.maskedEmail : undefined,
        devOtp: typeof data.devOtp === 'string' ? data.devOtp : undefined,
        remainingAttempts:
          typeof data.remainingAttempts === 'number' ? data.remainingAttempts : undefined,
        failedAttempts:
          typeof data.failedAttempts === 'number' ? data.failedAttempts : undefined,
      },
    };
  }
  return { message: e instanceof Error ? e.message : 'Request failed', meta: {}, code: undefined };
}
