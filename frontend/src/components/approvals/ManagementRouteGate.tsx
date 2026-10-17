import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';
import { PERM } from '../../constants/permissionKeys';
import { PageLoader } from '../common/PageLoader';

const APPROVAL_PERMISSIONS = [
  PERM.LEAVE_APPROVE,
  PERM.OVERTIME_MANAGE,
  PERM.EMPLOYEE_MOVEMENTS,
  PERM.PAYROLL_APPROVE,
  PERM.PERFORMANCE_VIEW,
  PERM.PERFORMANCE_APPRAISAL_VIEW,
] as const;

/** Restrict approval-queue pages to management roles with at least one approval permission. */
export function ManagementRouteGate({ children }: { children: React.ReactNode }) {
  const { hasRole, hasPermission, permissionsReady } = useAuth();
  const isManagement =
    hasRole(Role.ADMIN) || hasRole(Role.HR) || hasRole(Role.MANAGER);
  if (!isManagement) {
    return <Navigate to="/dashboard" replace />;
  }
  if (hasRole(Role.ADMIN)) {
    return <>{children}</>;
  }
  if (!permissionsReady) {
    return <PageLoader layout="dashboard" />;
  }
  const canApprove = APPROVAL_PERMISSIONS.some((key) => hasPermission(key));
  if (!canApprove) {
    return <Navigate to="/forbidden" replace />;
  }
  return <>{children}</>;
}
