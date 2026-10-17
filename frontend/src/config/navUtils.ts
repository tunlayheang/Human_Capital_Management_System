import { Role } from '../types';
import { PERM } from '../constants/permissionKeys';
import { canAccessPayrollApprovals, canAccessFullPayrollModule } from '../utils/payrollAccess';
import { parseNavItemScope } from '../utils/selfServiceScope';
import {
  ADMIN_SELF_SERVICE_NAV_KEYS,
  isAdminBlockedFromSelfServiceRoute,
  isAdminRole,
} from '../utils/adminNavScope';
import type { NavItemConfig, NavSectionConfig } from './navConfig';
import { navSections, sidebarFooterNavItems } from './navConfig';
import type { ModuleSidebarChild } from './moduleSidebarNav';
import { isCatalogMenuPath } from './navMenuCatalog';
import { hasOffboardingStageAccess } from './offboardingAccess';

type TFn = (path: string, vars?: Record<string, string | number>) => string;

export function moduleSidebarChildLabel(child: ModuleSidebarChild, t: TFn): string {
  if (child.labelKey) {
    const translated = t(child.labelKey);
    if (translated && translated !== child.labelKey && !translated.startsWith('nav.')) {
      return translated;
    }
    return child.fallbackLabel;
  }
  if (child.navKey.startsWith('rail-')) {
    return child.fallbackLabel;
  }
  const key = `nav.modules.${child.navKey}`;
  const translated = t(key);
  if (translated && translated !== key && !translated.startsWith('nav.')) {
    return translated;
  }
  return child.fallbackLabel;
}

export type HasRoleFn = (roles: Role | Role[]) => boolean;

/** Fallback when menu API is unavailable — mirrors App route role guards. */
export const ROUTE_ROLE_GUARDS: Record<string, Role[]> = {
  '/employees': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/payroll/approvals': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/payroll/runs': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/payroll': [Role.ADMIN, Role.HR],
  '/performance': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/approvals': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/approvals/evaluations/self': [Role.EMPLOYEE, Role.HR, Role.MANAGER, Role.ADMIN],
  '/reviews/self': [Role.EMPLOYEE, Role.HR, Role.MANAGER, Role.ADMIN],
  '/departments': [Role.ADMIN, Role.HR, Role.MANAGER],
  '/reports': [Role.ADMIN, Role.HR],
  '/my-pay': [Role.EMPLOYEE, Role.HR, Role.MANAGER],
  '/my-performance': [Role.EMPLOYEE, Role.HR, Role.MANAGER],
  '/users': [Role.ADMIN, Role.HR],
  '/permissions': [Role.ADMIN, Role.HR],
  '/settings': [Role.ADMIN, Role.HR],
  '/audit': [Role.ADMIN, Role.HR],
};

export const canSeeNavItem = (item: NavItemConfig, hasRole: HasRoleFn): boolean => {
  if (item.roles.length === 0) return true;
  return item.roles.some((r) => hasRole(r));
};

/** First sign-in / PIN setup — sidebar shows Dashboard only until setup completes. */
export const applyDashboardOnlyNav = (sections: NavSectionConfig[]): NavSectionConfig[] =>
  sections
    .filter((section) => section.title === 'Home')
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.path === '/dashboard'),
    }))
    .filter((section) => section.items.length > 0);

export const filterNavSections = (
  hasRole: HasRoleFn,
  isPathVisible?: (path: string, search?: string) => boolean,
  hasPermission?: (key: string) => boolean,
  userRole?: Role,
  options?: { dashboardOnly?: boolean }
): NavSectionConfig[] => {
  const filtered = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (isAdminRole(userRole) && section.title === 'Self Service') {
          if (!ADMIN_SELF_SERVICE_NAV_KEYS.has(item.navKey)) return false;
        }
        if (isAdminRole(userRole)) {
          if (!canSeeNavItem(item, hasRole)) return false;
          if (
            item.permKey &&
            hasPermission &&
            !hasPermission(item.permKey)
          ) {
            return false;
          }
          return true;
        }
        if (isPathVisible) {
          if (
            hasPermission &&
            (item.navKey === 'mgmt-employees' || item.navKey === 'mgmt-payroll') &&
            hasOffboardingStageAccess({ hasPermission, userRole })
          ) {
            return true;
          }
          if (item.navKey === 'mgmt-payroll') {
            if (!hasPermission) return false;
            const canSeePayrollNav =
              canAccessFullPayrollModule(hasPermission) ||
              canAccessPayrollApprovals(hasPermission);
            if (!canSeePayrollNav) return false;
            return isPathVisible('/payroll') || isPathVisible('/payroll/approvals');
          }
          if (!isPathVisible(item.path, item.search)) return false;
          if (
            item.permKey &&
            hasPermission &&
            !hasPermission(item.permKey)
          ) {
            return false;
          }
          return true;
        }
        if (!canSeeNavItem(item, hasRole)) return false;
        if (
          item.permKey &&
          hasPermission &&
          !hasPermission(item.permKey)
        ) {
          return false;
        }
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  return options?.dashboardOnly ? applyDashboardOnlyNav(filtered) : filtered;
};

/** Footer items (e.g. Settings) — not scrolled with sections; no admin self-service key filter. */
export const filterSidebarFooterItems = (
  hasRole: HasRoleFn,
  isPathVisible?: (path: string, search?: string) => boolean,
  hasPermission?: (key: string) => boolean,
  dashboardOnly?: boolean,
  userRole?: Role
): NavItemConfig[] => {
  if (dashboardOnly) return [];
  return sidebarFooterNavItems.filter((item) => {
    if (isAdminRole(userRole)) {
      if (
        item.permKey &&
        hasPermission &&
        !hasPermission(item.permKey)
      ) {
        return false;
      }
      return true;
    }
    if (isPathVisible) {
      if (!isPathVisible(item.path, item.search)) return false;
      if (
        item.permKey &&
        hasPermission &&
        !hasPermission(item.permKey)
      ) {
        return false;
      }
      return true;
    }
    if (!canSeeNavItem(item, hasRole)) return false;
    if (
      item.permKey &&
      hasPermission &&
      !hasPermission(item.permKey)
    ) {
      return false;
    }
    return true;
  });
};

