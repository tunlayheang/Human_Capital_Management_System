import { Role } from '../types';

/** Portal access roles — authorization uses this only (users.role / accessRole). */
export const SYSTEM_ACCESS_ROLES = [Role.EMPLOYEE, Role.MANAGER, Role.HR, Role.ADMIN] as const;

/** Employee wizard and employee-linked portal accounts — not system administrators. */
export const EMPLOYEE_WIZARD_ACCESS_ROLES = [Role.EMPLOYEE, Role.MANAGER, Role.HR] as const;

/** Roles assignable when linking portal access to an onboarded employee. */
export const EMPLOYEE_LINKED_PORTAL_ROLES = EMPLOYEE_WIZARD_ACCESS_ROLES;

export const ACCESS_ROLE_OPTIONS: {
  value: Role;
  label: string;
  description?: string;
}[] = [
  {
    value: Role.EMPLOYEE,
    label: 'Staff',
  },
  {
    value: Role.MANAGER,
    label: 'Manager',
  },
  {
    value: Role.HR,
    label: 'HR',
  },
];

const ACCESS_ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.HR]: 'HR',
  [Role.MANAGER]: 'Manager',
  [Role.EMPLOYEE]: 'Staff',
};

export function normalizeAccessRole(raw: unknown, fallback: Role = Role.EMPLOYEE): Role {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  const map: Record<string, Role> = {
    ADMIN: Role.ADMIN,
    HR: Role.HR,
    MANAGER: Role.MANAGER,
    /** Canonical stored value remains EMPLOYEE; STAFF is the display/alias name. */
    EMPLOYEE: Role.EMPLOYEE,
    STAFF: Role.EMPLOYEE,
    SUPER_ADMIN: Role.ADMIN,
  };
  return map[v] ?? fallback;
}

/** User-facing label for portal access roles (EMPLOYEE → Staff). */
export function formatAccessRoleLabel(raw: unknown): string {
  const role = normalizeAccessRole(raw);
  return ACCESS_ROLE_LABELS[role] ?? String(raw ?? '');
}

/** Employee create/edit wizard — never includes Admin (use Settings → Create Admin). */
export function accessRoleOptionsForEmployeeForm(): typeof ACCESS_ROLE_OPTIONS {
  return ACCESS_ROLE_OPTIONS;
}

export function canAssignAccessRole(actorRole: Role | undefined, target: Role): boolean {
  if (target === Role.ADMIN) return actorRole === Role.ADMIN;
  if (actorRole === Role.ADMIN || actorRole === Role.HR) return true;
  if (actorRole === Role.MANAGER) return target === Role.EMPLOYEE;
  return false;
}
