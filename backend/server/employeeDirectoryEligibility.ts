import { Op } from 'sequelize';
import { sequelize } from './db.js';
import { isPlaceholderDraftEmail, normalizeEmployeeLifecycleStatus } from './employeeDraft.js';

/** HR badge code (IROC/TROC…) assigned and not a draft onboarding placeholder row. */
export function hasAssignedEmployeeDisplayId(row: Record<string, unknown>): boolean {
  const code = String(row.employee_id ?? row.employeeId ?? '').trim();
  if (!code) return false;
  const status = normalizeEmployeeLifecycleStatus(row.status);
  if (status === 'draft') return false;
  if (isPlaceholderDraftEmail(row.email)) return false;
  return true;
}

export function assignedEmployeeDisplayIdSqlLiterals(): string[] {
  return [
    '`Employee`.`employee_id` IS NOT NULL AND TRIM(`Employee`.`employee_id`) != \'\'',
    "LOWER(COALESCE(`Employee`.`status`, '')) NOT IN ('draft', 'profile_incomplete')",
    "LOWER(COALESCE(`Employee`.`email`, '')) NOT LIKE '%@pending.iroc'",
  ];
}

export function appendAssignedEmployeeDisplayIdClauses(where: Record<string, unknown>): void {
  const priorAnd = where[Op.and] ? [...(where[Op.and] as unknown[])] : [];
  for (const clause of assignedEmployeeDisplayIdSqlLiterals()) {
    priorAnd.push(sequelize.literal(clause));
  }
  where[Op.and] = priorAnd;
}

export function filterRowsWithAssignedEmployeeDisplayId<T extends Record<string, unknown>>(
  rows: T[]
): T[] {
  return rows.filter((row) => hasAssignedEmployeeDisplayId(row));
}
