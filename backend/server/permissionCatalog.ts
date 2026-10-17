export type SystemRoleName = 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE';

export type PermissionCatalogEntry = {
  id: string;
  name: string;
  key: string;
  module: string;
  description: string;
  isSensitive?: boolean;
  /** Role → actions; omitted roles get no default grant (except ADMIN fallback). */
  defaults?: Partial<Record<SystemRoleName, string[]>>;
};

const VIEW = ['view'];
const MANAGE = ['view', 'create', 'edit', 'delete', 'manage'];
const EDIT = ['view', 'edit'];
const FULL = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'];

/**
 * Default role grants seed the editable file store (not MySQL).
 * ADMIN=full via adminActions; HR=workforce ops; MANAGER=team oversight; EMPLOYEE=self-service.
 */
export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // —— Employee (granular spec keys) ——
  {
    id: 'perm-hr-emp-view',
    name: 'View Employees (HR)',
    key: 'hr.employee.view',
    module: 'EMPLOYEE',
    description: 'View employee records and profiles',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-hr-emp-create',
    name: 'Create Employees (HR)',
    key: 'hr.employee.create',
    module: 'EMPLOYEE',
    description: 'Create new employee records',
    isSensitive: true,
    defaults: { HR: ['create'] },
  },
  {
    id: 'perm-hr-emp-edit-personal',
    name: 'Edit Employee Personal Data',
    key: 'hr.employee.edit.personal',
    module: 'EMPLOYEE',
    description: 'Edit personal and family / tax dependent information',
    isSensitive: true,
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-hr-emp-edit-financial',
    name: 'Edit Employee Financial Data',
    key: 'hr.employee.edit.financial',
    module: 'EMPLOYEE',
    description: 'Edit salary, bank, and payroll-related employee fields',
    isSensitive: true,
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-hr-emp-edit-work',
    name: 'Edit Employee Work Data',
    key: 'hr.employee.edit.work',
    module: 'EMPLOYEE',
    description: 'Edit job, department, and reporting structure',
    isSensitive: true,
    defaults: { HR: EDIT, MANAGER: EDIT },
  },
  {
    id: 'perm-hr-emp-terminate',
    name: 'Terminate Employees',
    key: 'hr.employee.terminate',
    module: 'EMPLOYEE',
    description: 'Deactivate or terminate employee records',
    isSensitive: true,
    defaults: { HR: ['delete'] },
  },
  {
    id: 'perm-hr-emp-restore',
    name: 'Restore Employees',
    key: 'hr.employee.restore',
    module: 'EMPLOYEE',
    description: 'Reactivate terminated employees',
    isSensitive: true,
    defaults: { HR: ['edit'] },
  },
  {
    id: 'perm-emp-restore',
    name: 'Restore Employees (legacy key)',
    key: 'employees.restore',
    module: 'EMPLOYEE',
    description: 'Reactivate terminated employees',
    isSensitive: true,
    defaults: { HR: ['edit'] },
  },

  // —— Attendance / leave ——
  {
    id: 'perm-att-manage',
    name: 'Manage Attendance',
    key: 'attendance.manage',
    module: 'ATTENDANCE',
    description: 'Create and adjust attendance records',
    isSensitive: true,
    defaults: { HR: MANAGE, MANAGER: EDIT },
  },
  {
    id: 'perm-att-view',
    name: 'View Attendance',
    key: 'attendance.view',
    module: 'ATTENDANCE',
    description: 'View attendance, leaderboard, and attendance history',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-leave-view',
    name: 'View Leave',
    key: 'leave.view',
    module: 'LEAVE',
    description: 'View leave requests, balances, and leave calendar',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-leave-approve',
    name: 'Approve Leave',
    key: 'leave.approve',
    module: 'LEAVE',
    description: 'Approve or reject leave requests',
    defaults: { HR: ['view', 'approve'], MANAGER: ['view', 'approve'] },
  },
  {
    id: 'perm-leave-create',
    name: 'Create Leave Requests',
    key: 'leave.create',
    module: 'LEAVE',
    description: 'Create leave requests',
    defaults: { HR: ['view', 'create'], MANAGER: ['view', 'create'], EMPLOYEE: ['view', 'create'] },
  },
  {
    id: 'perm-leave-edit',
    name: 'Edit Leave Configuration',
    key: 'leave.edit',
    module: 'LEAVE',
    description: 'Edit leave configuration and planning settings',
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-overtime-view',
    name: 'View Overtime',
    key: 'overtime.view',
    module: 'OVERTIME',
    description: 'View overtime requests and overtime summaries',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-overtime-manage',
    name: 'Manage Overtime',
    key: 'overtime.manage',
    module: 'OVERTIME',
    description: 'Approve, reject, and process overtime requests',
    defaults: { HR: MANAGE, MANAGER: EDIT },
  },
  {
    id: 'perm-overtime-config',
    name: 'Configure Overtime',
    key: 'overtime.config',
    module: 'OVERTIME',
    description: 'Configure overtime types and policy rules',
    isSensitive: true,
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-leave-request',
    name: 'Request Leave',
    key: 'leave.request',
    module: 'LEAVE',
    description: 'Submit leave requests',
    defaults: { HR: ['create'], MANAGER: ['create'], EMPLOYEE: ['create'] },
  },

  // —— Payroll (spec + rules) ——
  {
    id: 'perm-hr-pay-view',
    name: 'View Payroll (HR)',
    key: 'hr.payroll.view',
    module: 'PAYROLL',
    description: 'View payroll overview, schedule, rules, and run records',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-hr-pay-process',
    name: 'Process Payroll',
    key: 'hr.payroll.process',
    module: 'PAYROLL',
    description: 'Calculate payroll runs, route approvers, and manage payroll cycles',
    isSensitive: true,
    defaults: { HR: ['view', 'create', 'approve'] },
  },
  {
    id: 'perm-hr-pay-approve',
    name: 'Approve Payroll Runs',
    key: 'hr.payroll.approve',
    module: 'PAYROLL',
    description: 'Open the payroll approval queue and sign off runs assigned in the approval chain',
    isSensitive: true,
    defaults: { HR: ['view', 'approve'], MANAGER: ['view', 'approve'] },
  },
  {
    id: 'perm-hr-pay-edit',
    name: 'Edit Payroll Data',
    key: 'hr.payroll.edit',
    module: 'PAYROLL',
    description: 'Edit payroll items and adjustments',
    isSensitive: true,
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-pay-rules-view',
    name: 'View Payroll Rules',
    key: 'payroll.rules.view',
    module: 'PAYROLL',
    description: 'View compliance rules and tax bracket configuration',
    defaults: { HR: VIEW },
  },
  {
    id: 'perm-pay-rules-edit',
    name: 'Edit Payroll Rules',
    key: 'payroll.rules.edit',
    module: 'PAYROLL',
    description: 'Edit NSSF, overtime, and compliance rule settings',
    isSensitive: true,
    defaults: { HR: EDIT },
  },

  // —— Projects (spec keys) ——
  {
    id: 'perm-projects-self-view',
    name: 'View My Projects',
    key: 'projects.self.view',
    module: 'PROJECT',
    description:
      'Self-service: view projects and tasks assigned to you (My Project)',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-projects-create',
    name: 'Create Projects',
    key: 'projects.create',
    module: 'PROJECT',
    description: 'Create new projects in Project management',
    isSensitive: true,
    defaults: { MANAGER: ['create'] },
  },
  {
    id: 'perm-projects-view',
    name: 'View Project Portfolio',
    key: 'projects.view',
    module: 'PROJECT',
    description:
      'Management: view the project portfolio, overview, and timeline',
    defaults: { MANAGER: VIEW },
  },
  {
    id: 'perm-project-view-legacy',
    name: 'View Projects (legacy)',
    key: 'project.view',
    module: 'PROJECT',
    description: 'Legacy project view permission key (maps to portfolio view)',
    defaults: { MANAGER: VIEW },
  },
  {
    id: 'perm-projects-delete',
    name: 'Delete Projects',
    key: 'projects.delete',
    module: 'PROJECT',
    description: 'Delete or archive projects',
    isSensitive: true,
    defaults: { MANAGER: ['delete'] },
  },
  {
    id: 'perm-projects-edit-info',
    name: 'Edit Project Info',
    key: 'projects.edit.info',
    module: 'PROJECT',
    description: 'Edit project name, description, and details',
    defaults: { MANAGER: EDIT },
  },
  {
    id: 'perm-projects-edit-lead',
    name: 'Edit Project Lead',
    key: 'projects.edit.lead',
    module: 'PROJECT',
    description: 'Assign or change project lead',
    isSensitive: true,
    defaults: { MANAGER: EDIT },
  },
  {
    id: 'perm-projects-edit-status',
    name: 'Edit Project Status',
    key: 'projects.edit.status',
    module: 'PROJECT',
    description: 'Change project status and lifecycle',
    defaults: { MANAGER: EDIT },
  },
  // —— Tasks ——
  {
    id: 'perm-tasks-create',
    name: 'Create Tasks',
    key: 'tasks.create',
    module: 'TASK',
    description: 'Create tasks on projects',
    defaults: { MANAGER: ['create'], EMPLOYEE: ['create'] },
  },
  {
    id: 'perm-tasks-assign',
    name: 'Assign Tasks',
    key: 'tasks.assign',
    module: 'TASK',
    description: 'Assign tasks to team members',
    defaults: { MANAGER: EDIT },
  },
  {
    id: 'perm-tasks-edit-info',
    name: 'Edit Task Info',
    key: 'tasks.edit.info',
    module: 'TASK',
    description: 'Edit task title, description, and priority',
    defaults: { MANAGER: EDIT, EMPLOYEE: EDIT },
  },
  {
    id: 'perm-tasks-edit-dates',
    name: 'Edit Task Dates',
    key: 'tasks.edit.dates',
    module: 'TASK',
    description: 'Edit task start and due dates',
    defaults: { MANAGER: EDIT },
  },
  {
    id: 'perm-tasks-progress',
    name: 'Update Task Progress',
    key: 'tasks.progress',
    module: 'TASK',
    description: 'Update task status and completion',
    defaults: { MANAGER: EDIT, EMPLOYEE: EDIT },
  },
  {
    id: 'perm-tasks-delete',
    name: 'Delete Tasks',
    key: 'tasks.delete',
    module: 'TASK',
    description: 'Remove tasks from projects',
    isSensitive: true,
    defaults: { MANAGER: ['delete'] },
  },
  {
    id: 'perm-task-create',
    name: 'Create Tasks (legacy)',
    key: 'task.create',
    module: 'TASK',
    description: 'Create tasks',
    defaults: { MANAGER: ['create'], EMPLOYEE: ['create'] },
  },
  {
    id: 'perm-task-view',
    name: 'View Tasks (legacy)',
    key: 'task.view',
    module: 'TASK',
    description: 'View tasks',
    defaults: { MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-task-edit',
    name: 'Edit Tasks (legacy)',
    key: 'task.edit',
    module: 'TASK',
    description: 'Edit tasks',
    defaults: { MANAGER: EDIT, EMPLOYEE: EDIT },
  },
  {
    id: 'perm-task-delete',
    name: 'Delete Tasks (legacy)',
    key: 'task.delete',
    module: 'TASK',
    description: 'Delete tasks',
    isSensitive: true,
    defaults: { MANAGER: ['delete'] },
  },

  // —— Communication ——
  {
    id: 'perm-chat-view',
    name: 'View Chat',
    key: 'chat.view',
    module: 'COMMUNICATION',
    description: 'Access chat and read messages',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-chat-send',
    name: 'Send Chat Messages',
    key: 'chat.send',
    module: 'COMMUNICATION',
    description: 'Send chat messages to colleagues',
    defaults: { HR: ['view', 'create'], MANAGER: ['view', 'create'], EMPLOYEE: ['view', 'create'] },
  },

  // —— Organization / reporting / admin modules ——
  {
    id: 'perm-departments-view',
    name: 'View Departments',
    key: 'departments.view',
    module: 'DEPARTMENT',
    description: 'View departments and department structure',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-departments-manage',
    name: 'Manage Departments',
    key: 'departments.manage',
    module: 'DEPARTMENT',
    description: 'Create and update departments',
    isSensitive: true,
    defaults: { HR: MANAGE },
  },
  {
    id: 'perm-reports-view',
    name: 'View Reports',
    key: 'reports.view',
    module: 'REPORT',
    description: 'View analytics and reports',
    defaults: { HR: VIEW },
  },
  {
    id: 'perm-reports-export',
    name: 'Export Reports',
    key: 'reports.export',
    module: 'REPORT',
    description: 'Export report data',
    defaults: { HR: ['view', 'export'] },
  },
  {
    id: 'perm-users-view',
    name: 'View User Management',
    key: 'users.view',
    module: 'USER',
    description: 'View user accounts and portal access settings',
    defaults: {},
  },
  {
    id: 'perm-users-manage',
    name: 'Manage User Accounts',
    key: 'users.manage',
    module: 'USER',
    description: 'Create/edit/freeze user accounts and access roles',
    isSensitive: true,
    defaults: {},
  },
  {
    id: 'perm-settings-view',
    name: 'View Settings',
    key: 'settings.view',
    module: 'SETTINGS',
    description: 'View system settings',
    defaults: {},
  },
  {
    id: 'perm-settings-edit',
    name: 'Edit Settings',
    key: 'settings.edit',
    module: 'SETTINGS',
    description: 'Edit system settings and policy values',
    isSensitive: true,
    defaults: {},
  },
  {
    id: 'perm-settings-security-view',
    name: 'View Security Settings',
    key: 'settings.security.view',
    module: 'SETTINGS',
    description:
      'Open Settings → Security (default password, session policy, and related authentication settings)',
    isSensitive: true,
    defaults: {},
  },
  {
    id: 'perm-settings-security-edit',
    name: 'Edit Security Settings',
    key: 'settings.security.edit',
    module: 'SETTINGS',
    description:
      'Change Settings → Security values including default portal password and session policy',
    isSensitive: true,
    defaults: {},
  },
  {
    id: 'perm-performance-view',
    name: 'View Performance',
    key: 'performance.view',
    module: 'PERFORMANCE',
    description: 'View probation and appraisal pages (Managers: assigned evaluations only)',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-performance-manage',
    name: 'Manage Performance',
    key: 'performance.manage',
    module: 'PERFORMANCE',
    description: 'Manage probation and performance records (HR/Admin)',
    defaults: { HR: MANAGE, MANAGER: EDIT },
  },

  // —— Governance ——
  {
    id: 'perm-permissions-view',
    name: 'View Permission Matrix',
    key: 'permissions.view',
    module: 'SYSTEM',
    description: 'View roles and permission matrix',
    defaults: {},
  },
  {
    id: 'perm-permissions-manage',
    name: 'Manage Permissions',
    key: 'permissions.manage',
    module: 'SYSTEM',
    description: 'Edit role permissions and user overrides',
    isSensitive: true,
    defaults: {},
  },

  // —— Personal hub ——
  {
    id: 'perm-personal-view',
    name: 'View Personal Hub',
    key: 'personal.view',
    module: 'PERSONAL',
    description: 'Access personal analytics, notes, alerts calendar, and KPI trends',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },

  // —— Legacy employee keys (kept for alias resolution) ——
  {
    id: 'perm-employees-view',
    name: 'View Employees (legacy)',
    key: 'employees.view',
    module: 'EMPLOYEE',
    description: 'Legacy key — view employee records and profiles',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-employees-create',
    name: 'Create Employees (legacy)',
    key: 'employees.create',
    module: 'EMPLOYEE',
    description: 'Legacy key — create new employee records',
    isSensitive: true,
    defaults: { HR: ['create'] },
  },
  {
    id: 'perm-employees-edit',
    name: 'Edit Employees (legacy)',
    key: 'employees.edit',
    module: 'EMPLOYEE',
    description: 'Legacy key — edit employee records',
    isSensitive: true,
    defaults: { HR: EDIT, MANAGER: EDIT },
  },

  // —— Legacy payroll keys (kept for alias resolution) ——
  {
    id: 'perm-pay-view',
    name: 'View Payroll (legacy)',
    key: 'payroll.view',
    module: 'PAYROLL',
    description: 'Legacy key — view payroll runs and payslips',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-pay-create',
    name: 'Create Payroll (legacy)',
    key: 'payroll.create',
    module: 'PAYROLL',
    description: 'Legacy key — create and calculate payroll runs',
    isSensitive: true,
    defaults: { HR: ['view', 'create'] },
  },
  {
    id: 'perm-pay-approve',
    name: 'Approve Payroll (legacy)',
    key: 'payroll.approve',
    module: 'PAYROLL',
    description: 'Legacy key — approve payroll runs in the workflow chain',
    isSensitive: true,
    defaults: { HR: ['view', 'approve'], MANAGER: ['view', 'approve'] },
  },
  {
    id: 'perm-pay-export',
    name: 'Export Payroll (legacy)',
    key: 'payroll.export',
    module: 'PAYROLL',
    description: 'Legacy key — export payroll data',
    defaults: { HR: ['view', 'export'] },
  },

  // —— Audit ——
  {
    id: 'perm-audit-view',
    name: 'View Audit Logs',
    key: 'audit.view',
    module: 'AUDIT',
    description: 'View audit logs and audit trail entries',
    defaults: {},
  },
  {
    id: 'perm-audit-manage',
    name: 'Manage Audit Logs',
    key: 'audit.manage',
    module: 'AUDIT',
    description: 'Export audit data and manage audit retention',
    isSensitive: true,
    defaults: {},
  },

  // —— Profile & notifications ——
  {
    id: 'perm-profile-view',
    name: 'View Profile',
    key: 'profile.view',
    module: 'PROFILE',
    description: 'View and edit own employee profile',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-account-settings',
    name: 'Account Settings',
    key: 'account.settings.view',
    module: 'PROFILE',
    description: 'Change password, security, and personal account preferences',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-notifications-view',
    name: 'View Notifications',
    key: 'notifications.view',
    module: 'NOTIFICATION',
    description: 'View in-app notifications and alerts',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },

  // —— Organization ——
  {
    id: 'perm-company-structure-view',
    name: 'View Company Structure',
    key: 'company.structure.view',
    module: 'ORGANIZATION',
    description: 'Open the organization chart and company structure explorer',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
  {
    id: 'perm-company-structure-manage',
    name: 'Manage Company Structure',
    key: 'company.structure.manage',
    module: 'ORGANIZATION',
    description: 'Edit structure levels and organizational hierarchy settings',
    isSensitive: true,
    defaults: { HR: EDIT },
  },

  // —— Employee lifecycle (movements / offboarding) ——
  {
    id: 'perm-hr-emp-movements',
    name: 'Manage Employee Movements',
    key: 'hr.employee.movements',
    module: 'EMPLOYEE',
    description: 'Transfers, promotions, salary changes, and movement history',
    isSensitive: true,
    defaults: { HR: MANAGE, MANAGER: EDIT },
  },
  {
    id: 'perm-hr-emp-offboard',
    name: 'Manage Offboarding',
    key: 'hr.employee.offboard',
    module: 'EMPLOYEE',
    description: 'Resignation, termination, settlement, and offboarding workflow',
    isSensitive: true,
    defaults: { HR: ['view', 'create', 'edit', 'approve'] },
  },

  // —— Payroll schedule & payslip ——
  {
    id: 'perm-pay-cal-view',
    name: 'View Payroll Schedule',
    key: 'payroll.calendar.view',
    module: 'PAYROLL',
    description: 'View payroll calendar cutoff, calculation, and payment dates',
    defaults: { HR: VIEW },
  },
  {
    id: 'perm-pay-cal-edit',
    name: 'Edit Payroll Schedule',
    key: 'payroll.calendar.edit',
    module: 'PAYROLL',
    description: 'Edit monthly payroll calendar milestones',
    isSensitive: true,
    defaults: { HR: EDIT },
  },
  {
    id: 'perm-pay-mypay-view',
    name: 'View My Payslips',
    key: 'payroll.mypay.view',
    module: 'PAYROLL',
    description: 'Employee self-service access to own payslips',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },

  // —— Performance appraisals (KPI) ——
  {
    id: 'perm-perf-appraisal-view',
    name: 'View KPI Appraisals',
    key: 'performance.appraisal.view',
    module: 'PERFORMANCE',
    description: 'View appraisal periods, scores, and workflow status',
    defaults: { HR: VIEW, MANAGER: VIEW },
  },
  {
    id: 'perm-perf-appraisal-manage',
    name: 'Manage KPI Appraisals',
    key: 'performance.appraisal.manage',
    module: 'PERFORMANCE',
    description: 'Create appraisal periods, score employees, and run approval workflow',
    isSensitive: true,
    defaults: { HR: MANAGE, MANAGER: EDIT },
  },

  // —— Chat announcements ——
  {
    id: 'perm-chat-announce',
    name: 'Manage Chat Announcements',
    key: 'chat.announcements.manage',
    module: 'COMMUNICATION',
    description: 'Post and configure organization chat announcements (Admin and HR)',
    isSensitive: true,
    defaults: { HR: MANAGE },
  },

  // —— Dashboard ——
  {
    id: 'perm-dashboard-view',
    name: 'View Dashboard',
    key: 'dashboard.view',
    module: 'DASHBOARD',
    description: 'Access the main dashboard (always granted to every role)',
    defaults: { HR: VIEW, MANAGER: VIEW, EMPLOYEE: VIEW },
  },
];

function adminActions(entry: PermissionCatalogEntry): string[] {
  return entry.defaults?.ADMIN ?? FULL;
}

export function actionsForRole(
  entry: PermissionCatalogEntry,
  roleName: SystemRoleName
): string[] | null {
  const key = String(entry.key || '');
  const selfServiceActions = entry.defaults?.EMPLOYEE ?? [];
  const managementActions = entry.defaults?.[roleName] ?? [];

  const isAdministrationKey = ['USER', 'SETTINGS', 'AUDIT', 'SYSTEM'].includes(String(entry.module || '').trim());
  const isProjectOrTaskKey =
    key.startsWith('projects.') ||
    key.startsWith('project.') ||
    key.startsWith('tasks.') ||
    key.startsWith('task.');
  const isProjectSelfServiceKey = key === 'projects.self.view';
  const isManagerExcludedKey =
    key.startsWith('payroll.') ||
    key.startsWith('hr.payroll.') ||
    key.startsWith('departments.') ||
    key.startsWith('hr.employee.') ||
    key.startsWith('employees.') ||
    key.startsWith('attendance.') ||
    key === 'leave.edit' ||
    key === 'overtime.config' ||
    key === 'performance.manage';

  if (roleName === 'ADMIN') return adminActions(entry);

  if (roleName === 'HR') {
    // HR: SelfService all, Management except Project/Task portfolio, Administration none.
    // Administration is always denied (never fall back to EMPLOYEE defaults).
    if (isAdministrationKey) return null;
    // Project/Task management keys are denied; only projects.self.view uses employee defaults.
    // Other task.* keys that include EMPLOYEE defaults stay available as self-service.
    if (isProjectOrTaskKey && !isProjectSelfServiceKey) {
      const actions = selfServiceActions;
      return actions.length > 0 ? actions : null;
    }

    const actions = [...new Set([...selfServiceActions, ...managementActions])];
    return actions.length > 0 ? actions : null;
  }

  if (roleName === 'MANAGER') {
    // Manager: SelfService all, Management except several configuration modules.
    if (isAdministrationKey || isManagerExcludedKey) {
      const actions = selfServiceActions;
      return actions.length > 0 ? actions : null;
    }

    const actions = [...new Set([...selfServiceActions, ...managementActions])];
    return actions.length > 0 ? actions : null;
  }

  // EMPLOYEE role: keep catalog defaults as-is.
  if (roleName === 'EMPLOYEE') {
    const actions = entry.defaults?.EMPLOYEE ?? [];
    return actions.length > 0 ? actions : null;
  }

  return null;
}

/** Catalog rows shaped like the former DB `permissions` records (no DB read). */
export function listCatalogPermissions(): Array<{
  id: string;
  name: string;
  key: string;
  module: string;
  description: string;
  isSensitive: boolean;
}> {
  return PERMISSION_CATALOG.map((entry) => ({
    id: entry.id,
    name: entry.name,
    key: entry.key,
    module: entry.module,
    description: entry.description,
    isSensitive: entry.isSensitive ?? false,
  }));
}

/**
 * Role → permission key → actions, built only from `PERMISSION_CATALOG.defaults`.
 * Used by admin matrix UI and runtime checks (no `rolepermissions` table).
 */
export function buildCatalogRoleMatrix(): Record<string, Record<string, string[]>> {
  const roles: SystemRoleName[] = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
  const matrix: Record<string, Record<string, string[]>> = {};
  for (const roleName of roles) {
    matrix[roleName] = {};
    for (const entry of PERMISSION_CATALOG) {
      const actions = actionsForRole(entry, roleName);
      matrix[roleName][entry.key] = actions ? [...actions] : [];
    }
  }
  return matrix;
}

/**
 * Effective permission map for a non-admin role from hardcoded catalog defaults.
 * Source is always `catalog` so deploy does not depend on MySQL grant rows.
 */
export function buildEffectivePermissionsFromCatalog(
  roleName: string
): Record<string, { actions: string[]; source: string }> {
  const normalized = String(roleName || '').toUpperCase() as SystemRoleName;
  if (normalized !== 'HR' && normalized !== 'MANAGER' && normalized !== 'EMPLOYEE') {
    return {};
  }

  const effective: Record<string, { actions: string[]; source: string }> = {};
  for (const entry of PERMISSION_CATALOG) {
    const actions = actionsForRole(entry, normalized);
    if (actions && actions.length > 0) {
      effective[entry.key] = { actions: [...actions], source: 'catalog' };
    }
  }

  return effective;
}

/** True when grants are not stored in MySQL (file/catalog store is used instead). */
export const PERMISSIONS_HARDCODED = true;

export type EnsurePermissionCatalogOptions = {
  /**
   * When true, overwrite existing role grants with catalog defaults for every
   * catalog entry (restores production after a bad matrix save). User overrides
   * are untouched.
   */
  reapplyDefaults?: boolean;
};

/**
 * Formerly wrote `permissions` + `rolepermissions` MySQL rows.
 * Grants now live in the file store — this is a no-op kept for callers/scripts.
 */
export async function ensurePermissionCatalog(
  _options?: EnsurePermissionCatalogOptions
): Promise<{
  added: number;
  roleLinks: number;
  repaired: number;
  reapplied: number;
  roleIdRepaired: number;
}> {
  void _options;
  return { added: 0, roleLinks: 0, repaired: 0, reapplied: 0, roleIdRepaired: 0 };
}
