import { sequelize } from '../db.js';

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
  console.log(`[offboarding-schema] Added ${table}.${column}`);
}

export async function ensureEmployeeOffboardingColumns(): Promise<void> {
  const t = 'employees';
  await ensureColumn(t, 'resignation_submitted_at', 'DATETIME NULL');
  await ensureColumn(t, 'resignation_approved_at', 'DATETIME NULL');
  await ensureColumn(t, 'last_working_date', 'DATE NULL');
  await ensureColumn(t, 'final_settlement_date', 'DATE NULL');
  await ensureColumn(t, 'offboard_type', "VARCHAR(20) NULL COMMENT 'resign|terminate'");
  await ensureColumn(t, 'suspended_at', 'DATETIME NULL');
  await ensureColumn(t, 'final_removal_approved_at', 'DATETIME NULL');
  await ensureColumn(t, 'final_removal_approved_by', 'VARCHAR(64) NULL');
  await ensureColumn(t, 'offboard_pending_settlement_id', 'VARCHAR(64) NULL');
  await ensureColumn(
    t,
    'offboard_source',
    "VARCHAR(32) NULL COMMENT 'wizard|probation|employee|abandonment'"
  );
}
