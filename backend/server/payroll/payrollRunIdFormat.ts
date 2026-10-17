import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '../db.js';

/** Fixed payroll run ID format: PRROC00001, PRROC00002, … */
export const PAYROLL_RUN_ID_PREFIX = 'PRROC';
export const PAYROLL_RUN_ID_PAD = 5;

const PRROC_PATTERN = /^PRROC(\d+)$/i;
/** Legacy formats still accepted for lookup / migration. */
const LEGACY_RUN_ID_PATTERN = /^(?:run-\d+|pr-\d{4}-\d{2})$/i;

export function formatPayrollRunId(serial: number): string {
  const n = Math.max(1, Math.floor(Number(serial) || 0));
  return `${PAYROLL_RUN_ID_PREFIX}${String(n).padStart(PAYROLL_RUN_ID_PAD, '0')}`;
}

export function parsePayrollRunIdSuffix(runId: string): number | null {
  const m = String(runId || '')
    .trim()
    .toUpperCase()
    .match(PRROC_PATTERN);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isCanonicalPayrollRunId(raw: unknown): boolean {
  return PRROC_PATTERN.test(String(raw ?? '').trim().toUpperCase());
}

export function isLegacyPayrollRunId(raw: unknown): boolean {
  return LEGACY_RUN_ID_PATTERN.test(String(raw ?? '').trim());
}

export function toCanonicalPayrollRunId(raw: unknown): string {
  const code = String(raw ?? '').trim();
  if (!code) return '';
  const suffix = parsePayrollRunIdSuffix(code);
  if (suffix != null) return formatPayrollRunId(suffix);
  return code;
}

/** Highest numeric PRROC suffix already used in `payrollruns.id`. */
export async function maxPayrollRunIdNumericSuffix(): Promise<number> {
  try {
    const [rows] = await sequelize.query(
      `SELECT COALESCE(MAX(CASE
         WHEN id REGEXP '^[Pp][Rr][Rr][Oo][Cc][0-9]+$'
         THEN CAST(SUBSTRING(id, 6) AS UNSIGNED)
       END), 0) AS mx
       FROM payrollruns`,
      { raw: true }
    );
    const mx = (rows as { mx?: number | string | null }[])[0]?.mx;
    const n = mx != null ? Number(mx) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.warn('maxPayrollRunIdNumericSuffix failed:', (e as Error)?.message || e);
    return 0;
  }
}

/** Allocate next unused PRROC##### (caller should create inside a transaction when possible). */
export async function allocateNextPayrollRunId(): Promise<string> {
  let max = await maxPayrollRunIdNumericSuffix();
  for (let i = 0; i < 40; i += 1) {
    const candidate = formatPayrollRunId(max + 1 + i);
    const [rows] = (await sequelize.query(
      `SELECT id FROM payrollruns WHERE UPPER(TRIM(id)) = :id LIMIT 1`,
      { replacements: { id: candidate }, raw: true }
    )) as [{ id?: string }[], unknown];
    if (!rows?.length) return candidate;
  }
  throw new Error('Could not allocate a unique payroll run ID.');
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
  const opts = transaction ? { transaction, replacements: { oldId, newId } } : { replacements: { oldId, newId } };
  const updates: Array<{ sql: string; onlyIfTable?: string }> = [
    {
      onlyIfTable: 'payslips',
      sql: `UPDATE payslips SET payrollRunId = :newId WHERE payrollRunId = :oldId`,
    },
    {
      onlyIfTable: 'payrolladjustments',
      sql: `UPDATE payrolladjustments SET payrollRunId = :newId WHERE payrollRunId = :oldId`,
    },
    {
      onlyIfTable: 'workflow_approval_steps',
      sql: `UPDATE workflow_approval_steps
            SET entity_id = :newId
            WHERE entity_type = 'payroll_run' AND entity_id = :oldId`,
    },
    {
      onlyIfTable: 'auditlogs',
      sql: `UPDATE auditlogs
            SET entityId = :newId
            WHERE entityType IN ('payroll_run', 'payroll') AND entityId = :oldId`,
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
        `[db] Skipping payroll run id remap on ${entry.onlyIfTable ?? 'unknown'}:`,
        (e as Error)?.message || e
      );
    }
  }
}

/**
 * Rewrite legacy `run-{timestamp}` / `pr-YYYY-MM` payroll run PKs to PRROC#####.
 * Soft FKs (payslips, adjustments, workflow, audit, notifications) are remapped.
 */
export async function migrateLegacyPayrollRunIds(): Promise<number> {
  if (!(await tableExists('payrollruns'))) return 0;

  const legacyRows = (await sequelize.query(
    `SELECT id, createdAt, month
     FROM payrollruns
     WHERE id NOT REGEXP '^[Pp][Rr][Rr][Oo][Cc][0-9]+$'
     ORDER BY
       CASE WHEN createdAt IS NULL OR TRIM(createdAt) = '' THEN 1 ELSE 0 END,
       createdAt ASC,
       month ASC,
       id ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<{ id: string; createdAt?: string | null; month?: string | null }>;

  if (!legacyRows.length) return 0;

  let next = (await maxPayrollRunIdNumericSuffix()) + 1;
  let changed = 0;

  for (const row of legacyRows) {
    const oldId = String(row.id ?? '').trim();
    if (!oldId || isCanonicalPayrollRunId(oldId)) continue;

    let newId = formatPayrollRunId(next);
    while (true) {
      const clash = (await sequelize.query(
        `SELECT id FROM payrollruns WHERE UPPER(TRIM(id)) = :id LIMIT 1`,
        { replacements: { id: newId }, type: QueryTypes.SELECT }
      )) as Array<{ id: string }>;
      if (!clash.length) break;
      next += 1;
      newId = formatPayrollRunId(next);
    }

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
      await sequelize.query(`UPDATE payrollruns SET id = :newId WHERE id = :oldId`, {
        replacements: { oldId, newId },
        transaction,
      });
      await remapSoftRefs(oldId, newId, transaction);
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
      await transaction.commit();
      changed += 1;
      next += 1;
      console.log(`[db] Migrated payroll run ${oldId} → ${newId}`);
    } catch (e) {
      try {
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
      } catch {
        /* ignore */
      }
      await transaction.rollback();
      console.warn(
        `[db] Failed migrating payroll run ${oldId} → ${newId}:`,
        (e as Error)?.message || e
      );
    }
  }

  if (changed > 0) {
    console.log(`[db] Migrated ${changed} payroll run id(s) to PRROC#####.`);
  }
  return changed;
}
