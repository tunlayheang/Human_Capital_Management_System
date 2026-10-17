import { sequelize } from '../db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: any = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureProbationReviewSchema(): Promise<void> {
  if (!(await columnExists('employees', 'probation_next_review_date'))) {
    await sequelize.query(
      'ALTER TABLE `employees` ADD COLUMN `probation_next_review_date` DATE NULL DEFAULT NULL AFTER `probation_confirmed_at`'
    );
    console.log('[db] Added employees.probation_next_review_date.');
  }

  const table = 'employeereviews';
  const reviewCols: Array<{ name: string; ddl: string }> = [
    { name: 'recommendation', ddl: 'VARCHAR(16) NULL' },
    { name: 'evaluationRatingsJson', ddl: 'TEXT NULL' },
    { name: 'strengths', ddl: 'TEXT NULL' },
    { name: 'areasForImprovement', ddl: 'TEXT NULL' },
    { name: 'hrNotes', ddl: 'TEXT NULL' },
    { name: 'extensionDays', ddl: 'INT NULL' },
    { name: 'extensionReason', ddl: 'TEXT NULL' },
    { name: 'nextReviewDate', ddl: 'DATE NULL' },
    { name: 'overallRecommendation', ddl: 'VARCHAR(128) NULL' },
    { name: 'employeeRowId', ddl: 'VARCHAR(64) NULL' },
    { name: 'assignedHrUserId', ddl: 'VARCHAR(64) NULL' },
    { name: 'assignedManagerUserId', ddl: 'VARCHAR(64) NULL' },
    { name: 'routedByHrUserId', ddl: 'VARCHAR(64) NULL' },
    { name: 'routedAt', ddl: 'DATETIME NULL' },
    { name: 'managerSubmittedBy', ddl: 'VARCHAR(64) NULL' },
    { name: 'managerSubmittedAt', ddl: 'DATETIME NULL' },
    { name: 'employeeSubmittedBy', ddl: 'VARCHAR(64) NULL' },
    { name: 'employeeSubmittedAt', ddl: 'DATETIME NULL' },
    { name: 'outcomePayloadJson', ddl: 'TEXT NULL' },
  ];

  for (const col of reviewCols) {
    if (!(await columnExists(table, col.name))) {
      await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col.name}\` ${col.ddl}`);
      console.log(`[db] Added employeereviews.${col.name}.`);
    }
  }

  try {
    await sequelize.query(
      "ALTER TABLE `employeereviews` MODIFY COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'UPCOMING'"
    );
  } catch {
    /* column may already be VARCHAR */
  }
}
