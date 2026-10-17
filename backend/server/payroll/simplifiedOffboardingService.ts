import { Op } from 'sequelize';
import { Employee, Payslip } from '../db.js';
import { findEmployeePkByUserId } from '../employeeIdentity.js';
import { offboardEmployee, type OffboardType } from '../employeeLifecycle.js';
import { FinalSettlementRun, type FinalSettlementStatus } from './finalSettlementSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { type ClearanceChecklist } from './finalSettlementService.js';
import { employeeLookupWhere, toCanonicalEmployeeDisplayId } from '../employeeIdFormat.js';

export type OffboardMeta = {
  offboardType: OffboardType;
  offboardReason: string;
  resignationSubmittedAt?: string | null;
  resignationApprovedAt?: string | null;
  offboardedBy?: string | null;
  source?: 'wizard';
};

export type SimplifiedClearance = ClearanceChecklist & {
  _offboardMeta?: OffboardMeta;
};

/** Statuses where Pay / No-pay has not been chosen yet (includes legacy review trap). */
export const SIMPLIFIED_PRE_PAYMENT_STATUSES = [
  'DRAFT',
  'HR_REVIEW',
  'FINANCE_REVIEW',
  'MANAGEMENT_APPROVAL',
  'APPROVED',
  'PENDING_REMOVAL_APPROVAL',
] as const;

export function parseSimplifiedClearance(raw: unknown): SimplifiedClearance | ClearanceChecklist {
  if (!raw) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  } catch {
    return {};
  }
  const meta = parsed._offboardMeta as OffboardMeta | undefined;
  return meta ? { _offboardMeta: meta } : {};
}

/** Wizard / simplified settlements must not use the legacy HR→Finance→Management chain. */
export function isSimplifiedOffboardingSettlement(row: {
  clearanceJson?: unknown;
  breakdownSnapshotJson?: unknown;
  breakdown?: unknown;
}): boolean {
  const clearance = parseSimplifiedClearance(row.clearanceJson);
  const meta = clearance._offboardMeta as OffboardMeta | undefined;
  if (meta?.offboardReason || meta?.source === 'wizard') {
    return true;
  }
  const raw = row.breakdown ?? row.breakdownSnapshotJson;
  if (!raw) return false;
  try {
    const parsed =
      typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    return Boolean(parsed && parsed.simplified === true);
  } catch {
    return false;
  }
}

function serializeClearance(clearance: SimplifiedClearance): string {
  return JSON.stringify(clearance);
}

function assertPrePaymentStatus(status: string): void {
  const from = status.trim().toUpperCase();
  if ((SIMPLIFIED_PRE_PAYMENT_STATUSES as readonly string[]).includes(from)) return;
  const err = new Error(
    from === 'PENDING_PAYROLL_OFFBOARD'
      ? 'Payment decision already made — awaiting payroll approval.'
      : `Settlement is already ${from}.`
  ) as Error & { statusCode?: number };
  err.statusCode = 409;
  throw err;
}

