import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '../db.js';

/** Fixed payslip ID format: PSROC1, PSROC2, … (no zero-padding). */
export const PAYSLIP_ID_PREFIX = 'PSROC';

const PSROC_PATTERN = /^PSROC(\d+)$/i;

export function formatPayslipId(serial: number): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  return `${PAYSLIP_ID_PREFIX}${n}`;
}

export function parsePayslipIdSuffix(payslipId: string): number | null {
  const m = String(payslipId || '')
    .trim()
    .toUpperCase()
    .match(PSROC_PATTERN);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isCanonicalPayslipId(raw: unknown): boolean {
  return PSROC_PATTERN.test(String(raw ?? '').trim().toUpperCase());
}

/** Highest numeric PSROC suffix already used in `payslips.id`. */
export async function maxPayslipIdNumericSuffix(): Promise<number> {
  try {
    const [rows] = await sequelize.query(
      `SELECT COALESCE(MAX(CASE
         WHEN id REGEXP '^[Pp][Ss][Rr][Oo][Cc][0-9]+$'
         THEN CAST(SUBSTRING(id, 6) AS UNSIGNED)
       END), 0) AS mx
       FROM payslips`,
      { raw: true }
    );
    const mx = (rows as { mx?: number | string | null }[])[0]?.mx;
    const n = mx != null ? Number(mx) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.warn('maxPayslipIdNumericSuffix failed:', (e as Error)?.message || e);
    return 0;
  }
}

/** Allocate the next unused PSROC# id. */
export async function allocateNextPayslipId(): Promise<string> {
  const ids = await allocateNextPayslipIds(1);
  return ids[0]!;
}

/** Allocate `count` sequential unused PSROC# ids (starting after the current max). */
export async function allocateNextPayslipIds(count: number): Promise<string[]> {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return [];

  let max = await maxPayslipIdNumericSuffix();
  const ids: string[] = [];
  let guard = 0;
  while (ids.length < n && guard < n + 80) {
    guard += 1;
    max += 1;
    const candidate = formatPayslipId(max);
    const [rows] = (await sequelize.query(
      `SELECT id FROM payslips WHERE UPPER(TRIM(id)) = :id LIMIT 1`,
      { replacements: { id: candidate }, raw: true }
    )) as [{ id?: string }[], unknown];
    if (!rows?.length) ids.push(candidate);
  }
  if (ids.length < n) {
    throw new Error('Could not allocate unique payslip IDs.');
  }
  return ids;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table }, type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function remapSoftRefs(
  oldId: string,
  newId: string,
  transaction?: Transaction
): Promise<void> {
  const opts = transaction
    ? { transaction, replacements: { oldId, newId } }
    : { replacements: { oldId, newId } };
  const updates: Array<{ sql: string; onlyIfTable?: string }> = [
    {
      onlyIfTable: 'payslipbreakdowns',
      sql: `UPDATE payslipbreakdowns SET payslipId = :newId WHERE payslipId = :oldId`,
    },
    {
      onlyIfTable: 'finalsettlementruns',
      sql: `UPDATE finalsettlementruns SET payslipId = :newId WHERE payslipId = :oldId`,
    },
    {
      onlyIfTable: 'finalsettlementruns',
      sql: `UPDATE finalsettlementruns SET linkedPayslipId = :newId WHERE linkedPayslipId = :oldId`,
    },
    {
      onlyIfTable: 'auditlogs',
      sql: `UPDATE auditlogs
            SET entityId = :newId
            WHERE entityType IN ('payslip', 'payslips', 'payroll') AND entityId = :oldId`,
    },
    {
      onlyIfTable: 'notifications',
      sql: `UPDATE notifications
            SET id = REPLACE(id, :oldId, :newId),
                entityId = CASE
                  WHEN entityId = :oldId THEN :newId
                  ELSE entityId
                END,
                message = REPLACE(IFNULL(message, ''), :oldId, :newId)
            WHERE id LIKE CONCAT('%', :oldId, '%')
               OR entityId = :oldId
               OR IFNULL(message, '') LIKE CONCAT('%', :oldId, '%')`,
    },
  ];

  for (const entry of updates) {
    if (entry.onlyIfTable && !(await tableExists(entry.onlyIfTable))) continue;
    try {
      await sequelize.query(entry.sql, opts);
    } catch (e) {
      console.warn(
        `[db] Skipping payslip id remap on ${entry.onlyIfTable ?? 'unknown'}:`,
        (e as Error)?.message || e
      );
    }
  }
}

/**
 * Rewrite legacy `ps-…` payslip PKs to PSROC1, PSROC2, …
 * Remaps breakdown rows, settlement refs, audit, and notifications.
 */
export async function migrateLegacyPayslipIds(): Promise<number> {
  if (!(await tableExists('payslips'))) return 0;

  const legacyRows = (await sequelize.query(
    `SELECT id, generatedAt, createdAt, month
     FROM payslips
     WHERE id NOT REGEXP '^[Pp][Ss][Rr][Oo][Cc][0-9]+$'
     ORDER BY
       CASE WHEN generatedAt IS NULL OR TRIM(generatedAt) = '' THEN 1 ELSE 0 END,
       generatedAt ASC,
       CASE WHEN createdAt IS NULL OR TRIM(createdAt) = '' THEN 1 ELSE 0 END,
       createdAt ASC,
       month ASC,
       id ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<{
    id: string;
    generatedAt?: string | null;
    createdAt?: string | null;
    month?: string | null;
  }>;

  if (!legacyRows.length) return 0;

  let next = (await maxPayslipIdNumericSuffix()) + 1;
  let changed = 0;

  for (const row of legacyRows) {
    const oldId = String(row.id ?? '').trim();
    if (!oldId || isCanonicalPayslipId(oldId)) continue;

    let newId = formatPayslipId(next);
    while (true) {
      const clash = (await sequelize.query(
        `SELECT id FROM payslips WHERE UPPER(TRIM(id)) = :id LIMIT 1`,
        { replacements: { id: newId }, type: QueryTypes.SELECT }
      )) as Array<{ id: string }>;
      if (!clash.length) break;
      next += 1;
      newId = formatPayslipId(next);
    }

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
      await sequelize.query(`UPDATE payslips SET id = :newId WHERE id = :oldId`, {
        replacements: { oldId, newId },
        transaction,
      });
      await remapSoftRefs(oldId, newId, transaction);
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
      await transaction.commit();
      changed += 1;
      next += 1;
      console.log(`[db] Migrated payslip ${oldId} → ${newId}`);
    } catch (e) {
      try {
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
      } catch {
        /* ignore */
      }
      await transaction.rollback();
      console.warn(
        `[db] Failed migrating payslip ${oldId} → ${newId}:`,
        (e as Error)?.message || e
      );
    }
  }

  if (changed > 0) {
    console.log(`[db] Migrated ${changed} payslip id(s) to PSROC#.`);
  }
  return changed;
}
