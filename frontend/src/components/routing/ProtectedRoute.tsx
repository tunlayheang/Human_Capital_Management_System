import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useInAppLayout } from '../../context/InAppLayoutContext';
import { PageLoader } from '../common/PageLoader';
import { AuthBootSplash } from '../auth/AuthBootSplash';
import { Role } from '../../types';
import { isAdminBlockedFromSelfServiceRoute, isAdminRole } from '../../utils/adminNavScope';
import { isAlwaysAuthPath } from '../../constants/alwaysOnPermissions';

export interface ProtectedRouteProps {
  children?: React.ReactNode;
  roles?: Role[];
  /** Spec permission key — checked via hasPermission (matrix + overrides). */
  permission?: string;
  /** Allow access if the user has any of these permission keys. */
  permissionAny?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  roles,
  permission,
  permissionAny,
}) => {
  const { isAuthenticated, hasRole, hasPermission, isLoading, user, permissionsReady } = useAuth();
  const location = useLocation();
  const inAppLayout = useInAppLayout();

  const hasRequiredPermission = (): boolean => {
    if (permissionAny && permissionAny.length > 0) {
      return permissionAny.some((key) => hasPermission(key));
    }
    if (permission) return hasPermission(permission);
    return true;
  };

  // Lottie blank splash only outside Layout; in-chrome gates use skeletons.
  if (isLoading) {
    return inAppLayout ? <PageLoader layout="dashboard" /> : <AuthBootSplash />;
  }
  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const loginTo =
      returnTo && returnTo !== '/login'
        ? `/login?redirect=${encodeURIComponent(returnTo)}`
        : '/login';
    return <Navigate to={loginTo} replace />;
  }

  if (
    user &&
    isAdminBlockedFromSelfServiceRoute(location.pathname, location.search, user.role)
  ) {
    const path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/projects') return <Navigate to="/projects?scope=manage" replace />;
    if (path === '/attendance') return <Navigate to="/attendance?scope=manage" replace />;
    if (path === '/leaves') return <Navigate to="/leaves?scope=manage&tab=requests" replace />;
    if (path === '/overtime') return <Navigate to="/overtime?scope=manage&tab=requests" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  const needsPermissionCheck = Boolean(permission) || Boolean(permissionAny?.length);

  /**
   * Auth-only shell paths without an explicit permission prop — never forbidden.
   * When `permission` / `permissionAny` is set, matrix Grant/Deny applies like any other route.
   */
  if (isAlwaysAuthPath(location.pathname) && !needsPermissionCheck) {
    return <>{children}</>;
  }

  /** Wait for matrix before denying — empty map during load must not send users to /forbidden. */
  if (needsPermissionCheck && !permissionsReady) {
    return <PageLoader layout="dashboard" />;
  }

  /** Explicit route role allowlist (App.tsx) — still requires permission when set. */
  if (roles && hasRole(roles)) {
    if (!needsPermissionCheck || hasRequiredPermission()) {
      return <>{children}</>;
    }
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }

  if (roles && !hasRole(roles)) {
    // Permission-only access: allow non-listed roles when the matrix Grants the required key(s).
    if (needsPermissionCheck && hasRequiredPermission()) {
      return <>{children}</>;
    }
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }

  /**
   * Route access = role allowlist + permission matrix Grant/Deny only.
   * Sidebar menu visibility must not forbid URLs that the matrix grants.
   */
  if (needsPermissionCheck && !hasRequiredPermission()) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};
