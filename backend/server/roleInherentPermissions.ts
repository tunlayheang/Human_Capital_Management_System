import { resolvePermissionKeys } from './permissionKeyAliases.js';

/**
 * Inherent grants are disabled while the editable permission matrix is the
 * source of truth. Kept as stubs so existing imports keep compiling.
 */
export const ROLE_INHERENT_PERFORMANCE_KEYS = new Set<string>();
export const ROLE_INHERENT_MANAGER_KEYS = new Set<string>();
export const ROLE_INHERENT_HR_KEYS = new Set<string>();

/** Matrix Grant/Deny is authoritative — no role-level forced grants. */
export function roleGrantsInherentPermission(_role: string, _specKey: string): boolean {
  void resolvePermissionKeys;
  return false;
}
