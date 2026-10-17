import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { AuditLog, sequelize } from '../db.js';

export const APPRAISAL_SCORE_AUDIT_SOURCE = 'appraisal_score';

export type AppraisalScoreAuditLegacyRow = {
  id: string;
  appraisal_id: string;
  component_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
};

export function appraisalScoreAuditId(): string {
  return `audit-${crypto.randomBytes(8).toString('hex')}`;
}

export function appraisalAuditActionLabel(fieldName: string): string {
  switch (fieldName) {
    case 'reopen_cycle_snapshot':
      return 'REOPEN_CYCLE_ARCHIVED';
    case 'workflow_status':
      return 'WORKFLOW_STATUS';
    case 'weighted_score':
      return 'SCORE_UPDATED';
    case 'locked':
      return 'LOCK_CHANGED';
    default:
      return fieldName.replace(/_/g, ' ').toUpperCase();
  }
}

function parseJsonValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return raw;
  }
}

function auditJsonToLegacyString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function legacyStringToAuditJson(value: string | number | null): unknown {
  if (value == null) return null;
  return String(value);
}

function toMysqlDatetime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(value ?? '').trim();
  if (!s) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const parsed = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  return s.slice(0, 19);
}

function mapAuditLogToLegacyRow(row: Record<string, unknown>): AppraisalScoreAuditLegacyRow {
  const metadata = parseJsonValue(row.metadata) as Record<string, unknown> | null;
  const fieldName = String(metadata?.fieldName ?? metadata?.field_name ?? row.action ?? '');
  return {
    id: String(row.id),
    appraisal_id: String(row.entityId ?? row.entity_id ?? ''),
    component_id:
      metadata?.componentId != null
        ? String(metadata.componentId)
        : metadata?.component_id != null
          ? String(metadata.component_id)
          : null,
    field_name: fieldName,
    old_value: auditJsonToLegacyString(parseJsonValue(row.oldValue ?? row.old_value)),
    new_value: auditJsonToLegacyString(parseJsonValue(row.newValue ?? row.new_value)),
    changed_by: row.performedBy != null ? String(row.performedBy) : row.changed_by != null ? String(row.changed_by) : null,
    changed_at: toMysqlDatetime(row.createdAt ?? row.changed_at),
    reason: row.reason != null ? String(row.reason) : null,
  };
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table }, type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function logAppraisalScoreChange(params: {
  appraisalId: string;
  componentId?: string | null;
  fieldName: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  changedBy?: string | null;
  reason?: string | null;
  id?: string;
  changedAt?: string | Date;
}): Promise<void> {
  const now = params.changedAt
    ? toMysqlDatetime(params.changedAt)
    : new Date().toISOString().slice(0, 19).replace('T', ' ');
  await AuditLog.create({
    id: params.id ?? appraisalScoreAuditId(),
    entityType: 'employee_appraisal',
    entityId: params.appraisalId,
    action: appraisalAuditActionLabel(params.fieldName),
    oldValue: legacyStringToAuditJson(params.oldValue),
    newValue: legacyStringToAuditJson(params.newValue),
    performedBy: params.changedBy ?? 'system',
    reason: params.reason ?? null,
    metadata: {
      source: APPRAISAL_SCORE_AUDIT_SOURCE,
      fieldName: params.fieldName,
      componentId: params.componentId ?? null,
    },
    createdAt: now,
    updatedAt: now,
  } as any);
}

export async function listAppraisalScoreAuditLog(
  appraisalId: string,
  limit = 100
): Promise<AppraisalScoreAuditLegacyRow[]> {
  const rows = (await sequelize.query(
    `SELECT *
     FROM auditlogs
     WHERE entityType = 'employee_appraisal'
       AND entityId = :appraisalId
       AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
     ORDER BY createdAt DESC
     LIMIT :limit`,
    {
      replacements: {
        appraisalId,
        source: APPRAISAL_SCORE_AUDIT_SOURCE,
        limit: Math.min(Math.max(limit, 1), 500),
      },
      type: QueryTypes.SELECT,
    }
  )) as Record<string, unknown>[];

  return rows.map(mapAuditLogToLegacyRow);
}

type LegacyScoreAuditRow = {
  id: string;
  appraisal_id: string;
  component_id?: string | null;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  changed_by?: string | null;
  changed_at: string | Date;
  reason?: string | null;
};

/** Migrate rows from `appraisal_score_audit_log` into `auditlogs`, then drop the legacy table. */
export async function ensureAppraisalScoreAuditConsolidated(): Promise<void> {
  if (!(await tableExists('appraisal_score_audit_log'))) {
    return;
  }

  const legacyRows = (await sequelize.query(
    `SELECT id, appraisal_id, component_id, field_name, old_value, new_value, changed_by, changed_at, reason
     FROM appraisal_score_audit_log
     ORDER BY changed_at ASC`,
    { type: QueryTypes.SELECT }
  )) as LegacyScoreAuditRow[];

  let migrated = 0;
  for (const row of legacyRows) {
    const existing = await AuditLog.findByPk(String(row.id), { attributes: ['id'] });
    if (existing) continue;

    await logAppraisalScoreChange({
      id: String(row.id),
      appraisalId: String(row.appraisal_id),
      componentId: row.component_id ?? null,
      fieldName: String(row.field_name),
      oldValue: row.old_value ?? null,
      newValue: row.new_value ?? null,
      changedBy: row.changed_by ?? 'system',
      reason: row.reason ?? null,
      changedAt: row.changed_at,
    });
    migrated += 1;
  }

  await sequelize.query('DROP TABLE IF EXISTS `appraisal_score_audit_log`', { raw: true });
  console.log(
    `[db] Consolidated appraisal_score_audit_log into auditlogs` +
      (migrated ? ` (${migrated} row(s)).` : '.') +
      ' Legacy table dropped.'
  );
}
