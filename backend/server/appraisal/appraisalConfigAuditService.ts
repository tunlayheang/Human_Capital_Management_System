import crypto from 'crypto';
import { AuditLog } from '../db.js';

export type AppraisalConfigAuditKey =
  | 'kpi_components'
  | 'kpi_attendance_rules'
  | 'kpi_policy'
  | 'kpi_recommendation_rules';

const CONFIG_LABELS: Record<AppraisalConfigAuditKey, string> = {
  kpi_components: 'KPI components',
  kpi_attendance_rules: 'Attendance scoring rules',
  kpi_policy: 'KPI appraisal policy',
  kpi_recommendation_rules: 'Recommendation rules',
};

export async function writeAppraisalConfigAudit(params: {
  configKey: AppraisalConfigAuditKey;
  oldValue?: unknown;
  newValue?: unknown;
  performedBy?: string | null;
  reason?: string | null;
}): Promise<void> {
  const id = `audit-ap-config-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await AuditLog.create({
    id,
    entityType: params.configKey,
    entityId: params.configKey,
    action: 'UPDATE',
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
    performedBy: params.performedBy ?? 'system',
    reason: params.reason ?? `${CONFIG_LABELS[params.configKey]} updated`,
    metadata: {
      source: 'appraisal_config',
      configKey: params.configKey,
    },
  } as any);
}
