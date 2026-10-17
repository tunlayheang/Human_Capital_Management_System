import { QueryTypes } from 'sequelize';
import { Payslip, sequelize } from '../db.js';

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column], type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function ensurePayrollRunPaymentColumn(column: string, ddl: string): Promise<void> {
  if (await columnExists('payrollruns', column)) return;
  await sequelize.query(`ALTER TABLE payrollruns ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[payroll] Added payrollruns.${column}`);
}

/** Run-level payment export metadata (replaces payrollpaymentbatches). */
export async function ensurePayrollRunPaymentColumns(): Promise<void> {
  await ensurePayrollRunPaymentColumn('paymentNumber', 'VARCHAR(40) NULL');
  await ensurePayrollRunPaymentColumn('paymentExportedAt', 'VARCHAR(32) NULL');
  await ensurePayrollRunPaymentColumn('paymentExportedBy', 'VARCHAR(64) NULL');
  await ensurePayrollRunPaymentColumn('bankExportRef', 'VARCHAR(120) NULL');
  await ensurePayrollRunPaymentColumn('paymentReconciledAt', 'VARCHAR(32) NULL');
}

/**
 * One-time migration: move legacy payrollpaymentbatches rows into payrollruns + payslips, then drop the table.
 */
export async function consolidatePayrollPaymentBatchesTable(): Promise<void> {
  await ensurePayrollRunPaymentColumns();
  const { ensurePayslipDisbursementSchema } = await import('./payslipDisbursementService.js');
  await ensurePayslipDisbursementSchema();

  if (!(await tableExists('payrollpaymentbatches'))) return;

  const batches = (await sequelize.query(
    `SELECT id, payrollRunId, paymentNumber, status, exportedAt, exportedBy, bankExportRef, reconciledAt
     FROM payrollpaymentbatches`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  for (const batch of batches) {
    const runId = String(batch.payrollRunId ?? '').trim();
    if (!runId) continue;
    const batchStatus = String(batch.status ?? '').toUpperCase();
    const reconciled = Boolean(batch.reconciledAt) || batchStatus === 'PAID' || batchStatus === 'RECONCILED';
    const exported = Boolean(batch.exportedAt) || batchStatus === 'EXPORTED' || batchStatus === 'PROCESSING';

    await sequelize.query(
      `UPDATE payrollruns
       SET paymentNumber = COALESCE(paymentNumber, :paymentNumber),
           paymentExportedAt = COALESCE(paymentExportedAt, :exportedAt),
           paymentExportedBy = COALESCE(paymentExportedBy, :exportedBy),
           bankExportRef = COALESCE(bankExportRef, :bankExportRef),
           paymentReconciledAt = COALESCE(paymentReconciledAt, :reconciledAt)
       WHERE id = :runId`,
      {
        replacements: {
          runId,
          paymentNumber: batch.paymentNumber ?? null,
          exportedAt: batch.exportedAt ?? null,
          exportedBy: batch.exportedBy ?? null,
          bankExportRef: batch.bankExportRef ?? null,
          reconciledAt: batch.reconciledAt ?? (reconciled ? new Date().toISOString() : null),
        },
      }
    );

    if (reconciled) {
      await Payslip.update(
        { disbursementStatus: 'PAID', status: 'PAID' },
        { where: { payrollRunId: runId } }
      );
    } else if (exported) {
      await sequelize.query(
        `UPDATE payslips
         SET disbursementStatus = 'PENDING'
         WHERE payrollRunId = :runId
           AND (disbursementStatus IS NULL OR disbursementStatus = '' OR disbursementStatus = 'PENDING')`,
        { replacements: { runId } }
      );
    }
  }

  await sequelize.query('DROP TABLE IF EXISTS payrollpaymentbatches');
  console.log('[payroll] Consolidated payrollpaymentbatches into payrollruns/payslips and dropped legacy table.');
}
