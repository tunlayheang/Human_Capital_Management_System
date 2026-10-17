import { AuditLog } from '../db.js';
import { AUDIT_SOURCE_PAYROLL } from '../auditLogConsolidationService.js';

export type PayrollAuditPayload = {
  entityType: string;
  entityId: string;
  actionType: string;
  userId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  reason?: string | null;
};

export async function writePayrollAuditLog(payload: PayrollAuditPayload): Promise<void> {
  const payrollAuditId = `paudit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AuditLog.create({
    id: `audit-${payrollAuditId}`,
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.actionType,
    oldValue: payload.oldValue ?? null,
    newValue: payload.newValue ?? null,
    performedBy: payload.userId ?? 'system',
    reason:
      payload.reason ??
      `Payroll ${payload.entityType} ${payload.actionType}`.replace(/_/g, ' '),
    metadata: {
      source: AUDIT_SOURCE_PAYROLL,
      payrollAuditId,
      ...(payload.metadata && typeof payload.metadata === 'object'
        ? (payload.metadata as Record<string, unknown>)
        : {}),
    },
  } as any);
}
