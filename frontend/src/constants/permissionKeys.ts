/**
 * Spec-facing permission keys. Each may map to one or more DB `permissions.key` values.
 */
export const PERM = {
  EMPLOYEE_VIEW: 'hr.employee.view',
  EMPLOYEE_CREATE: 'hr.employee.create',
  EMPLOYEE_EDIT_PERSONAL: 'hr.employee.edit.personal',
  EMPLOYEE_EDIT_FINANCIAL: 'hr.employee.edit.financial',
  EMPLOYEE_EDIT_WORK: 'hr.employee.edit.work',
  EMPLOYEE_TERMINATE: 'hr.employee.terminate',
  EMPLOYEE_RESTORE: 'hr.employee.restore',

  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_MANAGE: 'attendance.manage',

  LEAVE_VIEW: 'leave.view',
  LEAVE_APPROVE: 'leave.approve',
  LEAVE_REQUEST: 'leave.request',
  LEAVE_CREATE: 'leave.create',
  LEAVE_EDIT: 'leave.edit',

  OVERTIME_VIEW: 'overtime.view',
  OVERTIME_MANAGE: 'overtime.manage',
  OVERTIME_CONFIG: 'overtime.config',

  PAYROLL_VIEW: 'hr.payroll.view',
  PAYROLL_PROCESS: 'hr.payroll.process',
  PAYROLL_APPROVE: 'hr.payroll.approve',
  PAYROLL_EDIT: 'hr.payroll.edit',
  PAYROLL_RULES_VIEW: 'payroll.rules.view',
  PAYROLL_RULES_EDIT: 'payroll.rules.edit',

  PERFORMANCE_VIEW: 'performance.view',
  PERFORMANCE_MANAGE: 'performance.manage',

  DEPARTMENTS_VIEW: 'departments.view',
  DEPARTMENTS_MANAGE: 'departments.manage',

  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  PERSONAL_VIEW: 'personal.view',
  PROFILE_VIEW: 'profile.view',
  ACCOUNT_SETTINGS_VIEW: 'account.settings.view',
  NOTIFICATIONS_VIEW: 'notifications.view',

  EMPLOYEE_MOVEMENTS: 'hr.employee.movements',
  EMPLOYEE_OFFBOARD: 'hr.employee.offboard',

  PAYROLL_CALENDAR_VIEW: 'payroll.calendar.view',
  PAYROLL_CALENDAR_EDIT: 'payroll.calendar.edit',
  PAYROLL_MYPAY_VIEW: 'payroll.mypay.view',

  PERFORMANCE_APPRAISAL_VIEW: 'performance.appraisal.view',
  PERFORMANCE_APPRAISAL_MANAGE: 'performance.appraisal.manage',

  COMPANY_STRUCTURE_VIEW: 'company.structure.view',
  COMPANY_STRUCTURE_MANAGE: 'company.structure.manage',

  CHAT_ANNOUNCEMENTS_MANAGE: 'chat.announcements.manage',

  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',
  SETTINGS_SECURITY_VIEW: 'settings.security.view',
  SETTINGS_SECURITY_EDIT: 'settings.security.edit',

  AUDIT_VIEW: 'audit.view',
  AUDIT_MANAGE: 'audit.manage',

  CHAT_VIEW: 'chat.view',
  CHAT_SEND: 'chat.send',

  PERMISSIONS_VIEW: 'permissions.view',
  PERMISSIONS_MANAGE: 'permissions.manage',

  DASHBOARD_VIEW: 'dashboard.view',

  PROJECTS_SELF_VIEW: 'projects.self.view',
  PROJECTS_VIEW: 'projects.view',
  PROJECTS_CREATE: 'projects.create',
  PROJECTS_DELETE: 'projects.delete',
  PROJECTS_EDIT_INFO: 'projects.edit.info',
  PROJECTS_EDIT_LEAD: 'projects.edit.lead',
  PROJECTS_EDIT_STATUS: 'projects.edit.status',

  TASKS_CREATE: 'tasks.create',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_EDIT_INFO: 'tasks.edit.info',
  TASKS_EDIT_DATES: 'tasks.edit.dates',
  TASKS_PROGRESS: 'tasks.progress',
  TASKS_DELETE: 'tasks.delete',
} as const;

