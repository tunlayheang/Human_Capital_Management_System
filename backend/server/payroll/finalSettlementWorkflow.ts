import { FinalSettlementRun, type FinalSettlementStatus } from './finalSettlementSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { type ClearanceChecklist } from './finalSettlementService.js';
import { generateFinalSettlementPayslip } from './finalSettlementService.js';
import { Employee } from '../db.js';
import {
  parsePayrollOverlap,
  validateSeparatePaymentAmount,
} from './finalSettlementPayrollOverlapService.js';
import { refreshFinalSettlementPayrollOverlap } from './finalSettlementService.js';

export function parseClearance(raw: unknown): ClearanceChecklist {
  if (!raw) return {};
  let parsed: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  } else {
    parsed = raw as Record<string, unknown>;
  }
  const result: ClearanceChecklist = {};
  if (parsed.notes != null) result.notes = String(parsed.notes);
  if (parsed.deductionUsd != null) result.deductionUsd = Number(parsed.deductionUsd);
  if (parsed._offboardMeta && typeof parsed._offboardMeta === 'object') {
    result._offboardMeta = parsed._offboardMeta as Record<string, unknown>;
  }
  return result;
}

function normalizeStatus(raw: unknown): FinalSettlementStatus {
  return String(raw ?? 'DRAFT').trim().toUpperCase() as FinalSettlementStatus;
}

type ApprovalTransitionAction =
  | 'submit'
  | 'hr_approve'
  | 'finance_approve'
  | 'management_approve'
  | 'reject';

type PaymentTransitionAction = 'record_payment' | 'skip_payment' | 'approve_final_removal';

type TransitionAction = ApprovalTransitionAction | PaymentTransitionAction;

const TARGET_STATUS: Record<ApprovalTransitionAction, FinalSettlementStatus | 'REJECTED'> = {
  submit: 'HR_REVIEW',
  hr_approve: 'FINANCE_REVIEW',
  finance_approve: 'MANAGEMENT_APPROVAL',
  management_approve: 'APPROVED',
  reject: 'REJECTED',
};

const PAYMENT_ACTIONS = new Set<PaymentTransitionAction>([
  'record_payment',
  'skip_payment',
  'approve_final_removal',
]);

export type FinalSettlementPaymentInput = {
  method: string;
  paymentDate: string;
  reference?: string;
  amountUsd: number;
  notes?: string;
};

