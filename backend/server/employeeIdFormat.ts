import { Op } from 'sequelize';
import { sequelize } from './db.js';

/** Fixed display-id format: ROC00001, ROC00002, … */
export const EMPLOYEE_DISPLAY_ID_PREFIX = 'ROC';
export const EMPLOYEE_DISPLAY_ID_PAD = 5;

/** Accept canonical ROC plus legacy IROC / EMP badges. */
const DISPLAY_ID_PATTERN = /^(?:IROC|ROC|EMP)(\d+)$/i;

export function formatEmployeeDisplayId(serial: number): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  return `${EMPLOYEE_DISPLAY_ID_PREFIX}${String(n).padStart(EMPLOYEE_DISPLAY_ID_PAD, '0')}`;
}

export function parseEmployeeDisplayIdSuffix(employeeId: string): number | null {
  const m = String(employeeId || '').match(DISPLAY_ID_PATTERN);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Canonical storage/display form for HR badge IDs.
 * IROC/EMP/ROC + digits → ROC#####; ADM + digits → ADM#####; else cleaned uppercase.
 */
export function toCanonicalEmployeeDisplayId(raw: unknown): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!code) return '';
  const emp = code.match(/^(?:IROC|ROC|EMP)(\d+)$/);
  if (emp) return `ROC${emp[1].padStart(EMPLOYEE_DISPLAY_ID_PAD, '0')}`;
  const adm = code.match(/^ADM(\d+)$/);
  if (adm) return `ADM${adm[1].padStart(EMPLOYEE_DISPLAY_ID_PAD, '0')}`;
  return code;
}

