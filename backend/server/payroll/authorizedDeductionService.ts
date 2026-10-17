import { Op } from 'sequelize';
import { PayrollDeductionAuthorization } from './abandonmentSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import type { SeparationType } from './separationTypes.js';
import { notifyRoles } from '../notificationService.js';
import { resolveEmployeePk, findDisplayIdByEmployeePk } from '../employeeIdentity.js';

export type DeductionCode =
  | 'NO_NOTICE_PENALTY'
  | 'ABSCONDED_PENALTY'
  | 'ASSET_PENALTY'
  | 'LOAN_BALANCE'
  | 'SALARY_ADVANCE'
  | 'OTHER';

function authId(): string {
  return `pded-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createDeductionAuthorization(params: {
  employeeId: string;
  separationType?: SeparationType | null;
  deductionCode: DeductionCode;
  deductionLabel: string;
  amountUsd: number;
  reason: string;
  createdBy: string;
}) {
  const employeePk = await resolveEmployeePk(params.employeeId);
  if (!employeePk) {
    const err = new Error('Employee not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const displayId = (await findDisplayIdByEmployeePk(employeePk)) ?? params.employeeId;
  const amount = Number(params.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Deduction amount must be greater than zero') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }
  const reason = String(params.reason || '').trim();
  if (!reason) {
    const err = new Error('Deduction reason is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const row = await PayrollDeductionAuthorization.create({
    id: authId(),
    employee_id: employeePk,
    separationType: params.separationType ?? null,
    deductionCode: params.deductionCode,
    deductionLabel: params.deductionLabel,
    amountUsd: Math.round(amount * 100) / 100,
    reason,
    status: 'PENDING_APPROVAL',
    createdBy: params.createdBy,
  });

  await notifyRoles(['HR', 'ADMIN'], {
    title: 'Payroll deduction pending approval',
    message: `${params.deductionLabel} ($${amount}) for ${displayId} requires authorization.`,
    type: 'WARNING',
    link: '/payroll/final-settlement',
    idPrefix: `pded-pending-${row.get('id')}`,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_deduction_auth',
    entityId: String(row.get('id')),
    actionType: 'DEDUCTION_AUTH_CREATED',
    userId: params.createdBy,
    newValue: row.get({ plain: true }),
  });

  return row.get({ plain: true });
}

export async function transitionDeductionAuthorization(params: {
  id: string;
  action: 'approve' | 'reject';
  actorUserId: string;
  reason?: string;
}) {
  const row = await PayrollDeductionAuthorization.findByPk(params.id);
  if (!row) {
    const err = new Error('Deduction authorization not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (String(row.get('status')) !== 'PENDING_APPROVAL') {
    const err = new Error('Deduction is not pending approval') as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  if (String(row.get('createdBy')) === params.actorUserId) {
    const err = new Error('Maker-checker: creator cannot approve this deduction') as Error & {
      statusCode?: number;
    };
    err.statusCode = 403;
    throw err;
  }

  const before = row.get({ plain: true });
  const now = new Date().toISOString();
  if (params.action === 'approve') {
    await row.update({
      status: 'APPROVED',
      approvedBy: params.actorUserId,
      approvedAt: now,
    });
  } else {
    await row.update({
      status: 'REJECTED',
      rejectedBy: params.actorUserId,
    });
  }

  await writePayrollAuditLog({
    entityType: 'payroll_deduction_auth',
    entityId: params.id,
    actionType: `DEDUCTION_AUTH_${params.action.toUpperCase()}`,
    userId: params.actorUserId,
    oldValue: before,
    newValue: row.get({ plain: true }),
    metadata: { reason: params.reason },
  });

  const { notifyDeductionAuthorizationResolved } = await import('../notificationService.js');
  void notifyDeductionAuthorizationResolved({
    id: params.id,
    employeePk: String(row.get('employee_id') ?? ''),
    createdBy: String(row.get('createdBy') ?? ''),
    deductionLabel: String(row.get('deductionLabel') ?? ''),
    amountUsd: row.get('amountUsd'),
    status: String(row.get('status') ?? ''),
  });

  return row.get({ plain: true });
}

export async function listApprovedDeductionsForEmployee(employeeRef: string) {
  const employeePk = await resolveEmployeePk(employeeRef);
  if (!employeePk) return [];
  const rows = await PayrollDeductionAuthorization.findAll({
    where: {
      employee_id: employeePk,
      status: { [Op.in]: ['APPROVED', 'APPLIED'] },
    },
    order: [['createdAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function applyDeductionsToSettlement(
  employeeRef: string,
  settlementId: string
): Promise<void> {
  const employeePk = await resolveEmployeePk(employeeRef);
  if (!employeePk) return;
  const rows = await PayrollDeductionAuthorization.findAll({
    where: { employee_id: employeePk, status: 'APPROVED' },
  });
  for (const row of rows) {
    await row.update({
      status: 'APPLIED',
      appliedToSettlementId: settlementId,
    });
  }
}

export async function listDeductionAuthorizations(filters?: {
  employeeId?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.employeeId) {
    const pk = await resolveEmployeePk(filters.employeeId);
    if (pk) where.employee_id = pk;
  }
  if (filters?.status) where.status = filters.status;
  const rows = await PayrollDeductionAuthorization.findAll({
    where,
    order: [['createdAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}
