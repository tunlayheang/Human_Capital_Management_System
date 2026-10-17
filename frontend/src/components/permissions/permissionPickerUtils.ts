import type { PermissionRecord } from '../../services/permissionService';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  groupPermissionsByCategory,
  resolvePermissionCategory,
  type CategoryKey,
} from './permissionCategories';

/** Hide legacy / duplicate keys so admins pick the current permission names only. */
export function permissionsForOverridePicker(permissions: PermissionRecord[]): PermissionRecord[] {
  return permissions.filter((p) => {
    if (/legacy/i.test(p.name)) return false;
    if (p.key.startsWith('employees.')) return false;
    if (p.key === 'recruitment.view' || p.key === 'recruitment.manage') return false;
    if (p.key.startsWith('task.') && !p.key.startsWith('tasks.')) return false;
    if (p.key === 'project.view') return false;
    if (p.key === 'payroll.view') return false;
    return true;
  });
}

export function groupPickerPermissions(
  permissions: PermissionRecord[]
): Record<CategoryKey, PermissionRecord[]> {
  const filtered = permissionsForOverridePicker(permissions);
  return groupPermissionsByCategory(filtered);
}

export function filterPickerPermissions(
  permissions: PermissionRecord[],
  query: string,
  category: CategoryKey | 'all'
): PermissionRecord[] {
  const q = query.trim().toLowerCase();
  let list = permissionsForOverridePicker(permissions);
  if (category !== 'all') {
    list = list.filter((p) => resolvePermissionCategory(p) === category);
  }
  if (!q) return list.sort((a, b) => a.name.localeCompare(b.name));
  return list
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        CATEGORY_META[resolvePermissionCategory(p)].label.toLowerCase().includes(q)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { CATEGORY_META, CATEGORY_ORDER };