/** True when value is a staff badge (ROC / legacy IROC / EMP), not ADM or free text. */
export function isEmployeeBadgeDisplayId(raw: unknown): boolean {
  return /^(?:IROC|ROC|EMP)\d+$/i.test(
    String(raw ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
  );
}

/**
 * Login / lookup aliases so staff can still type a legacy IROC##### badge
 * after the canonical format moved to ROC#####.
 */
export function employeeDisplayIdLookupVariants(rawId: unknown): string[] {
  const code = String(rawId ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!code) return [];
  const out = new Set<string>([code]);
  const m = code.match(DISPLAY_ID_PATTERN);
  if (m) {
    const digits = m[1];
    const padded = digits.padStart(EMPLOYEE_DISPLAY_ID_PAD, '0');
    out.add(`ROC${padded}`);
    out.add(`IROC${padded}`);
    out.add(`EMP${padded}`);
  }
  const canonical = toCanonicalEmployeeDisplayId(code);
  if (canonical) out.add(canonical);
  return [...out];
}

/**
 * Sequelize WHERE for GET/PUT by route param: matches display EmpID variants
 * (ROC / IROC / EMP) or the internal `employees.id` PK.
 */
export function employeeLookupWhere(rawId: unknown): Record<string | symbol, unknown> {
  const key = String(rawId ?? '').trim();
  if (!key) {
    return { employee_id: '__missing__' };
  }
  const variants = employeeDisplayIdLookupVariants(key);
  return {
    [Op.or]: [{ employee_id: { [Op.in]: variants } }, { id: key }],
  };
}

/** Highest numeric suffix already used in `employees.employee_id` (ROC / IROC / EMP). */
export async function maxEmployeeIdNumericSuffix(): Promise<number> {
  try {
    const [rows] = await sequelize.query(
      `SELECT GREATEST(
         COALESCE(MAX(CASE
           WHEN employee_id REGEXP '^[Rr][Oo][Cc][0-9]+$'
           THEN CAST(SUBSTRING(employee_id, 4) AS UNSIGNED)
         END), 0),
         COALESCE(MAX(CASE
           WHEN employee_id REGEXP '^[Ii][Rr][Oo][Cc][0-9]+$'
           THEN CAST(SUBSTRING(employee_id, 5) AS UNSIGNED)
         END), 0),
         COALESCE(MAX(CASE
           WHEN employee_id REGEXP '^[Ee][Mm][Pp][0-9]+$'
           THEN CAST(SUBSTRING(employee_id, 4) AS UNSIGNED)
         END), 0)
       ) AS mx
       FROM employees`,
      { raw: true }
    );
    const mx = (rows as { mx?: number | string | null }[])[0]?.mx;
    const n = mx != null ? Number(mx) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.warn('maxEmployeeIdNumericSuffix failed:', (e as Error)?.message || e);
    return 0;
  }
}

/** Preview the next display id without reserving it (caller must enforce uniqueness on insert). */
export async function previewNextEmployeeDisplayId(): Promise<string> {
  const currentNum = await maxEmployeeIdNumericSuffix();
  const nextNumber = currentNum + 1;
  if (!Number.isFinite(nextNumber) || nextNumber < 1) {
    throw new Error('Could not compute next employee id');
  }
  return formatEmployeeDisplayId(nextNumber);
}

async function cascadeDenormalizedBadge(
  table: string,
  column: string,
  joinExpr: string
): Promise<number> {
  try {
    const [result] = (await sequelize.query(
      `UPDATE \`${table}\` t
       INNER JOIN employees e ON ${joinExpr}
       SET t.\`${column}\` = e.employee_id
       WHERE e.employee_id REGEXP '^[Rr][Oo][Cc][0-9]+$'
         AND t.\`${column}\` IS NOT NULL
         AND TRIM(t.\`${column}\`) <> ''
         AND UPPER(TRIM(t.\`${column}\`)) <> UPPER(TRIM(e.employee_id))
         AND (
           t.\`${column}\` REGEXP '^[Ii][Rr][Oo][Cc][0-9]+$'
           OR t.\`${column}\` REGEXP '^[Ee][Mm][Pp][0-9]+$'
           OR (
             t.\`${column}\` REGEXP '^[Rr][Oo][Cc][0-9]+$'
             AND CAST(SUBSTRING(t.\`${column}\`, 4) AS UNSIGNED) =
                 CAST(SUBSTRING(e.employee_id, 4) AS UNSIGNED)
           )
         )`
    )) as [{ affectedRows?: number }, unknown];
    return Number((result as { affectedRows?: number })?.affectedRows || 0);
  } catch (e) {
    console.warn(`[db] Skipping ${table}.${column} badge cascade:`, (e as Error)?.message || e);
    return 0;
  }
}

/** Rewrite legacy EMP* / IROC* badges to canonical ROC##### and cascade denormalized copies. */
export async function migrateLegacyEmployeeDisplayIds(): Promise<number> {
  let changed = 0;
  try {
    const [empResult] = (await sequelize.query(
      `UPDATE employees
       SET employee_id = CONCAT('ROC', LPAD(CAST(SUBSTRING(employee_id, 4) AS UNSIGNED), 5, '0'))
       WHERE employee_id REGEXP '^[Ee][Mm][Pp][0-9]+$'
         AND NOT EXISTS (
           SELECT 1 FROM (
             SELECT employee_id FROM employees
           ) x
           WHERE x.employee_id = CONCAT('ROC', LPAD(CAST(SUBSTRING(employees.employee_id, 4) AS UNSIGNED), 5, '0'))
         )`
    )) as [{ affectedRows?: number }, unknown];
    changed += Number((empResult as { affectedRows?: number })?.affectedRows || 0);
  } catch (e) {
    console.warn('Skipping EMP→ROC employee_id migration:', (e as Error)?.message || e);
  }

  try {
    const [irocResult] = (await sequelize.query(
      `UPDATE employees
       SET employee_id = CONCAT('ROC', LPAD(CAST(SUBSTRING(employee_id, 5) AS UNSIGNED), 5, '0'))
       WHERE employee_id REGEXP '^[Ii][Rr][Oo][Cc][0-9]+$'
         AND NOT EXISTS (
           SELECT 1 FROM (
             SELECT employee_id FROM employees
           ) x
           WHERE x.employee_id = CONCAT('ROC', LPAD(CAST(SUBSTRING(employees.employee_id, 5) AS UNSIGNED), 5, '0'))
         )`
    )) as [{ affectedRows?: number }, unknown];
    changed += Number((irocResult as { affectedRows?: number })?.affectedRows || 0);
  } catch (e) {
    console.warn('Skipping IROC→ROC employee_id migration:', (e as Error)?.message || e);
  }

  const cascaded =
    (await cascadeDenormalizedBadge(
      'employee_movements',
      'employee_id',
      'e.id = t.employee_pk'
    )) +
    (await cascadeDenormalizedBadge(
      'historyemployee',
      'employee_id',
      'e.id = t.id OR e.employee_id = t.employee_id'
    )) +
    (await cascadeDenormalizedBadge(
      'employeecards',
      'display_employee_id',
      'e.id = t.employee_id OR e.employee_id = t.display_employee_id'
    ));
  changed += cascaded;

  if (changed > 0) {
    console.log(`[db] Migrated ${changed} employee badge value(s) toward ROC#####.`);
  }
  return changed;
}
