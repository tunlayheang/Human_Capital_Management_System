import { resolvePermissionKeys } from '../constants/permissionKeys';

/**
 * Inherent grants are disabled — editable matrix Grant/Deny is authoritative.
 * Stub kept for AuthContext / permissionService compatibility.
 */
export function roleGrantsInherentPermission(
  _role: string | undefined,
  _specKey: string
): boolean {
  void resolvePermissionKeys;
  return false;
}
