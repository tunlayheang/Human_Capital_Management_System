import { User } from './db';
import { PERMISSION_KEY_ALIASES, resolvePermissionKeys } from './permissionKeyAliases.js';
import { roleGrantsInherentPermission } from './roleInherentPermissions.js';
import {
  buildEffectivePermissionsFromStore,
  loadPermissionStore,
} from './permissionFileStore.js';

export type EffectivePermissionMap = Record<string, { actions: string[]; source: string }>;

export { PERMISSION_KEY_ALIASES, resolvePermissionKeys };

const USER_PERM_CACHE_TTL_MS = 60_000;
const userPermCache = new Map<string, { at: number; data: EffectivePermissionMap | null }>();

export function invalidateEffectivePermissionsCache(userId?: string): void {
  if (userId) userPermCache.delete(userId);
  else userPermCache.clear();
}

/** Catalog keys are code-defined; kept for callers that previously cleared a DB catalog cache. */
export function invalidatePermissionsCatalogCache(): void {
  // no-op — permission keys come from PERMISSION_CATALOG
}

/**
 * Resolve effective permissions from the editable file store (matrix + overrides).
 * Defaults seed from PERMISSION_CATALOG. Does not use MySQL grant tables.
 * Still loads the user row to determine role (portal login remains DB-backed).
 */
export async function getEffectivePermissionsForUser(
  userId: string
): Promise<EffectivePermissionMap | null> {
  const cached = userPermCache.get(userId);
  if (cached && Date.now() - cached.at < USER_PERM_CACHE_TTL_MS) {
    return cached.data;
  }

  const user: any = await User.findByPk(userId);
  if (!user) return {};

  const roleName = String(user.role || '').toUpperCase();
  // Every role — including ADMIN / SUPER_ADMIN — uses matrix Grant/Deny.
  const store = await loadPermissionStore();
  const effectivePerms = buildEffectivePermissionsFromStore(roleName, userId, store);
  userPermCache.set(userId, { at: Date.now(), data: effectivePerms });
  return effectivePerms;
}

export function hasEffectivePermission(
  map: EffectivePermissionMap | null,
  specKey: string,
  role?: string
): boolean {
  // null is legacy "unchecked admin" — treat as no grants so callers must load the matrix.
  if (map == null) return false;
  if (role && roleGrantsInherentPermission(role, specKey)) return true;
  for (const key of resolvePermissionKeys(specKey)) {
    const entry = map[key];
    if (entry?.actions?.length) return true;
  }
  return false;
}
