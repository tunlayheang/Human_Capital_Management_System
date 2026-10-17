import { sequelize } from '../db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = (await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1`,
    { replacements: { table, column } }
  )) as [unknown[], unknown];
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureEmployeeReviewKpiColumns(): Promise<void> {
  const table = 'employeereviews';
  if (!(await columnExists(table, 'grade'))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`grade\` VARCHAR(5) NULL`);
  }
  if (!(await columnExists(table, 'categoryScoresJson'))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`categoryScoresJson\` TEXT NULL`);
  }
  if (!(await columnExists(table, 'periodMonth'))) {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`periodMonth\` VARCHAR(7) NULL`);
  }
}
