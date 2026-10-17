import { PayrollAdjustment } from './payrollHybridSchema.js';
import { isPayrollRunLocked } from './payrollWorkflowService.js';
import { PayrollRun } from '../db.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import type { PayrollAdjustmentType } from './hybridPayrollTypes.js';

export async function listPayrollAdjustments(filters: {
  month?: string;
  payrollRunId?: string;
  userId?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters.month) where.month = filters.month.slice(0, 7);
  if (filters.payrollRunId) where.payrollRunId = filters.payrollRunId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.status) where.status = filters.status.toUpperCase();

  const rows = await PayrollAdjustment.findAll({
    where,
    order: [['createdAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function createPayrollAdjustment(params: {
  userId: string;
  month: string;
  adjustmentType: PayrollAdjustmentType;
  amountUsd: number;
  description?: string;
  payrollRunId?: string;
  payslipId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  createdBy: string;
}) {
  if (params.payrollRunId) {
    const run: any = await PayrollRun.findByPk(params.payrollRunId);
    if (run && isPayrollRunLocked(String(run.status))) {
      const err = new Error(
        'Cannot create adjustment against a locked payroll run. Use a new adjustment run.'
      ) as Error & { statusCode?: number };
      err.statusCode = 409;
      throw err;
    }
  }

  const id = `padj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const row = await PayrollAdjustment.create({
    id,
    payrollRunId: params.payrollRunId ?? null,
    payslipId: params.payslipId ?? null,
    userId: params.userId,
    month: params.month.slice(0, 7),
    adjustmentType: params.adjustmentType,
    status: 'PENDING_APPROVAL',
    description: params.description ?? null,
    oldValuesJson: params.oldValues != null ? JSON.stringify(params.oldValues) : null,
    newValuesJson: params.newValues != null ? JSON.stringify(params.newValues) : null,
    amountUsd: params.amountUsd,
    createdBy: params.createdBy,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_adjustment',
    entityId: id,
    actionType: 'ADJUSTMENT_CREATED',
    userId: params.createdBy,
    newValue: row.get({ plain: true }),
  });
  const { notifyRolesExcept } = await import('../notificationService.js');
  await notifyRolesExcept(['ADMIN', 'HR'], [params.createdBy], {
    idPrefix: `payroll-adjustment-review-${id}`,
    title: 'Payroll adjustment needs approval',
    message: `${params.adjustmentType.replace(/_/g, ' ')} adjustment for ${params.month.slice(0, 7)} is ready for review.`,
    type: 'WARNING',
    category: 'APPROVAL',
    priority: 'HIGH',
    entityId: id,
    entityType: 'PAYROLL_ADJUSTMENT',
    senderId: params.createdBy,
    link: '/payroll',
  });

  return row.get({ plain: true });
}

export async function approvePayrollAdjustment(
  adjustmentId: string,
  approverUserId: string
) {
  const row: any = await PayrollAdjustment.findByPk(adjustmentId);
  if (!row) {
    const err = new Error('Adjustment not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (String(row.createdBy) === approverUserId) {
    const err = new Error('Maker-checker: creator cannot approve the same adjustment.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 403;
    throw err;
  }
  const before = row.get({ plain: true });
  await row.update({
    status: 'APPROVED',
    approvedBy: approverUserId,
    reviewedBy: approverUserId,
  });
  await writePayrollAuditLog({
    entityType: 'payroll_adjustment',
    entityId: adjustmentId,
    actionType: 'ADJUSTMENT_APPROVED',
    userId: approverUserId,
    oldValue: before,
    newValue: row.get({ plain: true }),
  });
  const { createNotification, notifyUserIds } = await import('../notificationService.js');
  const employeeUserId = String(row.userId || '').trim();
  if (employeeUserId) {
    await createNotification({
      id: `payroll-adjustment-approved-${adjustmentId}-${employeeUserId}`,
      userId: employeeUserId,
      title: 'Payroll adjustment approved',
      message: `A ${String(row.adjustmentType || '').replace(/_/g, ' ').toLowerCase()} adjustment of $${Number(row.amountUsd || 0).toFixed(2)} was approved for ${row.month}.`,
      type: 'SUCCESS',
      category: 'PAYROLL',
      priority: 'HIGH',
      entityId: adjustmentId,
      entityType: 'PAYROLL_ADJUSTMENT',
      senderId: approverUserId,
      link: '/my-pay',
    });
  }
  const creatorId = String(row.createdBy || '').trim();
  if (creatorId && creatorId !== approverUserId && creatorId !== employeeUserId) {
    await notifyUserIds([creatorId], {
      idPrefix: `payroll-adjustment-approved-${adjustmentId}`,
      title: 'Payroll adjustment approved',
      message: `The ${String(row.adjustmentType || '').replace(/_/g, ' ').toLowerCase()} adjustment for ${row.month} was approved.`,
      type: 'SUCCESS',
      category: 'PAYROLL',
      entityId: adjustmentId,
      entityType: 'PAYROLL_ADJUSTMENT',
      senderId: approverUserId,
      link: '/payroll',
    });
  }
  return row.get({ plain: true });
}
