import crypto from 'crypto';
import { AuditLog } from './db.js';
import {
  AUDIT_SOURCE_SENSITIVE_MODULE,
  listSensitiveModuleAuditFromAudit,
} from './auditLogConsolidationService.js';

export type SensitiveModule =
  | 'movement'
  | 'tax_rules'
  | 'exchange_rate'
  | 'nssf_rules'
  | 'payroll_compliance_rule'
  | 'payroll_work_day_policy';

export type SensitiveAuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'APPROVE'
  | 'APPLY'
  | 'SOFT_DELETE'
  | 'RESTORE';

function auditId(): string {
  return `sma-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export async function recordSensitiveAudit(params: {
  module: SensitiveModule;
  entityId: string;
  action: SensitiveAuditAction;
  oldValue?: unknown;
  newValue?: unknown;
  createdBy?: string | null;
  modifiedBy?: string | null;
  approvedBy?: string | null;
  appliedBy?: string | null;
}): Promise<void> {
  const rowId = auditId();
  await AuditLog.create({
    id: `audit-${rowId}`,
    entityType: params.module,
    entityId: params.entityId,
    action: params.action,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    performedBy: params.createdBy ?? params.modifiedBy ?? 'system',
    reason: `Sensitive ${params.module.replace(/_/g, ' ')} ${params.action.toLowerCase()}`,
    metadata: {
      source: AUDIT_SOURCE_SENSITIVE_MODULE,
      sensitiveAuditId: rowId,
      approvedBy: params.approvedBy ?? null,
      modifiedBy: params.modifiedBy ?? null,
      appliedBy: params.appliedBy ?? null,
    },
  } as any);
}

export async function listSensitiveAudit(params: {
  module?: SensitiveModule;
  entityId?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  return listSensitiveModuleAuditFromAudit(params);
}
