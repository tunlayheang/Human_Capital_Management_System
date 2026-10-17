import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';
import { consolidatePayrollPaymentBatchesTable, ensurePayrollRunPaymentColumns } from './consolidatePayrollPaymentStorage.js';

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
  console.log(`[payroll-hybrid] Added ${table}.${column}`);
}

export const PayrollAttendancePeriod = sequelize.define(
  'PayrollAttendancePeriod',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    month: { type: DataTypes.STRING(7), allowNull: false },
    payrollGroupId: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'default' },
    payrollCalendarId: { type: DataTypes.STRING(40), allowNull: true },
    payrollCycleId: { type: DataTypes.STRING(64), allowNull: true },
    payPeriodStart: { type: DataTypes.STRING(10), allowNull: false },
    payPeriodEnd: { type: DataTypes.STRING(10), allowNull: false },
    attendanceCutoffDate: { type: DataTypes.STRING(10), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OPEN' },
    freezeTrigger: { type: DataTypes.STRING(20), allowNull: true },
    finalizedBy: { type: DataTypes.STRING, allowNull: true },
    finalizedAt: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'payrollattendanceperiods', timestamps: true }
);

export const PayrollAdjustment = sequelize.define(
  'PayrollAdjustment',
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    payrollRunId: { type: DataTypes.STRING, allowNull: true },
    payslipId: { type: DataTypes.STRING, allowNull: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    month: { type: DataTypes.STRING(7), allowNull: false },
    adjustmentType: { type: DataTypes.STRING(40), allowNull: false },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'DRAFT' },
    description: { type: DataTypes.TEXT, allowNull: true },
    oldValuesJson: { type: DataTypes.TEXT, allowNull: true },
    newValuesJson: { type: DataTypes.TEXT, allowNull: true },
    amountUsd: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    createdBy: { type: DataTypes.STRING, allowNull: true },
    reviewedBy: { type: DataTypes.STRING, allowNull: true },
    approvedBy: { type: DataTypes.STRING, allowNull: true },
    appliedAt: { type: DataTypes.STRING, allowNull: true },
  },
  { tableName: 'payrolladjustments', timestamps: true }
);

export async function ensurePayrollHybridSchema(): Promise<void> {
  if (!(await tableExists('payrollattendanceperiods'))) {
    await PayrollAttendancePeriod.sync();
    console.log('[payroll-hybrid] Created payrollattendanceperiods');
  }
  if (!(await tableExists('payrolladjustments'))) {
    await PayrollAdjustment.sync();
    console.log('[payroll-hybrid] Created payrolladjustments');
  }

  // Add payrollruns columns before payment-batch consolidation so a consolidation
  // failure cannot leave the model ahead of the live table (GET /payroll/runs 500).
  await ensurePayrollRunPaymentColumns();
  await ensureColumn('payrollruns', 'payPeriodStart', 'VARCHAR(10) NULL');
  await ensureColumn('payrollruns', 'payPeriodEnd', 'VARCHAR(10) NULL');
  await ensureColumn('payrollruns', 'attendanceCutoffDate', 'VARCHAR(10) NULL');
  await ensureColumn('payrollruns', 'calculatedBy', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'calculatedAt', 'VARCHAR(32) NULL');
  await ensureColumn('payrollruns', 'reviewedBy', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'approvedBy', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'lockedAt', 'VARCHAR(32) NULL');
  await ensureColumn('payrollruns', 'lockedBy', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'payrollCalendarId', 'VARCHAR(40) NULL');
  await ensureColumn('payrollruns', 'payrollCycleId', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'payrollGroupId', 'VARCHAR(40) NULL');
  await ensureColumn('payrollruns', 'paymentNumber', 'VARCHAR(40) NULL');
  await ensureColumn('payrollruns', 'paymentExportedAt', 'VARCHAR(32) NULL');
  await ensureColumn('payrollruns', 'paymentExportedBy', 'VARCHAR(64) NULL');
  await ensureColumn('payrollruns', 'bankExportRef', 'VARCHAR(120) NULL');
  await ensureColumn('payrollruns', 'paymentReconciledAt', 'VARCHAR(32) NULL');
  await ensureColumn('payrollruns', 'updatedAt', 'DATETIME NULL');

  try {
    await consolidatePayrollPaymentBatchesTable();
  } catch (err) {
    console.warn(
      '[payroll-hybrid] Payment batch consolidation skipped:',
      (err as Error)?.message || err
    );
  }

  await ensureColumn('payrollattendanceperiods', 'payrollGroupId', "VARCHAR(40) NOT NULL DEFAULT 'default'");
  await ensureColumn('payrollattendanceperiods', 'payrollCalendarId', 'VARCHAR(40) NULL');
  await ensureColumn('payrollattendanceperiods', 'payrollCycleId', 'VARCHAR(64) NULL');
  await ensureColumn('payrollattendanceperiods', 'freezeTrigger', 'VARCHAR(20) NULL');
  await ensureColumn('payrollattendanceperiods', 'createdAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('payrollattendanceperiods', 'updatedAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await ensureColumn('payslipbreakdowns', 'hybridComponentsJson', 'LONGTEXT NULL');
  await ensureColumn('payslipbreakdowns', 'contractBaseSalary', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await ensureColumn('payslipbreakdowns', 'otHours100', 'DECIMAL(8,2) NOT NULL DEFAULT 0');
  await ensureColumn('payslipbreakdowns', 'otAmount100', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
}
