import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[leave-schema] Added ${table}.${column}`);
}

/** Half-day leave columns on existing databases. */
export async function ensureLeaveRequestHalfDayColumns(): Promise<void> {
  const table = 'leaverequests';
  await ensureColumn(table, 'isHalfDay', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'halfDayPeriod', "VARCHAR(2) NULL");
}
