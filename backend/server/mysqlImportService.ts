import fs from 'node:fs';
import path from 'node:path';
import type mysql from 'mysql2/promise';
import {
  assertCreateTableSqlValid,
  assertInsertColumnValueAlignment,
  hasAnsiQuotedCreateTable,
  normalizeAnsiQuotedIdentifiers,
  normalizeJsonColumnLiterals,
  repairExpandedJsonInserts,
  rewriteInsertTimestampNulls,
  sanitizeDumpSql,
  sanitizeInsertStatements,
  splitSqlStatements,
} from '../scripts/sqlSanitize.js';
import {
  assessDatabase,
  openMysqlConnection,
  targetDatabaseName,
} from '../scripts/lib/dbSafety.js';
import { healPortalAccounts } from '../scripts/lib/healPortalAccounts.js';
import { createSafetyBackup, EXPORTS_DIR } from './backupService.js';
import {
  beginDatabaseRestoreBarrier,
  endDatabaseRestoreBarrier,
} from './databaseRestoreBarrier.js';


function validateBackupSql(sql: string, filePath: string): void {
  const trimmed = sql.trim();
  if (trimmed.length < 64) {
    throw new Error(`Backup file is empty or too small: ${filePath}`);
  }
  if (!/CREATE TABLE|INSERT INTO/i.test(trimmed)) {
    throw new Error('File does not appear to be a valid SQL database backup.');
  }
}

