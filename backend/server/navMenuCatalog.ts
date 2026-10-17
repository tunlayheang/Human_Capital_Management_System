import { isAdminRole } from './adminNavScope.js';

/** Sidebar menu catalog — keep in sync with frontend `config/navMenuCatalog.ts`. */
export type NavMenuCatalogItem = {
  path: string;
  search?: string;
  label: string;
  section: string;
  /** Empty = all staff roles except Admin self-service (Admin: Profile + Chat only). */
  defaultRoles: string[];
  /** Cannot be enabled for non-admin roles. */
  adminOnly?: boolean;
};

export const ROLE_MENU_SETTING_KEY = 'role_menu_visibility';

const normalizeSearch = (search?: string): string => {
  if (!search) return '';
  return search.startsWith('?') ? search : `?${search}`;
};

export const menuItemKey = (item: { path: string; search?: string }): string =>
  `${item.path}${normalizeSearch(item.search)}`;

/** One row per sidebar main module — sub-features inherit parent visibility. */
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
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/attendance',
    search: '?scope=manage',
    label: 'Attendance',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/leaves',
    search: '?scope=manage',
    label: 'Leaves',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/approvals',
    label: 'Approvals',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/overtime',
    search: '?scope=manage',
    label: 'Overtime',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/performance',
    label: 'Performance',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/projects',
    search: '?scope=manage',
    label: 'Projects',
    section: 'Management',
    // Management portfolio is Manager/Admin — HR uses Self Service → Project only.
    defaultRoles: ['ADMIN', 'MANAGER'],
  },
  { path: '/payroll', label: 'Payroll', section: 'Management', defaultRoles: ['ADMIN', 'HR'] },
  {
    path: '/payroll/approvals',
    label: 'Payroll Approval',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  {
    path: '/departments',
    label: 'Departments',
    section: 'Management',
    defaultRoles: ['ADMIN', 'HR', 'MANAGER'],
  },
  { path: '/reports', label: 'Reports', section: 'Management', defaultRoles: ['ADMIN', 'HR'] },
  {
    path: '/users',
    label: 'User accounts',
    section: 'ADMINISTRATION',
    defaultRoles: ['ADMIN'],
  },
  {
    path: '/permissions',
    label: 'Permissions',
    section: 'ADMINISTRATION',
    defaultRoles: ['ADMIN'],
  },
  {
    path: '/settings',
    label: 'Settings',
    section: 'ADMINISTRATION',
    defaultRoles: ['ADMIN'],
  },
  {
    path: '/audit/logs',
    label: 'Audit Logs',
    section: 'ADMINISTRATION',
    defaultRoles: ['ADMIN'],
  },
  {
    path: '/audit/trail',
    label: 'Audit Trail',
    section: 'ADMINISTRATION',
    defaultRoles: ['ADMIN'],
  },
];

const STAFF_ROLES = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const;
export const MENU_MANAGEABLE_ROLES = ['HR', 'MANAGER', 'EMPLOYEE'] as const;

const catalogByKey = new Map(NAV_MENU_CATALOG.map((item) => [menuItemKey(item), item]));

const LEGACY_SELF_SERVICE_PATHS: Record<string, string> = {
  '/attendance': menuItemKey({ path: '/attendance', search: '?scope=self' }),
  '/leaves': menuItemKey({ path: '/leaves', search: '?scope=self' }),
  '/overtime': menuItemKey({ path: '/overtime', search: '?scope=self' }),
  '/projects': menuItemKey({ path: '/projects', search: '?scope=self' }),
};

/** Admin menu paths (management + Profile/Chat; excludes employee-only payslips). */
export const buildAdminMenuPaths = (): string[] =>
  NAV_MENU_CATALOG.filter((item) => item.path !== '/my-pay').map((i) => menuItemKey(i));

export const pathAllowedByDefault = (pathOrKey: string, role: string): boolean => {
  const item = catalogByKey.get(pathOrKey);
  if (!item) return false;
  const key = menuItemKey(item);
  if (isAdminRole(role)) {
    return buildAdminMenuPaths().includes(key);
  }
  if (item.adminOnly) return false;
  if (item.defaultRoles.length === 0) {
    return STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number]);
  }
  return item.defaultRoles.includes(role);
};

export const buildDefaultRoleMenuConfig = (): Record<string, string[]> => {
  const config: Record<string, string[]> = {};
  for (const role of STAFF_ROLES) {
    config[role] = NAV_MENU_CATALOG.filter((item) => pathAllowedByDefault(menuItemKey(item), role)).map(
      (i) => menuItemKey(i)
    );
  }
  config.ADMIN = buildAdminMenuPaths();
  return config;
};

