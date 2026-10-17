// @refresh reset
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from './LanguageContext';
import { useModuleSidebarContext } from '../hooks/useModuleSidebarContext';
import {
  MAX_WORKSPACE_TABS,
  WORKSPACE_TABS_STORAGE_KEY,
  canonicalTabIdsMatch,
  canonicalWorkspaceTabId,
  isDashboardRoute,
  normalizeWorkspacePath,
  normalizeWorkspaceSearch,
  withUniqueWorkspaceTabTitles,
  allowsCustomWorkspaceTabTitle,
} from '../utils/workspaceTabs';
import { clearWorkspaceTabState } from '../utils/workspaceTabStateStore';
import { resolveWorkspaceTabLabel } from '../utils/workspaceTabLabel';
import { isModalOverlayRoute, filterModalOverlayTabs } from '../utils/modalOverlayRoutes';
import {
  shouldPromptLeaveNavigation,
  tryLeaveWithUnsavedChanges,
} from '../utils/unsavedChangesGuard';

export type WorkspaceTab = {
  id: string;
  pathname: string;
  search: string;
  title: string;
  /** When true, location sync keeps this title until resetTabTitle is called. */
  customTitle?: boolean;
};

type WorkspaceTabsContextValue = {
  enabled: boolean;
  /** Tabs shown in the bar (never includes Dashboard). */
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  openTab: (pathname: string, search?: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (fromTabId: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (dragId: string, targetId: string, insertAfter: boolean) => void;
  /** Set display title for the tab matching pathname + search (e.g. entity name on detail pages). */
  updateTabTitle: (pathname: string, search: string, title: string) => void;
  resetTabTitle: (pathname: string, search: string) => void;
  /** Open a modal overlay route without adding or switching workspace tabs. */
  navigateOverlay: (pathname: string, search?: string) => void;
};

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(null);

function withoutDashboard(tabList: WorkspaceTab[]): WorkspaceTab[] {
  return filterModalOverlayTabs(withoutDashboardOnly(tabList));
}

function withoutDashboardOnly(tabList: WorkspaceTab[]): WorkspaceTab[] {
  return tabList.filter((tab) => !isDashboardRoute(tab.pathname, tab.search));
}

function preferScopedWorkspaceTab(a: WorkspaceTab, b: WorkspaceTab): WorkspaceTab {
  const scopeA = new URLSearchParams(normalizeWorkspaceSearch(a.search).slice(1)).get('scope');
  const scopeB = new URLSearchParams(normalizeWorkspaceSearch(b.search).slice(1)).get('scope');
  if (scopeA && !scopeB) return a;
  if (scopeB && !scopeA) return b;
  return a;
}

/** One workspace tab per canonical route; keeps the latest search string. */
function dedupeWorkspaceTabs(tabList: WorkspaceTab[], preferActiveId: string | null): WorkspaceTab[] {
  const result: WorkspaceTab[] = [];
  for (const tab of tabList) {
    const idx = result.findIndex((existing) =>
      canonicalTabIdsMatch(existing.pathname, existing.search, tab.pathname, tab.search)
    );
    if (idx < 0) {
      result.push({
        ...tab,
        id: canonicalWorkspaceTabId(tab.pathname, tab.search),
      });
      continue;
    }
    const existing = result[idx];
    const pick =
      tab.id === preferActiveId
        ? tab
        : existing.id === preferActiveId
          ? existing
          : preferScopedWorkspaceTab(tab, existing);
    result[idx] = {
      ...pick,
      id: canonicalWorkspaceTabId(pick.pathname, pick.search),
    };
  }
  return result;
}

function loadStoredTabs(): { tabs: WorkspaceTab[]; activeTabId: string | null } | null {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs: WorkspaceTab[]; activeTabId: string | null };
    if (!Array.isArray(parsed.tabs)) return null;
    const preferId = parsed.activeTabId ?? null;
    const tabs = filterModalOverlayTabs(
      dedupeWorkspaceTabs(withoutDashboard(parsed.tabs), preferId)
    );
    const activeTabId =
      preferId && tabs.some((t) => t.id === preferId)
        ? preferId
        : tabs[0]?.id ?? null;
    return { tabs, activeTabId };
  } catch {
    return null;
  }
}

type ProviderProps = {
  children: React.ReactNode;
  /** Desktop only — false on phone/tablet compact layout */
  enabled: boolean;
};