/** After normalization, dumps must use MySQL backticks for CREATE TABLE. */
function assertMysqlCompatibleCreateTables(sql: string): void {
  if (hasAnsiQuotedCreateTable(sql)) {
    throw new Error(
      'Backup still uses ANSI double-quoted CREATE TABLE identifiers after normalization. Re-export the backup from HCMS.'
    );
  }
  if (!/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`/i.test(sql)) {
    throw new Error('Backup has no CREATE TABLE statements with MySQL identifiers.');
  }
}

/** Pre-flight check for uploaded restore files (throws Error with user-facing message). */
export function assertValidBackupSqlFile(sqlPath: string): void {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }
  let sql = fs.readFileSync(sqlPath, 'utf8');
  validateBackupSql(sql, sqlPath);
  sql = normalizeAnsiQuotedIdentifiers(sql);
  assertMysqlCompatibleCreateTables(sql);
  sql = sanitizeDumpSql(sql);
  sql = sanitizeInsertStatements(sql);
  const repaired = repairExpandedJsonInserts(sql);
  sql = repaired.sql;
  if (repaired.repairedCount > 0) {
    console.warn(
      `[restore] Upload preflight repaired ${repaired.repairedCount} expanded JSON INSERT(s).`
    );
  }
  if (repaired.unresolved.length) {
    throw new Error(
      `Backup has expanded JSON VALUES that could not be repaired: ${repaired.unresolved.join('; ')}`
    );
  }
  assertCreateTableSqlValid(sql);
  const jsonNorm = normalizeJsonColumnLiterals(sql);
  sql = jsonNorm.sql;
  assertInsertColumnValueAlignment(sql);
  // Persist normalized + repaired SQL so restore never re-reads a broken original.
  fs.writeFileSync(sqlPath, sql, 'utf8');
}

/** Managed MySQL (Aiven/Render) often rejects CREATE DATABASE / USE of another schema. */
function stripDatabaseSwitchStatements(sql: string): string {
  return sql
    .replace(/^\s*CREATE\s+DATABASE\b[^;]*;/gim, '')
    .replace(/^\s*CREATE\s+SCHEMA\b[^;]*;/gim, '')
    .replace(/^\s*USE\s+[`'"]?[\w-]+[`'"]?\s*;/gim, '');
}

async function wipeRemoteSchema(conn: mysql.Connection): Promise<void> {
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES');
  const key = rows.length > 0 ? Object.keys(rows[0] as object)[0] : null;
  if (!key) return;
  for (const row of rows) {
    const table = (row as Record<string, string>)[key];
    await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
}

function prepareStatementForExecute(stmt: string): string {
  // Last-line defense: never send ANSI-quoted DDL to a non-ANSI session.
  if (stmt.includes('"') || stmt.includes('\u201C') || stmt.includes('\u201D')) {
    return normalizeAnsiQuotedIdentifiers(stmt);
  }
  return stmt;
}

async function executeStatementsBatched(
  connection: mysql.Connection,
  statements: string[]
): Promise<number> {
  // IMPORTANT: never multi-statement batch then retry the whole batch on failure.
  // MySQL may already have applied earlier statements in the batch (autocommit),
  // and re-running them causes Duplicate entry on PRIMARY KEY.
  let done = 0;
  for (const stmt of statements) {
    const executable = prepareStatementForExecute(stmt);
    try {
      await connection.query(executable);
      done += 1;
    } catch (stmtErr) {
      const preview = executable.replace(/\s+/g, ' ').slice(0, 180);
      const detail = stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
      // Idempotent retry for leftover rows when DROP/CREATE raced or a prior partial restore remains.
      if (
        /^INSERT\s+INTO\b/i.test(executable.trim()) &&
        /Duplicate entry/i.test(detail)
      ) {
        try {
          await connection.query(executable.replace(/^INSERT\s+INTO/i, 'REPLACE INTO'));
          done += 1;
          continue;
        } catch (replaceErr) {
          const replaceDetail =
            replaceErr instanceof Error ? replaceErr.message : String(replaceErr);
          throw new Error(
            `SQL restore failed at statement ${done + 1}/${statements.length}: ${replaceDetail}. Near: ${preview}`
          );
        }
      }
      throw new Error(
        `SQL restore failed at statement ${done + 1}/${statements.length}: ${detail}. Near: ${preview}`
      );
    }
  }
  return done;
}

async function reconnectSequelize(): Promise<void> {
  try {
    const { sequelize, markDatabaseSchemaHealthy, markDatabaseSchemaUnhealthy } = await import(
      './db.js'
    );
    // Never call connectionManager.close() — Sequelize marks the manager permanently
    // closed and every later query (including login) fails until process restart.
    try {
      const pool = (
        sequelize as {
          connectionManager?: { pool?: { drain?: () => Promise<void>; clear?: () => Promise<void> } };
        }
      ).connectionManager?.pool;
      if (pool?.drain && pool?.clear) {
        await pool.drain();
        await pool.clear();
      }
    } catch {
      /* pool may be empty / unavailable */
    }
    await sequelize.authenticate();
    try {
      const { isCoreSchemaComplete } = await import('./schemaHealth.js');
      if (await isCoreSchemaComplete(sequelize)) {
        markDatabaseSchemaHealthy();
      } else {
        markDatabaseSchemaUnhealthy();
      }
    } catch {
      markDatabaseSchemaUnhealthy();
    }
  } catch (err) {
    console.warn('[restore] sequelize reconnect failed:', err);
    try {
      const { markDatabaseSchemaUnhealthy } = await import('./db.js');
      markDatabaseSchemaUnhealthy();
    } catch {
      /* ignore */
    }
  }
}

function prepareDumpSql(rawSql: string, force: boolean, targetDb: string, rawUrl?: string): string {
  let sql = rawSql;
  validateBackupSql(sql, 'in-memory');

  // Always normalize ANSI "ident" → `ident` before MySQL-specific sanitizers.
  sql = normalizeAnsiQuotedIdentifiers(sql);

  if (rawUrl || force) {
    sql = stripDatabaseSwitchStatements(sql);
  } else if (targetDb !== 'hcms_db') {
    sql = sql
      .replace(/CREATE DATABASE IF NOT EXISTS `hcms_db`[^;]*;/gi, '')
      .replace(/USE `hcms_db`/gi, `USE \`${targetDb}\``)
      .replace(/USE hcms_db/gi, `USE ${targetDb}`);
  }

  sql = sanitizeDumpSql(sql);
  sql = sanitizeInsertStatements(sql);
  // Repair dumps produced before JSON-array escape fix (expand → collapse).
  const repaired = repairExpandedJsonInserts(sql);
  if (repaired.repairedCount > 0) {
    console.warn(
      `[restore] Repaired ${repaired.repairedCount} INSERT(s) with expanded JSON values.`
    );
    for (const n of repaired.notes.slice(0, 5)) console.warn(`  - ${n}`);
    if (repaired.unresolved.length) {
      throw new Error(
        `Backup has expanded JSON VALUES that could not be repaired: ${repaired.unresolved.join('; ')}`
      );
    }
    sql = repaired.sql;
  }
  const jsonNorm = normalizeJsonColumnLiterals(sql);
  if (jsonNorm.fixedCount > 0) {
    console.warn(
      `[restore] Normalized ${jsonNorm.fixedCount} INSERT(s) with JSON-column literals.`
    );
    sql = jsonNorm.sql;
  }
  sql = rewriteInsertTimestampNulls(sql);
  assertMysqlCompatibleCreateTables(sql);
  assertCreateTableSqlValid(sql);
  // Before any wipe/import: every INSERT must match its column list and CREATE TABLE.
  assertInsertColumnValueAlignment(sql);

  return sql;
}

export type ImportDatabaseOptions = {
  force?: boolean;
  emptyOk?: boolean;
  /** Internal: rolling back to the pre-wipe safety snapshot after a failed restore. */
  isSafetyRollback?: boolean;
};

async function applyPreparedSql(
  connection: mysql.Connection,
  sql: string,
  wipe: boolean,
  targetDb: string
): Promise<number> {
  await connection.query(`USE \`${targetDb}\``);
  if (wipe) {
    await wipeRemoteSchema(connection);
  }

  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    throw new Error('Backup contained no executable SQL statements after sanitization.');
  }

  await connection.query('SET FOREIGN_KEY_CHECKS=0');
  // Prefer backticks (prepared SQL is normalized). Also enable ANSI_QUOTES so older
  // dumps that still contain "ident" cannot brick restore if a statement slips through.
  await connection.query(
    "SET SESSION sql_mode = 'ANSI_QUOTES,NO_ENGINE_SUBSTITUTION,NO_AUTO_VALUE_ON_ZERO'"
  );
  const done = await executeStatementsBatched(connection, statements);
  await connection.query('SET FOREIGN_KEY_CHECKS=1');

  // Partial restore (e.g. failed mid-file) leaves login half-working and inbox APIs 500ing.
  const { assessCoreSchema } = await import('../scripts/lib/dbSafety.js');
  const core = await assessCoreSchema(connection, targetDb);
  if (!core.complete) {
    throw new Error(
      `Restore finished but core tables are still missing: ${core.missing.join(', ')}. ` +
        `The import did not complete successfully.`
    );
  }

  return done;
}

async function postImportHeal(): Promise<void> {
  try {
    await healPortalAccounts();
  } catch (err) {
    console.warn('[restore] healPortalAccounts failed (non-fatal):', err);
  }

  try {
    const { ensureOvertimeSchema } = await import('./overtimeSchema.js');
    await ensureOvertimeSchema();
  } catch {
    /* non-fatal */
  }

  try {
    const { ensureProductionSchema } = await import('../scripts/lib/ensureProductionSchema.js');
    await ensureProductionSchema();
  } catch (err) {
    console.warn('[restore] ensureProductionSchema failed (non-fatal):', err);
  }
}

/** Import a SQL dump into the active database. Creates a safety backup when data would be overwritten. */
export async function importDatabaseFromFile(
  sqlPath: string,
  options: ImportDatabaseOptions = {}
): Promise<{ statementsExecuted: number; safetyBackupFileName?: string }> {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }

  const force = options.force === true;
  const emptyOk = options.emptyOk === true;
  const isSafetyRollback = options.isSafetyRollback === true;
  const targetDb = targetDatabaseName();
  const rawUrl = process.env.MYSQL_URL?.trim();

  // Validate + normalize BEFORE wipe so bad dumps never destroy a live database.
  const preparedSql = prepareDumpSql(fs.readFileSync(sqlPath, 'utf8'), force, targetDb, rawUrl);
  try {
    // Keep the on-disk restore artifact in MySQL-safe form for retries / audit.
    fs.writeFileSync(sqlPath, preparedSql, 'utf8');
  } catch {
    /* non-fatal — in-memory preparedSql is what we execute */
  }

  const connection = await openMysqlConnection(true);
  const assessment = await assessDatabase(connection, targetDb);

  const needsFullImport =
    !assessment.hasSchema ||
    !assessment.isSchemaComplete ||
    (assessment.employeeCount === 0 && assessment.userCount === 0);

  if (!needsFullImport && !emptyOk && !isSafetyRollback) {
    if (assessment.isProtected && !force) {
      await connection.end();
      throw new Error(
        'Restore blocked: database contains custom data. Confirm restore to proceed (a safety backup will be created first).'
      );
    }
  }

  let safetyBackupFileName: string | undefined;
  if (!needsFullImport && !isSafetyRollback) {
    try {
      const safety = await createSafetyBackup(force ? 'pre-restore-force' : 'pre-restore');
      safetyBackupFileName = safety.fileName;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('[restore] Safety backup failed:', detail);
      if (!force) {
        await connection.end();
        throw new Error(
          `Could not create a safety backup before restore: ${detail}. Confirm restore to proceed without a safety snapshot.`
        );
      }
      // Force restore (UI confirm): do not block restore when dump/export tools fail on the host.
    }
  }

  let done = 0;
  let restoreError: Error | null = null;
  beginDatabaseRestoreBarrier();
  try {
    try {
      done = await applyPreparedSql(connection, preparedSql, Boolean(rawUrl || force), targetDb);
    } catch (err) {
      restoreError = err instanceof Error ? err : new Error(String(err));
      console.error('[restore] Import failed after wipe:', restoreError.message);

      // Auto-rollback to the pre-wipe safety snapshot so login keeps working.
      if (safetyBackupFileName && !isSafetyRollback) {
        const safetyPath = path.join(EXPORTS_DIR, safetyBackupFileName);
        if (fs.existsSync(safetyPath)) {
          try {
            console.warn(`[restore] Rolling back from safety backup ${safetyBackupFileName}…`);
            const safetySql = prepareDumpSql(
              fs.readFileSync(safetyPath, 'utf8'),
              true,
              targetDb,
              rawUrl
            );
            done = await applyPreparedSql(connection, safetySql, true, targetDb);
            restoreError = new Error(
              `${restoreError.message} The previous database was restored from safety backup ${safetyBackupFileName}.`
            );
          } catch (rollbackErr) {
            const detail =
              rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
            console.error('[restore] Safety rollback failed:', detail);
            restoreError = new Error(
              `${restoreError.message} Safety rollback also failed: ${detail}`
            );
          }
        }
      }
    } finally {
      await connection.end().catch(() => undefined);
    }

    if (!restoreError) {
      await postImportHeal();
    } else if (safetyBackupFileName && /restored from safety backup/i.test(restoreError.message)) {
      // Rollback succeeded — heal as if restore succeeded, then still surface the original failure.
      await postImportHeal();
    }

    await reconnectSequelize();

    if (restoreError) throw restoreError;
    return { statementsExecuted: done, safetyBackupFileName };
  } finally {
    endDatabaseRestoreBarrier();
  }
}
