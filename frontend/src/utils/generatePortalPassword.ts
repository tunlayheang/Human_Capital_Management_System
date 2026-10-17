import {
  DEFAULT_PORTAL_PASSWORD_POLICY,
  getPortalPasswordPolicy,
  type PortalPasswordPolicy,
} from './passwordPolicy';

const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?+-=';

function secureIndex(max: number): number {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function pickChar(pool: string): string {
  return pool.charAt(secureIndex(pool.length));
}

/** Strong portal password matching the current org password policy. */
export function generatePortalPassword(
  length?: number,
  policyOverrides?: Partial<PortalPasswordPolicy>
): string {
  const policy = {
    ...DEFAULT_PORTAL_PASSWORD_POLICY,
    ...getPortalPasswordPolicy(),
    ...(policyOverrides || {}),
  };
  const size = Math.max(policy.minLength, length ?? Math.max(policy.minLength, 14));
  const pools: string[] = [];
  const required: string[] = [];
  if (policy.requireLower) {
    pools.push(LOWER);
    required.push(pickChar(LOWER));
  }
  if (policy.requireUpper) {
    pools.push(UPPER);
    required.push(pickChar(UPPER));
  }
  if (policy.requireDigit) {
    pools.push(DIGITS);
    required.push(pickChar(DIGITS));
  }
  if (policy.requireSpecial) {
    pools.push(SYMBOLS);
    required.push(pickChar(SYMBOLS));
  }
  if (pools.length === 0) {
    pools.push(LOWER, UPPER, DIGITS);
    required.push(pickChar(LOWER), pickChar(UPPER), pickChar(DIGITS));
  }
  const all = pools.join('');
  const chars = [...required];
  while (chars.length < size) {
    chars.push(pickChar(all));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