function normalizeSearch(search: string): string {
  return search.startsWith('?') ? search.slice(1) : search;
}

function normalizePath(path: string): string {
  return path.replace(/\/$/, '') || '/';
}

/** True when another sub-item lives under this path (e.g. /payroll vs /payroll/rules). */
function moduleSidebarChildUsesEnd(
  child: ModuleSidebarChild,
  peers: ModuleSidebarChild[]
): boolean {
  const childPath = normalizePath(child.path);
  return peers.some((peer) => {
    if (peer.navKey === child.navKey) return false;
    const peerPath = normalizePath(peer.path);
    return peerPath.startsWith(`${childPath}/`);
  });
}

function moduleSidebarChildPathMatch(
  child: ModuleSidebarChild,
  locPath: string,
  peers: ModuleSidebarChild[]
): boolean {
  const childPath = normalizePath(child.path);

  // Onboarding is the canonical employee-list entry: highlight it for the list,
  // the new/edit wizard, and the bare /employees route (but not movements/offboarding).
  if (childPath === '/employees/onboarding') {
    return (
      locPath === '/employees' ||
      locPath === '/employees/onboarding' ||
      locPath.startsWith('/employees/onboarding/') ||
      (locPath.startsWith('/employees/') &&
        !locPath.startsWith('/employees/offboarding') &&
        !locPath.startsWith('/employees/movements'))
    );
  }

  // Payroll run detail tabs (August 2026, etc.) keep Overview selected when that
  // child exists — whether opened as `/payroll/runs/:id` or `/payroll/approvals/:id`.
  // Approver-only users (no Overview child) still highlight Payroll Approval on detail.
  const payrollRunDetail =
    locPath.startsWith('/payroll/runs/') || /^\/payroll\/approvals\/[^/]+$/.test(locPath);
  const hasPayrollOverview = peers.some((p) => normalizePath(p.path) === '/payroll');
  if (childPath === '/payroll') {
    return locPath === '/payroll' || payrollRunDetail;
  }
  if (childPath === '/payroll/approvals') {
    if (locPath === '/payroll/approvals') return true;
    if (payrollRunDetail) return !hasPayrollOverview;
    return false;
  }

  if (moduleSidebarChildUsesEnd(child, peers)) {
    return locPath === childPath;
  }

  return locPath === childPath || locPath.startsWith(`${childPath}/`);
}

/** Match location search to a sub-menu item (`tab`, `scope`, etc.). */
export function isModuleSidebarChildActive(
  child: ModuleSidebarChild,
  pathname: string,
  search: string,
  peers: ModuleSidebarChild[] = []
): boolean {
  const locPath = normalizePath(pathname);

  if (!moduleSidebarChildPathMatch(child, locPath, peers)) return false;

  const childParams = new URLSearchParams(normalizeSearch(child.search ?? ''));
  const locParams = new URLSearchParams(normalizeSearch(search));

  // Peers on the same path (e.g. attendance settingsTab / performance tab): every
  // discriminating query key used by any peer must match exactly (missing = '').
  const samePathPeers = peers.filter(
    (peer) => normalizePath(peer.path) === normalizePath(child.path)
  );
  if (samePathPeers.length > 1) {
    const keys = new Set<string>();
    for (const peer of samePathPeers) {
      for (const key of new URLSearchParams(normalizeSearch(peer.search ?? '')).keys()) {
        keys.add(key);
      }
    }
    for (const key of keys) {
      if ((childParams.get(key) ?? '') !== (locParams.get(key) ?? '')) return false;
    }
    return true;
  }

  for (const key of childParams.keys()) {
    if (locParams.get(key) !== childParams.get(key)) return false;
  }
  // Child without query constraints stays active for any search on that path
  // (e.g. Payroll rules remains selected for ?tab=tax|nssf|…).
  return true;
}

export { moduleSidebarChildUsesEnd };

/** NavLink active state; honors `scope` on items that share a path (self vs management). */
export const isNavItemActive = (item: NavItemConfig, pathname: string, search: string): boolean => {
  const itemPath = item.path;
  const pathMatch =
    itemPath === '/profile'
      ? pathname === '/profile'
      : pathname === itemPath || pathname.startsWith(`${itemPath}/`);
  if (!pathMatch) return false;

  const itemScope = parseNavItemScope(item.search);
  const locParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const locScope = locParams.get('scope');

  if (itemScope) return locScope === itemScope;
  return !locScope;
};

export const canAccessPath = (
  pathname: string,
  userRole: Role | undefined,
  hasRole: HasRoleFn,
  routeGuards: Record<string, Role[]> = ROUTE_ROLE_GUARDS,
  search = '',
  isPathVisible?: (path: string, search?: string) => boolean
): boolean => {
  if (!userRole) return false;
  if (isAdminBlockedFromSelfServiceRoute(pathname, search, userRole)) return false;
  if (isAdminRole(userRole)) return true;

  if (isPathVisible && isCatalogMenuPath(pathname)) {
    if (isPathVisible(pathname, search)) return true;
  }

  const normalized = pathname.replace(/\/$/, '') || '/';
  const guardKey = Object.keys(routeGuards)
    .filter((key) => normalized === key || normalized.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0];

  if (!guardKey) return true;
  return hasRole(routeGuards[guardKey]);
};