export const WorkspaceTabsProvider: React.FC<ProviderProps> = ({ children, enabled }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const moduleCtx = useModuleSidebarContext();
  const suppressSyncRef = useRef(false);

  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    if (!enabled) return [];
    return loadStoredTabs()?.tabs ?? [];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    if (!enabled) return null;
    return loadStoredTabs()?.activeTabId ?? null;
  });

  const defaultTabTitle = useCallback(
    (pathname: string, search: string) =>
      resolveWorkspaceTabLabel(pathname, normalizeWorkspaceSearch(search), t, moduleCtx),
    [t, moduleCtx]
  );

  const makeTab = useCallback(
    (pathname: string, search: string, existing?: WorkspaceTab | null): WorkspaceTab => {
      const searchNorm = normalizeWorkspaceSearch(search);
      const id = canonicalWorkspaceTabId(pathname, searchNorm);
      const path = normalizeWorkspacePath(pathname);
      // Keep entity names (department, employee wizard, …) only — never in-page segment labels.
      const preserveCustom =
        allowsCustomWorkspaceTabTitle(path) &&
        Boolean(existing?.customTitle && existing.title.trim());
      const title = preserveCustom
        ? existing!.title
        : defaultTabTitle(pathname, searchNorm);
      return {
        id,
        pathname,
        search: searchNorm,
        title,
        customTitle: preserveCustom ? true : undefined,
      };
    },
    [defaultTabTitle]
  );

  const findTabByLocation = useCallback((list: WorkspaceTab[], pathname: string, search: string) => {
    return list.find((tab) => canonicalTabIdsMatch(tab.pathname, tab.search, pathname, search));
  }, []);

  const persist = useCallback((nextTabs: WorkspaceTab[], nextActive: string | null) => {
    if (!enabled) return;
    const visible = withoutDashboard(nextTabs);
    const active =
      nextActive && visible.some((t) => t.id === nextActive) ? nextActive : visible[0]?.id ?? null;
    try {
      sessionStorage.setItem(
        WORKSPACE_TABS_STORAGE_KEY,
        JSON.stringify({ tabs: visible, activeTabId: active })
      );
    } catch {
      /* ignore quota */
    }
  }, [enabled]);

  /** Navigate to Dashboard without removing other open tabs from the strip. */
  const goToDashboard = useCallback(() => {
    const doGo = () => {
      setActiveTabId(null);
      setTabs((prev) => {
        const next = withoutDashboard(prev);
        persist(next, null);
        return next;
      });
      suppressSyncRef.current = true;
      navigate({ pathname: '/dashboard' });
    };
    if (shouldPromptLeaveNavigation(location.pathname, '/dashboard')) {
      tryLeaveWithUnsavedChanges(doGo);
      return;
    }
    doGo();
  }, [navigate, persist, location.pathname]);

  const clearAllTabsAndGoDashboard = useCallback(() => {
    const doClear = () => {
      for (const tab of tabs) clearWorkspaceTabState(tab.id);
      setActiveTabId(null);
      setTabs([]);
      persist([], null);
      suppressSyncRef.current = true;
      navigate({ pathname: '/dashboard' });
    };
    if (shouldPromptLeaveNavigation(location.pathname, '/dashboard')) {
      tryLeaveWithUnsavedChanges(doClear);
      return;
    }
    doClear();
  }, [navigate, persist, tabs, location.pathname]);

  const navigateOverlay = useCallback(
    (pathname: string, search = '') => {
      const searchNorm = normalizeWorkspaceSearch(search);
      const doNav = () => {
        suppressSyncRef.current = true;
        navigate({ pathname, search: searchNorm || undefined });
      };
      if (shouldPromptLeaveNavigation(location.pathname, pathname)) {
        tryLeaveWithUnsavedChanges(doNav);
        return;
      }
      doNav();
    },
    [navigate, location.pathname]
  );

  const openTab = useCallback(
    (pathname: string, search = '') => {
      const searchNorm = normalizeWorkspaceSearch(search);
      const doOpen = () => {
        if (!enabled) {
          navigate({ pathname, search: searchNorm || undefined });
          return;
        }

        if (isModalOverlayRoute(pathname, searchNorm)) {
          // Bypass leave check here — navigateOverlay already guards when called directly;
          // from openTab we already passed the leave check for `pathname`.
          suppressSyncRef.current = true;
          navigate({ pathname, search: searchNorm || undefined });
          return;
        }

        if (isDashboardRoute(pathname, searchNorm)) {
          // Dashboard path already passed leave check above.
          setActiveTabId(null);
          setTabs((prev) => {
            const next = withoutDashboard(prev);
            persist(next, null);
            return next;
          });
          suppressSyncRef.current = true;
          navigate({ pathname: '/dashboard' });
          return;
        }

        const id = canonicalWorkspaceTabId(pathname, searchNorm);
        suppressSyncRef.current = true;

        setTabs((prev) => {
          const existing = findTabByLocation(prev, pathname, searchNorm);
          if (existing) {
            const updated = makeTab(pathname, searchNorm);
            const next = dedupeWorkspaceTabs(
              prev.map((tab) =>
                canonicalTabIdsMatch(tab.pathname, tab.search, pathname, searchNorm) ? updated : tab
              ),
              updated.id
            );
            persist(next, updated.id);
            return next;
          }
          let next = dedupeWorkspaceTabs([...prev, makeTab(pathname, searchNorm)], id);
          if (next.length > MAX_WORKSPACE_TABS) {
            const drop = next.find((tab) => tab.id !== activeTabId) ?? next[0];
            if (drop) clearWorkspaceTabState(drop.id);
            next = next.filter((tab) => tab.id !== drop.id);
          }
          persist(next, id);
          return next;
        });
        setActiveTabId(id);
        navigate({ pathname, search: searchNorm || undefined });
      };

      if (shouldPromptLeaveNavigation(location.pathname, pathname)) {
        tryLeaveWithUnsavedChanges(doOpen);
        return;
      }
      doOpen();
    },
    [
      enabled,
      navigate,
      makeTab,
      persist,
      activeTabId,
      findTabByLocation,
      location.pathname,
    ]
  );

  const activateTab = useCallback(
    (id: string) => {
      const tab = tabs.find((x) => x.id === id);
      if (!tab) return;

      const doActivate = () => {
        suppressSyncRef.current = true;
        setActiveTabId(id);
        persist(tabs, id);
        navigate({ pathname: tab.pathname, search: tab.search || undefined });
      };

      if (shouldPromptLeaveNavigation(location.pathname, tab.pathname)) {
        tryLeaveWithUnsavedChanges(doActivate);
        return;
      }
      doActivate();
    },
    [tabs, navigate, persist, location.pathname]
  );

  const closeTab = useCallback(
    (id: string) => {
      if (!enabled) return;

      const visible = withoutDashboard(tabs);
      const closingActive = activeTabId === id;

      let destPath = location.pathname;
      if (closingActive) {
        if (visible.length <= 1 && visible.some((t) => t.id === id)) {
          destPath = '/dashboard';
        } else {
          const idx = tabs.findIndex((tab) => tab.id === id);
          const next = tabs.filter((tab) => tab.id !== id);
          const neighbor = next[Math.min(Math.max(idx, 0), Math.max(next.length - 1, 0))];
          destPath =
            neighbor && !isDashboardRoute(neighbor.pathname, neighbor.search)
              ? neighbor.pathname
              : '/dashboard';
        }
      }

      const doClose = () => {
        if (visible.length <= 1 && visible.some((t) => t.id === id)) {
          for (const tab of tabs) clearWorkspaceTabState(tab.id);
          setActiveTabId(null);
          setTabs([]);
          persist([], null);
          suppressSyncRef.current = true;
          navigate({ pathname: '/dashboard' });
          return;
        }

        const idx = tabs.findIndex((tab) => tab.id === id);
        if (idx < 0) return;

        clearWorkspaceTabState(id);
        const next = tabs.filter((tab) => tab.id !== id);
        if (activeTabId === id) {
          const neighbor = next[Math.min(idx, next.length - 1)];
          if (neighbor && !isDashboardRoute(neighbor.pathname, neighbor.search)) {
            setTabs(next);
            setActiveTabId(neighbor.id);
            persist(next, neighbor.id);
            suppressSyncRef.current = true;
            navigate({
              pathname: neighbor.pathname,
              search: neighbor.search || undefined,
            });
          } else {
            setTabs(next);
            persist(next, null);
            setActiveTabId(null);
            suppressSyncRef.current = true;
            navigate({ pathname: '/dashboard' });
          }
        } else {
          setTabs(next);
          persist(next, activeTabId);
        }
      };

      if (closingActive && shouldPromptLeaveNavigation(location.pathname, destPath)) {
        tryLeaveWithUnsavedChanges(doClose);
        return;
      }
      doClose();
    },
    [enabled, tabs, activeTabId, navigate, persist, location.pathname]
  );

  const closeOtherTabs = useCallback(
    (id: string) => {
      if (!enabled) return;
      const keep = tabs.find((tab) => tab.id === id);
      if (!keep) return;

      const doCloseOthers = () => {
        for (const tab of tabs) {
          if (tab.id !== id) clearWorkspaceTabState(tab.id);
        }
        const kept = tabs.find((tab) => tab.id === id);
        if (!kept) return;
        setTabs([kept]);
        setActiveTabId(id);
        persist([kept], id);
        suppressSyncRef.current = true;
        navigate({ pathname: kept.pathname, search: kept.search || undefined });
      };

      if (shouldPromptLeaveNavigation(location.pathname, keep.pathname)) {
        tryLeaveWithUnsavedChanges(doCloseOthers);
        return;
      }
      doCloseOthers();
    },
    [enabled, tabs, navigate, persist, location.pathname]
  );

  const closeTabsToRight = useCallback(
    (fromTabId: string) => {
      if (!enabled) return;
      const list = withoutDashboard(tabs);
      const idx = list.findIndex((t) => t.id === fromTabId);
      if (idx < 0) return;
      const next = list.slice(0, idx + 1);
      if (next.length === list.length) return;

      const keepActive =
        activeTabId && next.some((t) => t.id === activeTabId) ? activeTabId : fromTabId;
      const active = next.find((t) => t.id === keepActive);
      const destPath = active?.pathname ?? location.pathname;

      const doCloseRight = () => {
        const visible = withoutDashboard(tabs);
        const fromIdx = visible.findIndex((t) => t.id === fromTabId);
        if (fromIdx < 0) return;
        const kept = visible.slice(0, fromIdx + 1);
        if (kept.length === visible.length) return;

        for (const tab of visible.slice(fromIdx + 1)) {
          clearWorkspaceTabState(tab.id);
        }

        const nextActive =
          activeTabId && kept.some((t) => t.id === activeTabId) ? activeTabId : fromTabId;
        setTabs(kept);
        setActiveTabId(nextActive);
        persist(kept, nextActive);
        const activeTab = kept.find((t) => t.id === nextActive);
        if (activeTab) {
          suppressSyncRef.current = true;
          navigate({
            pathname: activeTab.pathname,
            search: activeTab.search || undefined,
          });
        }
      };

      if (shouldPromptLeaveNavigation(location.pathname, destPath)) {
        tryLeaveWithUnsavedChanges(doCloseRight);
        return;
      }
      doCloseRight();
    },
    [enabled, tabs, activeTabId, navigate, persist, location.pathname]
  );

  const closeAllTabs = useCallback(() => {
    if (!enabled) return;
    clearAllTabsAndGoDashboard();
  }, [enabled, clearAllTabsAndGoDashboard]);

  const reorderTabs = useCallback(
    (dragId: string, targetId: string, insertAfter: boolean) => {
      if (!enabled || dragId === targetId) return;
      setTabs((prev) => {
        const list = withoutDashboard(prev);
        const fromIndex = list.findIndex((t) => t.id === dragId);
        const targetIndex = list.findIndex((t) => t.id === targetId);
        if (fromIndex < 0 || targetIndex < 0) return prev;

        let insertAt = insertAfter ? targetIndex + 1 : targetIndex;
        const next = [...list];
        const [moved] = next.splice(fromIndex, 1);
        if (fromIndex < insertAt) insertAt -= 1;
        next.splice(insertAt, 0, moved);
        persist(next, activeTabId);
        return next;
      });
    },
    [enabled, activeTabId, persist]
  );

  const updateTabTitle = useCallback(
    (pathname: string, search: string, title: string) => {
      if (!enabled) return;
      if (!allowsCustomWorkspaceTabTitle(pathname)) return;
      const trimmed = title.trim();
      if (!trimmed) return;
      const searchNorm = normalizeWorkspaceSearch(search);
      setTabs((prev) => {
        const idx = prev.findIndex((tab) =>
          canonicalTabIdsMatch(tab.pathname, tab.search, pathname, searchNorm)
        );
        if (idx < 0) return prev;
        const current = prev[idx];
        if (current.title === trimmed && current.customTitle) return prev;
        const next = prev.map((tab, i) =>
          i === idx ? { ...tab, title: trimmed, customTitle: true } : tab
        );
        persist(next, activeTabId);
        return next;
      });
    },
    [enabled, persist, activeTabId]
  );

  const resetTabTitle = useCallback(
    (pathname: string, search: string) => {
      if (!enabled) return;
      const searchNorm = normalizeWorkspaceSearch(search);
      const title = defaultTabTitle(pathname, searchNorm);
      setTabs((prev) => {
        const idx = prev.findIndex((tab) =>
          canonicalTabIdsMatch(tab.pathname, tab.search, pathname, searchNorm)
        );
        if (idx < 0) return prev;
        const current = prev[idx];
        if (!current.customTitle && current.title === title) return prev;
        const next = prev.map((tab, i) =>
          i === idx ? { ...tab, title, customTitle: undefined } : tab
        );
        persist(next, activeTabId);
        return next;
      });
    },
    [enabled, defaultTabTitle, persist, activeTabId]
  );

  /** Keep tab strip in sync with direct URL changes (bookmarks, in-app links). */
  useEffect(() => {
    if (!enabled) return;
    if (suppressSyncRef.current) {
      suppressSyncRef.current = false;
      return;
    }

    if (isDashboardRoute(location.pathname, location.search)) {
      setActiveTabId(null);
      setTabs((prev) => {
        const next = withoutDashboard(prev);
        if (next.length === prev.length) return prev;
        persist(next, null);
        return next;
      });
      return;
    }

    if (isModalOverlayRoute(location.pathname, location.search)) {
      setTabs((prev) => {
        const next = filterModalOverlayTabs(withoutDashboardOnly(prev));
        if (next.length === prev.length) return prev;
        const active =
          activeTabId && next.some((tab) => tab.id === activeTabId) ? activeTabId : next[0]?.id ?? null;
        persist(next, active);
        if (active !== activeTabId) {
          queueMicrotask(() => setActiveTabId(active));
        }
        return next;
      });
      return;
    }

    const searchNorm = normalizeWorkspaceSearch(location.search);
    const id = canonicalWorkspaceTabId(location.pathname, searchNorm);
    setTabs((prev) => {
      const existing = findTabByLocation(prev, location.pathname, searchNorm);
      if (existing) {
        const updated = makeTab(location.pathname, searchNorm, existing);
        const unchanged =
          existing.id === updated.id &&
          existing.title === updated.title &&
          existing.pathname === updated.pathname &&
          existing.search === updated.search &&
          Boolean(existing.customTitle) === Boolean(updated.customTitle);
        if (unchanged) {
          if (activeTabId !== updated.id) {
            queueMicrotask(() => setActiveTabId(updated.id));
          }
          return prev;
        }
        const next = dedupeWorkspaceTabs(
          prev.map((tab) =>
            canonicalTabIdsMatch(tab.pathname, tab.search, location.pathname, searchNorm)
              ? updated
              : tab
          ),
          updated.id
        );
        queueMicrotask(() => setActiveTabId(updated.id));
        persist(next, updated.id);
        return next;
      }
      let next = dedupeWorkspaceTabs(
        [...prev, makeTab(location.pathname, searchNorm)],
        id
      );
      if (next.length > MAX_WORKSPACE_TABS) {
        next = next.slice(next.length - MAX_WORKSPACE_TABS);
      }
      if (next.length === prev.length && next.every((tab, idx) => tab.id === prev[idx]?.id && tab.title === prev[idx]?.title)) {
        if (activeTabId !== id) {
          queueMicrotask(() => setActiveTabId(id));
        }
        return prev;
      }
      queueMicrotask(() => setActiveTabId(id));
      persist(next, id);
      return next;
    });
  }, [enabled, location.pathname, location.search, makeTab, persist, findTabByLocation, activeTabId]);

  useEffect(() => {
    if (enabled) return;
    setTabs([]);
    setActiveTabId(null);
  }, [enabled]);

  const visibleTabs = useMemo(
    () => withUniqueWorkspaceTabTitles(withoutDashboard(tabs)),
    [tabs]
  );

  const value = useMemo(
    () => ({
      enabled,
      tabs: visibleTabs,
      activeTabId,
      openTab,
      activateTab,
      closeTab,
      closeOtherTabs,
      closeTabsToRight,
      closeAllTabs,
      reorderTabs,
      updateTabTitle,
      resetTabTitle,
      navigateOverlay,
    }),
    [
      enabled,
      visibleTabs,
      activeTabId,
      openTab,
      activateTab,
      closeTab,
      closeOtherTabs,
      closeTabsToRight,
      closeAllTabs,
      reorderTabs,
      updateTabTitle,
      resetTabTitle,
      navigateOverlay,
    ]
  );

  return (
    <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>
  );
};

export function useWorkspaceTabs(): WorkspaceTabsContextValue {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) {
    throw new Error('useWorkspaceTabs must be used within WorkspaceTabsProvider');
  }
  return ctx;
}

export function useWorkspaceTabsOptional(): WorkspaceTabsContextValue | null {
  return useContext(WorkspaceTabsContext);
}
