/**
 * Spec permission key → DB catalog keys (first match wins).
 * Keep in sync with frontend `constants/permissionKeys.ts`.
 */
export const PERMISSION_KEY_ALIASES: Record<string, string[]> = {
  'hr.employee.view': ['hr.employee.view', 'employees.view'],
  'hr.employee.create': ['hr.employee.create', 'employees.create'],
  'hr.employee.edit.personal': [
    'hr.employee.edit.personal',
    'employees.edit.personal',
    'employees.edit',
  ],
  'hr.employee.edit.financial': [
    'hr.employee.edit.financial',
    'employees.edit.payroll',
    'employees.edit.financial',
    'payroll.edit',
    'employees.edit',
  ],
  'hr.employee.edit.work': ['hr.employee.edit.work', 'employees.edit.job', 'employees.edit.work', 'employees.edit'],
  'hr.employee.terminate': ['hr.employee.terminate', 'employees.delete'],
  'hr.employee.restore': ['hr.employee.restore', 'employees.restore'],
  'hr.employee.movements': ['hr.employee.movements', 'employees.edit'],
  'hr.employee.offboard': ['hr.employee.offboard', 'hr.employee.terminate', 'employees.delete'],

  'attendance.view': ['attendance.view'],
  'attendance.manage': ['attendance.manage', 'attendance.edit'],

  'leave.view': ['leave.view'],
  'leave.approve': ['leave.approve'],
  'leave.request': ['leave.request', 'leave.create'],
  'leave.create': ['leave.create', 'leave.request'],
  'leave.edit': ['leave.edit', 'leave.manage'],

  'overtime.view': ['overtime.view', 'leave.view'],
  'overtime.manage': ['overtime.manage', 'leave.approve'],
  'overtime.config': ['overtime.config', 'leave.edit'],

  'hr.payroll.view': ['hr.payroll.view', 'payroll.view'],
  'hr.payroll.process': ['hr.payroll.process', 'payroll.process', 'payroll.create'],
  'hr.payroll.approve': ['hr.payroll.approve', 'payroll.approve'],
  'hr.payroll.edit': ['hr.payroll.edit', 'payroll.edit'],
  'payroll.rules.view': ['payroll.rules.view', 'payroll.view', 'hr.payroll.view'],
  'payroll.rules.edit': ['payroll.rules.edit', 'payroll.edit', 'hr.payroll.edit'],
  'payroll.calendar.view': ['payroll.calendar.view', 'hr.payroll.view', 'payroll.view'],
  'payroll.calendar.edit': ['payroll.calendar.edit', 'payroll.rules.edit', 'hr.payroll.edit'],
  'payroll.mypay.view': ['payroll.mypay.view'],

  'performance.view': ['performance.view'],
  'performance.manage': ['performance.manage'],
  'performance.appraisal.view': ['performance.appraisal.view', 'performance.view'],
  'performance.appraisal.manage': ['performance.appraisal.manage', 'performance.manage'],

  'departments.view': ['departments.view', 'company.structure.view'],
  'departments.manage': ['departments.manage', 'company.structure.manage'],

  'company.structure.view': ['company.structure.view', 'departments.view'],
  'company.structure.manage': ['company.structure.manage', 'departments.manage'],

  'reports.view': ['reports.view', 'hr.payroll.view'],
  'reports.export': ['reports.export'],

  'personal.view': ['personal.view'],
  'profile.view': ['profile.view'],
  'account.settings.view': ['account.settings.view', 'profile.view'],
  'notifications.view': ['notifications.view', 'dashboard.view'],

  'audit.view': ['audit.view', 'audit.manage'],
  'audit.manage': ['audit.manage'],

  'chat.view': ['chat.view'],
  'chat.send': ['chat.send', 'chat.view'],
  // Do not alias to chat.view/send — those are granted to all staff.
  'chat.announcements.manage': ['chat.announcements.manage'],

  'permissions.view': ['permissions.view', 'permissions.manage'],
  'permissions.manage': ['permissions.manage'],

  'users.view': ['users.view', 'users.manage'],
  'users.manage': ['users.manage'],

  'settings.view': [
    'settings.view',
    'settings.edit',
    'settings.security.view',
    'settings.security.edit',
  ],
  'settings.edit': ['settings.edit'],
  // Dedicated Security page keys — do not fall back to settings.edit or Deny is ignored.
  'settings.security.view': ['settings.security.view', 'settings.security.edit'],
  'settings.security.edit': ['settings.security.edit'],

  'dashboard.view': ['dashboard.view'],

  'hr.employee.correction': [
    'hr.employee.correction',
    'hr.employee.edit.personal',
    'employees.edit.personal',
    'employees.edit',
  ],

  'projects.self.view': ['projects.self.view'],
  'projects.view': ['projects.view', 'project.view'],
  'projects.create': ['projects.create', 'project.create'],
  'projects.delete': ['projects.delete', 'project.delete'],
  'projects.edit.info': ['projects.edit.info', 'project.edit', 'project.edit.info'],
  'projects.edit.lead': ['projects.edit.lead', 'project.edit', 'project.edit.lead'],
  'projects.edit.status': ['projects.edit.status', 'project.edit', 'project.approve'],

  'tasks.create': ['tasks.create', 'task.create'],
  'tasks.assign': ['tasks.assign', 'task.edit', 'task.assign'],
  'tasks.edit.info': ['tasks.edit.info', 'task.edit', 'task.edit.info'],
  'tasks.edit.dates': ['tasks.edit.dates', 'task.edit', 'task.edit.dates'],
  'tasks.progress': ['tasks.progress', 'task.edit', 'task.progress'],
  'tasks.delete': ['tasks.delete', 'task.delete'],
};