export type RoleMenuConfigPayload = {
  version: 1;
  roles: Record<string, string[]>;
};

const normalizeStoredMenuKey = (entry: string): string | null => {
  const val = String(entry || '').trim();
  if (!val) return null;
  if (catalogByKey.has(val)) return val;
  return LEGACY_SELF_SERVICE_PATHS[val.split('?')[0]] ?? null;
};

export const sanitizeRoleMenuConfig = (input: unknown): RoleMenuConfigPayload => {
  const defaults = buildDefaultRoleMenuConfig();
  const raw = input && typeof input === 'object' ? (input as RoleMenuConfigPayload) : null;
  const rolesInput = raw?.roles && typeof raw.roles === 'object' ? raw.roles : {};

  const roles: Record<string, string[]> = { ...defaults };

  for (const roleName of MENU_MANAGEABLE_ROLES) {
    if (!Object.prototype.hasOwnProperty.call(rolesInput, roleName)) continue;
    const paths = rolesInput[roleName];
    if (!Array.isArray(paths)) continue;
    const normalized = new Set<string>();
    for (const entry of paths.map((p) => String(p))) {
      const key = normalizeStoredMenuKey(entry);
      if (!key) continue;
      const item = catalogByKey.get(key);
      if (item && !item.adminOnly) normalized.add(key);
    }
    roles[roleName] = Array.from(normalized);
  }

  const mandatoryKeys = [
    menuItemKey({ path: '/dashboard' }),
    menuItemKey({ path: '/profile' }),
    menuItemKey({ path: '/account-settings' }),
    menuItemKey({ path: '/chat' }),
  ];

  for (const roleName of MENU_MANAGEABLE_ROLES) {
    if (!roles[roleName]?.length) {
      roles[roleName] = defaults[roleName];
    }
    for (const key of mandatoryKeys) {
      if (!roles[roleName].includes(key)) {
        roles[roleName].unshift(key);
      }
    }
    if (roleName === 'HR') {
      roles[roleName] = ensureHrInherentMenuPaths(roleName, roles[roleName]);
    } else if (roleName === 'MANAGER') {
      roles[roleName] = ensurePayrollApprovalsPathForRole(
        roleName,
        ensureApprovalsPathForRole(roleName, ensurePerformancePathForRole(roleName, roles[roleName]))
      );
    }
    roles[roleName] = ensureSelfPerformancePathForRole(roleName, roles[roleName]);
  }

  roles.ADMIN = buildAdminMenuPaths();
  return { version: 1, roles };
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
    (item) => item.section === 'Management' && item.defaultRoles.includes('HR')
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

/** HR and Manager always see Approvals when role menu allows management modules. */
export const ensureApprovalsPathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (!APPROVALS_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(APPROVALS_MENU_KEY)) return paths;
  return [...paths, APPROVALS_MENU_KEY];
};

/** HR and Manager always see Performance when role menu allows management modules. */
export const ensurePerformancePathForRole = (role: string, paths: string[]): string[] => {
  const normalized = String(role || '').toUpperCase();
  if (!PERFORMANCE_MENU_ROLES.has(normalized)) return paths;
  if (paths.includes(PERFORMANCE_MENU_KEY)) return paths;
  return [...paths, PERFORMANCE_MENU_KEY];
};

/** HR and Manager always see Payroll Approval when role menu allows management modules. */
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

export const pathsVisibleForRole = (role: string, config: RoleMenuConfigPayload): string[] => {
  if (isAdminRole(role)) {
    return buildAdminMenuPaths();
  }
  const normalized = String(role || '').toUpperCase();
  const base =
    config.roles[normalized] || buildDefaultRoleMenuConfig()[normalized] || [];
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

export const buildRouteGuardsFromConfig = (
  config: RoleMenuConfigPayload
): Record<string, string[]> => {
  const guards: Record<string, string[]> = {};
  for (const item of NAV_MENU_CATALOG) {
    if (item.path === '/dashboard' || item.path === '/profile') continue;
    const key = menuItemKey(item);
    const allowed: string[] = [];
    if (pathsVisibleForRole('ADMIN', config).includes(key)) {
      allowed.push('ADMIN');
    }
    for (const role of MENU_MANAGEABLE_ROLES) {
      if (pathsVisibleForRole(role, config).includes(key)) {
        allowed.push(role);
      }
    }
    if (allowed.length > 0) {
      guards[item.path] = [...new Set([...(guards[item.path] || []), ...allowed])];
    }
  }
  return guards;
};
