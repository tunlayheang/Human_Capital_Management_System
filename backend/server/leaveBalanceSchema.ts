import { sequelize } from './db.js';

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[leave-balance-schema] Added ${table}.${column}`);
}

/** Accrual / renewal columns on leave balance rows. */
export async function ensureLeaveBalanceRenewalColumns(): Promise<void> {
  const table = 'leavebalances';
  await ensureColumn(table, 'openingBalance', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'accrued', 'DECIMAL(7,2) NOT NULL DEFAULT 0');
  await ensureColumn(table, 'lastAccrualMonth', 'VARCHAR(7) NULL');
}

export async function ensureEmployeeLeaveTypeAssignmentTable(): Promise<void> {
  const table = 'employeeleavetypeassignments';
  if (await tableExists(table)) return;
  await sequelize.query(`
    CREATE TABLE \`${table}\` (
      \`id\` varchar(255) NOT NULL,
      \`employeeId\` varchar(255) NOT NULL,
      \`leaveTypeId\` varchar(255) NOT NULL,
      \`year\` int(11) NOT NULL,
      \`enabled\` tinyint(1) NOT NULL DEFAULT 1,
      \`createdAt\` datetime NOT NULL,
      \`updatedAt\` datetime NOT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`emp_leave_type_year\` (\`employeeId\`,\`leaveTypeId\`,\`year\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log(`[leave-balance-schema] Created ${table}`);
}