export function resolvePermissionKeys(specKey: string): string[] {
  return PERMISSION_KEY_ALIASES[specKey] ?? [specKey];
}

/**
 * Tight matrix sync groups (legacy ↔ modern). Broader hasPermission aliases are
 * intentionally excluded so Approve does not cascade into Rules/Calendar/Edit.
 */
export const PERMISSION_MATRIX_LINK_GROUPS: readonly (readonly string[])[] = [
  ['hr.payroll.view', 'payroll.view'],
  ['hr.payroll.process', 'payroll.create', 'payroll.process'],
  ['hr.payroll.approve', 'payroll.approve'],
  ['hr.payroll.edit', 'payroll.edit'],
  ['hr.employee.view', 'employees.view'],
  ['hr.employee.create', 'employees.create'],
  ['hr.employee.restore', 'employees.restore'],
  ['hr.employee.terminate', 'employees.delete'],
  ['departments.view', 'company.structure.view'],
  ['departments.manage', 'company.structure.manage'],
  ['leave.request', 'leave.create'],
  ['projects.view', 'project.view'],
  ['projects.create', 'project.create'],
  ['projects.delete', 'project.delete'],
  ['tasks.create', 'task.create'],
  ['tasks.delete', 'task.delete'],
  ['performance.appraisal.view', 'performance.view'],
  ['performance.appraisal.manage', 'performance.manage'],
];

const MATRIX_LINK_INDEX = (() => {
  const map = new Map<string, readonly string[]>();
  for (const group of PERMISSION_MATRIX_LINK_GROUPS) {
    for (const key of group) map.set(key, group);
  }
  return map;
})();

/** Keys that must Grant/Deny together in the permission matrix (includes `key`). */
export function getMatrixLinkedKeys(key: string): string[] {
  const group = MATRIX_LINK_INDEX.get(String(key || '').trim());
  return group ? [...group] : [key];
}

/**
 * @deprecated Prefer getMatrixLinkedKeys for matrix sync. Kept for callers that
 * need the broader OR-check sibling set from PERMISSION_KEY_ALIASES.
 */
export function getAliasSiblingKeys(key: string): string[] {
  return getMatrixLinkedKeys(key);
}

/** Mirror grant/deny state across linked legacy + modern keys before persisting. */
export function expandRolePermissionPayload(
  rolePermissions: Record<string, unknown>
): Record<string, unknown> {
  const expanded: Record<string, unknown> = { ...rolePermissions };
  for (const [key, actions] of Object.entries(rolePermissions)) {
    for (const sibling of getMatrixLinkedKeys(key)) {
      expanded[sibling] = actions;
    }
  }
  return expanded;
}
