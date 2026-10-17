/**
 * Tight permission groups that must stay Grant/Deny in sync in the matrix
 * (legacy key ↔ modern key). Broader hasPermission aliases are intentionally
 * excluded so granting Approve does not cascade into Rules/Calendar/Edit.
 */
export const PERMISSION_MATRIX_LINK_GROUPS: readonly (readonly string[])[] = [
  // Payroll
  ['hr.payroll.view', 'payroll.view'],
  ['hr.payroll.process', 'payroll.create', 'payroll.process'],
  ['hr.payroll.approve', 'payroll.approve'],
  ['hr.payroll.edit', 'payroll.edit'],

  // Employees
  ['hr.employee.view', 'employees.view'],
  ['hr.employee.create', 'employees.create'],
  ['hr.employee.restore', 'employees.restore'],
  ['hr.employee.terminate', 'employees.delete'],

  // Organization
  ['departments.view', 'company.structure.view'],
  ['departments.manage', 'company.structure.manage'],

  // Leave
  ['leave.request', 'leave.create'],

  // Projects / tasks (legacy ↔ modern)
  ['projects.view', 'project.view'],
  ['projects.create', 'project.create'],
  ['projects.delete', 'project.delete'],
  ['tasks.create', 'task.create'],
  ['tasks.delete', 'task.delete'],

  // Performance
  ['performance.appraisal.view', 'performance.view'],
  ['performance.appraisal.manage', 'performance.manage'],
];

const LINKED_KEY_INDEX = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of PERMISSION_MATRIX_LINK_GROUPS) {
    for (const key of group) {
      map.set(key, group);
    }
  }
  return map;
})();

/** All keys that must move together with `key` (always includes `key`). */
export function getMatrixLinkedKeys(key: string): string[] {
  const group = LINKED_KEY_INDEX.get(String(key || '').trim());
  return group ? [...group] : [key];
}
