import { SettingsSecurity } from './db.js';
import { ORG_SETTINGS_SINGLETON_ID } from './organizationSettingsSchema.js';
import {
  type PortalPasswordPolicy,
  validatePortalPassword,
  validatePortalPasswordIfProvided,
} from './passwordPolicy.js';

const DEFAULT_POLICY: PortalPasswordPolicy = {
  minLength: 12,
  maxLength: 128,
  requireLower: true,
  requireUpper: true,
  requireDigit: true,
  requireSpecial: true,
};

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

export async function loadPortalPasswordPolicy(): Promise<PortalPasswordPolicy> {
  try {
    const row = await SettingsSecurity.findByPk(ORG_SETTINGS_SINGLETON_ID);
    const plain = row?.get({ plain: true }) as Record<string, unknown> | undefined;
    if (!plain) return DEFAULT_POLICY;

    const minLengthRaw = Number(plain.password_min_length);
    // Keep aligned with portal UI default (12). Never raise above 128.
    const minLength = Number.isFinite(minLengthRaw) && minLengthRaw > 0
      ? Math.min(128, Math.max(8, Math.floor(minLengthRaw)))
      : 12;

    const complexityList = parseComplexityList(plain.password_complexity);
    const hasExplicit = complexityList.length > 0;
    const hasToken = (token: string) =>
      complexityList.some((value) => value.includes(token.toLowerCase()));

    return {
      minLength,
      maxLength: 128,
      requireLower: hasExplicit ? hasToken('lower') : true,
      requireUpper: hasExplicit ? hasToken('upper') : true,
      requireDigit: hasExplicit ? hasToken('number') || hasToken('digit') : true,
      requireSpecial: hasExplicit ? hasToken('special') : true,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function validatePortalPasswordWithPolicy(raw: unknown) {
  const policy = await loadPortalPasswordPolicy();
  return validatePortalPassword(raw, policy);
}

export async function validatePortalPasswordIfProvidedWithPolicy(raw: unknown) {
  const policy = await loadPortalPasswordPolicy();
  return validatePortalPasswordIfProvided(raw, policy);
}
