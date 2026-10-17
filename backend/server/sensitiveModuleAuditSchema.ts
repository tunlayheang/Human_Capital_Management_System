import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  try {
    if (await columnExists(table, column)) return;
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    console.log(`[sensitive-audit] Added ${table}.${column}`);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    // Race: another instance added the column first.
    if (/Duplicate column|ER_DUP_FIELDNAME/i.test(msg)) return;
    // Table not created yet — caller will create then retry.
    if (/doesn't exist|ER_NO_SUCH_TABLE/i.test(msg)) return;
    throw err;
  }
}

export async function ensureEmployeeMovementAuditColumns(): Promise<void> {
  const table = 'employee_movements';
  await ensureColumn(table, 'modified_by', '`modified_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'modified_at', '`modified_at` VARCHAR(32) NULL');
  await ensureColumn(table, 'applied_by', '`applied_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'is_active', '`is_active` TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(table, 'is_deleted', '`is_deleted` TINYINT(1) NOT NULL DEFAULT 0');
}

export async function ensurePayrollPolicyVersionAuditColumns(): Promise<void> {
  const table = 'payroll_policy_versions';
  // Do not early-return on missing id — CREATE may have just run; always try adds.
  await ensureColumn(table, 'modified_by', '`modified_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'modified_at', '`modified_at` DATETIME NULL');
  await ensureColumn(table, 'approved_by', '`approved_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'approved_at', '`approved_at` DATETIME NULL');
  await ensureColumn(table, 'is_active', '`is_active` TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(table, 'is_deleted', '`is_deleted` TINYINT(1) NOT NULL DEFAULT 0');
}

export async function ensureExchangeRateAuditColumns(): Promise<void> {
  const table = 'exchange_rates';
  if (!(await columnExists(table, 'rate_id'))) return;
  await ensureColumn(table, 'created_by', '`created_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'modified_by', '`modified_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'modified_at', '`modified_at` DATETIME NULL');
  await ensureColumn(table, 'approved_by', '`approved_by` VARCHAR(64) NULL');
  await ensureColumn(table, 'approved_at', '`approved_at` DATETIME NULL');
  await ensureColumn(table, 'is_deleted', '`is_deleted` TINYINT(1) NOT NULL DEFAULT 0');
}

export async function ensureSensitiveModuleSchemas(): Promise<void> {
  await ensureEmployeeMovementAuditColumns();
  await ensurePayrollPolicyVersionAuditColumns();
  await ensureExchangeRateAuditColumns();
}
