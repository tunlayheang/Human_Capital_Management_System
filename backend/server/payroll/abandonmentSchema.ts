import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  if (Array.isArray(rows) && rows.length) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[abandonment-schema] Added ${table}.${column}`);
}

export const EmployeeAbandonmentCase = sequelize.define(
  'EmployeeAbandonmentCase',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    /** employees.id */
    employee_id: { type: DataTypes.STRING, allowNull: false, field: 'employee_id' },
    caseStatus: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'MONITORING',
    },
    consecutiveAbsenceDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    thresholdDays: { type: DataTypes.INTEGER, allowNull: true },
    lastValidWorkingDate: { type: DataTypes.STRING(10), allowNull: true },
    investigationJson: { type: DataTypes.TEXT, allowNull: true },
    contactAttemptsJson: { type: DataTypes.TEXT, allowNull: true },
    flaggedAt: { type: DataTypes.STRING, allowNull: true },
    underInvestigationAt: { type: DataTypes.STRING, allowNull: true },
    abscondedAt: { type: DataTypes.STRING, allowNull: true },
    abscondedBy: { type: DataTypes.STRING, allowNull: true },
    closedAt: { type: DataTypes.STRING, allowNull: true },
    payrollGroupId: { type: DataTypes.STRING(40), allowNull: true, defaultValue: 'default' },
  },
  { tableName: 'employeeabandonmentcases', timestamps: true }
);

export const PayrollDeductionAuthorization = sequelize.define(
  'PayrollDeductionAuthorization',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    /** employees.id */
    employee_id: { type: DataTypes.STRING, allowNull: false, field: 'employee_id' },
    separationType: { type: DataTypes.STRING(40), allowNull: true },
    deductionCode: { type: DataTypes.STRING(40), allowNull: false },
    deductionLabel: { type: DataTypes.STRING(120), allowNull: false },
    amountUsd: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'PENDING_APPROVAL' },
    createdBy: { type: DataTypes.STRING, allowNull: true },
    approvedBy: { type: DataTypes.STRING, allowNull: true },
    rejectedBy: { type: DataTypes.STRING, allowNull: true },
    appliedToSettlementId: { type: DataTypes.STRING, allowNull: true },
    approvedAt: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'payrolldeductionauthorizations', timestamps: true }
);

export async function ensureAbandonmentSchema(): Promise<void> {
  if (!(await tableExists('employeeabandonmentcases'))) {
    await EmployeeAbandonmentCase.sync();
    console.log('[abandonment-schema] Created employeeabandonmentcases');
  }
  if (!(await tableExists('payrolldeductionauthorizations'))) {
    await PayrollDeductionAuthorization.sync();
    console.log('[abandonment-schema] Created payrolldeductionauthorizations');
  }

  const emp = 'employees';
  await ensureColumn(emp, 'separation_type', 'VARCHAR(40) NULL');
  await ensureColumn(emp, 'last_valid_working_date', 'DATE NULL');
  await ensureColumn(emp, 'abandonment_flagged_at', 'DATETIME NULL');
  await ensureColumn(emp, 'investigation_status', "VARCHAR(32) NULL DEFAULT NULL");
}
