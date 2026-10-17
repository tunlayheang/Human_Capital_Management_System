/**
 * Tenant default portal password — used ONLY when creating a new employee portal
 * login without an explicit password. Updating this value must never rewrite
 * existing users' password hashes; they keep whatever they already use.
 *
 * The feature is optional: when disabled, callers must supply an explicit password
 * for new portal accounts. First-login password change (mustChangePassword) still
 * applies to newly created staff accounts regardless of this toggle.
 */
import { SettingsSecurity, sequelize } from './db.js';
import { ORG_SETTINGS_SINGLETON_ID } from './organizationSettingsSchema.js';
import { validatePortalPasswordWithPolicy } from './securityPasswordPolicy.js';

export const FALLBACK_DEFAULT_PORTAL_PASSWORD = 'Password123!';

const ENV_DEFAULT_KEY = 'HCMS_DEFAULT_EMPLOYEE_PASSWORD';

const DEFAULT_PASSWORD_DISABLED_MESSAGE =
  'Default portal password is disabled. Provide a password when creating the account, or enable Default Password in Settings → Security.';

let columnReady = false;

/** Normalize DB / JSON / form values to a strict boolean (default: enabled). */
export function coerceDefaultPasswordEnabled(raw: unknown): boolean {
  if (raw === false || raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'false' || s === 'off' || s === 'no' || s === '') return false;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) {
    return raw.length > 0 && raw[0] !== 0;
  }
  if (raw == null) return true;
  return Boolean(raw);
}

