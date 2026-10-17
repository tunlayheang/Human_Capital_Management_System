import {
  Award,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  CheckSquare,
  Clock,
  DollarSign,
  FolderKanban,
  LayoutDashboard,
  MessageSquare,
  PieChart,
  Settings,
  Shield,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionRecord } from '../../services/permissionService';

/** Sidebar-aligned sections (matches `navConfig.ts`). */
export type SidebarSectionKey =
  | 'home'
  | 'selfService'
  | 'management'
  | 'administration'
  | 'system';

/** Module groups within each sidebar section. */
export type CategoryKey =
  | 'dashboard'
  | 'selfPersonal'
  | 'selfProfile'
  | 'selfLeave'
  | 'selfPayslip'
  | 'selfChat'
  | 'selfProjects'
  | 'employee'
  | 'attendance'
  | 'leave'
  | 'overtime'
  | 'payroll'
  | 'performance'
  | 'projects'
  | 'tasks'
  | 'communication'
  | 'departments'
  | 'reports'
  | 'administration'
  | 'system';

export const CATEGORY_ORDER: CategoryKey[] = [
  'dashboard',
  'selfPersonal',
  'selfProfile',
  'selfLeave',
  'selfPayslip',
  'selfChat',
  'selfProjects',
  'employee',
  'attendance',
  'leave',
  'overtime',
  'performance',
  'projects',
  'tasks',
  'payroll',
  'departments',
  'reports',
  'communication',
  'administration',
  'system',
];

export type SidebarSectionConfig = {
  key: SidebarSectionKey;
  label: string;
  categories: CategoryKey[];
};

