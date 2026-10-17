import type { ElementType } from 'react';
import { navSections, type NavItemConfig } from '../config/navConfig';
import {
  MODULE_NAV_KEYS_WITH_CHILDREN,
  getVisibleModuleChildren,
  type ModuleSidebarChild,
  type ModuleSidebarContext,
} from '../config/moduleSidebarNav';
import {
  isModuleSidebarChildActive,
  isNavItemActive,
  moduleSidebarChildLabel,
} from '../config/navUtils';
import { NAV_MENU_CATALOG } from '../config/navMenuCatalog';
import { normalizeWorkspacePath, normalizeWorkspaceSearch } from './workspaceTabs';
import {
  resolveDetailWorkspaceTabLabel,
  resolveQueryTabWorkspaceLabel,
} from './workspaceTabDetailLabels';

type TFn = (key: string) => string;

export type RoutePageMeta = {
  title: string;
  subtitle?: string;
  icon?: ElementType;
  navKey?: string;
};

const SUBTITLE_BY_NAV_KEY: Record<string, { key?: string; fallback: string }> = {
  'home-dashboard': { key: 'dashboard.subtitle', fallback: 'Your HR command center and daily overview.' },
  'self-analytics': { key: 'personalAnalytics.subtitle', fallback: 'Your personal HR insights and trends.' },
  'self-profile': { key: 'profile.subtitle', fallback: 'View and update your employee profile.' },
  'self-attendance': { key: 'attendance.selfSubtitle', fallback: 'Clock in, view history, and track your attendance.' },
  'self-leave': { key: 'leaves.selfSubtitle', fallback: 'View your leave balance and submit requests.' },
  'self-overtime': { key: 'overtime.selfSubtitle', fallback: 'Submit and track your overtime requests.' },
  'self-my-pay': { key: 'payroll.myPaySubtitle', fallback: 'View payslips and payment history.' },
  'self-performance': { key: 'nav.myPerformanceSubtitle', fallback: 'Track goals, reviews, and performance history.' },
  'self-chat': { key: 'chat.subtitle', fallback: 'Message colleagues and teams.' },
  'self-projects': { key: 'projects.selfSubtitle', fallback: 'View projects and tasks assigned to you.' },
  'leave-requests': { key: 'leaves.requestsSubtitle', fallback: 'Review, approve, or reject team leave requests' },
  'leave-planning': { key: 'leaves.planningSubtitle', fallback: 'Monthly rosters, day-off scheduling, and team coverage calendar' },
  'leave-config': { key: 'leaves.configSubtitle', fallback: 'Leave types, accrual rules, and approval settings' },
  'att-mgmt-list': { key: 'attendance.listSubtitle', fallback: 'Daily attendance records and corrections for your team.' },
  'att-mgmt-tracking': { key: 'attendance.trackingSubtitle', fallback: 'Leaderboard and live attendance tracking.' },
  'att-mgmt-settings-rules': { key: 'attendance.settingsSubtitle', fallback: 'GPS enforcement, lateness, and clock-in policies.' },
  'ot-my': { key: 'overtime.mySubtitle', fallback: 'Submit and track your overtime requests.' },
  'ot-requests': { key: 'overtime.requestsSubtitle', fallback: 'Review, approve, or reject overtime requests.' },
  'ot-config': { key: 'overtime.configSubtitle', fallback: 'Overtime types, rates, and approval rules.' },
  'emp-onboard': { key: 'employees.onboardingSubtitle', fallback: 'Review your team, then start onboarding a new employee' },
  'emp-movements': { key: 'employees.movementsSubtitle', fallback: 'Transfers, promotions, and salary updates across your organization' },
  'emp-offboarding': { key: 'employees.offboardingSubtitle', fallback: 'Manage resignations, terminations, and exit settlements' },
  'perf-analytics': { key: 'performance.analyticsSubtitle', fallback: 'Team KPI trends, rankings, and department averages.' },
  'perf-kpi': { key: 'performance.kpiSubtitle', fallback: 'Run weighted KPI evaluations and approval workflow.' },
  'perf-config': { key: 'performance.configSubtitle', fallback: 'Periods, KPI components, scoring rules, and grades.' },
  'perf-probation': { key: 'performance.probationSubtitle', fallback: 'Probation evaluations and approvals.' },
  'perf-approvals': { key: 'performance.approvalsSubtitle', fallback: 'Sign off on appraisal approvals assigned to you.' },
  'perf-probation-approvals': { key: 'performance.probationApprovalsSubtitle', fallback: 'Sign off on probation approvals assigned to you.' },
  'pay-dash': { key: 'payroll.overviewSubtitle', fallback: '' },
  'pay-cal': { key: 'payroll.calendarSubtitle', fallback: 'Set cutoff, calculation, and payment dates per month' },
  'pay-rules': {
    key: 'payroll.rulesSubtitle',
    fallback: 'Exchange rate, tax brackets, compliance rates, and NSSF wage table',
  },
  'pay-approvals': { key: 'payroll.approvalsSubtitle', fallback: 'Browse all payroll runs and open any run to review, route approvers, and sign off.' },
  'pay-payment': { key: 'payroll.paymentSubtitle', fallback: 'Release approved payslips to employees — mark Paid, Pending, or Holding.' },
  'rep-overview': { key: 'reports.overviewSubtitle', fallback: 'Workforce analytics and operational reports.' },
  'rep-catalog': { key: 'reports.module.catalogSubtitle', fallback: 'Workforce Reports and Forecast & Planning Reports.' },
  'proj-overview': { key: 'projects.overviewSubtitle', fallback: 'Project portfolio, status, and assignments.' },
  'proj-timeline': { key: 'projects.timelineSubtitle', fallback: 'Timeline view of projects and milestones.' },
  'perm-roles': { key: 'permissions.rolesSubtitle', fallback: 'Manage system roles and default access levels.' },
  'perm-matrix': { key: 'permissions.matrixSubtitle', fallback: 'Configure permissions for each role.' },
  'perm-overrides': { key: 'permissions.overridesSubtitle', fallback: 'Grant or revoke permissions for individual users.' },
  'set-company': { key: 'settings.companySubtitle', fallback: 'Organization profile, structure, and branding.' },
  'set-security': { key: 'settings.securitySubtitle', fallback: 'Security policies, PIN, and authentication settings.' },
  'set-office': { key: 'settings.officeSubtitle', fallback: 'Office geofence point, radius, and zone preview.' },
  'set-qr': { key: 'settings.qrSubtitle', fallback: 'Entrance QR display for on-site check-in.' },
  'set-admin': { key: 'settings.createAdminSubtitle', fallback: 'Create additional administrator accounts.' },
  'set-backup': { key: 'settingsBackup.subtitle', fallback: 'Create, download, and restore database backups.' },
  'mgmt-employees': { key: 'employees.subtitle', fallback: 'Employee records, onboarding, and lifecycle.' },
  'mgmt-attendance': { key: 'attendance.manageSubtitle', fallback: 'Team attendance, tracking, and settings.' },
  'mgmt-leave': { key: 'leaves.manageSubtitle', fallback: 'Leave approvals, planning, and configuration.' },
  'mgmt-overtime': { key: 'overtime.manageSubtitle', fallback: 'Overtime approvals and configuration.' },
  'mgmt-performance': { key: 'performance.subtitle', fallback: 'Appraisals, probation, and performance approvals.' },
  'mgmt-projects': { key: 'projects.manageSubtitle', fallback: 'Manage projects, tasks, and timelines.' },
  'mgmt-payroll': { key: 'payroll.subtitle', fallback: 'Payroll cycles, rules, and approvals.' },
  'mgmt-departments': { key: 'departments.subtitle', fallback: 'Manage organizational business units and departmental leadership.' },
  'mgmt-reports': { key: 'reports.subtitle', fallback: 'Analytics and historical HR reports.' },
  'admin-users': { key: 'users.subtitle', fallback: 'Manage user accounts, roles, and access.' },
  'admin-audit-logs': { key: 'audit.logsSubtitle', fallback: 'System activity and security event logs.' },
  'admin-audit-trail': { key: 'audit.trailSubtitle', fallback: 'Trace sensitive data changes over time.' },
  'admin-permissions': { key: 'permissions.subtitle', fallback: 'Roles, permission matrix, and user overrides.' },
  'admin-settings': { key: 'settings.subtitle', fallback: 'Configure organization-wide settings and policies.' },
};

