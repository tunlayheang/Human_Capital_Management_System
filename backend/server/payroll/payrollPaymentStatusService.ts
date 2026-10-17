import { Payslip, PayrollRun } from '../db.js';
import { consolidatePayrollPaymentBatchesTable } from './consolidatePayrollPaymentStorage.js';
import { normalizeLegacyRunStatus } from './payrollWorkflowService.js';

export type PayrollPaymentStatus = 'pending' | 'exported' | 'paid';

let storageReady = false;

async function ensurePaymentStorage(): Promise<void> {
  if (storageReady) return;
  await consolidatePayrollPaymentBatchesTable();
  storageReady = true;
}

function normalizeDisbursement(value: unknown): string {
  return String(value ?? 'PENDING').toUpperCase();
}

/** Resolve disbursement status for all payslips in a payroll run (post-approval). */
export async function resolveRunPaymentStatus(
  payrollRunId: string | null | undefined,
  runStatus: string | null | undefined
): Promise<PayrollPaymentStatus | null> {
  await ensurePaymentStorage();

  const status = normalizeLegacyRunStatus(String(runStatus ?? ''));
  if (status === 'PAID') return 'paid';
  if (!payrollRunId) return null;

  const payslips = await Payslip.findAll({
    where: { payrollRunId: String(payrollRunId) },
    attributes: ['disbursementStatus'],
    raw: true,
  });
  if (!payslips.length) {
    if (['APPROVED', 'PAYMENT_PROCESSING', 'LOCKED'].includes(status)) return 'pending';
    return null;
  }

  const disbursementStatuses = payslips.map((row) =>
    normalizeDisbursement((row as { disbursementStatus?: string }).disbursementStatus)
  );
  if (disbursementStatuses.every((s) => s === 'PAID')) return 'paid';

  const run = await PayrollRun.findByPk(String(payrollRunId), {
    attributes: ['paymentExportedAt', 'paymentReconciledAt'],
    raw: true,
  });
  const exportedAt = run ? (run as { paymentExportedAt?: string }).paymentExportedAt : null;
  if (exportedAt) return 'exported';

  if (['APPROVED', 'PAYMENT_PROCESSING', 'LOCKED'].includes(status)) {
    return 'pending';
  }

  return null;
}