export async function ensureDefaultPortalPasswordColumn(): Promise<void> {
  if (columnReady) return;
  try {
    const [rows] = (await sequelize.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'settings_security'
         AND COLUMN_NAME IN ('default_portal_password', 'default_portal_password_enabled')`
    )) as [{ COLUMN_NAME: string }[], unknown];
    const names = new Set((rows || []).map((r) => r.COLUMN_NAME));
    if (!names.has('default_portal_password')) {
      await sequelize.query(
        `ALTER TABLE settings_security
         ADD COLUMN default_portal_password VARCHAR(128) NULL`
      );
      console.log('[db] settings_security.default_portal_password column added.');
    }
    if (!names.has('default_portal_password_enabled')) {
      await sequelize.query(
        `ALTER TABLE settings_security
         ADD COLUMN default_portal_password_enabled TINYINT(1) NOT NULL DEFAULT 1`
      );
      console.log('[db] settings_security.default_portal_password_enabled column added.');
    }
    columnReady = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Duplicate column')) {
      columnReady = true;
      return;
    }
    throw err;
  }
}

function envFallbackPassword(): string {
  const fromEnv = process.env[ENV_DEFAULT_KEY]?.trim();
  if (fromEnv && fromEnv.length >= 8) return fromEnv;
  return FALLBACK_DEFAULT_PORTAL_PASSWORD;
}

async function readSecurityRow(): Promise<Record<string, unknown> | null> {
  await ensureDefaultPortalPasswordColumn();
  const row = await SettingsSecurity.findByPk(ORG_SETTINGS_SINGLETON_ID);
  if (!row) return null;
  return (row as { get?: (opts: { plain: boolean }) => Record<string, unknown> }).get
    ? (row as { get: (opts: { plain: boolean }) => Record<string, unknown> }).get({ plain: true })
    : ((row as unknown as Record<string, unknown>) ?? null);
}

/** Whether Settings → Default Password is enabled for provisioning new accounts. */
export async function isDefaultPortalPasswordEnabled(): Promise<boolean> {
  try {
    const plain = await readSecurityRow();
    if (!plain) return true;
    return coerceDefaultPasswordEnabled(
      (plain as { default_portal_password_enabled?: unknown }).default_portal_password_enabled
    );
  } catch (err) {
    console.warn(
      '[defaultPortalPassword] Could not read enabled flag; treating as enabled:',
      (err as Error)?.message || err
    );
    return true;
  }
}

/** Plaintext default used when provisioning NEW portal accounts without an explicit password. */
export async function resolveDefaultPortalPassword(): Promise<string> {
  try {
    const plain = await readSecurityRow();
    const stored = String(
      (plain as { default_portal_password?: string } | null)?.default_portal_password ?? ''
    ).trim();
    if (stored.length >= 8) return stored;
  } catch (err) {
    console.warn(
      '[defaultPortalPassword] Could not read settings; using env/fallback:',
      (err as Error)?.message || err
    );
  }
  return envFallbackPassword();
}

/**
 * Resolve the default password for new-account provisioning.
 * Throws when the feature is disabled so callers require an explicit password.
 */
export async function resolveDefaultPortalPasswordForNewAccount(): Promise<string> {
  if (!(await isDefaultPortalPasswordEnabled())) {
    throw new Error(DEFAULT_PASSWORD_DISABLED_MESSAGE);
  }
  return resolveDefaultPortalPassword();
}

export function defaultPortalPasswordDisabledMessage(): string {
  return DEFAULT_PASSWORD_DISABLED_MESSAGE;
}

export async function getDefaultPortalPasswordStatus(): Promise<{
  enabled: boolean;
  isSet: boolean;
  source: 'settings' | 'env' | 'fallback';
  /** Resolved plaintext for Settings → Security (admins must share it with new hires). */
  password: string;
}> {
  const enabled = await isDefaultPortalPasswordEnabled();
  const password = await resolveDefaultPortalPassword();
  try {
    const plain = await readSecurityRow();
    const stored = String(
      (plain as { default_portal_password?: string } | null)?.default_portal_password ?? ''
    ).trim();
    if (stored.length >= 8) {
      return { enabled, isSet: true, source: 'settings', password };
    }
  } catch {
    /* fall through */
  }
  const fromEnv = process.env[ENV_DEFAULT_KEY]?.trim();
  if (fromEnv && fromEnv.length >= 8) {
    return { enabled, isSet: true, source: 'env', password };
  }
  return { enabled, isSet: true, source: 'fallback', password };
}

/** Persist the default for future new accounts only — does not update any users.password rows. */
export async function setDefaultPortalPassword(rawPassword: string): Promise<void> {
  const password = String(rawPassword ?? '').trim();
  const check = await validatePortalPasswordWithPolicy(password);
  if (!check.valid) {
    throw new Error(check.message || 'Password does not meet policy requirements.');
  }

  await ensureDefaultPortalPasswordColumn();
  const [row] = await SettingsSecurity.findOrCreate({
    where: { id: ORG_SETTINGS_SINGLETON_ID },
    defaults: { id: ORG_SETTINGS_SINGLETON_ID },
  });
  await row.update({ default_portal_password: password } as any);
}

/** Enable/disable optional default-password provisioning (does not change existing users). */
export async function setDefaultPortalPasswordEnabled(enabled: boolean): Promise<void> {
  await ensureDefaultPortalPasswordColumn();
  const [row] = await SettingsSecurity.findOrCreate({
    where: { id: ORG_SETTINGS_SINGLETON_ID },
    defaults: {
      id: ORG_SETTINGS_SINGLETON_ID,
      default_portal_password_enabled: true,
    } as any,
  });
  const next = coerceDefaultPasswordEnabled(enabled);
  await row.update({ default_portal_password_enabled: next } as any);
  // Re-read to confirm persistence (guards against silent no-op updates).
  const confirmed = await isDefaultPortalPasswordEnabled();
  if (confirmed !== next) {
    throw new Error(
      `Failed to ${next ? 'enable' : 'disable'} default portal password. Please try again.`
    );
  }
}

/**
 * Save Settings → Default Password panel: optional enable flag and/or password.
 * Existing portal accounts are never modified.
 */
export async function saveDefaultPortalPasswordSettings(input: {
  enabled?: boolean;
  password?: string;
  confirmPassword?: string;
}): Promise<{ enabled: boolean; isSet: boolean; source: 'settings' | 'env' | 'fallback' }> {
  const hasEnabled = typeof input.enabled === 'boolean';
  const password = String(input.password ?? '').trim();
  const confirmPassword = String(input.confirmPassword ?? '').trim();

  if (!hasEnabled && !password) {
    throw new Error('Provide a password or change the enable toggle.');
  }

  if (password) {
    if (confirmPassword && confirmPassword !== password) {
      throw new Error('Password and confirmation do not match');
    }
    await setDefaultPortalPassword(password);
  }

  if (hasEnabled) {
    if (input.enabled) {
      // Enabling requires a usable default (settings / env / fallback).
      const status = await getDefaultPortalPasswordStatus();
      if (!status.isSet && !password) {
        throw new Error('Set a default password before enabling this feature.');
      }
    }
    await setDefaultPortalPasswordEnabled(Boolean(input.enabled));
  }

  const status = await getDefaultPortalPasswordStatus();
  return { enabled: status.enabled, isSet: status.isSet, source: status.source };
}
