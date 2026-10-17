import { useLocation } from 'react-router-dom';
import { canonicalWorkspaceTabId } from '../utils/workspaceTabs';

/** Canonical workspace tab id for the current URL (pathname + scope, not in-page `tab`). */
export function useWorkspaceTabId(): string {
  const location = useLocation();
  return canonicalWorkspaceTabId(location.pathname, location.search);
}
