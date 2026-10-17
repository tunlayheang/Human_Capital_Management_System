import { QueryTypes } from 'sequelize';
import { PayrollRun, Payslip, sequelize } from '../db.js';
import { serializePayslipForApi } from '../payrollCalculation.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { transitionPayrollRun } from './payrollWorkflowService.js';
import { consolidatePayrollPaymentBatchesTable } from './consolidatePayrollPaymentStorage.js';
import { initializePayslipDisbursementForRun } from './payslipDisbursementService.js';
import { assertPayrollPaymentUpdatesAllowed } from './payrollPaymentUpdateWindow.js';

export type VirtualPaymentBatch = {
  id: string;
  payrollRunId: string;
  paymentNumber: string;
  status: string;
  totalAmountUsd: number;
  exportedAt: string | null;
  exportedBy: string | null;
  bankExportRef: string | null;
  reconciledAt: string | null;
  pendingCount: number;
  paidCount: number;
  holdingCount: number;
};

let storageReady = false;

async function ensurePaymentStorage(): Promise<void> {
  if (storageReady) return;
  await consolidatePayrollPaymentBatchesTable();
  storageReady = true;
}

/** Batch API ids are the payroll run id; legacy paybatch-* ids resolve while the old table still exists. */
export async function resolvePaymentBatchRunId(batchOrRunId: string): Promise<string> {
  const raw = String(batchOrRunId ?? '').trim();
  if (!raw.startsWith('paybatch-')) return raw;

  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payrollpaymentbatches' LIMIT 1`,
    { type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  if (!rows.length) return raw;

  const match = (await sequelize.query(
    `SELECT payrollRunId FROM payrollpaymentbatches WHERE id = :id LIMIT 1`,
    { replacements: { id: raw }, type: QueryTypes.SELECT }
  )) as Array<{ payrollRunId?: string }>;
  return match[0]?.payrollRunId ? String(match[0].payrollRunId) : raw;
}

function deriveBatchStatus(input: {
  runStatus: string;
  paymentExportedAt: string | null;
  paymentReconciledAt: string | null;
  pendingCount: number;
  paidCount: number;
  holdingCount: number;
  total: number;
}): string {
  const runStatus = input.runStatus.toUpperCase();
  if (runStatus === 'PAID' || (input.total > 0 && input.paidCount === input.total)) {
    return 'RECONCILED';
  }
  if (input.paymentReconciledAt) return 'RECONCILED';
  if (input.paymentExportedAt) return 'EXPORTED';
  if (input.holdingCount > 0 && input.paidCount === 0 && input.pendingCount === 0) {
    return 'PROCESSING';
  }
  if (runStatus === 'PAYMENT_PROCESSING') return 'PROCESSING';
  return 'DRAFT';
}

async function buildVirtualBatch(run: {
  id: string;
  month: string;
  status: string;
  paymentNumber?: string | null;
  paymentExportedAt?: string | null;
  paymentExportedBy?: string | null;
  bankExportRef?: string | null;
  paymentReconciledAt?: string | null;
}): Promise<VirtualPaymentBatch> {
  const payslips = await Payslip.findAll({
    where: { payrollRunId: run.id },
    attributes: ['disbursementStatus'],
    raw: true,
  });
  const statuses = payslips.map((row) =>
    String((row as { disbursementStatus?: string }).disbursementStatus ?? 'PENDING').toUpperCase()
  );
  const pendingCount = statuses.filter((s) => s === 'PENDING').length;
  const paidCount = statuses.filter((s) => s === 'PAID').length;
  const holdingCount = statuses.filter((s) => s === 'HOLDING').length;
  const total = payslips.length;

  let totalAmountUsd = 0;
  const slipRows = await Payslip.findAll({ where: { payrollRunId: run.id } });
  for (const ps of slipRows) {
    const row = await serializePayslipForApi(ps, run.month);
    totalAmountUsd += row.breakdown?.netSalary ?? 0;
  }

  const paymentNumber =
    run.paymentNumber?.trim() ||
    `PAY-${String(run.month).replace('-', '')}-${String(run.id).slice(-6)}`;

  return {
    id: run.id,
    payrollRunId: run.id,
    paymentNumber,
    status: deriveBatchStatus({
      runStatus: String(run.status ?? ''),
      paymentExportedAt: run.paymentExportedAt ?? null,
      paymentReconciledAt: run.paymentReconciledAt ?? null,
      pendingCount,
      paidCount,
      holdingCount,
      total,
    }),
    totalAmountUsd: Math.round(totalAmountUsd * 100) / 100,
    exportedAt: run.paymentExportedAt ?? null,
    exportedBy: run.paymentExportedBy ?? null,
    bankExportRef: run.bankExportRef ?? null,
    reconciledAt: run.paymentReconciledAt ?? null,
    pendingCount,
    paidCount,
    holdingCount,
  };
}

async function syncPayrollRunPaidStatusFromPayslips(
  payrollRunId: string,
  actorUserId: string
): Promise<void> {
  const payslips = await Payslip.findAll({
    where: { payrollRunId },
    attributes: ['disbursementStatus'],
    raw: true,
  });
  if (!payslips.length) return;
  const allPaid = payslips.every(
    (row) => String((row as { disbursementStatus?: string }).disbursementStatus ?? '').toUpperCase() === 'PAID'
  );
  if (!allPaid) return;

  const run: any = await PayrollRun.findByPk(payrollRunId);
  if (!run) return;
  const runStatus = String(run.status ?? '').toUpperCase();
  if (runStatus === 'PAID') return;
  if (!['APPROVED', 'LOCKED', 'PAYMENT_PROCESSING', 'COMPLETED'].includes(runStatus)) return;

  await transitionPayrollRun({
    runId: payrollRunId,
    toStatus: 'PAID',
    actorUserId,
  });
}

export async function createPaymentBatchForRun(payrollRunId: string, actorUserId: string) {
  await ensurePaymentStorage();
  const run: any = await PayrollRun.findByPk(payrollRunId);
  if (!run) {
    const err = new Error('Payroll run not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const status = String(run.status ?? '').toUpperCase();
  if (!['APPROVED', 'LOCKED', 'COMPLETED'].includes(status)) {
    const err = new Error('Payroll run must be approved before creating a payment batch.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 409;
    throw err;
  }
  assertPayrollPaymentUpdatesAllowed(run.get({ plain: true }));

  const paymentNumber = `PAY-${String(run.month).replace('-', '')}-${Date.now().toString().slice(-6)}`;
  await run.update({ paymentNumber });

  await initializePayslipDisbursementForRun(payrollRunId);

  await transitionPayrollRun({
    runId: payrollRunId,
    toStatus: 'PAYMENT_PROCESSING',
    actorUserId,
  });

  const batch = await buildVirtualBatch({
    id: payrollRunId,
    month: String(run.month ?? ''),
    status: 'PAYMENT_PROCESSING',
    paymentNumber,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_run',
    entityId: payrollRunId,
    actionType: 'PAYMENT_BATCH_CREATED',
    userId: actorUserId,
    newValue: batch,
  });

  return batch;
}

export async function exportPaymentBatch(batchId: string, actorUserId: string) {
  await ensurePaymentStorage();
  const payrollRunId = await resolvePaymentBatchRunId(batchId);
  const run: any = await PayrollRun.findByPk(payrollRunId);
  if (!run) {
    const err = new Error('Payment batch not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  assertPayrollPaymentUpdatesAllowed(run.get({ plain: true }));

  const before = run.get({ plain: true });
  const paymentNumber =
    run.paymentNumber?.trim() ||
    `PAY-${String(run.month).replace('-', '')}-${Date.now().toString().slice(-6)}`;
  const ref = `BANK-${paymentNumber}`;
  const exportedAt = new Date().toISOString();

  await run.update({
    paymentNumber,
    paymentExportedAt: exportedAt,
    paymentExportedBy: actorUserId,
    bankExportRef: ref,
  });

  const batch = await buildVirtualBatch({
    id: payrollRunId,
    month: String(run.month ?? ''),
    status: String(run.status ?? ''),
    paymentNumber,
    paymentExportedAt: exportedAt,
    paymentExportedBy: actorUserId,
    bankExportRef: ref,
    paymentReconciledAt: run.paymentReconciledAt ?? null,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_run',
    entityId: payrollRunId,
    actionType: 'PAYMENT_EXPORT',
    userId: actorUserId,
    oldValue: before,
    newValue: batch,
  });

  return {
    batch,
    exportFormat: 'csv',
    bankExportRef: ref,
    lines: [],
  };
}

export async function reconcilePaymentBatch(batchId: string, actorUserId: string) {
  await ensurePaymentStorage();
  const payrollRunId = await resolvePaymentBatchRunId(batchId);
  const run: any = await PayrollRun.findByPk(payrollRunId);
  if (!run) {
    const err = new Error('Payment batch not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  assertPayrollPaymentUpdatesAllowed(run.get({ plain: true }));

  if (run.paymentReconciledAt) {
    return buildVirtualBatch({
      id: payrollRunId,
      month: String(run.month ?? ''),
      status: String(run.status ?? ''),
      paymentNumber: run.paymentNumber ?? null,
      paymentExportedAt: run.paymentExportedAt ?? null,
      paymentExportedBy: run.paymentExportedBy ?? null,
      bankExportRef: run.bankExportRef ?? null,
      paymentReconciledAt: run.paymentReconciledAt ?? null,
    });
  }

  const before = run.get({ plain: true });
  const reconciledAt = new Date().toISOString();
  await run.update({ paymentReconciledAt: reconciledAt });

  const payslips = await Payslip.findAll({ where: { payrollRunId } });
  const { setPayslipDisbursementStatus } = await import('./payslipDisbursementService.js');
  for (const ps of payslips) {
    const slipStatus = String(ps.get('disbursementStatus') ?? 'PENDING').toUpperCase();
    if (slipStatus !== 'PAID') {
      await setPayslipDisbursementStatus({
        payslipId: String(ps.get('id')),
        status: 'PAID',
        actorUserId,
      });
    }
  }

  await syncPayrollRunPaidStatusFromPayslips(payrollRunId, actorUserId);

  const batch = await buildVirtualBatch({
    id: payrollRunId,
    month: String(run.month ?? ''),
    status: 'PAID',
    paymentNumber: run.paymentNumber ?? null,
    paymentExportedAt: run.paymentExportedAt ?? null,
    paymentExportedBy: run.paymentExportedBy ?? null,
    bankExportRef: run.bankExportRef ?? null,
    paymentReconciledAt: reconciledAt,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_run',
    entityId: payrollRunId,
    actionType: 'PAYMENT_RECONCILED',
    userId: actorUserId,
    oldValue: before,
    newValue: batch,
  });

  return batch;
}

export async function listPaymentBatches(payrollRunId?: string) {
  await ensurePaymentStorage();
  const where = payrollRunId ? { id: payrollRunId } : {};
  const runs = await PayrollRun.findAll({
    where,
    order: [['calculatedAt', 'DESC'], ['createdAt', 'DESC']],
    limit: payrollRunId ? 1 : 100,
    raw: true,
  });

  const approvedStatuses = ['APPROVED', 'LOCKED', 'PAYMENT_PROCESSING', 'PAID', 'COMPLETED'];
  const batches: VirtualPaymentBatch[] = [];
  for (const run of runs as Array<Record<string, unknown>>) {
    const status = String(run.status ?? '').toUpperCase();
    if (!approvedStatuses.includes(status)) continue;
    const slipCount = await Payslip.count({ where: { payrollRunId: String(run.id) } });
    if (slipCount === 0) continue;
    batches.push(
      await buildVirtualBatch({
        id: String(run.id),
        month: String(run.month ?? ''),
        status,
        paymentNumber: run.paymentNumber ? String(run.paymentNumber) : null,
        paymentExportedAt: run.paymentExportedAt ? String(run.paymentExportedAt) : null,
        paymentExportedBy: run.paymentExportedBy ? String(run.paymentExportedBy) : null,
        bankExportRef: run.bankExportRef ? String(run.bankExportRef) : null,
        paymentReconciledAt: run.paymentReconciledAt ? String(run.paymentReconciledAt) : null,
      })
    );
  }
  return batches;
}
