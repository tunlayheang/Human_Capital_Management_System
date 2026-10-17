import { Role } from '../types';
import { isAdminRole } from '../utils/adminNavScope';

export type NavMenuCatalogItem = {
  path: string;
  search?: string;
  label: string;
  section: string;
  defaultRoles: Role[];
  adminOnly?: boolean;
};

/**
 * One row per sidebar main module — used for API defaults and route guards.
 * Sub-features (tabs, nested routes) inherit visibility from their parent module.
 * Keep in sync with backend `navMenuCatalog.ts` and `navConfig.ts`.
 */
export const NAV_MENU_CATALOG: NavMenuCatalogItem[] = [
  { path: '/dashboard', label: 'Dashboard', section: 'Home', defaultRoles: [] },
  { path: '/personal-analytics', label: 'Personal', section: 'Self Service', defaultRoles: [] },
  { path: '/profile', label: 'Profile', section: 'Self Service', defaultRoles: [] },
  { path: '/account-settings', label: 'Settings', section: 'Self Service', defaultRoles: [] },
  {
    path: '/attendance',
    search: '?scope=self',
    label: 'Attendance',
    section: 'Self Service',
    defaultRoles: [],
  },
  {
    path: '/leaves',
    search: '?scope=self',
    label: 'Leave',
    section: 'Self Service',
    defaultRoles: [],
  },
  {
    path: '/overtime',
    search: '?scope=self',
    label: 'Overtime',
    section: 'Self Service',
    defaultRoles: [],
  },
  { path: '/my-pay', label: 'Payslip', section: 'Self Service', defaultRoles: [] },
  { path: '/my-performance', label: 'My Performance', section: 'Self Service', defaultRoles: [] },
  { path: '/chat', label: 'Chat', section: 'Self Service', defaultRoles: [] },
  {
    path: '/projects',
    search: '?scope=self',
    label: 'Project',
    section: 'Self Service',
    defaultRoles: [],
  },
  {
    path: '/employees',
    label: 'Employees',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/attendance',
    search: '?scope=manage',
    label: 'Attendance',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/leaves',
    search: '?scope=manage',
    label: 'Leaves',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/approvals',
    label: 'Approvals',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/overtime',
    search: '?scope=manage',
    label: 'Overtime',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/performance',
    label: 'Performance',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/projects',
    search: '?scope=manage',
    label: 'Projects',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  { path: '/payroll', label: 'Payroll', section: 'Management', defaultRoles: [Role.ADMIN, Role.HR] },
  {
    path: '/payroll/approvals',
    label: 'Payroll Approval',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  {
    path: '/departments',
    label: 'Departments',
    section: 'Management',
    defaultRoles: [Role.ADMIN, Role.HR, Role.MANAGER],
  },
  { path: '/reports', label: 'Reports', section: 'Management', defaultRoles: [Role.ADMIN, Role.HR] },
  {
    path: '/users',
    label: 'User accounts',
    section: 'ADMINISTRATION',
    defaultRoles: [Role.ADMIN, Role.HR],
  },
  {
    path: '/permissions',
    label: 'Permissions',
    section: 'ADMINISTRATION',
    defaultRoles: [Role.ADMIN, Role.HR],
  },
  {
    path: '/settings',
    label: 'Settings',
    section: 'ADMINISTRATION',
    defaultRoles: [Role.ADMIN, Role.HR],
  },
  {
    path: '/audit/logs',
    label: 'Audit Logs',
    section: 'ADMINISTRATION',
    defaultRoles: [Role.ADMIN, Role.HR],
  },
  {
    path: '/audit/trail',
    label: 'Audit Trail',
    section: 'ADMINISTRATION',
    defaultRoles: [Role.ADMIN, Role.HR],
  },
];

export const MENU_MANAGEABLE_ROLES = [Role.HR, Role.MANAGER, Role.EMPLOYEE] as const;

const STAFF_ROLES = [Role.ADMIN, Role.HR, Role.MANAGER, Role.EMPLOYEE] as const;

const normalizeSearch = (search?: string): string => {
  if (!search) return '';
  return search.startsWith('?') ? search : `?${search}`;
};

export const menuItemKey = (item: { path: string; search?: string }): string =>
  `${item.path}${normalizeSearch(item.search)}`;

const catalogByKey = new Map(NAV_MENU_CATALOG.map((item) => [menuItemKey(item), item]));

/** Legacy saved configs used bare paths for self-service modules. */
const LEGACY_SELF_SERVICE_PATHS: Record<string, string> = {
  '/attendance': menuItemKey({ path: '/attendance', search: '?scope=self' }),
  '/leaves': menuItemKey({ path: '/leaves', search: '?scope=self' }),
  '/overtime': menuItemKey({ path: '/overtime', search: '?scope=self' }),
  '/projects': menuItemKey({ path: '/projects', search: '?scope=self' }),
};

/** Routes not in the catalog but allowed when a parent menu path is visible. */
export const MENU_PATH_ALIASES: Record<string, string> = {
  '/tasks': '/projects',
  '/notifications': '/dashboard',
  '/payroll/runs': '/payroll',
  '/payroll/calendar': '/payroll',
  '/payroll/rules': '/payroll',
  '/employees/onboarding': '/employees',
  '/employees/offboarding': '/employees',
  '/my-performance-reviews': '/my-performance',
  '/approvals/appraisals': '/approvals',
  '/approvals/movements': '/approvals',
  '/approvals/probation': '/approvals',
  '/approvals/evaluations/kpi': '/approvals',
  '/approvals/evaluations/probation': '/approvals',
  '/approvals/evaluations/self': '/my-performance',
  '/reviews': '/approvals',
  '/reviews/kpi': '/approvals',
  '/reviews/probation': '/approvals',
  '/reviews/self': '/my-performance',
};

/** Admin menu paths — keep in sync with backend `navMenuCatalog.buildAdminMenuPaths`. */
export const buildAdminMenuPaths = (): string[] =>
  NAV_MENU_CATALOG.filter((item) => item.path !== '/my-pay').map((i) => menuItemKey(i));

export const pathAllowedByDefault = (pathOrKey: string, role: string): boolean => {
  const item = catalogByKey.get(pathOrKey);
  if (!item) return false;
  const r = String(role || '').toUpperCase();
  const key = menuItemKey(item);
  if (isAdminRole(r)) {
    return buildAdminMenuPaths().includes(key);
  }
  if (item.adminOnly) return false;
  if (item.defaultRoles.length === 0) {
    return STAFF_ROLES.some((sr) => String(sr).toUpperCase() === r);
  }
  return item.defaultRoles.some((dr) => String(dr).toUpperCase() === r);
};

export const buildDefaultRoleMenuConfig = (): Record<string, string[]> => {
  const config: Record<string, string[]> = {};
  for (const role of STAFF_ROLES) {
    const roleKey = String(role).toUpperCase();
    config[roleKey] = NAV_MENU_CATALOG.filter((item) => pathAllowedByDefault(menuItemKey(item), roleKey))
      .map((i) => menuItemKey(i));
  }
  config.ADMIN = buildAdminMenuPaths();
  return config;
};

/** Default sidebar paths for a role (used while menu API loads or on error). */
export const getDefaultPathsForRole = (role: string | undefined): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (isAdminRole(normalized)) return buildAdminMenuPaths();
  return buildDefaultRoleMenuConfig()[normalized] || [];
};

export type RoleMenuConfigPayload = {
  version: 1;
  roles: Record<string, string[]>;
};

const PERFORMANCE_MENU_KEY = menuItemKey({ path: '/performance' });
const APPROVALS_MENU_KEY = menuItemKey({ path: '/approvals' });
const PAYROLL_APPROVALS_MENU_KEY = menuItemKey({ path: '/payroll/approvals' });
const SELF_PERFORMANCE_MENU_KEY = menuItemKey({ path: '/my-performance' });
const PERFORMANCE_MENU_ROLES = new Set(['HR', 'MANAGER']);
const APPROVALS_MENU_ROLES = new Set(['HR', 'MANAGER']);
const PAYROLL_APPROVALS_MENU_ROLES = new Set(['HR', 'MANAGER']);
const SELF_PERFORMANCE_MENU_ROLES = new Set(['HR', 'MANAGER', 'EMPLOYEE']);

/** Management modules HR always sees — matches catalog `defaultRoles` for HR. */
export const getHrDefaultManagementMenuKeys = (): string[] =>
  NAV_MENU_CATALOG.filter(
    (item) =>
      item.section === 'Management' &&
      item.defaultRoles.some((r) => String(r).toUpperCase() === 'HR')
  ).map((item) => menuItemKey(item));

/** HR always retains default management sidebar modules (not revocable via Permissions → Menu). */
export const ensureHrInherentMenuPaths = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (normalized !== 'HR') return paths;
  const merged = new Set(paths);
  for (const key of getHrDefaultManagementMenuKeys()) {
    merged.add(key);
  }
  return ensurePerformancePathForRole(normalized, Array.from(merged));
};

