import { PayrollRun, Payslip } from '../db.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import type { PayrollRunStatus } from './hybridPayrollTypes.js';
import {
  isPayrollSelfApprovalBlocked,
  PAYROLL_MAKER_CHECKER_MESSAGE,
} from './payrollMakerChecker.js';

/** Statuses where payroll inputs (recalc, payslip edits) must stay frozen. */
const INPUT_LOCKED_STATUSES: PayrollRunStatus[] = [
  'LOCKED',
  'PAYMENT_PROCESSING',
  'PAID',
  'COMPLETED',
  'APPROVED',
];

export const PAYROLL_RUN_ALLOWED_TRANSITIONS: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  DRAFT: ['UNDER_REVIEW', 'LOCKED', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['PENDING_APPROVAL', 'DRAFT', 'LOCKED', 'REJECTED', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PAYMENT_PROCESSING', 'REVERSED'],
  LOCKED: ['PAYMENT_PROCESSING', 'REVERSED'],
  PAYMENT_PROCESSING: ['PAID', 'REVERSED'],
  PAID: ['REVERSED'],
  REJECTED: [],
  CANCELLED: [],
  REVERSED: [],
  COMPLETED: ['PAYMENT_PROCESSING', 'REVERSED'],
};

export function isPayrollRunLocked(status: string): boolean {
  const s = normalizeLegacyRunStatus(status);
  return INPUT_LOCKED_STATUSES.includes(s);
}

export function normalizeLegacyRunStatus(status: string): PayrollRunStatus {
  const s = status.toUpperCase();
  if (s === 'PROCESSING') return 'DRAFT';
  if (s === 'COMPLETED') return 'APPROVED';
  return s as PayrollRunStatus;
}

export function assertPayrollRunTransitionAllowed(
  fromStatusRaw: string,
  toStatusRaw: string
): void {
  const from = normalizeLegacyRunStatus(fromStatusRaw);
  const to = toStatusRaw.toUpperCase() as PayrollRunStatus;
  const allowed = PAYROLL_RUN_ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    const err = new Error(
      `Payroll run cannot transition from ${from} to ${to}.`
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
}

export async function transitionPayrollRun(params: {
  runId: string;
  toStatus: PayrollRunStatus;
  actorUserId: string;
  actorRole?: string;
  reason?: string;
}): Promise<void> {
  const run: any = await PayrollRun.findByPk(params.runId);
  if (!run) {
    const err = new Error('Payroll run not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const fromStatus = String(run.status ?? 'DRAFT').toUpperCase();
  const toStatus = params.toStatus.toUpperCase();

  assertPayrollRunTransitionAllowed(fromStatus, toStatus);

  const calculatedBy = run.calculatedBy ?? run.processedBy ?? null;
  if (
    (toStatus === 'APPROVED' || toStatus === 'LOCKED' || toStatus === 'COMPLETED') &&
    isPayrollSelfApprovalBlocked({
      calculatedBy,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
    })
  ) {
    const err = new Error(PAYROLL_MAKER_CHECKER_MESSAGE) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  const patch: Record<string, unknown> = { status: toStatus };
  if (toStatus === 'UNDER_REVIEW' || toStatus === 'PENDING_APPROVAL') {
    patch.reviewedBy = params.actorUserId;
  }
  if (toStatus === 'APPROVED' || toStatus === 'COMPLETED' || toStatus === 'LOCKED') {
    patch.approvedBy = params.actorUserId;
    patch.lockedAt = new Date().toISOString();
    patch.lockedBy = params.actorUserId;
  }

  if (toStatus === 'PAID' || toStatus === 'PAYMENT_PROCESSING') {
    const { findMonthlyPayConflictsForRun } = await import(
      './finalSettlementPayrollOverlapService.js'
    );
    const conflicts = await findMonthlyPayConflictsForRun(params.runId);
    if (conflicts.length) {
      const names = conflicts.map((c) => c.employeeId).join(', ');
      const err = new Error(
        `Cannot pay monthly run: final settlement awaiting separate payment for ${names}. Complete Offboarding → Payment (Option A) or resolve settlements first.`
      ) as Error & { statusCode?: number; code?: string };
      err.statusCode = 409;
      err.code = 'FINAL_SETTLEMENT_PAYMENT_PENDING';
      throw err;
    }
  }

  const before = run.get({ plain: true });
  await run.update(patch);

  if (toStatus === 'APPROVED' || toStatus === 'COMPLETED' || toStatus === 'LOCKED') {
    await Payslip.update({ status: 'APPROVED' }, { where: { payrollRunId: params.runId } });
    const { assertPayrollRunBreakdownSnapshots } = await import('./payslipSnapshotGuard.js');
    await assertPayrollRunBreakdownSnapshots(params.runId);
    const { freezePayrollInputsAfterApproval } = await import('./payrollPeriodFreezeService.js');
    await freezePayrollInputsAfterApproval({
      runId: params.runId,
      month: String(run.month ?? ''),
      actorUserId: params.actorUserId,
      payrollGroupId: String(run.payrollGroupId ?? 'default'),
    });
    const { markBackPayAdjustmentsApplied, loadPayrollRunUserIds } = await import(
      './payrollBackPayService.js'
    );
    const runUserIds = await loadPayrollRunUserIds(params.runId);
    await markBackPayAdjustmentsApplied(
      String(run.month ?? ''),
      new Date().toISOString(),
      runUserIds
    );
    const { finalizePendingOffboardingsAfterPayrollApproval } = await import(
      './simplifiedOffboardingService.js'
    );
    await finalizePendingOffboardingsAfterPayrollApproval({
      runId: params.runId,
      month: String(run.month ?? ''),
      actorUserId: params.actorUserId,
    });
    const { initializePayslipDisbursementForRun } = await import('./payslipDisbursementService.js');
    await initializePayslipDisbursementForRun(params.runId);
  }
  if (toStatus === 'REJECTED' || toStatus === 'CANCELLED') {
    await Payslip.update({ status: 'REJECTED' }, { where: { payrollRunId: params.runId } });
  }
  if (toStatus === 'PAID') {
    await Payslip.update(
      { status: 'PAID', disbursementStatus: 'PAID' },
      { where: { payrollRunId: params.runId } }
    );
  }

  await writePayrollAuditLog({
    entityType: 'payroll_run',
    entityId: params.runId,
    actionType: `STATUS_${toStatus}`,
    userId: params.actorUserId,
    oldValue: { status: fromStatus, ...before },
    newValue: { status: toStatus, reason: params.reason ?? null },
    metadata: { role: params.actorRole ?? null },
  });
}
