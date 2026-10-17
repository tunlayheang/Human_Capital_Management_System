import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type mysql from 'mysql2/promise';
import {
  assertInsertColumnValueAlignment,
  escapeMysqlInsertValue,
  hasAnsiQuotedCreateTable,
  normalizeAnsiQuotedIdentifiers,
  normalizeJsonColumnLiterals,
  parseCreateTableJsonColumns,
  quoteMysqlIdent,
  sanitizeCreateTableSql,
  sanitizeDumpSql,
  sanitizeInsertStatements,
  sortTablesByDependencies,
} from '../scripts/sqlSanitize.js';
import { openMysqlConnection, targetDatabaseName } from '../scripts/lib/dbSafety.js';

function normalizeRowForExport(row: mysql.RowDataPacket): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  const hasCreatedAt = Object.prototype.hasOwnProperty.call(row, 'createdAt');
  const hasUpdatedAt = Object.prototype.hasOwnProperty.call(row, 'updatedAt');
  const hasCreatedAtSnake = Object.prototype.hasOwnProperty.call(row, 'created_at');
  const hasUpdatedAtSnake = Object.prototype.hasOwnProperty.call(row, 'updated_at');

  if (hasCreatedAt && out.createdAt == null && hasCreatedAtSnake && out.created_at != null) {
    out.createdAt = out.created_at;
  }
  if (hasUpdatedAt && out.updatedAt == null && hasUpdatedAtSnake && out.updated_at != null) {
    out.updatedAt = out.updated_at;
  }
  const now = new Date();
  if (hasCreatedAt && out.createdAt == null) out.createdAt = now;
  if (hasUpdatedAt && out.updatedAt == null) out.updatedAt = now;

  const columns = Object.keys(out).filter((col) => {
    if (col === 'created_at' && hasCreatedAt) return false;
    if (col === 'updated_at' && hasUpdatedAt) return false;
    return true;
  });

  const normalized: Record<string, unknown> = {};
  for (const col of columns) {
    normalized[col] = out[col];
  }
  return normalized;
}

/** Export the active database to a SQL file (schema + data). */
export async function exportDatabaseToFile(outputPath: string): Promise<void> {
  const dbName = targetDatabaseName();
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const connection = await openMysqlConnection(false);
  const sql: string[] = [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE \`${dbName}\`;`,
    'SET FOREIGN_KEY_CHECKS=0;',
    '',
  ];

  try {
    await connection.query(`USE \`${dbName}\``);
    // Prefer MySQL backticks in SHOW CREATE TABLE (Aiven often enables ANSI_QUOTES).
    try {
      await connection.query(
        `SET SESSION sql_mode = REPLACE(REPLACE(@@SESSION.sql_mode,'ANSI_QUOTES',''),',,',',')`
      );
      await connection.query(`SET SESSION sql_quote_show_create = 1`);
    } catch {
      /* best-effort */
    }
    const [tableRows] = await connection.query({ sql: 'SHOW FULL TABLES', rowsAsArray: true });
    const tables = (tableRows as unknown[][])
      .filter((row) => row[1] === 'BASE TABLE')
      .map((row) => row[0] as string);

    const createSqlByTable = new Map<string, string>();
    for (const table of tables) {
      const tableId = quoteMysqlIdent(table);
      const [createRows] = await connection.query(`SHOW CREATE TABLE ${tableId}`);
      const row = (createRows as mysql.RowDataPacket[])[0] as { 'Create Table': string };
      const createSql = sanitizeCreateTableSql(
        normalizeAnsiQuotedIdentifiers(row['Create Table'] || '')
      );
      if (hasAnsiQuotedCreateTable(createSql)) {
        throw new Error(
          `SHOW CREATE TABLE ${table} still returned ANSI-quoted identifiers after normalization.`
        );
      }
      createSqlByTable.set(table, createSql);
    }

    const orderedTables = sortTablesByDependencies(tables, createSqlByTable);
    const jsonColsByTable = parseCreateTableJsonColumns(
      [...createSqlByTable.values()].map((c) => (c.endsWith(';') ? c : `${c};`)).join('\n')
    );

    for (const table of orderedTables) {
      // Always emit backticks — never connection.escapeId (can use "…" under ANSI_QUOTES).
      const tableId = quoteMysqlIdent(table);
      const createSql = createSqlByTable.get(table)!;
      sql.push(`DROP TABLE IF EXISTS ${tableId};`);
      sql.push(`${createSql};`);

      const jsonCols = jsonColsByTable.get(table) ?? new Set<string>();
      const [rows] = await connection.query(`SELECT * FROM ${tableId}`);
      for (const rowData of rows as mysql.RowDataPacket[]) {
        const normalized = normalizeRowForExport(rowData);
        const columns = Object.keys(normalized);
        if (columns.length === 0) continue;

        const columnSql = columns.map((column) => quoteMysqlIdent(column)).join(', ');
        const valueSql = columns
          .map((column) =>
            escapeMysqlInsertValue((v) => connection.escape(v), normalized[column], {
              asJson: jsonCols.has(column),
            })
          )
          .join(', ');
        sql.push(`INSERT INTO ${tableId} (${columnSql}) VALUES (${valueSql});`);
      }
      sql.push('');
    }

    sql.push('SET FOREIGN_KEY_CHECKS=1;');
    let dump = `${sql.join('\n')}\n`;
    dump = normalizeAnsiQuotedIdentifiers(dump);
    dump = sanitizeDumpSql(dump);
    dump = sanitizeInsertStatements(dump);
    dump = normalizeJsonColumnLiterals(dump).sql;
    if (hasAnsiQuotedCreateTable(dump)) {
      throw new Error(
        'Backup export still contains ANSI-quoted CREATE TABLE identifiers after normalization.'
      );
    }
    // Refuse to write a dump that cannot round-trip (JSON/array expansion, schema drift).
    assertInsertColumnValueAlignment(dump);
    writeFileSync(outputPath, dump, 'utf8');
  } finally {
    await connection.end();
  }
}