function navItemLabel(item: NavItemConfig, t: TFn): string {
  const key = item.labelKey?.trim();
  if (key) {
    const translated = t(key);
    if (translated && translated !== key && !translated.includes('.')) {
      return translated;
    }
  }
  return item.fallbackLabel;
}

function subtitleForNavKey(navKey: string, t: TFn): string | undefined {
  const entry = SUBTITLE_BY_NAV_KEY[navKey];
  if (!entry) return undefined;
  if (entry.key) {
    const translated = t(entry.key);
    if (translated && translated !== entry.key && !translated.startsWith('nav.')) {
      return translated;
    }
  }
  return entry.fallback;
}

function metaFromChild(child: ModuleSidebarChild, t: TFn): RoutePageMeta {
  return {
    title: moduleSidebarChildLabel(child, t),
    subtitle: subtitleForNavKey(child.navKey, t),
    icon: child.icon,
    navKey: child.navKey,
  };
}

function metaFromNavItem(item: NavItemConfig, t: TFn): RoutePageMeta {
  return {
    title: navItemLabel(item, t),
    subtitle: subtitleForNavKey(item.navKey, t),
    icon: item.icon,
    navKey: item.navKey,
  };
}

/** Resolve page title, subtitle, and icon from sidebar navigation for the current route. */
export function resolveRoutePageMeta(
  pathname: string,
  search: string,
  t: TFn,
  moduleCtx: ModuleSidebarContext
): RoutePageMeta | null {
  const path = normalizeWorkspacePath(pathname);
  const searchNorm = normalizeWorkspaceSearch(search);

  const detailLabel = resolveDetailWorkspaceTabLabel(path, searchNorm, t);
  if (detailLabel) {
    return { title: detailLabel };
  }

  // Prefer sidebar labels over in-page segment names (e.g. Rules not Tax).
  for (const section of navSections) {
    for (const item of section.items) {
      const children = getVisibleModuleChildren(item.navKey, moduleCtx);
      if (children?.length) {
        const activeChild = children.find((c) =>
          isModuleSidebarChildActive(c, path, searchNorm, children)
        );
        if (activeChild) {
          return metaFromChild(activeChild, t);
        }
      }

      if (isNavItemActive(item, path, searchNorm)) {
        const itemPath = normalizeWorkspacePath(item.path);
        const isDeeperRoute = path !== itemPath && path.startsWith(`${itemPath}/`);
        if (isDeeperRoute) {
          const visibleChildren = getVisibleModuleChildren(item.navKey, moduleCtx);
          const childOwnsRoute = visibleChildren?.some((c) =>
            isModuleSidebarChildActive(c, path, searchNorm, visibleChildren)
          );
          if (!childOwnsRoute) {
            continue;
          }
        }
        return metaFromNavItem(item, t);
      }
    }
  }

  const queryTabLabel = resolveQueryTabWorkspaceLabel(path, searchNorm, t);
  if (queryTabLabel) {
    return { title: queryTabLabel };
  }

  const catalogMatch = NAV_MENU_CATALOG.filter(
    (c) => path === c.path || path.startsWith(`${c.path}/`)
  ).sort((a, b) => b.path.length - a.path.length)[0];
  if (catalogMatch) {
    return { title: catalogMatch.label };
  }

  return null;
}

/** Routes that render their own in-page PageHeader (module shells, wizards, detail views). */
export function shouldSkipAutoPageHeader(pathname: string): boolean {
  const path = normalizeWorkspacePath(pathname);
  if (path === '/dashboard' || path === '/chat') return true;

  const moduleOwnsHeader = [
    '/leaves',
    '/overtime',
    '/attendance',
    '/employees',
    '/payroll',
    '/performance',
    '/personal-analytics',
    '/account-settings',
    '/reports',
    '/settings/backup',
  ];
  if (moduleOwnsHeader.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }

  if (path.startsWith('/employees/') && (path.includes('/new') || path.includes('/edit') || path.includes('/wizard') || path.includes('/payment'))) {
    return true;
  }
  if (/^\/payroll\/runs\/[^/]+$/.test(path)) return true;
  if (/^\/departments\/[^/]+$/.test(path)) return true;
  if (/^\/projects\/[^/]+$/.test(path)) return true;
  return false;
}
