export function normalizeWorkspacePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Stable, order-independent query string (e.g. `?scope=manage&tab=overview`). */
export function normalizeWorkspaceSearch(search: string): string {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return '';
  const params = new URLSearchParams(raw);
  const sorted = new URLSearchParams();
  [...params.keys()]
    .sort()
    .forEach((key) => {
      const value = params.get(key);
      if (value != null) sorted.set(key, value);
    });
  const body = sorted.toString();
  return body ? `?${body}` : '';
}

/** Full location id (pathname + all query params). */
export function workspaceTabId(pathname: string, search: string): string {
  const path = normalizeWorkspacePath(pathname);
  const q = normalizeWorkspaceSearch(search);
  return `${path}${q}`;
}

/**
 * Routes that use `?tab=` for in-page sections share one workspace tab per path + scope.
 * Prevents duplicate "Projects" (etc.) tabs when switching Overview / Timeline inside the page.
 */
const MERGE_INTERNAL_TAB_PATHS = new Set([
  '/projects',
  '/attendance',
  '/leaves',
  '/overtime',
  '/payroll',
  '/payroll/rules',
  '/permissions',
  '/employees',
  '/departments',
  '/settings',
  '/performance',
  /** Selecting a report uses `?report=` — keep one workspace tab and update its title. */
  '/reports/catalog',
]);

/** Shared routes where bare path redirects to a `scope` query (e.g. admin `/projects` → `?scope=manage`). */
const SCOPE_SPLIT_PATHS = new Set(['/projects', '/attendance']);

function routeScopeFromSearch(search: string): string | null {
  const params = new URLSearchParams(normalizeWorkspaceSearch(search).slice(1));
  const scope = params.get('scope');
  return scope === 'self' || scope === 'manage' ? scope : null;
}

/** Deep-link / in-page params that must not create extra workspace tabs. */
const EPHEMERAL_TAB_PARAMS = [
  'tab',
  'section',
  'companyTab',
  'settingsTab',
  /** Project deep links — details open in-page on `/projects`. */
  'project',
  'task',
  /** Performance evaluation / approval entity deep links + Evaluation/Approval mode. */
  'appraisalId',
  'userId',
  'reviewId',
  'view',
] as const;

export function stripInternalTabParam(pathname: string, search: string): string {
  const path = normalizeWorkspacePath(pathname);
  if (!MERGE_INTERNAL_TAB_PATHS.has(path)) return normalizeWorkspaceSearch(search);
  const q = normalizeWorkspaceSearch(search);
  if (!q) return '';
  const params = new URLSearchParams(q.slice(1));
  // In-page section switchers — keep one workspace tab per module path (+ scope).
  for (const key of EPHEMERAL_TAB_PARAMS) {
    params.delete(key);
  }
  if (path === '/reports/catalog') {
    params.delete('report');
  }
  const body = params.toString();
  return body ? `?${body}` : '';
}

export type WorkspaceTabTitleSource = {
  id: string;
  pathname: string;
  search: string;
  title: string;
};

/** Hint used when two open tabs would otherwise share the same label. */
export function workspaceTabTitleDisambiguator(tab: WorkspaceTabTitleSource): string {
  const params = new URLSearchParams(normalizeWorkspaceSearch(tab.search).slice(1));
  const scope = params.get('scope');
  if (scope === 'self') return 'My';
  if (scope === 'manage') return 'Team';
  if (params.get('view') === 'approval') return 'Approval';

  const segments = normalizeWorkspacePath(tab.pathname).split('/').filter(Boolean);
  if (segments.length >= 2) {
    const leaf = segments[segments.length - 1];
    if (leaf && !/^[0-9a-f-]{8,}$/i.test(leaf)) {
      return leaf
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
    const parent = segments[segments.length - 2];
    if (parent) {
      return parent.charAt(0).toUpperCase() + parent.slice(1);
    }
  }
  if (segments[0]) {
    return segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  }
  return 'Tab';
}

/**
 * Ensure visible workspace tab labels are unique when distinct routes collide
 * (e.g. same project title on self vs manage scope).
 */
export function withUniqueWorkspaceTabTitles<T extends WorkspaceTabTitleSource>(tabs: T[]): T[] {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    const key = tab.title.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const claimed = new Map<string, number>();
  return tabs.map((tab) => {
    const key = tab.title.trim().toLowerCase();
    if (!key || (counts.get(key) ?? 0) <= 1) return tab;

    let next = `${tab.title} · ${workspaceTabTitleDisambiguator(tab)}`;
    const nextKey = next.trim().toLowerCase();
    const times = (claimed.get(nextKey) ?? 0) + 1;
    claimed.set(nextKey, times);
    if (times > 1) next = `${next} ${times}`;
    return { ...tab, title: next };
  });
}

/** Workspace tab identity — one tab per distinct pathname + query (incl. sidebar sub-pages). */
export function canonicalWorkspaceTabId(pathname: string, search: string): string {
  const path = normalizeWorkspacePath(pathname);
  const q = stripInternalTabParam(path, search);
  return `${path}${q}`;
}

export function canonicalTabIdsMatch(
  aPath: string,
  aSearch: string,
  bPath: string,
  bSearch: string
): boolean {
  return canonicalWorkspaceTabId(aPath, aSearch) === canonicalWorkspaceTabId(bPath, bSearch);
}

/** Dashboard is the home surface — not shown as a workspace tab. */
export function isDashboardRoute(pathname: string, search = ''): boolean {
  void search;
  return normalizeWorkspacePath(pathname) === '/dashboard';
}

export function isWorkspaceTabRoute(pathname: string, search = ''): boolean {
  return !isDashboardRoute(pathname, search);
}

/** Routes where an async entity name may override the default sidebar/page title. */
export function allowsCustomWorkspaceTabTitle(pathname: string): boolean {
  const path = normalizeWorkspacePath(pathname);
  if (/^\/departments\/[^/]+$/.test(path)) return true;
  if (/^\/payroll\/runs\/[^/]+$/.test(path)) return true;
  if (path.includes('/employees/offboarding/payment')) return true;
  if (path.includes('/employees/offboarding/wizard')) return true;
  if (path.includes('/employees/movements/wizard')) return true;
  if (path.includes('/employees/card/')) return true;
  if (/\/employees\/[^/]+\/edit$/.test(path) || path.includes('/employees/edit/')) return true;
  if (path.includes('/employees/onboarding/new') || path.endsWith('/employees/new')) return true;
  return false;
}

/** Bumped when canonical tab identity / title rules change so stale tabs are cleared. */
export const WORKSPACE_TABS_STORAGE_KEY = 'hcms.workspace.tabs.v4';
export const MAX_WORKSPACE_TABS = 16;
