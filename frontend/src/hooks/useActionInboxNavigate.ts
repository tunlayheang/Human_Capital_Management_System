import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceTabsOptional } from '../context/WorkspaceTabsContext';
import { isModalOverlayRoute } from '../utils/modalOverlayRoutes';
import { splitNavigateTarget } from '../utils/reviewNavigation';
import { normalizeWorkspacePath, normalizeWorkspaceSearch } from '../utils/workspaceTabs';

const SELF_EVALUATION_PATHS = new Set(['/approvals/evaluations/self', '/reviews/self']);

function resolveInboxPath(pathname: string): string {
  const path = normalizeWorkspacePath(pathname);
  if (SELF_EVALUATION_PATHS.has(path)) return '/my-performance';
  return path;
}

function navigateMyPerformance(
  navigate: ReturnType<typeof useNavigate>,
  workspace: ReturnType<typeof useWorkspaceTabsOptional>,
  pathname: string,
  search: string
) {
  const searchNorm = normalizeWorkspaceSearch(search || '?tab=action');
  if (workspace?.enabled) {
    workspace.openTab(pathname, searchNorm);
    return;
  }
  navigate({ pathname, search: searchNorm || undefined });
}

/** Navigate to action-inbox modal routes without opening a workspace tab. */
export function useActionInboxNavigate() {
  const navigate = useNavigate();
  const workspace = useWorkspaceTabsOptional();

  const openInbox = useCallback(
    (target: string) => {
      const { pathname: rawPath, search: rawSearch } = splitNavigateTarget(target);
      const path = resolveInboxPath(rawPath);
      const searchNorm = normalizeWorkspaceSearch(rawSearch);
      if (path === '/approvals') {
        navigate('/dashboard');
        return;
      }
      if (path === '/my-performance') {
        navigateMyPerformance(navigate, workspace, path, searchNorm || '?tab=action');
        return;
      }
      if (workspace?.enabled && isModalOverlayRoute(rawPath, searchNorm)) {
        workspace.navigateOverlay(rawPath, searchNorm);
        return;
      }
      navigate({ pathname: path, search: searchNorm || undefined });
    },
    [navigate, workspace]
  );

  return { openInbox, navigate };
}
