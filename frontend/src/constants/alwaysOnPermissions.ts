/**
 * Formerly forced grants. Matrix Grant/Deny is authoritative for every catalog key.
 * Kept in sync with backend/server/alwaysOnPermissions.ts.
 */
export const ALWAYS_ON_PERMISSION_KEYS = [] as const;

const ALWAYS_ON_SET = new Set<string>(ALWAYS_ON_PERMISSION_KEYS);

export function isAlwaysOnPermissionKey(key: string): boolean {
  return ALWAYS_ON_SET.has(String(key || '').trim().toLowerCase());
}

/**
 * Routes that only require authentication when no permission prop is set.
 * When a route declares `permission` / `permissionAny`, the matrix Grant/Deny applies.
 */
export const ALWAYS_AUTH_PATHS = new Set([
  '/dashboard',
  '/profile',
  '/account-settings',
  '/notifications',
]);

export function isAlwaysAuthPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return ALWAYS_AUTH_PATHS.has(normalized);
}
