/** System access roles (portal permissions) — not organizational job titles. */

export const SYSTEM_ACCESS_ROLES = ['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'] as const;
export type SystemAccessRole = (typeof SYSTEM_ACCESS_ROLES)[number];

/** Shown on employee create/edit — Admin is system-user only. */
export const EMPLOYEE_FORM_ACCESS_ROLES = ['EMPLOYEE', 'MANAGER', 'HR'] as const;

const ACCESS_ROLE_SET = new Set<string>(SYSTEM_ACCESS_ROLES);

export function normalizeAccessRole(
  raw: unknown,
  fallback: SystemAccessRole = 'EMPLOYEE'
): SystemAccessRole {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (v === 'SUPER_ADMIN') return 'ADMIN';
  /** Display rename: Staff role still stores as EMPLOYEE for compatibility. */
  if (v === 'STAFF') return 'EMPLOYEE';
  if (ACCESS_ROLE_SET.has(v)) return v as SystemAccessRole;
  return fallback;
}

/** User-facing label for portal access roles. */
export function formatAccessRoleLabel(raw: unknown): string {
  const role = normalizeAccessRole(raw);
  if (role === 'EMPLOYEE') return 'Staff';
  if (role === 'HR') return 'HR';
  if (role === 'MANAGER') return 'Manager';
  if (role === 'ADMIN') return 'Admin';
  return role;
}

export function resolveAccessRoleFromBody(body: Record<string, unknown> | null | undefined): SystemAccessRole {
  const b = body ?? {};
  return normalizeAccessRole(b.accessRole ?? b.access_role ?? b.role);
}

export function canAssignAccessRole(actorRole: unknown, targetRole: SystemAccessRole): boolean {
  const actor = normalizeAccessRole(actorRole);
  if (targetRole === 'ADMIN') return actor === 'ADMIN';
  if (actor === 'ADMIN' || actor === 'HR') return true;
  if (actor === 'MANAGER') return targetRole === 'EMPLOYEE';
  return false;
}

/** Legacy values that were job titles stored in user.role — not system access roles. */
const LEGACY_JOB_TITLE_ROLE_VALUES = new Set([
  'RECEPTIONIST',
  'ACCOUNTANT',
  'CASHIER',
  'DEVELOPER',
  'SUPERVISOR',
  'OFFICER',
  'CTO',
  'CEO',
  'INTERN',
  'CONTRACTOR',
]);

export function isMisclassifiedJobTitleRole(raw: unknown): boolean {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!v || ACCESS_ROLE_SET.has(v)) return false;
  if (LEGACY_JOB_TITLE_ROLE_VALUES.has(v)) return true;
  return v.length > 2 && !v.includes('_');
}
