import { Op, QueryTypes } from 'sequelize';
import { AuditLog, sequelize } from './db.js';
import { buildAuditActorMap } from './userAccountService.js';
import {
  AUDIT_SOURCE_ALLOWANCE,
  AUDIT_SOURCE_DOMAIN,
  AUDIT_SOURCE_PAYROLL,
  AUDIT_SOURCE_SENSITIVE_MODULE,
  AUDIT_SOURCE_SETTING,
} from './auditLogConsolidationService.js';
import {
  APPRAISAL_SCORE_AUDIT_SOURCE,
  appraisalAuditActionLabel,
} from './appraisal/appraisalScoreAuditService.js';

export type UnifiedAuditTrailRow = {
  id: string;
  source:
    | 'audit_log'
    | 'domain_audit'
    | 'sensitive_module'
    | 'payroll_audit'
    | 'allowance_audit'
    | 'setting_audit'
    | 'appraisal_audit';
  entityType: string;
  entityId: string | null;
  action: string;
  reason: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: Record<string, unknown> | null;
  performedBy: string;
  changedBy: Awaited<ReturnType<typeof buildAuditActorMap>> extends Map<string, infer V>
    ? V | null
    : null;
  createdAt: string;
};

export type AuditTrailQuery = {
  entityType?: string;
  entityId?: string;
  action?: string;
  performedBy?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
};

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

