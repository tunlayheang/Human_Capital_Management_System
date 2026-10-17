import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../constants/permissionKeys';
import { Role } from '../types';
import type { ModuleSidebarContext } from '../config/moduleSidebarNav';
import { useMenuConfigOptional } from '../context/MenuConfigContext';
import { hasOffboardingStageAccess } from '../config/offboardingAccess';
const SUPER_ADMIN = 'SUPER_ADMIN';

export function useModuleSidebarContext(): ModuleSidebarContext {
  const { user, hasRole, hasPermission } = useAuth();
  const menuConfig = useMenuConfigOptional();

  return useMemo(() => {
    const role = String(user?.role ?? '');
    const isSuperAdmin = role === SUPER_ADMIN;
    const isAdminHRManager =
      isSuperAdmin || hasRole([Role.ADMIN, Role.HR, Role.MANAGER]);
    const isHrLeaveOps = isSuperAdmin || hasRole([Role.ADMIN, Role.HR]);
    const isManagerOnly =
      hasRole(Role.MANAGER) && !hasRole([Role.ADMIN, Role.HR]) && !isSuperAdmin;

    const canPlanningAndConfig =
      hasPermission(PERM.LEAVE_EDIT) || isSuperAdmin;

    return {
      hasRole,
      hasPermission,
      isPathVisible: menuConfig?.isPathVisible,
      userRole: user?.role,
      isAdminHRManager,
      isManagerOnly,
      isHrLeaveOps,
      canPlanningAndConfig,
      canApproveOvertime: hasPermission(PERM.OVERTIME_MANAGE),
      canConfigOvertime: isSuperAdmin || hasPermission(PERM.OVERTIME_CONFIG),
      hasEmployeeView: hasPermission(PERM.EMPLOYEE_VIEW),
      hasEmployeeCreate: hasPermission(PERM.EMPLOYEE_CREATE),
      hasEmployeeMovements: hasPermission(PERM.EMPLOYEE_MOVEMENTS),
      hasOffboardingAccess: hasOffboardingStageAccess({
        hasPermission,
        userRole: user?.role,
      }),
    };
  }, [user?.role, hasRole, hasPermission, menuConfig?.isPathVisible]);
}
