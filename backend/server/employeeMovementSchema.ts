import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: any = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function addColumnIfMissing(table: string, column: string, ddl: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  console.log(`[db] Added ${table}.${column}`);
}

/** Extended movement audit + generic value fields. */
export async function ensureEmployeeMovementExtendedColumns(): Promise<void> {
  const cols: { name: string; ddl: string }[] = [
    { name: 'field_key', ddl: '`field_key` varchar(64) DEFAULT NULL' },
    { name: 'current_value', ddl: '`current_value` text DEFAULT NULL' },
    { name: 'new_value', ddl: '`new_value` text DEFAULT NULL' },
    { name: 'approved_by', ddl: '`approved_by` varchar(255) DEFAULT NULL' },
    { name: 'approved_at', ddl: '`approved_at` varchar(255) DEFAULT NULL' },
    { name: 'modified_by', ddl: '`modified_by` varchar(64) DEFAULT NULL' },
    { name: 'modified_at', ddl: '`modified_at` varchar(32) DEFAULT NULL' },
    { name: 'applied_by', ddl: '`applied_by` varchar(64) DEFAULT NULL' },
    { name: 'is_active', ddl: '`is_active` tinyint(1) NOT NULL DEFAULT 1' },
    { name: 'is_deleted', ddl: '`is_deleted` tinyint(1) NOT NULL DEFAULT 0' },
    { name: 'assigned_approver_user_id', ddl: '`assigned_approver_user_id` varchar(64) DEFAULT NULL' },
    { name: 'rejected_by', ddl: '`rejected_by` varchar(64) DEFAULT NULL' },
    { name: 'rejected_at', ddl: '`rejected_at` varchar(32) DEFAULT NULL' },
    { name: 'rejection_reason', ddl: '`rejection_reason` text DEFAULT NULL' },
    { name: 'returned_by', ddl: '`returned_by` varchar(64) DEFAULT NULL' },
    { name: 'returned_at', ddl: '`returned_at` varchar(32) DEFAULT NULL' },
    { name: 'return_notes', ddl: '`return_notes` text DEFAULT NULL' },
  ];
  for (const { name, ddl } of cols) {
    try {
      await addColumnIfMissing('employee_movements', name, ddl);
    } catch (err) {
      console.warn(`[db] Could not add employee_movements.${name}:`, (err as Error)?.message || err);
    }
  }
}

/** Employment lifecycle separate from contract type. */
export async function ensureEmployeeEmploymentStatusColumn(): Promise<void> {
  try {
    await addColumnIfMissing(
      'employees',
      'employment_status',
      "`employment_status` varchar(32) DEFAULT NULL AFTER `contract_type`"
    );
    await sequelize.query(`
      UPDATE employees
      SET status = 'draft'
      WHERE LOWER(COALESCE(status, '')) = 'profile_incomplete'
    `);
    await sequelize.query(`
      UPDATE employees
      SET employment_status = CASE LOWER(COALESCE(status, ''))
        WHEN 'probation' THEN 'Probation'
        WHEN 'active' THEN 'Active'
        WHEN 'pending_approval' THEN 'Active'
        WHEN 'profile_incomplete' THEN 'Inactive'
        WHEN 'draft' THEN 'Inactive'
        WHEN 'resigned' THEN 'Resigned'
        WHEN 'terminated' THEN 'Terminated'
        WHEN 'absconded' THEN 'Terminated'
        WHEN 'suspended' THEN 'Suspended'
        WHEN 'retired' THEN 'Retired'
        ELSE 'Inactive'
      END
      WHERE employment_status IS NULL OR employment_status = ''
    `);
  } catch (err) {
    console.warn('[db] Could not ensure employees.employment_status:', (err as Error)?.message || err);
  }
}
