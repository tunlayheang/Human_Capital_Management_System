import { PERM } from '../constants/permissionKeys';
import { Role } from '../types';
import { isAdminRole } from '../utils/adminNavScope';
import { canAccessFullPayrollModule } from '../utils/payrollAccess';

/** Routes that are part of the resign/terminate → settlement → payment workflow. */
export const OFFBOARDING_STAGE_PATH_PREFIXES = [
  '/employees/offboarding',
  /** Legacy payroll URLs redirect here; keep for menu access checks. */
  '/payroll/final-settlement',
] as const;

export function isOffboardingStagePath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/';
  return OFFBOARDING_STAGE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

type AccessCtx = {
  hasPermission: (key: string) => boolean;
  userRole?: string;
};

/**
 * Offboarding stages require the dedicated offboarding permission (or Admin).
 * Payment steps also accept payroll process/view grants.
 */
export function canAccessOffboardingStagePath(pathname: string, ctx: AccessCtx): boolean {
  if (!isOffboardingStagePath(pathname)) return false;

  const role = String(ctx.userRole ?? '').toUpperCase();
  if (isAdminRole(role)) return true;

  if (pathname.startsWith('/employees/offboarding')) {
    if (pathname.includes('/payment')) {
      return (
        ctx.hasPermission(PERM.EMPLOYEE_OFFBOARD) ||
        ctx.hasPermission(PERM.PAYROLL_VIEW) ||
        ctx.hasPermission(PERM.PAYROLL_PROCESS)
      );
    }
    return (
      ctx.hasPermission(PERM.EMPLOYEE_OFFBOARD) ||
      ctx.hasPermission(PERM.EMPLOYEE_TERMINATE)
    );
  }

  if (pathname.startsWith('/payroll/final-settlement')) {
    return (
      ctx.hasPermission(PERM.EMPLOYEE_OFFBOARD) ||
      ctx.hasPermission(PERM.PAYROLL_VIEW) ||
      ctx.hasPermission(PERM.PAYROLL_PROCESS)
    );
  }

  return false;
}

export function hasOffboardingStageAccess(ctx: AccessCtx): boolean {
  const role = String(ctx.userRole ?? '').toUpperCase();
  if (isAdminRole(role)) return true;
  return (
    ctx.hasPermission(PERM.EMPLOYEE_OFFBOARD) ||
    ctx.hasPermission(PERM.EMPLOYEE_TERMINATE) ||
    ctx.hasPermission(PERM.PAYROLL_PROCESS)
  );
}

/** Row actions on the offboarding list (resign/terminate). */
export function offboardingRowPermissions(ctx: AccessCtx): {
  canTerminate: boolean;
  canPayroll: boolean;
} {
  const role = String(ctx.userRole ?? '').toUpperCase();
  const hrFull = role === Role.HR || isAdminRole(role);
  return {
    canTerminate:
      hrFull ||
      ctx.hasPermission(PERM.EMPLOYEE_OFFBOARD) ||
      ctx.hasPermission(PERM.EMPLOYEE_TERMINATE),
    canPayroll:
      hrFull || canAccessFullPayrollModule(ctx.hasPermission, ctx.userRole),
  };
}