function toIsoDate(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  const s = String(raw ?? '').trim();
  if (!s) return new Date(0).toISOString();
  const parsed = Date.parse(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return s;
}

function normalizePolicyEntity(row: {
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): { entityType: string; entityId: string | null } {
  if (row.entityType !== 'payroll_policy_version') {
    return { entityType: row.entityType, entityId: row.entityId ?? null };
  }
  const legacyKey = String(row.entityId ?? '').trim();
  if (legacyKey && legacyKey !== 'payroll_policy_version') {
    return { entityType: legacyKey, entityId: legacyKey };
  }
  const policyType = String(row.metadata?.policyType ?? '').trim();
  if (policyType) {
    const policyKey = row.metadata?.policyKey != null ? String(row.metadata.policyKey) : '';
    return {
      entityType: policyKey ? `${policyType}:${policyKey}` : policyType,
      entityId: String(row.metadata?.versionId ?? row.entityId ?? policyType) || null,
    };
  }
  return { entityType: row.entityType, entityId: row.entityId ?? null };
}

function resolveUnifiedSource(metadata: Record<string, unknown> | null): UnifiedAuditTrailRow['source'] {
  const src = String(metadata?.source ?? '');
  if (src === AUDIT_SOURCE_PAYROLL) return 'payroll_audit';
  if (src === AUDIT_SOURCE_ALLOWANCE) return 'allowance_audit';
  if (src === AUDIT_SOURCE_SENSITIVE_MODULE) return 'sensitive_module';
  if (src === AUDIT_SOURCE_SETTING) return 'setting_audit';
  if (src === AUDIT_SOURCE_DOMAIN) return 'domain_audit';
  if (src === APPRAISAL_SCORE_AUDIT_SOURCE) return 'appraisal_audit';
  return 'audit_log';
}

/** Entity types excluded from the unified audit trail unless explicitly filtered. */
const AUDIT_TRAIL_EXCLUDED_ENTITY_TYPES = ['auth_login', 'chat'];

type AppraisalEnrichment = {
  employeeUserId: string | null;
  employeeName: string | null;
  periodName: string | null;
};

async function loadAppraisalEnrichment(
  appraisalIds: string[]
): Promise<Map<string, AppraisalEnrichment>> {
  const unique = [...new Set(appraisalIds.filter(Boolean))];
  if (!unique.length) return new Map();

  const rows = (await sequelize.query(
    `SELECT ea.id AS appraisalId,
            ea.user_id AS employeeUserId,
            u.display_name AS employeeName,
            ap.name AS periodName
     FROM employee_appraisals ea
     LEFT JOIN users u ON u.id = ea.user_id
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     WHERE ea.id IN (:ids)`,
    { replacements: { ids: unique }, type: QueryTypes.SELECT }
  )) as Array<Record<string, unknown>>;

  const map = new Map<string, AppraisalEnrichment>();
  for (const row of rows) {
    map.set(String(row.appraisalId), {
      employeeUserId: row.employeeUserId != null ? String(row.employeeUserId) : null,
      employeeName: row.employeeName != null ? String(row.employeeName) : null,
      periodName: row.periodName != null ? String(row.periodName) : null,
    });
  }
  return map;
}

function mapAuditRowToUnified(
  plain: Record<string, unknown>,
  enrichment?: AppraisalEnrichment
): UnifiedAuditTrailRow {
  const metadata = parseJsonValue(plain.metadata) as Record<string, unknown> | null;
  const source = resolveUnifiedSource(metadata);
  const normalized = normalizePolicyEntity({
    entityType: String(plain.entityType ?? ''),
    entityId: plain.entityId != null ? String(plain.entityId) : null,
    metadata,
  });

  let action = String(plain.action ?? '');
  let oldValue = parseJsonValue(plain.oldValue);
  let newValue = parseJsonValue(plain.newValue);
  let reason = plain.reason != null ? String(plain.reason) : null;
  let rowMetadata: Record<string, unknown> | null = metadata ? { ...metadata } : null;

  if (source === 'appraisal_audit') {
    const fieldName = String(metadata?.fieldName ?? metadata?.field_name ?? action);
    action = appraisalAuditActionLabel(fieldName);
    if (fieldName === 'reopen_cycle_snapshot' && typeof oldValue === 'string') {
      oldValue = parseJsonValue(oldValue);
      newValue = {
        status: newValue,
        ...(typeof oldValue === 'object' && oldValue ? (oldValue as Record<string, unknown>) : {}),
      };
    }
    if (!reason) {
      reason =
        fieldName === 'reopen_cycle_snapshot'
          ? 'Prior appraisal cycle archived on reopen'
          : `Appraisal ${fieldName.replace(/_/g, ' ')}`;
    }
    const employeeName = enrichment?.employeeName ?? null;
    const periodName = enrichment?.periodName ?? null;
    rowMetadata = {
      ...(rowMetadata ?? {}),
      fieldName,
      componentId: metadata?.componentId ?? metadata?.component_id ?? null,
      employeeUserId: enrichment?.employeeUserId ?? null,
      employeeName,
      periodName,
      summary:
        employeeName && periodName
          ? `${employeeName} · ${periodName}`
          : employeeName ?? periodName ?? null,
    };
  } else if (source === 'setting_audit') {
    action = 'UPDATE';
    if (!reason) {
      reason = `Setting ${String(metadata?.settingKey ?? normalized.entityId ?? '')} changed`;
    }
    rowMetadata = {
      ...(rowMetadata ?? {}),
      settingLevel: metadata?.settingLevel ?? null,
      levelId: metadata?.levelId ?? null,
    };
  } else if (source === 'payroll_audit' && !reason) {
    reason = `Payroll ${normalized.entityType} ${action}`.replace(/_/g, ' ');
  } else if (source === 'allowance_audit' && !reason) {
    reason = `Allowance ${action}`;
  } else if (source === 'sensitive_module' && !reason) {
    reason = `Sensitive module ${normalized.entityType} change`;
  } else if (source === 'domain_audit' && !reason) {
    reason = `${normalized.entityType.replace(/_/g, ' ')} ${action.replace(/_/g, ' ')}`.trim();
  } else if (
    !reason &&
    (normalized.entityType === 'company_profile' ||
      normalized.entityType === 'organization_setting' ||
      normalized.entityType === 'settings_position_levels')
  ) {
    const key = String(metadata?.settingKey ?? normalized.entityId ?? '').trim();
    reason = key ? `Setting ${key} changed` : `${normalized.entityType.replace(/_/g, ' ')} updated`;
  }

  return {
    id: String(plain.id),
    source,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    action,
    reason,
    oldValue,
    newValue,
    metadata: rowMetadata,
    performedBy: String(plain.performedBy ?? 'system'),
    changedBy: null,
    createdAt: toIsoDate(plain.createdAt),
  };
}

async function fetchUnifiedAuditRows(params: AuditTrailQuery): Promise<UnifiedAuditTrailRow[]> {
  const where: Record<string, unknown> = {};
  if (params.entityType) where.entityType = params.entityType;
  else where.entityType = { [Op.notIn]: AUDIT_TRAIL_EXCLUDED_ENTITY_TYPES };
  if (params.entityId) where.entityId = params.entityId;
  if (params.action) where.action = params.action;
  if (params.performedBy) where.performedBy = params.performedBy;
  if (params.startDate || params.endDate) {
    const createdAt: Record<symbol, Date> = {};
    if (params.startDate) createdAt[Op.gte] = new Date(params.startDate);
    if (params.endDate) createdAt[Op.lte] = new Date(params.endDate);
    where.createdAt = createdAt;
  }

  const limit = Math.min(Math.max(Number(params.limit) || 200, 1), 1000);
  const rows = await AuditLog.findAll({
    where: where as any,
    order: [['createdAt', 'DESC']],
    limit,
  });

  const plainRows = rows.map((row) => row.get({ plain: true }) as Record<string, unknown>);
  const appraisalIds = plainRows
    .filter((row) => {
      const metadata = parseJsonValue(row.metadata) as Record<string, unknown> | null;
      return (
        String(row.entityType ?? '') === 'employee_appraisal' &&
        String(metadata?.source ?? '') === APPRAISAL_SCORE_AUDIT_SOURCE &&
        row.entityId
      );
    })
    .map((row) => String(row.entityId));

  const enrichmentMap = await loadAppraisalEnrichment(appraisalIds);
  return plainRows.map((row) => {
    const metadata = parseJsonValue(row.metadata) as Record<string, unknown> | null;
    const enrichment =
      String(metadata?.source ?? '') === APPRAISAL_SCORE_AUDIT_SOURCE && row.entityId
        ? enrichmentMap.get(String(row.entityId))
        : undefined;
    return mapAuditRowToUnified(row, enrichment);
  });
}

export async function listUnifiedAuditTrail(params: AuditTrailQuery = {}): Promise<UnifiedAuditTrailRow[]> {
  const limit = Math.min(Math.max(Number(params.limit) || 200, 1), 1000);
  const rows = await fetchUnifiedAuditRows({ ...params, limit: limit * 2 });

  const entityFilter = params.entityType?.trim();
  const filtered = entityFilter
    ? rows.filter((row) => {
        if (row.entityType === entityFilter) return true;
        if (entityFilter === 'employee_appraisal' && row.source === 'appraisal_audit') return true;
        if (entityFilter === 'setting' && row.source === 'setting_audit') return true;
        if (
          entityFilter === 'company_profile' &&
          (row.entityType === 'company_profile' || row.source === 'setting_audit')
        ) {
          return row.entityType === 'company_profile';
        }
        if (
          entityFilter === 'organization_setting' &&
          row.entityType === 'organization_setting'
        ) {
          return true;
        }
        if (
          entityFilter === 'settings_position_levels' &&
          row.entityType === 'settings_position_levels'
        ) {
          return true;
        }
        if (entityFilter === 'exchange_rate' && row.entityType === 'payroll_policy_version') {
          return row.entityId === 'exchange_rate';
        }
        if (entityFilter === 'tax_brackets' && row.entityType === 'payroll_policy_version') {
          return row.entityId === 'tax_brackets';
        }
        if (entityFilter === 'nssf_wage_table' && row.entityType === 'payroll_policy_version') {
          return row.entityId === 'nssf_wage_table';
        }
        if (entityFilter.startsWith('compliance_rule') && row.entityType === 'payroll_policy_version') {
          return String(row.entityId ?? '').startsWith('compliance_rule:');
        }
        return false;
      })
    : rows;

  const limited = filtered.slice(0, limit);
  const performedByIds = Array.from(new Set(limited.map((row) => row.performedBy).filter(Boolean)));
  const actorById = await buildAuditActorMap(performedByIds);

  return limited.map((row) => ({
    ...row,
    changedBy: actorById.get(row.performedBy) ?? null,
  }));
}
