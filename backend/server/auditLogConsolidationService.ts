import { QueryTypes } from 'sequelize';
import { AuditLog, sequelize } from './db.js';

export const AUDIT_SOURCE_PAYROLL = 'payroll_audit';
export const AUDIT_SOURCE_ALLOWANCE = 'allowance_audit';
export const AUDIT_SOURCE_SENSITIVE_MODULE = 'sensitive_module';
export const AUDIT_SOURCE_SETTING = 'setting_audit';
export const AUDIT_SOURCE_DOMAIN = 'domain_audit';

const LEGACY_AUDIT_TABLES = [
  'payrollauditlogs',
  'payroll_allowance_audit_logs',
  'sensitive_module_audit_log',
  'settingauditlogs',
] as const;

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

function toMysqlDatetime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(value ?? '').trim();
  if (!s) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const parsed = Date.parse(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  return s.slice(0, 19);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table }, type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function auditLogExists(id: string): Promise<boolean> {
  const row = await AuditLog.findByPk(id, { attributes: ['id'] });
  return Boolean(row);
}

async function migratePayrollAuditLogsIfNeeded(): Promise<number> {
  if (!(await tableExists('payrollauditlogs'))) return 0;

  const rows = (await sequelize.query(
    `SELECT * FROM payrollauditlogs ORDER BY createdAt ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const legacyId = String(row.id);
    const auditId = `audit-${legacyId}`;
    if (await auditLogExists(auditId)) continue;

    const createdAt = toMysqlDatetime(row.createdAt);
    await AuditLog.create({
      id: auditId,
      entityType: String(row.entityType ?? 'payroll'),
      entityId: String(row.entityId ?? ''),
      action: String(row.actionType ?? 'UPDATE'),
      oldValue: parseJsonValue(row.oldValueJson),
      newValue: parseJsonValue(row.newValueJson),
      performedBy: row.userId != null ? String(row.userId) : 'system',
      reason: `Payroll ${String(row.entityType ?? '')} ${String(row.actionType ?? '')}`.replace(/_/g, ' '),
      metadata: {
        source: AUDIT_SOURCE_PAYROLL,
        payrollAuditId: legacyId,
        ...(parseJsonValue(row.metadataJson) as Record<string, unknown> | null),
      },
      createdAt,
      updatedAt: createdAt,
    } as never);
    migrated += 1;
  }
  return migrated;
}

async function migrateAllowanceAuditLogsIfNeeded(): Promise<number> {
  if (!(await tableExists('payroll_allowance_audit_logs'))) return 0;

  const rows = (await sequelize.query(
    `SELECT * FROM payroll_allowance_audit_logs ORDER BY created_at ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const legacyId = String(row.id);
    const auditId = `audit-${legacyId}`;
    if (await auditLogExists(auditId)) continue;

    const createdAt = toMysqlDatetime(row.created_at ?? row.createdAt);
    await AuditLog.create({
      id: auditId,
      entityType: String(row.entity_type ?? 'allowance'),
      entityId: String(row.entity_id ?? ''),
      action: String(row.action ?? 'UPDATE'),
      oldValue: parseJsonValue(row.old_value),
      newValue: parseJsonValue(row.new_value),
      performedBy: row.changed_by != null ? String(row.changed_by) : 'system',
      reason: `Allowance ${String(row.action ?? '').toLowerCase()}`,
      metadata: { source: AUDIT_SOURCE_ALLOWANCE, allowanceAuditId: legacyId },
      createdAt,
      updatedAt: createdAt,
    } as never);
    migrated += 1;
  }
  return migrated;
}

async function migrateSensitiveModuleAuditLogsIfNeeded(): Promise<number> {
  if (!(await tableExists('sensitive_module_audit_log'))) return 0;

  const rows = (await sequelize.query(
    `SELECT * FROM sensitive_module_audit_log WHERE is_deleted = 0 ORDER BY created_at ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const legacyId = String(row.id);
    const auditId = `audit-${legacyId}`;
    if (await auditLogExists(auditId)) continue;

    const createdAt = toMysqlDatetime(row.created_at);
    await AuditLog.create({
      id: auditId,
      entityType: String(row.module ?? 'sensitive_module'),
      entityId: row.entity_id != null ? String(row.entity_id) : null,
      action: String(row.action ?? 'UPDATE'),
      oldValue: parseJsonValue(row.old_value),
      newValue: parseJsonValue(row.new_value),
      performedBy: row.created_by != null ? String(row.created_by) : 'system',
      reason: `Sensitive ${String(row.module ?? '').replace(/_/g, ' ')} ${String(row.action ?? '').toLowerCase()}`,
      metadata: {
        source: AUDIT_SOURCE_SENSITIVE_MODULE,
        sensitiveAuditId: legacyId,
        approvedBy: row.approved_by ?? null,
        modifiedBy: row.modified_by ?? null,
      },
      createdAt,
      updatedAt: createdAt,
    } as never);
    migrated += 1;
  }
  return migrated;
}

async function migrateSettingAuditLogsIfNeeded(): Promise<number> {
  if (!(await tableExists('settingauditlogs'))) return 0;

  const rows = (await sequelize.query(
    `SELECT * FROM settingauditlogs ORDER BY changedAt ASC, createdAt ASC`,
    { type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const legacyId = String(row.id);
    const auditId = `audit-${legacyId}`;
    if (await auditLogExists(auditId)) continue;

    const createdAt = toMysqlDatetime(row.changedAt ?? row.createdAt);
    await AuditLog.create({
      id: auditId,
      entityType: 'setting',
      entityId: String(row.settingKey ?? ''),
      action: 'UPDATE',
      oldValue: parseJsonValue(row.oldValue),
      newValue: parseJsonValue(row.newValue),
      performedBy: row.changedBy != null ? String(row.changedBy) : 'system',
      reason:
        row.reason != null
          ? String(row.reason)
          : `Setting ${String(row.settingKey ?? '')} changed`,
      metadata: {
        source: AUDIT_SOURCE_SETTING,
        settingAuditId: legacyId,
        settingKey: row.settingKey ?? null,
        settingLevel: row.settingLevel ?? null,
        levelId: row.levelId ?? null,
      },
      createdAt,
      updatedAt: createdAt,
    } as never);
    migrated += 1;
  }
  return migrated;
}

/** Migrate legacy audit tables into `auditlogs`, then drop redundant tables. */
export async function ensureAuditLogsConsolidated(): Promise<void> {
  const payroll = await migratePayrollAuditLogsIfNeeded();
  const allowance = await migrateAllowanceAuditLogsIfNeeded();
  const sensitive = await migrateSensitiveModuleAuditLogsIfNeeded();
  const settings = await migrateSettingAuditLogsIfNeeded();
  const migrated = payroll + allowance + sensitive + settings;

  const dropped: string[] = [];
  for (const table of LEGACY_AUDIT_TABLES) {
    if (!(await tableExists(table))) continue;
    await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``, { raw: true });
    dropped.push(table);
  }

  if (migrated || dropped.length) {
    console.log(
      `[db] Consolidated legacy audit tables into auditlogs` +
        (migrated ? ` (${migrated} row(s) migrated).` : '.') +
        (dropped.length ? ` Dropped: ${dropped.join(', ')}.` : '')
    );
  }
}

/** Legacy payroll audit API shape from unified auditlogs. */
export async function listPayrollAuditLogsFromAudit(params: {
  entityType?: string;
  entityId?: string;
  actions?: string[];
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const rows = (await sequelize.query(
    `SELECT * FROM auditlogs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
       AND (:entityType IS NULL OR entityType = :entityType)
       AND (:entityId IS NULL OR entityId = :entityId)
       AND (:hasActions = 0 OR action IN (:actions))
     ORDER BY createdAt DESC
     LIMIT :limit`,
    {
      replacements: {
        source: AUDIT_SOURCE_PAYROLL,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        hasActions: params.actions?.length ? 1 : 0,
        actions: params.actions?.length ? params.actions : [''],
        limit,
      },
      type: QueryTypes.SELECT,
    }
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String((parseJsonValue(row.metadata) as Record<string, unknown> | null)?.payrollAuditId ?? row.id),
    entityType: row.entityType,
    entityId: row.entityId,
    actionType: row.action,
    userId: row.performedBy,
    oldValueJson: row.oldValue != null ? JSON.stringify(parseJsonValue(row.oldValue)) : null,
    newValueJson: row.newValue != null ? JSON.stringify(parseJsonValue(row.newValue)) : null,
    metadataJson: row.metadata != null ? JSON.stringify(parseJsonValue(row.metadata)) : null,
    createdAt: row.createdAt,
  }));
}

/** Legacy allowance audit API shape from unified auditlogs. */
export async function listAllowanceAuditLogsFromAudit(params: {
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = (await sequelize.query(
    `SELECT * FROM auditlogs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
     ORDER BY createdAt DESC
     LIMIT :limit`,
    {
      replacements: { source: AUDIT_SOURCE_ALLOWANCE, limit },
      type: QueryTypes.SELECT,
    }
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String((parseJsonValue(row.metadata) as Record<string, unknown> | null)?.allowanceAuditId ?? row.id),
    entity_type: row.entityType,
    entity_id: row.entityId,
    action: row.action,
    changed_by: row.performedBy,
    old_value: parseJsonValue(row.oldValue),
    new_value: parseJsonValue(row.newValue),
    created_at: row.createdAt,
  }));
}

/** Legacy sensitive module audit API shape from unified auditlogs. */
export async function listSensitiveModuleAuditFromAudit(params: {
  module?: string;
  entityId?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = (await sequelize.query(
    `SELECT * FROM auditlogs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
       AND (:module IS NULL OR entityType = :module)
       AND (:entityId IS NULL OR entityId = :entityId)
     ORDER BY createdAt DESC
     LIMIT :limit`,
    {
      replacements: {
        source: AUDIT_SOURCE_SENSITIVE_MODULE,
        module: params.module ?? null,
        entityId: params.entityId ?? null,
        limit,
      },
      type: QueryTypes.SELECT,
    }
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const metadata = parseJsonValue(row.metadata) as Record<string, unknown> | null;
    return {
      id: String(metadata?.sensitiveAuditId ?? row.id),
      module: row.entityType,
      entity_id: row.entityId,
      action: row.action,
      old_value: parseJsonValue(row.oldValue),
      new_value: parseJsonValue(row.newValue),
      created_by: row.performedBy,
      created_at: row.createdAt,
      approved_by: metadata?.approvedBy ?? null,
      modified_by: metadata?.modifiedBy ?? null,
      is_deleted: 0,
      is_active: 1,
    };
  });
}

export async function countPayrollAuditLogsFromAudit(actions: string[]): Promise<number> {
  if (!actions.length) return 0;
  const rows = (await sequelize.query(
    `SELECT COUNT(*) AS c FROM auditlogs
     WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = :source
       AND action IN (:actions)`,
    {
      replacements: { source: AUDIT_SOURCE_PAYROLL, actions },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}