export async function createSimplifiedOffboardingSettlement(params: {
  employeeDisplayId: string;
  lastWorkingDate: string;
  clearance: SimplifiedClearance;
  createdBy: string;
  notes?: string;
}): Promise<Record<string, unknown>> {
  const employeeDisplayId = params.employeeDisplayId.trim();
  const lwd = params.lastWorkingDate.slice(0, 10);
  const meta = params.clearance._offboardMeta;
  if (!meta?.offboardReason?.trim()) {
    const err = new Error('Offboarding reason is required.') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  if (!lwd) {
    const err = new Error('Last working date is required.') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  const emp = await Employee.findOne({ where: employeeLookupWhere(employeeDisplayId) as never });
  if (!emp) {
    const err = new Error('Employee not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const status = String(emp.get('status') ?? '').toLowerCase();
  if (['terminated', 'resigned'].includes(status)) {
    const err = new Error('Employee is already offboarded.') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const employeePk = String(emp.get('id'));

  const existing = await FinalSettlementRun.findOne({
    where: {
      employee_id: employeePk,
      status: { [Op.notIn]: ['REJECTED', 'PAID', 'LOCKED'] },
    },
  });
  if (existing) {
    const existingStatus = String(existing.get('status') ?? 'DRAFT').toUpperCase();
    const canRewrite =
      existingStatus === 'DRAFT' ||
      (isSimplifiedOffboardingSettlement(existing.get({ plain: true }) as Record<string, unknown>) &&
        (SIMPLIFIED_PRE_PAYMENT_STATUSES as readonly string[]).includes(existingStatus));
    if (!canRewrite) {
      const err = new Error(
        existingStatus === 'PENDING_PAYROLL_OFFBOARD'
          ? 'Payment decision already made for this employee — awaiting payroll approval.'
          : 'An offboarding settlement is already in progress for this employee.'
      ) as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
  }

  const month = lwd.slice(0, 7);
  const clearanceJson = serializeClearance(params.clearance);

  if (existing) {
    await existing.update({
      lastWorkingDate: lwd,
      finalSettlementDate: lwd,
      month,
      clearanceJson,
      notes: params.notes ?? null,
      grossUsd: 0,
      netUsd: 0,
      recommendedPayUsd: 0,
      disbursementMode: 'PAYROLL_BATCH',
      breakdownSnapshotJson: JSON.stringify({ simplified: true }),
      status: 'DRAFT',
    });
    await emp.update({
      offboard_pending_settlement_id: String(existing.get('id')),
      offboard_source: meta?.source ?? 'wizard',
      updated_at: new Date(),
    });
    return existing.get({ plain: true }) as Record<string, unknown>;
  }

  const id = `fsettle-${Date.now()}`;
  const row = await FinalSettlementRun.create({
    id,
    employee_id: employeePk,
    month,
    payrollType: 'FINAL_SETTLEMENT',
    disbursementMode: 'PAYROLL_BATCH',
    status: 'DRAFT',
    lastWorkingDate: lwd,
    finalSettlementDate: lwd,
    grossUsd: 0,
    netUsd: 0,
    recommendedPayUsd: 0,
    clearanceJson,
    settlementLinesJson: JSON.stringify([]),
    breakdownSnapshotJson: JSON.stringify({ simplified: true }),
    createdBy: params.createdBy,
    notes: params.notes ?? null,
  });

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: id,
    actionType: 'OFFBOARDING_SETTLEMENT_DRAFT',
    userId: params.createdBy,
    newValue: row.get({ plain: true }),
  });

  await emp.update({
    offboard_pending_settlement_id: id,
    offboard_source: meta?.source ?? 'wizard',
    updated_at: new Date(),
  });

  return row.get({ plain: true }) as Record<string, unknown>;
}

export async function completeSimplifiedOffboardingPayment(params: {
  settlementId: string;
  decision: 'PAY' | 'NO_PAY';
  actorUserId: string;
  notes?: string;
}): Promise<Record<string, unknown>> {
  const row: any = await FinalSettlementRun.findByPk(params.settlementId);
  if (!row) {
    const err = new Error('Settlement not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const from = String(row.status ?? 'DRAFT').toUpperCase();
  if (!isSimplifiedOffboardingSettlement(row.get({ plain: true }) as Record<string, unknown>)) {
    const err = new Error(
      'This settlement uses the full approval workflow. Use Record payment / Skip payment instead.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  assertPrePaymentStatus(from);

  const clearance = parseSimplifiedClearance(row.clearanceJson);
  const meta = clearance._offboardMeta;
  if (!meta?.offboardReason?.trim()) {
    const err = new Error('Settlement is missing offboarding details. Re-save the settlement step.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const employeePk = String(row.get('employee_id') ?? '');
  const emp = employeePk
    ? await Employee.findByPk(employeePk)
    : null;
  const employeeDisplayId = emp
    ? toCanonicalEmployeeDisplayId(emp.get('employee_id')) || String(emp.get('employee_id') ?? '')
    : '';
  if (!emp) {
    const err = new Error('Employee not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const before = row.get({ plain: true });
  const lwd = String(row.lastWorkingDate).slice(0, 10);
  const decision = params.decision;

  if (decision === 'NO_PAY') {
    await offboardEmployee({
      displayEmployeeId: employeeDisplayId,
      type: meta.offboardType,
      reason: meta.offboardReason.trim(),
      offboardedBy: meta.offboardedBy ?? params.actorUserId,
      lastWorkingDate: lwd,
      resignationSubmittedAt: meta.resignationSubmittedAt ?? undefined,
      resignationApprovedAt: meta.resignationApprovedAt ?? undefined,
      source: meta.source ?? 'wizard',
    });
    await row.update({
      status: 'LOCKED' as FinalSettlementStatus,
      paymentDecision: 'NO_PAY',
      paymentDetailsJson: JSON.stringify({
        decision: 'NO_PAY',
        completedAt: new Date().toISOString(),
        completedBy: params.actorUserId,
        notes: params.notes?.trim() || undefined,
      }),
      paymentProcessedBy: params.actorUserId,
      paymentProcessedAt: new Date(),
    });
    await emp.update({ offboard_pending_settlement_id: null });
  } else {
    await emp.update({
      last_working_date: lwd,
      offboard_pending_settlement_id: params.settlementId,
      updated_at: new Date(),
    });
    await row.update({
      status: 'PENDING_PAYROLL_OFFBOARD' as FinalSettlementStatus,
      paymentDecision: 'PAY',
      paymentDetailsJson: JSON.stringify({
        decision: 'PAY',
        requestedAt: new Date().toISOString(),
        requestedBy: params.actorUserId,
        notes: params.notes?.trim() || undefined,
      }),
      paymentProcessedBy: params.actorUserId,
      paymentProcessedAt: new Date(),
    });
  }

  await writePayrollAuditLog({
    entityType: 'final_settlement',
    entityId: params.settlementId,
    actionType: decision === 'PAY' ? 'OFFBOARDING_PAY_DEFERRED' : 'OFFBOARDING_NO_PAY',
    userId: params.actorUserId,
    oldValue: before,
    newValue: row.get({ plain: true }),
  });

  return row.get({ plain: true }) as Record<string, unknown>;
}

/** After monthly payroll is approved, offboard employees who chose Pay and were on that run. */
export async function finalizePendingOffboardingsAfterPayrollApproval(params: {
  runId: string;
  month: string;
  actorUserId: string;
}): Promise<number> {
  const payslips: any[] = await Payslip.findAll({
    where: { payrollRunId: params.runId },
    attributes: ['userId'],
  });
  if (!payslips.length) return 0;

  const payslipUserIds = [
    ...new Set(payslips.map((p) => String(p.userId ?? '').trim()).filter(Boolean)),
  ];
  const employeePks = [
    ...new Set(
      (
        await Promise.all(payslipUserIds.map((uid) => findEmployeePkByUserId(uid)))
      ).filter(Boolean) as string[]
    ),
  ];

  const employees: any[] = employeePks.length
    ? await Employee.findAll({
        where: {
          status: 'active',
          offboard_pending_settlement_id: { [Op.ne]: null },
          id: { [Op.in]: employeePks },
        },
      })
    : [];

  let count = 0;
  for (const emp of employees) {
    const settlementId = String(emp.offboard_pending_settlement_id ?? '').trim();
    if (!settlementId) continue;

    const settlement: any = await FinalSettlementRun.findByPk(settlementId);
    if (!settlement) continue;
    if (String(settlement.status) !== 'PENDING_PAYROLL_OFFBOARD') continue;
    if (String(settlement.get('employee_id')) !== String(emp.id)) continue;

    const settlementMonth = String(settlement.month ?? '').slice(0, 7);
    const runMonth = params.month.slice(0, 7);
    if (settlementMonth !== runMonth) continue;

    const clearance = parseSimplifiedClearance(settlement.clearanceJson);
    const meta = clearance._offboardMeta;
    if (!meta?.offboardReason?.trim()) continue;

    try {
      await offboardEmployee({
        displayEmployeeId: String(emp.employee_id),
        type: meta.offboardType,
        reason: meta.offboardReason.trim(),
        offboardedBy: meta.offboardedBy ?? params.actorUserId,
        lastWorkingDate: String(settlement.lastWorkingDate).slice(0, 10),
        resignationSubmittedAt: meta.resignationSubmittedAt ?? undefined,
        resignationApprovedAt: meta.resignationApprovedAt ?? undefined,
        source: meta.source ?? 'wizard',
      });
      await settlement.update({
        status: 'PAID',
        linkedMonthlyRunId: params.runId,
        paymentDetailsJson: JSON.stringify({
          ...JSON.parse(String(settlement.paymentDetailsJson ?? '{}')),
          finalizedAt: new Date().toISOString(),
          finalizedBy: params.actorUserId,
          payrollRunId: params.runId,
        }),
      });
      await emp.update({ offboard_pending_settlement_id: null });
      count += 1;
      await writePayrollAuditLog({
        entityType: 'final_settlement',
        entityId: settlementId,
        actionType: 'OFFBOARDING_PAYROLL_FINALIZED',
        userId: params.actorUserId,
        newValue: { payrollRunId: params.runId, employeeId: emp.employee_id },
      });
    } catch (err) {
      console.warn(
        '[offboarding] Could not finalize pending offboard for',
        emp.employee_id,
        (err as Error)?.message || err
      );
    }
  }
  return count;
}
