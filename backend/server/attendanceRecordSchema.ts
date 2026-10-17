import { sequelize } from './db.js';

const ATTENDANCE_TABLE = 'attendancerecords';

async function columnMeta(
  table: string,
  column: string
): Promise<{ dataType: string; maxLen: number | null } | null> {
  const [rows]: unknown = await sequelize.query(
    `SELECT DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS maxLen
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as { dataType?: string; maxLen?: number | null };
  return {
    dataType: String(row.dataType ?? '').toLowerCase(),
    maxLen: row.maxLen != null ? Number(row.maxLen) : null,
  };
}

/** Add or widen correction audit columns — stored as VARCHAR (ISO timestamps), not MySQL DATETIME. */
async function ensureVarcharColumn(table: string, column: string, length: number): Promise<void> {
  const meta = await columnMeta(table, column);
  if (!meta) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` VARCHAR(${length}) NULL`);
    console.log(`[attendance-schema] Added ${table}.${column}`);
    return;
  }

  const isVarchar = meta.dataType === 'varchar';
  const wideEnough = isVarchar && (meta.maxLen ?? 0) >= length;
  if (wideEnough) return;

  // Older production DBs added correctionAt as DATETIME — MySQL rejects ISO strings like 2026-08-02T15:11:32.458Z.
  await sequelize.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` VARCHAR(${length}) NULL`);
  console.log(`[attendance-schema] Modified ${table}.${column} to VARCHAR(${length})`);
}

/** Idempotent columns for HR manual clock time corrections (audit trail). */
export async function ensureAttendanceRecordCorrectionColumns(): Promise<void> {
  await ensureVarcharColumn(ATTENDANCE_TABLE, 'correctionAt', 64);
  await ensureVarcharColumn(ATTENDANCE_TABLE, 'correctionBy', 64);
  await ensureVarcharColumn(ATTENDANCE_TABLE, 'correctionReason', 500);
  await ensureVarcharColumn(ATTENDANCE_TABLE, 'correctionSummary', 1000);
}
