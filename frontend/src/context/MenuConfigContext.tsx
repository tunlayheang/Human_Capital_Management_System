import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Api } from '../services/api';
import { Role } from '../types';
import { ROUTE_ROLE_GUARDS, canAccessPath } from '../config/navUtils';
import {
  buildAdminMenuPaths,
  ensureApprovalsPathForRole,
  ensureHrInherentMenuPaths,
  ensurePayrollApprovalsPathForRole,
  ensurePerformancePathForRole,
  ensureSelfPerformancePathForRole,
  getDefaultPathsForRole,
  resolveCatalogMenuKey,
} from '../config/navMenuCatalog';
import { isAdminRole } from '../utils/adminNavScope';
import { useAuth } from './AuthContext';
import { canAccessChatModule, isChatPath } from '../utils/chatAccess';
import { canAccessOffboardingStagePath } from '../config/offboardingAccess';
import {
  readCachedMenu,
  writeCachedMenu,
  clearCachedMenu,
  readMenuConfigRevision,
  MENU_CONFIG_REVISION_KEY,
} from '../utils/menuCache';

type MenuConfigContextValue = {
  visiblePaths: Set<string> | null;
  routeGuards: Record<string, Role[]>;
  loading: boolean;
  refreshMenu: () => Promise<void>;
  isPathVisible: (path: string, search?: string) => boolean;
  canAccessPath: (pathname: string, search?: string) => boolean;
};

const MenuConfigContext = createContext<MenuConfigContextValue | undefined>(undefined);

const parseGuards = (raw: Record<string, string[]> | undefined): Record<string, Role[]> => {
  if (!raw) return { ...ROUTE_ROLE_GUARDS };
  const out: Record<string, Role[]> = { ...ROUTE_ROLE_GUARDS };
  for (const [path, roles] of Object.entries(raw)) {
    out[path] = roles.map((r) => r as Role);
  }
  return out;
};

export const MenuConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, hasPermission } = useAuth();
  const [visiblePaths, setVisiblePaths] = useState<Set<string> | null>(null);
  const [routeGuards, setRouteGuards] = useState<Record<string, Role[]>>(ROUTE_ROLE_GUARDS);
  const [loading, setLoading] = useState(false);
  const [, setMenuRevision] = useState(() => readMenuConfigRevision());

  const refreshMenu = useCallback(async () => {
    if (!user?.id) {
      setVisiblePaths(null);
      setRouteGuards(ROUTE_ROLE_GUARDS);
      setLoading(false);
      return;
    }
    const hasCachedMenu = Boolean(readCachedMenu(user.id)?.paths?.length);
    if (!hasCachedMenu) setLoading(true);
    try {
      const data = await Api.menu.getMyMenu();
      const paths = data.paths || [];
      writeCachedMenu(user.id, {
        paths,
        routeGuards: data.routeGuards || {},
      });
      setVisiblePaths((prev) => {
        if (prev && prev.size === paths.length && paths.every((p: string) => prev.has(p))) {
          return prev;
        }
        return new Set(paths);
      });
      setRouteGuards((prev) => {
        const next = parseGuards(data.routeGuards);
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(next);
        return prevJson === nextJson ? prev : next;
      });
    } catch {
      setVisiblePaths(null);
      setRouteGuards(ROUTE_ROLE_GUARDS);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const cached = readCachedMenu(user.id);
      if (cached) {
        setVisiblePaths(new Set(cached.paths));
        setRouteGuards(parseGuards(cached.routeGuards));
        setLoading(false);
      }
      void refreshMenu();
    } else {
      if (user?.id) clearCachedMenu(user.id);
      setVisiblePaths(null);
      setRouteGuards(ROUTE_ROLE_GUARDS);
    }
  }, [isAuthenticated, user?.id, refreshMenu]);

  /** Reload menu when permissions change in another tab. */
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const syncRevision = () => {
      const rev = readMenuConfigRevision();
      setMenuRevision((prev) => {
        if (prev !== rev) {
          clearCachedMenu(user.id);
          void refreshMenu();
          return rev;
        }
        return prev;
      });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === MENU_CONFIG_REVISION_KEY || e.key === 'hcms_menu_config_revision') syncRevision();
    };
    window.addEventListener('storage', onStorage);
    const interval = setInterval(syncRevision, 60_000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, [isAuthenticated, user?.id, refreshMenu]);

  const effectivePathSet = useMemo(() => {
    if (!user) return null;
    if (isAdminRole(user.role)) return new Set(buildAdminMenuPaths());
    const role = String(user.role || '').toUpperCase();
    const applyStaffPaths = (paths: string[]) => {
      if (role === 'HR') {
        return ensureSelfPerformancePathForRole(
          role,
          ensureApprovalsPathForRole(role, ensureHrInherentMenuPaths(user.role, paths))
        );
      }
      return ensureSelfPerformancePathForRole(
        role,
        ensurePayrollApprovalsPathForRole(
          role,
          ensureApprovalsPathForRole(role, ensurePerformancePathForRole(user.role, paths))
        )
      );
    };
    if (visiblePaths) {
      return new Set(applyStaffPaths(Array.from(visiblePaths)));
    }
    return new Set(applyStaffPaths(getDefaultPathsForRole(user.role)));
  }, [user, visiblePaths]);

  const isPathVisible = useCallback(
    (path: string, search = '') => {
      if (!user || !effectivePathSet) return false;
      if (isChatPath(path) && canAccessChatModule(hasPermission, user.role)) return true;
      const exactKey = resolveCatalogMenuKey(path, search);
      if (exactKey) return effectivePathSet.has(exactKey);
      return false;
    },
    [user, effectivePathSet, hasPermission]
  );

  const canAccessPathForUser = useCallback(
    (pathname: string, search = '') => {
      if (!user) return false;
      if (isChatPath(pathname) && canAccessChatModule(hasPermission, user.role)) return true;
      if (canAccessOffboardingStagePath(pathname, { hasPermission, userRole: user.role })) {
        return true;
      }
      return canAccessPath(
        pathname,
        user.role,
        (roles) => {
          if (isAdminRole(user.role)) return true;
          const list = Array.isArray(roles) ? roles : [roles];
          const userR = String(user.role || '').toUpperCase();
          return list.some((r) => String(r).toUpperCase() === userR);
        },
        routeGuards,
        search,
        isPathVisible
      );
    },
    [user, routeGuards, isPathVisible, hasPermission]
  );

  const value = useMemo(
    () => ({
      visiblePaths,
      routeGuards,
      loading,
      refreshMenu,
      isPathVisible,
      canAccessPath: canAccessPathForUser,
    }),
    [visiblePaths, routeGuards, loading, refreshMenu, isPathVisible, canAccessPathForUser]
  );

  return <MenuConfigContext.Provider value={value}>{children}</MenuConfigContext.Provider>;
};

export const useMenuConfig = () => {
  const ctx = useContext(MenuConfigContext);
  if (!ctx) {
    throw new Error('useMenuConfig must be used within MenuConfigProvider');
  }
  return ctx;
};

export const useMenuConfigOptional = () => useContext(MenuConfigContext);