export type PermissionKey = (typeof PERM)[keyof typeof PERM];

/** Spec key → candidate keys checked in order (first match in permission catalog wins). */
export const PERMISSION_KEY_ALIASES: Record<string, string[]> = {
  [PERM.EMPLOYEE_VIEW]: ['hr.employee.view', 'employees.view'],
  [PERM.EMPLOYEE_CREATE]: ['hr.employee.create', 'employees.create'],
  [PERM.EMPLOYEE_EDIT_PERSONAL]: [
    'hr.employee.edit.personal',
    'employees.edit.personal',
    'employees.edit',
  ],
  [PERM.EMPLOYEE_EDIT_FINANCIAL]: [
    'hr.employee.edit.financial',
    'employees.edit.payroll',
    'employees.edit.financial',
    'payroll.edit',
    'employees.edit',
  ],
  [PERM.EMPLOYEE_EDIT_WORK]: [
    'hr.employee.edit.work',
    'employees.edit.job',
    'employees.edit.work',
    'employees.edit',
  ],
  [PERM.EMPLOYEE_TERMINATE]: ['hr.employee.terminate', 'employees.delete'],
  [PERM.EMPLOYEE_RESTORE]: ['hr.employee.restore', 'employees.restore'],
  [PERM.EMPLOYEE_MOVEMENTS]: ['hr.employee.movements', 'employees.edit'],
  [PERM.EMPLOYEE_OFFBOARD]: [
    'hr.employee.offboard',
    'hr.employee.terminate',
    'employees.delete',
  ],
  /** Profile correction requests — maps to personal-edit grant. */
  'hr.employee.correction': [
    'hr.employee.correction',
    'hr.employee.edit.personal',
    'employees.edit.personal',
    'employees.edit',
  ],

  [PERM.ATTENDANCE_VIEW]: ['attendance.view'],
  [PERM.ATTENDANCE_MANAGE]: ['attendance.manage', 'attendance.edit'],

  [PERM.LEAVE_VIEW]: ['leave.view'],
  [PERM.LEAVE_APPROVE]: ['leave.approve'],
  [PERM.LEAVE_REQUEST]: ['leave.request', 'leave.create'],
  [PERM.LEAVE_CREATE]: ['leave.create', 'leave.request'],
  [PERM.LEAVE_EDIT]: ['leave.edit', 'leave.manage'],

  [PERM.OVERTIME_VIEW]: ['overtime.view', 'leave.view'],
  [PERM.OVERTIME_MANAGE]: ['overtime.manage', 'leave.approve'],
  [PERM.OVERTIME_CONFIG]: ['overtime.config', 'leave.edit'],

  [PERM.PAYROLL_VIEW]: ['hr.payroll.view', 'payroll.view'],
  [PERM.PAYROLL_PROCESS]: ['hr.payroll.process', 'payroll.create'],
  [PERM.PAYROLL_APPROVE]: ['hr.payroll.approve', 'payroll.approve'],
  [PERM.PAYROLL_EDIT]: ['hr.payroll.edit', 'payroll.edit'],
  [PERM.PAYROLL_RULES_VIEW]: ['payroll.rules.view', 'payroll.view', 'hr.payroll.view'],
  [PERM.PAYROLL_RULES_EDIT]: ['payroll.rules.edit', 'payroll.edit', 'hr.payroll.edit'],
  [PERM.PAYROLL_CALENDAR_VIEW]: ['payroll.calendar.view', 'hr.payroll.view', 'payroll.view'],
  [PERM.PAYROLL_CALENDAR_EDIT]: ['payroll.calendar.edit', 'payroll.rules.edit', 'hr.payroll.edit'],
  [PERM.PAYROLL_MYPAY_VIEW]: ['payroll.mypay.view'],

  [PERM.PERFORMANCE_VIEW]: ['performance.view'],
  [PERM.PERFORMANCE_MANAGE]: ['performance.manage'],
  [PERM.PERFORMANCE_APPRAISAL_VIEW]: ['performance.appraisal.view', 'performance.view'],
  [PERM.PERFORMANCE_APPRAISAL_MANAGE]: ['performance.appraisal.manage', 'performance.manage'],

  [PERM.DEPARTMENTS_VIEW]: ['departments.view', 'company.structure.view'],
  [PERM.DEPARTMENTS_MANAGE]: ['departments.manage', 'company.structure.manage'],
  [PERM.COMPANY_STRUCTURE_VIEW]: ['company.structure.view', 'departments.view'],
  [PERM.COMPANY_STRUCTURE_MANAGE]: ['company.structure.manage', 'departments.manage'],

  [PERM.REPORTS_VIEW]: ['reports.view', 'hr.payroll.view'],
  [PERM.REPORTS_EXPORT]: ['reports.export'],

  [PERM.PERSONAL_VIEW]: ['personal.view'],
  [PERM.PROFILE_VIEW]: ['profile.view'],
  [PERM.ACCOUNT_SETTINGS_VIEW]: ['account.settings.view', 'profile.view'],
  [PERM.NOTIFICATIONS_VIEW]: ['notifications.view', 'dashboard.view'],

  [PERM.USERS_VIEW]: ['users.view', 'users.manage'],
  [PERM.USERS_MANAGE]: ['users.manage'],
  [PERM.SETTINGS_VIEW]: [
    'settings.view',
    'settings.edit',
    'settings.security.view',
    'settings.security.edit',
  ],
  [PERM.SETTINGS_EDIT]: ['settings.edit'],
  // Dedicated Security page keys — do not fall back to settings.edit or Deny is ignored.
  [PERM.SETTINGS_SECURITY_VIEW]: ['settings.security.view', 'settings.security.edit'],
  [PERM.SETTINGS_SECURITY_EDIT]: ['settings.security.edit'],

  [PERM.AUDIT_VIEW]: ['audit.view', 'audit.manage'],
  [PERM.AUDIT_MANAGE]: ['audit.manage'],

  [PERM.CHAT_VIEW]: ['chat.view'],
  [PERM.CHAT_SEND]: ['chat.send', 'chat.view'],
  // Do not alias to chat.view/send — those are granted to all staff.
  [PERM.CHAT_ANNOUNCEMENTS_MANAGE]: ['chat.announcements.manage'],

  [PERM.PERMISSIONS_VIEW]: ['permissions.view', 'permissions.manage'],
  [PERM.PERMISSIONS_MANAGE]: ['permissions.manage'],

  [PERM.DASHBOARD_VIEW]: ['dashboard.view'],

  [PERM.PROJECTS_SELF_VIEW]: ['projects.self.view'],
  [PERM.PROJECTS_VIEW]: ['projects.view', 'project.view'],
  [PERM.PROJECTS_CREATE]: ['projects.create', 'project.create'],
  [PERM.PROJECTS_DELETE]: ['projects.delete', 'project.delete'],
  [PERM.PROJECTS_EDIT_INFO]: ['projects.edit.info', 'project.edit', 'project.edit.info'],
  [PERM.PROJECTS_EDIT_LEAD]: ['projects.edit.lead', 'project.edit', 'project.edit.lead'],
  [PERM.PROJECTS_EDIT_STATUS]: ['projects.edit.status', 'project.edit', 'project.approve'],

  [PERM.TASKS_CREATE]: ['tasks.create', 'task.create'],
  [PERM.TASKS_ASSIGN]: ['tasks.assign', 'task.edit', 'task.assign'],
  [PERM.TASKS_EDIT_INFO]: ['tasks.edit.info', 'task.edit', 'task.edit.info'],
  [PERM.TASKS_EDIT_DATES]: ['tasks.edit.dates', 'task.edit', 'task.edit.dates'],
  [PERM.TASKS_PROGRESS]: ['tasks.progress', 'task.edit', 'task.progress'],
  [PERM.TASKS_DELETE]: ['tasks.delete', 'task.delete'],
};

export function resolvePermissionKeys(specKey: string): string[] {
  return PERMISSION_KEY_ALIASES[specKey] ?? [specKey];
}