/** HR and Manager always see Approvals when permitted by role menu config. */
export const ensureApprovalsPathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (!APPROVALS_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(APPROVALS_MENU_KEY)) return paths;
  return [...paths, APPROVALS_MENU_KEY];
};

/** HR and Manager always see Performance when permitted by role menu config. */
export const ensurePerformancePathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (!PERFORMANCE_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(PERFORMANCE_MENU_KEY)) return paths;
  return [...paths, PERFORMANCE_MENU_KEY];
};

/** HR and Manager always see Payroll Approval when permitted by role menu config. */
export const ensurePayrollApprovalsPathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (!PAYROLL_APPROVALS_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(PAYROLL_APPROVALS_MENU_KEY)) return paths;
  return [...paths, PAYROLL_APPROVALS_MENU_KEY];
};

/** All staff roles always see Self Service → Performance (employee self-evaluations). */
export const ensureSelfPerformancePathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (isAdminRole(normalized)) return paths;
  if (!SELF_PERFORMANCE_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(SELF_PERFORMANCE_MENU_KEY)) return paths;
  return [...paths, SELF_PERFORMANCE_MENU_KEY];
};

export const pathsVisibleForRole = (
  role: string,
  config?: RoleMenuConfigPayload | null
): string[] => {
  if (isAdminRole(role)) return buildAdminMenuPaths();
  const normalized = String(role || '').toUpperCase();
  const fromConfig = config?.roles?.[normalized];
  const base = fromConfig?.length ? fromConfig : getDefaultPathsForRole(normalized);
  if (normalized === 'HR') {
    return ensureSelfPerformancePathForRole(
      normalized,
      ensureApprovalsPathForRole(normalized, ensureHrInherentMenuPaths(normalized, base))
    );
  }
  return ensureSelfPerformancePathForRole(
    normalized,
    ensurePayrollApprovalsPathForRole(
      normalized,
      ensureApprovalsPathForRole(normalized, ensurePerformancePathForRole(normalized, base))
    )
  );
};