export async function transitionFinalSettlement(params: {
  settlementId: string;
  action: string;
  actorUserId: string;
  reason?: string;
  /** Optional clearance patch applied before submit (DRAFT only). */
  clearance?: Partial<ClearanceChecklist>;
  payment?: FinalSettlementPaymentInput;
  acknowledgePaymentVariance?: boolean;
}) {
  const row: any = await FinalSettlementRun.findByPk(params.settlementId);
  if (!row) {
    const err = new Error('Final settlement not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const action = String(params.action ?? '').toLowerCase() as TransitionAction;

  if (PAYMENT_ACTIONS.has(action as PaymentTransitionAction)) {
    return handlePaymentTransition(row, action as PaymentTransitionAction, {
      settlementId: params.settlementId,
      actorUserId: params.actorUserId,
      reason: params.reason,
      payment: params.payment,
      acknowledgePaymentVariance: params.acknowledgePaymentVariance,
    });
  }

  if (!TARGET_STATUS[action as ApprovalTransitionAction]) {
    const err = new Error(`Unknown settlement action: ${params.action}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  let from = normalizeStatus(row.status);
  const before = row.get({ plain: true });
  const target = TARGET_STATUS[action as ApprovalTransitionAction];

  const { isSimplifiedOffboardingSettlement } = await import('./simplifiedOffboardingService.js');
  const isSimplified = isSimplifiedOffboardingSettlement(
    row.get({ plain: true }) as Record<string, unknown>
  );

  if (action === 'reject') {
    if (from === 'REJECTED') {
      return row.get({ plain: true });
    }
    await row.update({ status: 'REJECTED', notes: params.reason ?? row.notes });
    await writePayrollAuditLog({
      entityType: 'final_settlement',
      entityId: params.settlementId,
      actionType: 'FINAL_SETTLEMENT_REJECTED',
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
    });
    await dispatchFinalSettlementNotification(row, 'reject', params.actorUserId);
    return row.get({ plain: true });
  }

  if (isSimplified) {
    const err = new Error(
      'This offboarding uses Pay / No pay in the wizard. Open Continue wizard and complete payment — do not use the legacy approval chain.'
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 409;
    err.code = 'SIMPLIFIED_OFFBOARDING';
    throw err;
  }

  if (from === target) {
    return row.get({ plain: true });
  }

  if (params.clearance && (from === 'DRAFT' || from === 'PAID')) {
    const merged = { ...parseClearance(row.clearanceJson), ...params.clearance };
    await row.update({ clearanceJson: JSON.stringify(merged) });
    await row.reload();
    from = normalizeStatus(row.status);
  }

  if (action === 'submit') {
    if (from !== 'DRAFT' && from !== 'PAID') {
      const err = new Error(
        `Cannot submit: settlement is already in ${from}. Refresh the list and use the next approval step.`
      ) as Error & { statusCode?: number; code?: string };
      err.statusCode = 409;
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    await row.update({ status: 'HR_REVIEW' });
  } else if (action === 'hr_approve') {
    if (from !== 'HR_REVIEW') {
      const err = invalidTransitionErr(from, action);
      throw err;
    }
    if (String(row.createdBy) === params.actorUserId) {
      const err = new Error('Maker-checker: creator cannot perform HR review.') as Error & {
        statusCode?: number;
      };
      err.statusCode = 403;
      throw err;
    }
    await row.update({ status: 'FINANCE_REVIEW', hrReviewedBy: params.actorUserId });
  } else if (action === 'finance_approve') {
    if (from !== 'FINANCE_REVIEW') {
      throw invalidTransitionErr(from, action);
    }
    await row.update({ status: 'MANAGEMENT_APPROVAL', financeReviewedBy: params.actorUserId });
  } else if (action === 'management_approve') {
    const payslipId = row.get('payslipId');
    const retryPayslipOnly =
      from === 'PAID' && !payslipId && Boolean(row.get('managementApprovedBy'));
    if (from !== 'MANAGEMENT_APPROVAL' && !retryPayslipOnly) {
      throw invalidTransitionErr(from, action);
    }
    if (!retryPayslipOnly) {
      const paymentDecision = String(row.get('paymentDecision') ?? '').toUpperCase();
      const nextStatus = paymentDecision === 'PAY' ? 'PAID' : 'APPROVED';
      await row.update({
        status: nextStatus,
        managementApprovedBy: params.actorUserId,
      });
      await refreshFinalSettlementPayrollOverlap(params.settlementId);
      await row.reload();
    } else {
      await row.update({ managementApprovedBy: params.actorUserId });
    }
    let payslipWarning: string | undefined;
    try {
      await generateFinalSettlementPayslip(params.settlementId, params.actorUserId);
      await row.reload();
    } catch (payslipErr) {
      console.error('[final-settlement] payslip generation failed:', payslipErr);
      payslipWarning = (payslipErr as Error).message;
      await row.reload();
    }
    await writePayrollAuditLog({
      entityType: 'final_settlement',
      entityId: params.settlementId,
      actionType: `FINAL_SETTLEMENT_${String(row.get('status')).toUpperCase()}`,
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
    });
    const result = row.get({ plain: true }) as Record<string, unknown>;
    if (payslipWarning) {
      result.payslipWarning = payslipWarning;
    }
    await dispatchFinalSettlementNotification(row, action, params.actorUserId);
    return result;
  }

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: params.settlementId,
    actionType: `FINAL_SETTLEMENT_${String(row.get('status')).toUpperCase()}`,
    userId: params.actorUserId,
    oldValue: before,
    newValue: row.get({ plain: true }),
  });

  await dispatchFinalSettlementNotification(row, action, params.actorUserId);

  return row.get({ plain: true });
}

async function dispatchFinalSettlementNotification(
  row: InstanceType<typeof FinalSettlementRun>,
  action: string,
  actorUserId: string
): Promise<void> {
  try {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const { notifyFinalSettlementTransition } = await import('../notificationService.js');
    await notifyFinalSettlementTransition({
      settlementId: String(plain.id),
      employeePk: String(plain.employee_id),
      month: String(plain.month ?? ''),
      action,
      actorUserId,
      createdByUserId: plain.createdBy != null ? String(plain.createdBy) : null,
      status: String(plain.status ?? ''),
    });
  } catch (err) {
    console.warn('[final-settlement] notification failed:', err);
  }
}

function invalidTransitionErr(from: string, action: string): Error & { statusCode?: number; code?: string } {
  const hints: Record<string, string> = {
    DRAFT: 'Use Submit to send this settlement to HR review.',
    HR_REVIEW: 'Use HR approve.',
    FINANCE_REVIEW: 'Use Finance approve.',
    MANAGEMENT_APPROVAL: 'Use Final approve.',
    APPROVED: 'Settlement approved — use Offboarding → Payment or record payment here.',
    PENDING_REMOVAL_APPROVAL: 'Awaiting approval to finally remove employee without payment.',
    PAID: 'Payment recorded — submit for HR review on the Complete step (or use Submit here if not in the wizard).',
    LOCKED: 'Offboarding closed without payment.',
    REJECTED: 'This settlement was rejected.',
  };
  const err = new Error(
    `Invalid step for status ${from}. ${hints[from] ?? 'Refresh the page and try the correct action.'}`
  ) as Error & { statusCode?: number; code?: string };
  err.statusCode = 409;
  err.code = 'INVALID_TRANSITION';
  return err;
}

async function handlePaymentTransition(
  row: InstanceType<typeof FinalSettlementRun>,
  action: PaymentTransitionAction,
  params: {
    settlementId: string;
    actorUserId: string;
    reason?: string;
    payment?: FinalSettlementPaymentInput;
    acknowledgePaymentVariance?: boolean;
  }
) {
  const before = row.get({ plain: true });
  const from = normalizeStatus(row.status);

  const { isSimplifiedOffboardingSettlement } = await import('./simplifiedOffboardingService.js');
  if (isSimplifiedOffboardingSettlement(before as Record<string, unknown>)) {
    const err = new Error(
      'This offboarding uses Pay / No pay in the wizard. Open Continue wizard to complete payment.'
    ) as Error & { statusCode?: number; code?: string };
    err.statusCode = 409;
    err.code = 'SIMPLIFIED_OFFBOARDING';
    throw err;
  }

  if (action === 'record_payment') {
    if (from !== 'APPROVED' && from !== 'PAYMENT_PROCESSING' && from !== 'DRAFT') {
      throw invalidTransitionErr(from, action);
    }
    await refreshFinalSettlementPayrollOverlap(params.settlementId);
    await row.reload();
    const overlap = parsePayrollOverlap(row.get('payrollOverlapJson'));
    const pay = params.payment;
    if (!pay?.method?.trim() || !pay.paymentDate?.trim()) {
      const err = new Error('Payment method and payment date are required.') as Error & {
        statusCode?: number;
      };
      err.statusCode = 400;
      throw err;
    }
    const amountUsd = Number(pay.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      const err = new Error('Valid payment amount is required.') as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }
    const payCheck = validateSeparatePaymentAmount({
      overlap,
      amountUsd,
      acknowledgeVariance: params.acknowledgePaymentVariance,
    });
    if (!payCheck.ok) {
      const err = new Error(payCheck.message) as Error & {
        statusCode?: number;
        code?: string;
      };
      err.statusCode = 409;
      err.code = 'PAYMENT_AMOUNT_CONFLICT';
      throw err;
    }
    const details = {
      decision: 'PAY',
      method: pay.method.trim(),
      paymentDate: pay.paymentDate.slice(0, 10),
      reference: pay.reference?.trim() || undefined,
      amountUsd,
      notes: pay.notes?.trim() || undefined,
      paymentVarianceAcknowledged: params.acknowledgePaymentVariance ?? false,
      recommendedPayUsd: overlap?.recommendedPayUsd ?? null,
      overlapScenario: overlap?.scenario ?? null,
    };
    const now = new Date();
    await row.update({
      status: 'PAID',
      paymentDecision: 'PAY',
      paymentDetailsJson: JSON.stringify(details),
      paymentDate: details.paymentDate,
      paymentProcessedBy: params.actorUserId,
      paymentProcessedAt: now,
    });
    await writePayrollAuditLog({
      entityType: 'final_settlement',
      entityId: params.settlementId,
      actionType: 'FINAL_SETTLEMENT_PAID',
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
    });
    await dispatchFinalSettlementNotification(row, action, params.actorUserId);
    return row.get({ plain: true });
  }

  if (action === 'skip_payment') {
    if (from !== 'APPROVED' && from !== 'DRAFT') {
      throw invalidTransitionErr(from, action);
    }
    const details = {
      decision: 'SKIP',
      reason: params.reason?.trim() || undefined,
      requestedAt: new Date().toISOString(),
      requestedBy: params.actorUserId,
    };
    await row.update({
      status: 'PENDING_REMOVAL_APPROVAL',
      paymentDecision: 'SKIP',
      paymentDetailsJson: JSON.stringify(details),
      notes: params.reason?.trim() ? String(params.reason).trim() : row.notes,
    });
    await writePayrollAuditLog({
      entityType: 'final_settlement',
      entityId: params.settlementId,
      actionType: 'FINAL_SETTLEMENT_SKIP_PAYMENT',
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
    });
    await dispatchFinalSettlementNotification(row, action, params.actorUserId);
    return row.get({ plain: true });
  }

  if (action === 'approve_final_removal') {
    if (from !== 'PENDING_REMOVAL_APPROVAL') {
      throw invalidTransitionErr(from, action);
    }
    const now = new Date();
    await row.update({
      status: 'LOCKED',
      removalApprovedBy: params.actorUserId,
      removalApprovedAt: now,
    });
    const emp = await Employee.findByPk(String(row.get('employee_id') ?? ''));
    if (emp) {
      await emp.update({
        final_removal_approved_at: now,
        final_removal_approved_by: params.actorUserId,
      });
    }
    await writePayrollAuditLog({
      entityType: 'final_settlement',
      entityId: params.settlementId,
      actionType: 'FINAL_SETTLEMENT_REMOVAL_APPROVED',
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
    });
    await dispatchFinalSettlementNotification(row, action, params.actorUserId);
    return row.get({ plain: true });
  }

  const err = new Error(`Unknown payment action: ${action}`) as Error & { statusCode?: number };
  err.statusCode = 400;
  throw err;
}
