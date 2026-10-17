import { normalizeWorkspacePath, normalizeWorkspaceSearch } from './workspaceTabs';

/** Routes that open as overlay modals (not listed in the main sidebar). */
const MODAL_OVERLAY_PATHS = new Set([
  '/approvals/movements',
  '/approvals/evaluations/kpi',
  '/approvals/evaluations/probation',
]);

export function isModalOverlayRoute(pathname: string, search = ''): boolean {
  void search;
  const path = normalizeWorkspacePath(pathname);
  if (MODAL_OVERLAY_PATHS.has(path)) return true;
  if (path.startsWith('/approvals/evaluations/')) return true;
  if (path === '/approvals/movements') return true;
  return false;
}

/** Where the modal should return when closed (no history). */
export function modalOverlayCloseTarget(pathname: string): { pathname: string; search?: string } {
  return { pathname: '/dashboard' };
}

/** Parent route used for workspace tab identity (modal routes do not open their own tab). */
export function modalOverlayWorkspaceAnchor(
  pathname: string,
  search: string
): { pathname: string; search: string } | null {
  if (!isModalOverlayRoute(pathname, search)) return null;
  return { pathname: '/dashboard', search: '' };
}

export function filterModalOverlayTabs<T extends { pathname: string; search: string }>(
  tabs: T[]
): T[] {
  return tabs.filter((tab) => !isModalOverlayRoute(tab.pathname, tab.search));
}
