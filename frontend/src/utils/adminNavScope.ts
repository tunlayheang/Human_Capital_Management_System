import { Role } from '../types';
import { isSelfServiceScope } from './selfServiceScope';

/** Self-service sidebar items kept for Admin (system accounts are not employees). */
export const ADMIN_SELF_SERVICE_NAV_KEYS = new Set(['self-profile', 'self-chat']);

export const ADMIN_SELF_SERVICE_ALLOWED_PATHS = new Set(['/profile', '/chat', '/account-settings']);

export const ADMIN_SELF_SERVICE_BLOCKED_PATHS = new Set([
  '/attendance',
  '/leaves',
  '/overtime',
  '/my-pay',
  '/my-performance',
  '/projects',
]);

export function isAdminRole(role: Role | string | undefined): boolean {
  const r = String(role ?? '').trim().toUpperCase();
  return r === Role.ADMIN || r === 'SUPER_ADMIN';
}

export function isAdminBlockedFromSelfServiceRoute(
  pathname: string,
  search: string,
  role: Role | string | undefined
): boolean {
  if (!isAdminRole(role)) return false;
  const normalized = pathname.replace(/\/$/, '') || '/';
  if (ADMIN_SELF_SERVICE_ALLOWED_PATHS.has(normalized)) return false;
  if (!ADMIN_SELF_SERVICE_BLOCKED_PATHS.has(normalized)) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return isSelfServiceScope(params);
}
