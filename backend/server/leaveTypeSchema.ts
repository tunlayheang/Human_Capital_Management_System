import { sequelize } from './db.js';
import { inferLeaveCategory } from './leaveTypeCategory.js';

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
  console.log(`[leave-type-schema] Added ${table}.${column}`);
}

/** Category and renewal fields for leave types (idempotent). */
export async function ensureLeaveTypeCategoryColumns(): Promise<void> {
  const table = 'leavetypes';
  await ensureColumn(table, 'leaveCategory', "VARCHAR(32) NULL");
  await ensureColumn(table, 'monthlyAccrualRate', 'DECIMAL(5,2) NULL');
  await ensureColumn(table, 'yearlyResetEnabled', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'maxCarryForward', 'INT(11) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'eventTriggerType', 'VARCHAR(64) NULL');
  await ensureColumn(table, 'maxUsagePerEmployment', 'INT(11) NULL');
  await ensureColumn(table, 'affectsPayroll', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(table, 'requiresDocument', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'nameKh', 'VARCHAR(255) NULL');
  await ensureColumn(table, 'descriptionKh', 'TEXT NULL');
  // Payroll classification (attendance-driven engine). Nullable so existing rows
  // keep deriving behaviour from isPaid/affectsPayroll until explicitly configured.
  await ensureColumn(table, 'payrollCategory', 'VARCHAR(16) NULL');
  await ensureColumn(table, 'deductSalary', 'TINYINT(1) NULL');
  await ensureColumn(table, 'createdAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(table, 'updatedAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  const hasLegacyAccrual = await columnExists(table, 'accrualRate');
  const hasLegacyCarry = await columnExists(table, 'carryoverLimit');
  const legacySelect = [
    'id',
    'name',
    'code',
    'isPaid',
    'daysAllowed',
    ...(hasLegacyAccrual ? ['accrualRate'] : []),
    ...(hasLegacyCarry ? ['carryoverLimit'] : []),
    'leaveCategory',
  ].join(', ');

  const [rows]: unknown = await sequelize.query(
    `SELECT ${legacySelect} FROM \`${table}\` WHERE leaveCategory IS NULL OR leaveCategory = ''`
  );
  if (!Array.isArray(rows)) return;

  for (const row of rows as Record<string, unknown>[]) {
    const category = inferLeaveCategory(row);
    const carry = hasLegacyCarry ? Number(row.carryoverLimit ?? 0) : 0;
    const accrualSql = hasLegacyAccrual
      ? ', monthlyAccrualRate = COALESCE(monthlyAccrualRate, accrualRate)'
      : '';
    await sequelize.query(
      `UPDATE \`${table}\` SET leaveCategory = ?, maxCarryForward = COALESCE(maxCarryForward, ?)${accrualSql}
       WHERE id = ?`,
      { replacements: [category, carry, row.id] }
    );
  }

  // Migrate Annual Leave from accrual_based → join_date_based (yearly remaining for requests).
  try {
    await sequelize.query(
      `UPDATE \`${table}\`
       SET leaveCategory = 'join_date_based'
       WHERE leaveCategory = 'accrual_based'
         AND (
           UPPER(COALESCE(code, '')) = 'ANNUAL'
           OR LOWER(COALESCE(name, '')) LIKE '%annual%'
         )`
    );
  } catch (err) {
    console.warn(
      '[leave-type-schema] Annual → join_date_based migrate skipped:',
      (err as Error)?.message || err
    );
  }

  await ensurePublicHolidayLeaveType();
}

/**
 * Public holidays are modelled as a paid, fixed-allocation leave type (e.g. 9/year)
 * applied on employer-announced dates — not as a calendar exclusion. Idempotent:
 * inserts the row only when no active leave type already matches the PH code/name.
 */
export async function ensurePublicHolidayLeaveType(): Promise<void> {
  const table = 'leavetypes';
  const [existing]: unknown = await sequelize.query(
    `SELECT id FROM \`${table}\`
     WHERE UPPER(code) IN ('PUBLIC_HOLIDAY','PH','HOLIDAY')
        OR LOWER(name) LIKE '%public holiday%'
     LIMIT 1`
  );
  if (Array.isArray(existing) && existing.length > 0) return;

  try {
    await sequelize.query(
      `INSERT INTO \`${table}\`
         (id, name, code, description, isPaid, daysAllowed, leaveCategory,
          yearlyResetEnabled, affectsPayroll, requiresApproval, payrollCategory,
          deductSalary, color, isActive, createdAt, updatedAt)
       VALUES
         ('lt-public-holiday', 'Public Holiday', 'PUBLIC_HOLIDAY',
          'Paid public holiday leave applied on employer-announced dates', 1, 9,
          'fixed_allocation', 1, 1, 1, 'payable', 0, '#0EA5E9', 1, NOW(), NOW())`
    );
    console.log('[leave-type-schema] Seeded Public Holiday leave type');
  } catch (err) {
    console.warn(
      '[leave-type-schema] Public Holiday seed skipped:',
      (err as Error)?.message || err
    );
  }
}
