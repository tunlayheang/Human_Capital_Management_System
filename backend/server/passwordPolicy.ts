/** Portal password rules — enforced for all roles on set/reset/change. */

export const PORTAL_PASSWORD_MIN_LENGTH = 12;
export const PORTAL_PASSWORD_MAX_LENGTH = 128;

const LOWER = /[a-z]/;
const UPPER = /[A-Z]/;
const DIGIT = /[0-9]/;
const SPECIAL = /[!@#$%&*?+\-=]/;

export type PortalPasswordValidation = {
  valid: boolean;
  message: string;
  errors: string[];
};

export type PortalPasswordPolicy = {
  minLength: number;
  maxLength: number;
  requireLower: boolean;
  requireUpper: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
};

const DEFAULT_PASSWORD_POLICY: PortalPasswordPolicy = {
  minLength: PORTAL_PASSWORD_MIN_LENGTH,
  maxLength: PORTAL_PASSWORD_MAX_LENGTH,
  requireLower: true,
  requireUpper: true,
  requireDigit: true,
  requireSpecial: true,
};

export function validatePortalPassword(
  raw: unknown,
  policyOverrides?: Partial<PortalPasswordPolicy>
): PortalPasswordValidation {
  const password = String(raw ?? '');
  const errors: string[] = [];
  const policy: PortalPasswordPolicy = {
    ...DEFAULT_PASSWORD_POLICY,
    ...(policyOverrides || {}),
  };
  const minLength = Math.max(8, Number(policy.minLength) || PORTAL_PASSWORD_MIN_LENGTH);
  const maxLength = Math.max(minLength, Number(policy.maxLength) || PORTAL_PASSWORD_MAX_LENGTH);

  if (!password) {
    return { valid: false, message: 'Password is required.', errors: ['required'] };
  }
  if (password.length < minLength) {
    errors.push(`at least ${minLength} characters`);
  }
  if (password.length > maxLength) {
    errors.push(`no more than ${maxLength} characters`);
  }
  if (policy.requireLower && !LOWER.test(password)) errors.push('one lowercase letter');
  if (policy.requireUpper && !UPPER.test(password)) errors.push('one uppercase letter');
  if (policy.requireDigit && !DIGIT.test(password)) errors.push('one number');
  if (policy.requireSpecial && !SPECIAL.test(password)) {
    errors.push('one special character (!@#$%&*?+-=)');
  }

  if (errors.length === 0) {
    return { valid: true, message: '', errors: [] };
  }

  const message =
    errors.length === 1 && errors[0].startsWith('at least')
      ? `Password must be ${errors[0]}.`
      : `Password must include ${errors.join(', ')}.`;

  return { valid: false, message, errors };
}

/** Validate only when a non-empty password is provided (optional fields). */
export function validatePortalPasswordIfProvided(
  raw: unknown,
  policyOverrides?: Partial<PortalPasswordPolicy>
): PortalPasswordValidation {
  const password = String(raw ?? '').trim();
  if (!password) return { valid: true, message: '', errors: [] };
  return validatePortalPassword(password, policyOverrides);
}
