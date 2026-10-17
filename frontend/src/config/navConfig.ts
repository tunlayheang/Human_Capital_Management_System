import type { ElementType } from 'react';
import {
  LayoutDashboard,
  Users,
  Calendar,
  CalendarDays,
  FolderKanban,
  MessageSquare,
  User,
  Settings,
  PieChart,
  BarChart3,
  Briefcase,
  DollarSign,
  Building,
  ShieldCheck,
  Award,
  Wallet,
  Clock,
  ClipboardList,
  Activity,
  History,
  Timer,
  Star,
  Kanban,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { Role } from '../types';
import { PERM } from '../constants/permissionKeys';

export type NavItemConfig = {
  /** Stable key for React lists (same `path` can appear under Self Service and Management). */
  navKey: string;
  path: string;
  /** e.g. `?scope=self` — employee self-service view on shared routes */
  search?: string;
  icon: ElementType;
  labelKey: string;
  fallbackLabel: string;
  /** Empty = all authenticated roles (still subject to role defaults + `permKey` when set). */
  roles: Role[];
  permKey?: string;
};

export type NavSectionConfig = {
  /** Stable id for filters (e.g. Self Service admin rules). */
  title: string;
  /** i18n key under `nav.sections.*` */
  titleKey?: string;
  items: NavItemConfig[];
};

/**
 * Sidebar: Home → self-service → people-ops (management) → administration.
 * Each item links to a catalog permission so matrix Grant/Deny controls visibility.
 */
export const navSections: NavSectionConfig[] = [
  {
    title: 'Home',
    titleKey: 'nav.sections.home',
    items: [
      {
        navKey: 'home-dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
        labelKey: 'nav.dashboard',
        fallbackLabel: 'Dashboard',
        roles: [],
        permKey: PERM.DASHBOARD_VIEW,
      },
    ],
  },
  {
    title: 'Self Service',
    titleKey: 'nav.sections.selfService',
    items: [
      {
        navKey: 'self-analytics',
        path: '/personal-analytics',
        icon: BarChart3,
        labelKey: 'personalAnalytics.nav',
        fallbackLabel: 'Personal',
        roles: [],
        permKey: PERM.PERSONAL_VIEW,
      },
      {
        navKey: 'self-profile',
        path: '/profile',
        icon: User,
        labelKey: 'nav.profile',
        fallbackLabel: 'Profile',
        roles: [],
        permKey: PERM.PROFILE_VIEW,
      },
      {
        navKey: 'self-attendance',
        path: '/attendance',
        search: '?scope=self',
        icon: Calendar,
        labelKey: 'attendance.myAttendance',
        fallbackLabel: 'Attendance',
        roles: [],
        permKey: PERM.ATTENDANCE_VIEW,
      },
      {
        navKey: 'self-leave',
        path: '/leaves',
        search: '?scope=self',
        icon: CalendarDays,
        labelKey: 'leaves.leaveRequest',
        fallbackLabel: 'Leave Request',
        roles: [],
        permKey: PERM.LEAVE_VIEW,
      },
      {
        navKey: 'self-overtime',
        path: '/overtime',
        search: '?scope=self',
        icon: Timer,
        labelKey: 'leaves.overtimeRequest',
        fallbackLabel: 'Overtime Request',
        roles: [],
        permKey: PERM.OVERTIME_VIEW,
      },
      {
        navKey: 'self-my-pay',
        path: '/my-pay',
        icon: Wallet,
        labelKey: 'payroll.myPayslips',
        fallbackLabel: 'Payslip',
        roles: [],
        permKey: PERM.PAYROLL_MYPAY_VIEW,
      },
      {
        navKey: 'self-performance',
        path: '/my-performance',
        icon: Star,
        labelKey: 'nav.myPerformance',
        fallbackLabel: 'My Performance',
        roles: [],
        permKey: PERM.PERSONAL_VIEW,
      },
      {
        navKey: 'self-chat',
        path: '/chat',
        icon: MessageSquare,
        labelKey: 'nav.chat',
        fallbackLabel: 'Chat',
        roles: [],
        permKey: PERM.CHAT_VIEW,
      },
      {
        navKey: 'self-projects',
        path: '/projects',
        search: '?scope=self',
        icon: Kanban,
        labelKey: 'projects.selfNav',
        fallbackLabel: 'Project',
        roles: [],
        permKey: PERM.PROJECTS_SELF_VIEW,
      },
    ],
  },
  {
    title: 'Management',
    titleKey: 'nav.sections.management',
    items: [
      {
        navKey: 'mgmt-employees',
        path: '/employees',
        icon: Users,
        labelKey: 'nav.employees',
        fallbackLabel: 'Employees',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.EMPLOYEE_VIEW,
      },
      {
        navKey: 'mgmt-attendance',
        path: '/attendance',
        search: '?scope=manage',
        icon: ClipboardList,
        labelKey: 'nav.attendance',
        fallbackLabel: 'Attendance',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.ATTENDANCE_VIEW,
      },
      {
        navKey: 'mgmt-leave',
        path: '/leaves',
        search: '?scope=manage&tab=requests',
        icon: Briefcase,
        labelKey: 'nav.leaves',
        fallbackLabel: 'Leave',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.LEAVE_VIEW,
      },
      {
        navKey: 'mgmt-overtime',
        path: '/overtime',
        search: '?scope=manage&tab=requests',
        icon: Clock,
        labelKey: 'nav.overtime',
        fallbackLabel: 'Overtime',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.OVERTIME_VIEW,
      },
      {
        navKey: 'mgmt-performance',
        path: '/performance',
        icon: Award,
        labelKey: 'nav.performance',
        fallbackLabel: 'Performance',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.PERFORMANCE_VIEW,
      },
      {
        navKey: 'mgmt-projects',
        path: '/projects',
        search: '?scope=manage',
        icon: FolderKanban,
        labelKey: 'nav.projects',
        fallbackLabel: 'Projects',
        roles: [Role.ADMIN, Role.MANAGER],
        permKey: PERM.PROJECTS_VIEW,
      },
      {
        navKey: 'mgmt-payroll',
        path: '/payroll',
        icon: DollarSign,
        labelKey: 'nav.payroll',
        fallbackLabel: 'Payroll',
        roles: [Role.ADMIN, Role.HR],
        permKey: PERM.PAYROLL_VIEW,
      },
      {
        navKey: 'mgmt-departments',
        path: '/departments',
        icon: Building,
        labelKey: 'nav.departments',
        fallbackLabel: 'Departments',
        roles: [Role.ADMIN, Role.HR, Role.MANAGER],
        permKey: PERM.DEPARTMENTS_VIEW,
      },
      {
        navKey: 'mgmt-reports',
        path: '/reports',
        icon: PieChart,
        labelKey: 'nav.reports',
        fallbackLabel: 'Reports',
        roles: [Role.ADMIN, Role.HR],
        permKey: PERM.REPORTS_VIEW,
      },
    ],
  },
  {
    title: 'ADMINISTRATION',
    titleKey: 'nav.sections.administration',
    items: [
      {
        navKey: 'admin-users',
        path: '/users',
        icon: UsersRound,
        labelKey: 'nav.users',
        fallbackLabel: 'User accounts',
        roles: [Role.ADMIN],
        permKey: PERM.USERS_VIEW,
      },
      {
        navKey: 'admin-permissions',
        path: '/permissions',
        icon: ShieldCheck,
        labelKey: 'nav.permissions',
        fallbackLabel: 'Permissions',
        roles: [Role.ADMIN],
        permKey: PERM.PERMISSIONS_VIEW,
      },
      {
        navKey: 'admin-settings',
        path: '/settings',
        icon: Settings,
        labelKey: 'nav.settings',
        fallbackLabel: 'Settings',
        roles: [Role.ADMIN],
        permKey: PERM.SETTINGS_VIEW,
      },
      {
        navKey: 'admin-audit-logs',
        path: '/audit/logs',
        icon: Activity,
        labelKey: 'nav.auditLogs',
        fallbackLabel: 'Audit Logs',
        roles: [Role.ADMIN],
        permKey: PERM.AUDIT_VIEW,
      },
      {
        navKey: 'admin-audit-trail',
        path: '/audit/trail',
        icon: History,
        labelKey: 'nav.auditTrail',
        fallbackLabel: 'Audit Trail',
        roles: [Role.ADMIN],
        permKey: PERM.AUDIT_VIEW,
      },
    ],
  },
];

/** Self-service Settings — pinned in the sidebar footer above Logout. */
export const sidebarFooterNavItems: NavItemConfig[] = [
  {
    navKey: 'self-account-settings',
    path: '/account-settings',
    icon: Wrench,
    labelKey: 'nav.accountSettings',
    fallbackLabel: 'Settings',
    roles: [],
  },
];
