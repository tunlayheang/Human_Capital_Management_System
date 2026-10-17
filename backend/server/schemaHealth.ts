import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sequelize } from 'sequelize';
import { CORE_SCHEMA_TABLES } from '../scripts/lib/dbSafety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');

export function isOrphanEngineErrorMessage(msg: string): boolean {
  return (
    /doesn't exist in engine/i.test(msg) ||
    /\b1932\b/.test(msg) ||
    /Tablespace is missing/i.test(msg)
  );
}

function sqlMessage(err: unknown): string {
  return String(
    (err as { parent?: { sqlMessage?: string }; original?: { sqlMessage?: string }; message?: string })
      ?.parent?.sqlMessage ||
      (err as { original?: { sqlMessage?: string } })?.original?.sqlMessage ||
      (err as Error)?.message ||
      err
  );
}

/** Tables from CORE_SCHEMA_TABLES that cannot be read (missing or broken). */
export async function listMissingCoreTables(sequelize: Sequelize): Promise<string[]> {
  const tables = [...CORE_SCHEMA_TABLES];
  const missing: string[] = [];

  try {
    const [rows] = await sequelize.query(
      `SELECT LOWER(TABLE_NAME) AS t FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND LOWER(TABLE_NAME) IN (${tables.map(() => '?').join(',')})`,
      { replacements: tables.map((t) => t.toLowerCase()) }
    );
    const list = Array.isArray(rows) ? rows : [];
    const existing = new Set(
      list.map((r) => String((r as { t?: string }).t ?? '').toLowerCase()).filter(Boolean)
    );
    for (const table of tables) {
      if (!existing.has(table.toLowerCase())) missing.push(table);
    }
    if (missing.length === 0) return [];
  } catch (err) {
    console.warn(
      '[db] information_schema core-table check failed; probing with SELECT:',
      sqlMessage(err)
    );
  }

  // Authoritative fallback — information_schema can lag / differ by casing on managed MySQL.
  const confirmedMissing: string[] = [];
  const toProbe = missing.length > 0 ? missing : tables;
  for (const table of toProbe) {
    try {
      await sequelize.query(`SELECT 1 AS ok FROM \`${table}\` LIMIT 1`);
    } catch (err) {
      const msg = sqlMessage(err);
      if (isOrphanEngineErrorMessage(msg) || /doesn't exist|ER_NO_SUCH_TABLE/i.test(msg)) {
        confirmedMissing.push(table);
      } else {
        // Unexpected error (permissions, lock) — treat as present so we do not false-fail login.
        console.warn(`[db] Probe of ${table} failed (treating as present):`, msg);
      }
    }
  }
  return confirmedMissing;
}

export async function isCoreSchemaComplete(sequelize: Sequelize): Promise<boolean> {
  const missing = await listMissingCoreTables(sequelize);
  if (missing.length > 0) {
    console.warn(`[db] Missing core tables: ${missing.join(', ')}`);
  }
  return missing.length === 0;
}

/** True when portal login can authenticate against `users` (partial restore recovery). */
export async function isMinimalAuthSchemaAvailable(sequelize: Sequelize): Promise<boolean> {
  try {
    await sequelize.query('SELECT 1 AS ok FROM `users` LIMIT 1');
    return true;
  } catch (err) {
    const msg = sqlMessage(err);
    if (isOrphanEngineErrorMessage(msg) || /doesn't exist|ER_NO_SUCH_TABLE/i.test(msg)) {
      return false;
    }
    console.warn('[db] users table probe failed (treating as unavailable):', msg);
    return false;
  }
}

/**
 * Detects InnoDB #1932 orphans: `.frm`/dictionary rows exist but the tablespace
 * is detached (usually after XAMPP recreated a fresh `ibdata1`).
 */
export async function probeInnoDbEngineHealth(sequelize: Sequelize): Promise<{
  ok: boolean;
  orphanTables: string[];
  sampleError?: string;
}> {
  const orphanTables: string[] = [];
  let sampleError: string | undefined;
  for (const table of CORE_SCHEMA_TABLES) {
    try {
      await sequelize.query(`SELECT 1 AS ok FROM \`${table}\` LIMIT 1`);
    } catch (err) {
      const msg = sqlMessage(err);
      if (isOrphanEngineErrorMessage(msg)) {
        orphanTables.push(table);
        sampleError ??= msg;
      }
    }
  }
  return { ok: orphanTables.length === 0, orphanTables, sampleError };
}

/** Re-import backend/database/hcms_db.sql (fixes partial phpMyAdmin imports). */
export function repairCoreSchemaFromTemplate(): boolean {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'db:import', '--', '--empty-ok'], {
    cwd: BACKEND_ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  return result.status === 0;
}

export const INNODB_1932_RECOVERY_HINT =
  'InnoDB #1932: tables exist in metadata but not in the engine (usually ibdata1 was recreated). ' +
  'Fix local XAMPP with: npm --prefix backend run db:fix-1932';
