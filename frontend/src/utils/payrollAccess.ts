import { PERM } from '../constants/permissionKeys';
import { isAdminRole } from './adminNavScope';

type HasPermissionFn = (key: string) => boolean;

/** Full payroll module (overview, schedule, rules, runs list). */
export function canAccessFullPayrollModule(
  hasPermission: HasPermissionFn,
  role?: string
): boolean {
  if (isAdminRole(role)) return true;
  // Matrix/override grants win — do not hard-block Manager (or any role) after Allow.
  return (
    hasPermission(PERM.PAYROLL_PROCESS) ||
    hasPermission(PERM.PAYROLL_VIEW) ||
    hasPermission(PERM.PAYROLL_RULES_VIEW) ||
    hasPermission(PERM.PAYROLL_RULES_EDIT)
  );
}

/** Payroll approval queue and assigned run review — controllable via permission matrix. */
export function canAccessPayrollApprovals(
  hasPermission: HasPermissionFn,
  role?: string
): boolean {
  if (isAdminRole(role)) return true;
  return (
    hasPermission(PERM.PAYROLL_APPROVE) ||
    hasPermission(PERM.PAYROLL_PROCESS) ||
    hasPermission(PERM.PAYROLL_VIEW)
  );
}
