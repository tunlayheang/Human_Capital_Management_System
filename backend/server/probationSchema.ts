import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: any = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** worker_type + probation_confirmed_at for Art. 68 probation lifecycle. */
export async function ensureProbationLifecycleColumns(): Promise<void> {
  if (!(await columnExists('employees', 'worker_type'))) {
    await sequelize.query(
      "ALTER TABLE `employees` ADD COLUMN `worker_type` VARCHAR(32) NOT NULL DEFAULT 'regular' AFTER `probation_period_months`"
    );
    console.log('[db] Added employees.worker_type.');
  }

  if (!(await columnExists('employees', 'probation_confirmed_at'))) {
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `probation_confirmed_at` DATE NULL DEFAULT NULL AFTER `worker_type`'
    );
    console.log('[db] Added employees.probation_confirmed_at.');
  }
}
