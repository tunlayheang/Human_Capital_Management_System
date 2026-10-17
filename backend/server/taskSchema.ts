import { sequelize } from './db.js';

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Returns true when the column was missing and has just been added. */
async function ensureColumn(table: string, column: string, ddl: string): Promise<boolean> {
  if (await columnExists(table, column)) return false;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[task-schema] Added ${table}.${column}`);
  return true;
}

/**
 * Task execution fields the Projects UI reads and writes. Without these columns
 * Sequelize drops them from the update payload, so progress edits never persist
 * and the project/team rollups stay at 0%.
 */
export async function ensureTaskExecutionColumns(): Promise<void> {
  if (!(await tableExists('tasks'))) return;
  const progressAdded = await ensureColumn('tasks', 'progress', 'INT NOT NULL DEFAULT 0');
  await ensureColumn('tasks', 'priority', "VARCHAR(20) NULL DEFAULT 'MEDIUM'");
  await ensureColumn('tasks', 'startDate', 'VARCHAR(255) NULL');
  await ensureColumn('tasks', 'estimatedHours', 'FLOAT NULL DEFAULT 0');
  await ensureColumn('tasks', 'loggedHours', 'FLOAT NULL DEFAULT 0');
  await ensureColumn('tasks', 'deletedAt', 'VARCHAR(64) NULL');

  if (progressAdded) {
    // Tasks completed before the column existed would otherwise report 0%.
    const [result]: unknown = await sequelize.query(
      `UPDATE \`tasks\` SET \`progress\` = 100 WHERE \`status\` = 'DONE'`
    );
    const affected = (result as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
    if (affected > 0) {
      console.log(`[task-schema] Backfilled progress=100 on ${affected} completed task(s)`);
    }
  }
}
