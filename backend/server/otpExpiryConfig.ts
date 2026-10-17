/** OTP validity windows in seconds — keep in sync with storeOtpOnUser / pinRecoveryService / UI countdown. */
export const OTP_EXPIRY_SECONDS = {
  login: 180,
  passwordReset: 180,
  pinRecovery: 180,
} as const;

export type OtpExpiryPurpose = keyof typeof OTP_EXPIRY_SECONDS;

export function otpExpiryMs(purpose: OtpExpiryPurpose): number {
  return OTP_EXPIRY_SECONDS[purpose] * 1000;
}

/** Fractional minutes for legacy `expiresInMinutes` API fields. Prefer `OTP_EXPIRY_SECONDS`. */
export const OTP_EXPIRY_MINUTES = {
  login: OTP_EXPIRY_SECONDS.login / 60,
  passwordReset: OTP_EXPIRY_SECONDS.passwordReset / 60,
  pinRecovery: OTP_EXPIRY_SECONDS.pinRecovery / 60,
} as const;

export function otpExpiryPurposeFromDelivery(purpose: string): OtpExpiryPurpose {
  if (purpose === 'password-reset' || purpose === 'passwordReset') return 'passwordReset';
  if (purpose === 'pin-recovery' || purpose === 'pinRecovery') return 'pinRecovery';
  return 'login';
}
