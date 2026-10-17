import type { Department, User } from '../types';

/** Shown when a department has no department head / manager. */
export const NO_MANAGER_ASSIGNED_LABEL = 'No Manager Assigned';

export function isDepartmentManagerAssigned(dept: Department, users: User[] = []): boolean {
  const managerId = String(dept.managerId ?? '').trim();
  if (!managerId) return false;
  const fromApi = String(dept.managerName ?? '').trim();
  if (fromApi && fromApi !== NO_MANAGER_ASSIGNED_LABEL && fromApi !== 'Unassigned' && fromApi !== 'Not Assigned') {
    return true;
  }
  return users.some((u) => u.id === managerId && String(u.name ?? '').trim());
}

/** Display name for department head on list/detail cards. */
export function resolveDepartmentManagerName(dept: Department, users: User[] = []): string {
  const managerId = String(dept.managerId ?? '').trim();
  if (!managerId) return NO_MANAGER_ASSIGNED_LABEL;

  const fromApi = String(dept.managerName ?? '').trim();
  if (fromApi) return fromApi;

  const user = users.find((u) => u.id === managerId);
  const name = user?.name?.trim();
  return name || NO_MANAGER_ASSIGNED_LABEL;
}
