import { isStandaloneDisplay } from './device';

export const pinVerifiedKey = (userId: string) => `hcms_pin_ok_${userId}`;
/** Last user activity while PIN-verified (idle timer source of truth). */
export const pinVerifiedAtKey = (userId: string) => `hcms_pin_ok_at_${userId}`;

/**
 * Home-screen (standalone) apps kill sessionStorage on every process exit.
 * Persist PIN unlock there in localStorage so reopening the icon only asks for
 * PIN after the idle window — not a full password login.
 * Browser tabs keep sessionStorage so closing the tab still clears unlock.
 */
function pinStore(): Storage {
  try {
    if (isStandaloneDisplay()) return localStorage;
  } catch {
    /* fall through */
  }
  return sessionStorage;
}

function removeFromBoth(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearPinSession(userId: string) {
  removeFromBoth(pinVerifiedKey(userId));
  removeFromBoth(pinVerifiedAtKey(userId));
}

/** Mark PIN as verified and start/reset the idle clock. */
export function markPinSessionVerified(userId: string) {
  const store = pinStore();
  // Avoid duplicate keys across stores when switching display modes.
  removeFromBoth(pinVerifiedKey(userId));
  removeFromBoth(pinVerifiedAtKey(userId));
  store.setItem(pinVerifiedKey(userId), '1');
  store.setItem(pinVerifiedAtKey(userId), String(Date.now()));
}

/**
 * Extend the idle window while the session is still verified.
 * No-op if PIN was never verified (or was cleared by lock).
 */
export function touchPinSessionActivity(userId: string): void {
  const store = pinStore();
  const ok =
    store.getItem(pinVerifiedKey(userId)) ||
    localStorage.getItem(pinVerifiedKey(userId)) ||
    sessionStorage.getItem(pinVerifiedKey(userId));
  if (!ok) return;
  store.setItem(pinVerifiedKey(userId), '1');
  store.setItem(pinVerifiedAtKey(userId), String(Date.now()));
}

export function readPinVerifiedAt(userId: string): number | null {
  const okKey = pinVerifiedKey(userId);
  const atKey = pinVerifiedAtKey(userId);
  const store = pinStore();
  const ok =
    store.getItem(okKey) ||
    localStorage.getItem(okKey) ||
    sessionStorage.getItem(okKey);
  const at = Number(
    store.getItem(atKey) ||
      localStorage.getItem(atKey) ||
      sessionStorage.getItem(atKey) ||
      0
  );
  if (!ok || !at) return null;
  return at;
}

/**
 * True when PIN was verified and the user has been active within `autoLockMinutes`.
 * Idle (no interaction) longer than that requires PIN again.
 */
export function isPinSessionVerified(userId: string, autoLockMinutes: number): boolean {
  const at = readPinVerifiedAt(userId);
  if (!at) return false;
  const idleMs = Math.max(1, autoLockMinutes) * 60 * 1000;
  return Date.now() - at < idleMs;
}
