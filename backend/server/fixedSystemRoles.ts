/**
 * Four fixed portal access roles — defined in code, not in a `roles` database table.
 * `rolepermissions.roleId` uses these stable ids (role-1 … role-4).
 */
import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import {
  formatAccessRoleLabel,
  normalizeAccessRole,
  SYSTEM_ACCESS_ROLES,
  type SystemAccessRole,
} from './accessRole.js';

export type FixedSystemRole = {
  id: string;
  name: SystemAccessRole;
  description: string;
};

export const FIXED_SYSTEM_ROLES: FixedSystemRole[] = [
  { id: 'role-1', name: 'ADMIN', description: 'Full system access' },
  { id: 'role-2', name: 'HR', description: 'HR department access' },
  { id: 'role-3', name: 'MANAGER', description: 'Department management access' },
  { id: 'role-4', name: 'EMPLOYEE', description: 'Basic staff access' },
];

const ROLE_NAME_ALIASES: Record<SystemAccessRole, string[]> = {
  ADMIN: ['ADMIN', 'SUPER_ADMIN'],
  HR: ['HR', 'HUMAN_RESOURCES', 'HUMAN RESOURCES', 'HR_MANAGER', 'HR MGR'],
  MANAGER: ['MANAGER', 'DEPT_HEAD', 'DEPARTMENT_HEAD'],
  /** STAFF is the display name; EMPLOYEE remains the stored role value. */
  EMPLOYEE: ['EMPLOYEE', 'STAFF'],
};

const byId = new Map(FIXED_SYSTEM_ROLES.map((r) => [r.id, r]));
const byName = new Map(FIXED_SYSTEM_ROLES.map((r) => [r.name, r]));

/** API shape compatible with former Sequelize Role rows. */
export function listFixedSystemRoles(): Array<
  FixedSystemRole & { label: string; createdAt?: null; updatedAt?: null }
> {
  return FIXED_SYSTEM_ROLES.map((r) => ({
    ...r,
    label: formatAccessRoleLabel(r.name),
    createdAt: null,
    updatedAt: null,
  }));
}

export function getFixedRoleById(roleId: string): FixedSystemRole | null {
  return byId.get(String(roleId).trim()) ?? null;
}

export function resolveFixedRoleByName(raw: unknown): FixedSystemRole | null {
  const upper = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!upper) return null;

  for (const role of FIXED_SYSTEM_ROLES) {
    const aliases = ROLE_NAME_ALIASES[role.name] ?? [role.name];
    if (aliases.includes(upper)) return role;
  }

  const normalized = normalizeAccessRole(upper);
  return byName.get(normalized) ?? null;
}

export function fixedRoleIdForUserRole(raw: unknown): string | null {
  return resolveFixedRoleByName(raw)?.id ?? null;
}

const VALID_FIXED_ROLE_IDS = new Set(FIXED_SYSTEM_ROLES.map((r) => r.id));

/** True when `rolepermissions.roleId` already uses stable ids (role-1 … role-4). */
export function isFixedRolePermissionRoleId(roleId: unknown): boolean {
  return VALID_FIXED_ROLE_IDS.has(String(roleId ?? '').trim());
}

/**
 * Formerly migrated legacy `rolepermissions.roleId` values.
 * Grant tables are dropped — no-op kept for callers.
 */
export async function repairRolePermissionRoleIds(): Promise<number> {
  return 0;
}

/** Drop legacy `roles` table — catalog lives in code only. */
export async function dropLegacyRolesTableIfNeeded(): Promise<void> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' LIMIT 1`,
    { type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  if (!rows.length) return;

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await sequelize.query('DROP TABLE IF EXISTS `roles`');
    console.log('[roles] Dropped legacy roles table (fixed roles are defined in code).');
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

export { SYSTEM_ACCESS_ROLES };
