import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceTabsOptional } from '../context/WorkspaceTabsContext';
import { isModalOverlayRoute } from '../utils/modalOverlayRoutes';
import { normalizeWorkspacePath, normalizeWorkspaceSearch } from '../utils/workspaceTabs';

/** Navigate or open a desktop workspace tab (tabs disabled on phone/tablet). */
export function useWorkspaceNavigate() {
  const navigate = useNavigate();
  const workspace = useWorkspaceTabsOptional();

  const goTo = useCallback(
    (pathname: string, search?: string) => {
      const s = search ?? '';
      const searchNorm = normalizeWorkspaceSearch(s);
      const path = normalizeWorkspacePath(pathname);
      if (path === '/approvals') {
        navigate('/dashboard');
        return;
      }
      if (workspace?.enabled) {
        if (isModalOverlayRoute(pathname, searchNorm)) {
          workspace.navigateOverlay(pathname, searchNorm);
          return;
        }
        workspace.openTab(pathname, s);
        return;
      }
      navigate({ pathname, search: searchNorm || undefined });
    },
    [navigate, workspace]
  );

  return {
    goTo,
    navigate,
    tabsEnabled: Boolean(workspace?.enabled),
  };
}
