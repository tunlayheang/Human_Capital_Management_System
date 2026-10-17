/**
 * Plaintext password character count for UI masks only (never store the password).
 * Kept in sync when a password is hashed or successfully verified.
 */
export function portalPasswordLength(plain: string | null | undefined): number {
  return String(plain ?? '').length;
}

export function shouldSyncPasswordLength(
  stored: unknown,
  plain: string | null | undefined
): boolean {
  const next = portalPasswordLength(plain);
  if (next <= 0) return false;
  const prev = Number(stored);
  return !Number.isFinite(prev) || prev !== next;
}
