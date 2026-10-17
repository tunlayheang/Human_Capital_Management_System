import { describe, expect, it } from 'vitest';
import {
  portalPasswordPolicyFromSecuritySettings,
  validatePortalPassword,
} from './passwordPolicy';

describe('portalPasswordPolicyFromSecuritySettings', () => {
  it('maps min length and complexity labels from Settings → Security', () => {
    const policy = portalPasswordPolicyFromSecuritySettings({
      'security.password_min_length': '8',
      'security.password_complexity': ['Uppercase', 'Numbers'],
    });
    expect(policy.minLength).toBe(8);
    expect(policy.requireUpper).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.requireLower).toBe(false);
    expect(policy.requireSpecial).toBe(false);
  });

  it('defaults to all complexity when complexity list is empty', () => {
    const policy = portalPasswordPolicyFromSecuritySettings({
      'security.password_min_length': '12',
      'security.password_complexity': [],
    });
    expect(policy.requireLower).toBe(true);
    expect(policy.requireUpper).toBe(true);
    expect(policy.requireDigit).toBe(true);
    expect(policy.requireSpecial).toBe(true);
  });
});

describe('validatePortalPassword with policy', () => {
  it('accepts shorter passwords when min length is 8 and special is optional', () => {
    const check = validatePortalPassword('Abcdef12', {
      minLength: 8,
      requireLower: true,
      requireUpper: true,
      requireDigit: true,
      requireSpecial: false,
    });
    expect(check.valid).toBe(true);
  });

  it('rejects passwords missing required special characters', () => {
    const check = validatePortalPassword('Abcdef12', {
      minLength: 8,
      requireSpecial: true,
    });
    expect(check.valid).toBe(false);
    expect(check.message).toMatch(/special/i);
  });
});
