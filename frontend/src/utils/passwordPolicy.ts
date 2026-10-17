/** Keep in sync with backend/server/passwordPolicy.ts + securityPasswordPolicy.ts */

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

export type PasswordRequirementKey =
  | 'length'
  | 'lower'
  | 'upper'
  | 'digit'
  | 'special';

export const DEFAULT_PORTAL_PASSWORD_POLICY: PortalPasswordPolicy = {
  minLength: PORTAL_PASSWORD_MIN_LENGTH,
  maxLength: PORTAL_PASSWORD_MAX_LENGTH,
  requireLower: true,
  requireUpper: true,
  requireDigit: true,
  requireSpecial: true,
};

let cachedPolicy: PortalPasswordPolicy = { ...DEFAULT_PORTAL_PASSWORD_POLICY };
const policyListeners = new Set<() => void>();

export function getPortalPasswordPolicy(): PortalPasswordPolicy {
  return cachedPolicy;
}

export function setPortalPasswordPolicy(
  policy: Partial<PortalPasswordPolicy> | PortalPasswordPolicy
): PortalPasswordPolicy {
  cachedPolicy = normalizePortalPasswordPolicy(policy);
  policyListeners.forEach((listener) => listener());
  return cachedPolicy;
}

export function subscribePortalPasswordPolicy(listener: () => void): () => void {
  policyListeners.add(listener);
  return () => {
    policyListeners.delete(listener);
  };
}

function parseComplexityList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).toLowerCase().trim()).filter(Boolean);
  }
  const v = String(raw ?? '').trim();
  if (!v) return [];
  if (v.startsWith('[')) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).toLowerCase().trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return v
    .split(',')
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean);
}

/** Normalize API / settings values into a clamped portal password policy. */
export function normalizePortalPasswordPolicy(
  raw?: Partial<PortalPasswordPolicy> | PortalPasswordPolicy | null
): PortalPasswordPolicy {
  const minLengthRaw = Number(raw?.minLength);
  const minLength =
    Number.isFinite(minLengthRaw) && minLengthRaw > 0
      ? Math.min(128, Math.max(8, Math.floor(minLengthRaw)))
      : PORTAL_PASSWORD_MIN_LENGTH;
  const maxLengthRaw = Number(raw?.maxLength);
  const maxLength =
    Number.isFinite(maxLengthRaw) && maxLengthRaw > 0
      ? Math.max(minLength, Math.min(128, Math.floor(maxLengthRaw)))
      : PORTAL_PASSWORD_MAX_LENGTH;

  return {
    minLength,
    maxLength,
    requireLower: raw?.requireLower !== false,
    requireUpper: raw?.requireUpper !== false,
    requireDigit: raw?.requireDigit !== false,
    requireSpecial: raw?.requireSpecial !== false,
  };
}

/**
 * Build policy from Settings → Security flat keys
 * (`security.password_min_length`, `security.password_complexity`).
 */
export function portalPasswordPolicyFromSecuritySettings(
  settings: Record<string, unknown>
): PortalPasswordPolicy {
  const minLengthRaw = Number(settings['security.password_min_length']);
  const minLength =
    Number.isFinite(minLengthRaw) && minLengthRaw > 0
      ? Math.min(128, Math.max(8, Math.floor(minLengthRaw)))
      : PORTAL_PASSWORD_MIN_LENGTH;

  const complexityList = parseComplexityList(settings['security.password_complexity']);
  const hasExplicit = complexityList.length > 0;
  const hasToken = (token: string) =>
    complexityList.some((value) => value.includes(token.toLowerCase()));

  return normalizePortalPasswordPolicy({
    minLength,
    maxLength: PORTAL_PASSWORD_MAX_LENGTH,
    requireLower: hasExplicit ? hasToken('lower') : true,
    requireUpper: hasExplicit ? hasToken('upper') : true,
    requireDigit: hasExplicit ? hasToken('number') || hasToken('digit') : true,
    requireSpecial: hasExplicit ? hasToken('special') : true,
  });
}

function resolvePolicy(policyOverrides?: Partial<PortalPasswordPolicy>): PortalPasswordPolicy {
  return normalizePortalPasswordPolicy({
    ...cachedPolicy,
    ...(policyOverrides || {}),
  });
}

export function getPasswordRequirementChecks(
  password: string,
  policyOverrides?: Partial<PortalPasswordPolicy>
): Record<PasswordRequirementKey, boolean> {
  const p = password ?? '';
  const policy = resolvePolicy(policyOverrides);
  return {
    length: p.length >= policy.minLength && p.length <= policy.maxLength,
    lower: !policy.requireLower || LOWER.test(p),
    upper: !policy.requireUpper || UPPER.test(p),
    digit: !policy.requireDigit || DIGIT.test(p),
    special: !policy.requireSpecial || SPECIAL.test(p),
  };
}

export function getActivePasswordRequirementKeys(
  policyOverrides?: Partial<PortalPasswordPolicy>
): PasswordRequirementKey[] {
  const policy = resolvePolicy(policyOverrides);
  const keys: PasswordRequirementKey[] = ['length'];
  if (policy.requireLower) keys.push('lower');
  if (policy.requireUpper) keys.push('upper');
  if (policy.requireDigit) keys.push('digit');
  if (policy.requireSpecial) keys.push('special');
  return keys;
}

export function validatePortalPassword(
  raw: unknown,
  policyOverrides?: Partial<PortalPasswordPolicy>
): PortalPasswordValidation {
  const password = String(raw ?? '');
  const errors: string[] = [];
  const policy = resolvePolicy(policyOverrides);

  if (!password) {
    return { valid: false, message: 'Password is required.', errors: ['required'] };
  }
  if (password.length < policy.minLength) {
    errors.push(`at least ${policy.minLength} characters`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`no more than ${policy.maxLength} characters`);
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

export function validatePortalPasswordIfProvided(
  raw: unknown,
  policyOverrides?: Partial<PortalPasswordPolicy>
): PortalPasswordValidation {
  const password = String(raw ?? '').trim();
  if (!password) return { valid: true, message: '', errors: [] };
  return validatePortalPassword(password, policyOverrides);
}

/** Zod superRefine helper for required portal passwords. */
export function assertPortalPasswordZod(
  val: string,
  ctx: { addIssue: (arg: { code: 'custom'; message: string }) => void },
  policyOverrides?: Partial<PortalPasswordPolicy>
): void {
  const r = validatePortalPassword(val, policyOverrides);
  if (!r.valid) ctx.addIssue({ code: 'custom', message: r.message });
}

/** Zod superRefine when password is optional but validated if non-empty. */
export function assertPortalPasswordIfProvidedZod(
  val: string | undefined,
  ctx: { addIssue: (arg: { code: 'custom'; message: string }) => void },
  policyOverrides?: Partial<PortalPasswordPolicy>
): void {
  const r = validatePortalPasswordIfProvided(val, policyOverrides);
  if (!r.valid) ctx.addIssue({ code: 'custom', message: r.message });
}
