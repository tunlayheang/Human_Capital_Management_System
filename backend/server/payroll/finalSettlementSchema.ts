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
  console.log(`[final-settlement] Added ${table}.${column}`);
}

export type FinalSettlementStatus =
  | 'DRAFT'
  | 'HR_REVIEW'
  | 'FINANCE_REVIEW'
  | 'MANAGEMENT_APPROVAL'
  | 'APPROVED'
  | 'PENDING_REMOVAL_APPROVAL'
  | 'PENDING_PAYROLL_OFFBOARD'
  | 'LOCKED'
  | 'PAYMENT_PROCESSING'
  | 'PAID'
  | 'REJECTED';

export const FinalSettlementRun = sequelize.define(
  'FinalSettlementRun',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    /** employees.id — portal user resolved at runtime via users.employeeId. */
    employee_id: { type: DataTypes.STRING, allowNull: false, field: 'employee_id' },
    month: { type: DataTypes.STRING(7), allowNull: false },
    payrollType: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'FINAL_SETTLEMENT',
    },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'DRAFT' },
    lastWorkingDate: { type: DataTypes.STRING(10), allowNull: false },
    finalSettlementDate: { type: DataTypes.STRING(10), allowNull: true },
    paymentDate: { type: DataTypes.STRING(10), allowNull: true },
    prorationMethod: { type: DataTypes.STRING(32), allowNull: true },
    prorationFactor: { type: DataTypes.DECIMAL(8, 4), allowNull: true },
    linkedMonthlyRunId: { type: DataTypes.STRING, allowNull: true },
    linkedPayslipId: { type: DataTypes.STRING, allowNull: true },
    payslipId: { type: DataTypes.STRING, allowNull: true },
    paymentBatchId: { type: DataTypes.STRING, allowNull: true },
    payrollCalendarId: { type: DataTypes.STRING, allowNull: true },
    payrollCycleId: { type: DataTypes.STRING, allowNull: true },
    grossUsd: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    netUsd: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    clearanceJson: { type: DataTypes.TEXT, allowNull: true },
    settlementLinesJson: { type: DataTypes.TEXT, allowNull: true },
    breakdownSnapshotJson: { type: DataTypes.TEXT, allowNull: true },
    originalBreakdownJson: { type: DataTypes.TEXT, allowNull: true },
    hrReviewedBy: { type: DataTypes.STRING, allowNull: true },
    financeReviewedBy: { type: DataTypes.STRING, allowNull: true },
    managementApprovedBy: { type: DataTypes.STRING, allowNull: true },
    disbursementMode: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'SEPARATE_IMMEDIATE',
    },
    payrollOverlapJson: { type: DataTypes.TEXT, allowNull: true },
    recommendedPayUsd: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    paymentDecision: { type: DataTypes.STRING(32), allowNull: true },
    paymentDetailsJson: { type: DataTypes.TEXT, allowNull: true },
    paymentProcessedBy: { type: DataTypes.STRING, allowNull: true },
    paymentProcessedAt: { type: DataTypes.DATE, allowNull: true },
    removalApprovedBy: { type: DataTypes.STRING, allowNull: true },
    removalApprovedAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'finalsettlementruns', timestamps: true }
);

export async function ensureFinalSettlementSchema(): Promise<void> {
  const table = 'finalsettlementruns';
  if (!(await tableExists(table))) {
    await FinalSettlementRun.sync();
    console.log('[final-settlement] Created finalsettlementruns');
  }
  await ensureColumn(table, 'disbursementMode', "VARCHAR(32) NOT NULL DEFAULT 'SEPARATE_IMMEDIATE'");
  await ensureColumn(table, 'payrollOverlapJson', 'TEXT NULL');
  await ensureColumn(table, 'recommendedPayUsd', 'DECIMAL(14,2) NULL');
  await ensureColumn(table, 'paymentDecision', 'VARCHAR(32) NULL');
  await ensureColumn(table, 'paymentDetailsJson', 'TEXT NULL');
  await ensureColumn(table, 'paymentProcessedBy', 'VARCHAR(64) NULL');
  await ensureColumn(table, 'paymentProcessedAt', 'DATETIME NULL');
  await ensureColumn(table, 'removalApprovedBy', 'VARCHAR(64) NULL');
  await ensureColumn(table, 'removalApprovedAt', 'DATETIME NULL');
}
