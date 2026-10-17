/**
 * Organization Session Policy (Settings → Security).
 * Reads settings_security and exposes clamped values for idle timeout + login lockout.
 */
import { getOrganizationSettingValue } from './organizationSettingsService.js';

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
export const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
export const DEFAULT_LOCKED_PERIOD_MINUTES = 15;

/** Absolute JWT lifetime stays longer than idle; idle check is authoritative. */
export const SESSION_JWT_MAX_DAYS = 7;

const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 24 * 60; // 24h
const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 50;
const MIN_LOCK = 1;
const MAX_LOCK = 24 * 60;

function parsePositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function getSessionTimeoutMinutes(): Promise<number> {
  try {
    const raw = await getOrganizationSettingValue('security.session_timeout');
    return parsePositiveInt(raw, DEFAULT_SESSION_TIMEOUT_MINUTES, MIN_TIMEOUT, MAX_TIMEOUT);
  } catch {
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }
}

export async function getSessionTimeoutMs(): Promise<number> {
  return getSessionTimeoutMinutes().then((m) => m * 60 * 1000);
}

export async function getMaxLoginAttempts(): Promise<number> {
  try {
    const raw = await getOrganizationSettingValue('security.login_attempts');
    return parsePositiveInt(raw, DEFAULT_MAX_LOGIN_ATTEMPTS, MIN_ATTEMPTS, MAX_ATTEMPTS);
  } catch {
    return DEFAULT_MAX_LOGIN_ATTEMPTS;
  }
}

export async function getLockedPeriodMinutes(): Promise<number> {
  try {
    const raw = await getOrganizationSettingValue('security.locked_period');
    return parsePositiveInt(raw, DEFAULT_LOCKED_PERIOD_MINUTES, MIN_LOCK, MAX_LOCK);
  } catch {
    return DEFAULT_LOCKED_PERIOD_MINUTES;
  }
}

/** How often to persist lastActivity while the user is active (must be < idle timeout). */
export function activityTouchIntervalMs(sessionTimeoutMs: number): number {
  const capped = Math.floor(sessionTimeoutMs / 3);
  return Math.min(15 * 60 * 1000, Math.max(60_000, capped));
}
