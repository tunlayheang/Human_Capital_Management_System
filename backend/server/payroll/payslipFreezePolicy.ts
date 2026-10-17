import { isPayrollRunLocked } from './payrollWorkflowService.js';

const FROZEN_PAYSLIP_STATUSES = new Set(['APPROVED', 'PAID', 'REJECTED']);

/** Approved / paid / rejected payslips and locked runs are view-only historical records. */
export function isPayslipViewFrozen(params: {
  payslipStatus?: unknown;
  runStatus?: unknown;
}): boolean {
  const payslipStatus = String(params.payslipStatus ?? '').toUpperCase();
  if (FROZEN_PAYSLIP_STATUSES.has(payslipStatus)) return true;
  const runStatus = String(params.runStatus ?? '').toUpperCase();
  return isPayrollRunLocked(runStatus);
}

export function isPayrollRunViewFrozen(runStatus: unknown): boolean {
  return isPayrollRunLocked(String(runStatus ?? ''));
}