/** Map a URL to its catalog path (e.g. `/payroll/runs` → `/payroll`). */
export const resolveCatalogBasePath = (pathname: string): string | null => {
  const normalized = pathname.replace(/\/$/, '') || '/';
  const alias = MENU_PATH_ALIASES[normalized];
  if (alias) return alias;

  const matches = NAV_MENU_CATALOG.map((i) => i.path)
    .filter((p) => normalized === p || normalized.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length);

  return matches[0] ?? null;
};

export const isCatalogMenuPath = (pathname: string): boolean =>
  resolveCatalogBasePath(pathname) !== null;

/** Resolve a URL to the catalog key that controls its parent module visibility. */
export const resolveCatalogMenuKey = (pathname: string, search = ''): string | null => {
  const basePath = resolveCatalogBasePath(pathname);
  if (!basePath) return null;

  const normalizedSearch = normalizeSearch(search);
  const exact = menuItemKey({ path: basePath, search: normalizedSearch });
  if (catalogByKey.has(exact)) return exact;

  if (normalizedSearch) {
    const params = new URLSearchParams(normalizedSearch.replace(/^\?/, ''));
    const scope = params.get('scope');
    if (scope) {
      const scopeKey = menuItemKey({ path: basePath, search: `?scope=${scope}` });
      if (catalogByKey.has(scopeKey)) return scopeKey;
    }
    if (!scope && params.get('tab')) {
      const tabKey = menuItemKey({ path: basePath, search: `?tab=${params.get('tab')}` });
      if (catalogByKey.has(tabKey)) return tabKey;
    }
  }

  if (!normalizedSearch) {
    return menuItemKey({ path: basePath });
  }

  return null;
};

/** Normalize stored menu keys from older configs (path-only self-service entries). */
export const normalizeStoredMenuKey = (entry: string): string | null => {
  const val = String(entry || '').trim();
  if (!val) return null;
  if (catalogByKey.has(val)) return val;
  return LEGACY_SELF_SERVICE_PATHS[val.split('?')[0]] ?? null;
};
