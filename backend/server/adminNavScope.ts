/** Self-service routes system administrators must not use (portal admin is not an employee). */
export const ADMIN_SELF_SERVICE_ALLOWED = new Set(['/profile', '/chat']);

export const ADMIN_SELF_SERVICE_BLOCKED = new Set([
  '/attendance',
  '/leaves',
  '/overtime',
  '/my-pay',
  '/my-performance',
  '/projects',
]);

export function isAdminRole(role: string): boolean {
  const r = String(role || '').trim().toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN';
}

export function isAdminSelfServicePath(path: string): boolean {
  const normalized = String(path || '').trim().replace(/\/$/, '') || '/';
  return ADMIN_SELF_SERVICE_BLOCKED.has(normalized);
}

/** Employee self-service scope on a shared route (no `scope=manage`). */
export function isEmployeeSelfServiceScope(search: string): boolean {
  const q = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(q).get('scope') !== 'manage';
}

export function isAdminBlockedFromSelfServiceRoute(
  pathname: string,
  search: string,
  role: string
): boolean {
  if (!isAdminRole(role)) return false;
  const normalized = pathname.replace(/\/$/, '') || '/';
  if (ADMIN_SELF_SERVICE_ALLOWED.has(normalized)) return false;
  if (!ADMIN_SELF_SERVICE_BLOCKED.has(normalized)) return false;
  return isEmployeeSelfServiceScope(search);
}
