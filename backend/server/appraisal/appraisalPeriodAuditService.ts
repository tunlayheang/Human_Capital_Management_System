import crypto from 'crypto';
import { AuditLog } from '../db.js';
import type { AppraisalPeriodRow } from './appraisalTypes.js';

export type AppraisalPeriodAuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export function snapshotAppraisalPeriod(row: AppraisalPeriodRow | Record<string, unknown>) {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    periodType: String(r.period_type ?? r.periodType ?? ''),
    startDate: String(r.start_date ?? r.startDate ?? '').slice(0, 10),
    endDate: String(r.end_date ?? r.endDate ?? '').slice(0, 10),
    status: String(r.status ?? ''),
    isActive:
      r.is_active == null && r.isActive == null ? 1 : Number(r.is_active ?? r.isActive) === 1 ? 1 : 0,
    alertNotificationDate:
      r.alert_notification_date != null || r.alertNotificationDate != null
        ? String(r.alert_notification_date ?? r.alertNotificationDate).slice(0, 10)
        : null,
  };
}

export async function writeAppraisalPeriodAudit(params: {
  action: AppraisalPeriodAuditAction;
  periodId: string;
  oldValue?: unknown;
  newValue?: unknown;
  performedBy?: string | null;
  reason?: string | null;
}): Promise<void> {
  const verb =
    params.action === 'CREATE' ? 'created' : params.action === 'UPDATE' ? 'updated' : 'deleted';
  const id = `audit-ap-period-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await AuditLog.create({
    id,
    entityType: 'appraisal_period',
    entityId: params.periodId,
    action: params.action,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    performedBy: params.performedBy ?? 'system',
    reason: params.reason ?? `Appraisal period ${verb}`,
    metadata: {
      source: 'appraisal_period_config',
      periodName:
        (params.newValue as { name?: string } | null)?.name ??
        (params.oldValue as { name?: string } | null)?.name ??
        null,
    },
  } as any);
}
