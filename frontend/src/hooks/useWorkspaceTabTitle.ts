import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspaceTabsOptional } from '../context/WorkspaceTabsContext';
import { allowsCustomWorkspaceTabTitle } from '../utils/workspaceTabs';

/**
 * Push an entity-specific title onto the matching workspace tab (e.g. department name).
 * Ignored on module/list routes so the tab keeps the sidebar label.
 */
export function useWorkspaceTabTitle(title: string | null | undefined): void {
  const { pathname, search } = useLocation();
  const workspace = useWorkspaceTabsOptional();
  const normalized = title?.trim() ?? '';
  const allowCustom = allowsCustomWorkspaceTabTitle(pathname);

  useEffect(() => {
    if (!workspace?.enabled) return;
    if (!allowCustom) {
      workspace.resetTabTitle(pathname, search);
      return;
    }
    if (normalized) {
      workspace.updateTabTitle(pathname, search, normalized);
    } else {
      workspace.resetTabTitle(pathname, search);
    }
  }, [workspace, pathname, search, normalized, allowCustom]);
}