/** Matrix layout mirrors sidebar: Home → Self Service → Management → Administration. */
export const SIDEBAR_SECTIONS: SidebarSectionConfig[] = [
  {
    key: 'home',
    label: 'Home',
    categories: ['dashboard'],
  },
  {
    key: 'selfService',
    label: 'Self Service',
    categories: ['selfPersonal', 'selfProfile', 'selfLeave', 'selfPayslip', 'selfChat', 'selfProjects'],
  },
  {
    key: 'management',
    label: 'Management',
    categories: [
      'employee',
      'attendance',
      'leave',
      'overtime',
      'performance',
      'projects',
      'tasks',
      'payroll',
      'departments',
      'reports',
      'communication',
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    categories: ['administration'],
  },
  {
    key: 'system',
    label: 'System',
    categories: ['system'],
  },
];

const sectionHeaderClass =
  'bg-slate-100/90 dark:bg-slate-800/80 border-slate-200 dark:border-slate-600';
const headerClass =
  'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700';
const iconClass = 'text-slate-500 dark:text-slate-400';

export const SIDEBAR_SECTION_META: Record<
  SidebarSectionKey,
  { label: string; headerClass: string }
> = {
  home: { label: 'Home', headerClass: sectionHeaderClass },
  selfService: { label: 'Self Service', headerClass: sectionHeaderClass },
  management: { label: 'Management', headerClass: sectionHeaderClass },
  administration: { label: 'Administration', headerClass: sectionHeaderClass },
  system: { label: 'System', headerClass: sectionHeaderClass },
};

export const CATEGORY_META: Record<
  CategoryKey,
  { label: string; icon: LucideIcon; headerClass: string; iconClass: string; section: SidebarSectionKey }
> = {
  dashboard: {
    label: 'Dashboard',
    icon: LayoutDashboard,
    headerClass,
    iconClass,
    section: 'home',
  },
  selfPersonal: {
    label: 'Personal',
    icon: BarChart3,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  selfProfile: {
    label: 'Profile & account',
    icon: User,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  selfLeave: {
    label: 'Leave request',
    icon: CalendarDays,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  selfPayslip: {
    label: 'Payslip',
    icon: Wallet,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  selfChat: {
    label: 'Chat',
    icon: MessageSquare,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  selfProjects: {
    label: 'Project (self-service)',
    icon: FolderKanban,
    headerClass,
    iconClass,
    section: 'selfService',
  },
  employee: {
    label: 'Employees',
    icon: Users,
    headerClass,
    iconClass,
    section: 'management',
  },
  attendance: {
    label: 'Attendance',
    icon: Calendar,
    headerClass,
    iconClass,
    section: 'management',
  },
  leave: {
    label: 'Leaves',
    icon: Briefcase,
    headerClass,
    iconClass,
    section: 'management',
  },
  overtime: {
    label: 'Overtime',
    icon: Clock,
    headerClass,
    iconClass,
    section: 'management',
  },
  payroll: {
    label: 'Payroll',
    icon: DollarSign,
    headerClass,
    iconClass,
    section: 'management',
  },
  performance: {
    label: 'Performance',
    icon: Award,
    headerClass,
    iconClass,
    section: 'management',
  },
  projects: {
    label: 'Project management',
    icon: FolderKanban,
    headerClass,
    iconClass,
    section: 'management',
  },
  tasks: {
    label: 'Tasks',
    icon: CheckSquare,
    headerClass,
    iconClass,
    section: 'management',
  },
  communication: {
    label: 'Chat announcements',
    icon: MessageSquare,
    headerClass,
    iconClass,
    section: 'management',
  },
  departments: {
    label: 'Departments',
    icon: Building2,
    headerClass,
    iconClass,
    section: 'management',
  },
  reports: {
    label: 'Reports',
    icon: PieChart,
    headerClass,
    iconClass,
    section: 'management',
  },
  administration: {
    label: 'User & system settings',
    icon: Settings,
    headerClass,
    iconClass,
    section: 'administration',
  },
  system: {
    label: 'Permission governance',
    icon: Shield,
    headerClass,
    iconClass,
    section: 'system',
  },
};

/** Explicit self-service keys (employee-facing sidebar). */
const SELF_SERVICE_KEY_CATEGORY: Record<string, CategoryKey> = {
  'personal.view': 'selfPersonal',
  'profile.view': 'selfProfile',
  'account.settings.view': 'selfProfile',
  'notifications.view': 'selfProfile',
  'leave.request': 'selfLeave',
  'leave.create': 'selfLeave',
  'payroll.mypay.view': 'selfPayslip',
  'chat.view': 'selfChat',
  'chat.send': 'selfChat',
  'projects.self.view': 'selfProjects',
};

const MODULE_CATEGORY: Record<string, CategoryKey> = {
  PERSONAL: 'selfPersonal',
  DASHBOARD: 'dashboard',
  EMPLOYEE: 'employee',
  ATTENDANCE: 'attendance',
  LEAVE: 'leave',
  OVERTIME: 'overtime',
  PAYROLL: 'payroll',
  PERFORMANCE: 'performance',
  PROJECT: 'projects',
  TASK: 'tasks',
  COMMUNICATION: 'communication',
  DEPARTMENT: 'departments',
  ORGANIZATION: 'departments',
  REPORT: 'reports',
  USER: 'administration',
  SETTINGS: 'administration',
  AUDIT: 'administration',
  SYSTEM: 'system',
};

export function resolvePermissionCategory(perm: PermissionRecord): CategoryKey {
  const key = perm.key.toLowerCase();

  const selfService = SELF_SERVICE_KEY_CATEGORY[key];
  if (selfService) return selfService;

  const mod = String(perm.module || '').trim().toUpperCase();
  if (MODULE_CATEGORY[mod]) {
    const mapped = MODULE_CATEGORY[mod];
    if (mapped === 'leave' && (key === 'leave.request' || key === 'leave.create')) {
      return 'selfLeave';
    }
    if (mapped === 'payroll' && key === 'payroll.mypay.view') return 'selfPayslip';
    if (mapped === 'communication' && key !== 'chat.announcements.manage') {
      return 'selfChat';
    }
    return mapped;
  }

  if (key === 'dashboard.view') return 'dashboard';

  if (
    key.startsWith('hr.employee.') ||
    key.startsWith('employees.') ||
    key.includes('employee')
  ) {
    return 'employee';
  }

  if (key.startsWith('attendance.')) return 'attendance';

  if (key.startsWith('leave.')) return 'leave';

  if (key.startsWith('overtime.')) return 'overtime';

  if (key.startsWith('hr.payroll.') || key.startsWith('payroll.')) return 'payroll';

  if (key.startsWith('performance.')) return 'performance';

  if (key === 'projects.self.view') return 'selfProjects';

  if (key.startsWith('project.') || key.startsWith('projects.')) return 'projects';

  if (key.startsWith('task.') || key.startsWith('tasks.')) return 'tasks';

  if (key === 'chat.announcements.manage') return 'communication';

  if (key.startsWith('chat.')) return 'selfChat';

  if (key.startsWith('departments.') || key.startsWith('company.structure.')) return 'departments';

  if (key.startsWith('reports.')) return 'reports';

  if (
    key.startsWith('users.') ||
    key.startsWith('settings.') ||
    key.startsWith('audit.')
  ) {
    return 'administration';
  }

  if (key.startsWith('permissions.')) return 'system';

  return 'system';
}

export function resolveSidebarSection(category: CategoryKey): SidebarSectionKey {
  return CATEGORY_META[category].section;
}

export function groupPermissionsByCategory(
  permissions: PermissionRecord[]
): Record<CategoryKey, PermissionRecord[]> {
  const groups = Object.fromEntries(
    CATEGORY_ORDER.map((key) => [key, [] as PermissionRecord[]])
  ) as Record<CategoryKey, PermissionRecord[]>;

  for (const perm of permissions) {
    groups[resolvePermissionCategory(perm)].push(perm);
  }

  for (const key of CATEGORY_ORDER) {
    groups[key].sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

/** Default expanded state — all module sections open so every feature is visible. */
export function defaultCategoryExpanded(): Record<CategoryKey, boolean> {
  return Object.fromEntries(CATEGORY_ORDER.map((key) => [key, true])) as Record<
    CategoryKey,
    boolean
  >;
}
