import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import { AuditLog } from '../db.js';
import {
  ensurePayrollPolicyVersionSchema,
  payrollPolicyVersionId,
  type PayrollPolicyVersionRow,
} from './payrollPolicyVersionSchema.js';

export type PayrollPolicyType =
  | 'exchange_rate'
  | 'tax_brackets'
  | 'nssf_wage_table'
  | 'compliance_rule'
  | 'work_day_policy';

export class PolicyEffectiveDateRequiredError extends Error {
  statusCode = 400;
  code = 'POLICY_EFFECTIVE_DATE_REQUIRED';
  constructor() {
    super('Effective date is required. Policy changes are scheduled — they do not apply instantly.');
    this.name = 'PolicyEffectiveDateRequiredError';
  }
}

export function monthInPolicyRange(month: string, from: string, to?: string | null): boolean {
  const m = month.slice(0, 7);
  const f = from.slice(0, 7);
  if (m < f) return false;
  if (to) {
    const t = to.slice(0, 7);
    if (m > t) return false;
  }
  return true;
}

export function parseEffectiveFrom(raw: unknown): string {
  const d = String(raw ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new PolicyEffectiveDateRequiredError();
  }
  return d;
}

export function pickPolicyVersionForMonth<T extends { effective_from: string; effective_to?: string | null }>(
  versions: T[],
  month: string
): T | null {
  const matching = versions
    .filter((v) => monthInPolicyRange(month, v.effective_from, v.effective_to))
    .sort((a, b) => {
      const byFrom = String(b.effective_from).localeCompare(String(a.effective_from));
      if (byFrom !== 0) return byFrom;
      return String(b.id ?? '').localeCompare(String(a.id ?? ''));
    });
  return matching[0] ?? null;
}

function normalizePolicyVersionTimestamp(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    return s.slice(0, 19).replace('T', ' ');
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  }
  return s;
}

function policyVersionCreatedAtMs(version: Pick<PayrollPolicyVersionRow, 'created_at'>): number {
  const normalized = normalizePolicyVersionTimestamp(version.created_at);
  const ms = Date.parse(normalized.replace(' ', 'T'));
  return Number.isNaN(ms) ? 0 : ms;
}

function rowFromDb(r: Record<string, unknown>): PayrollPolicyVersionRow & { id: string } {
  let payload: unknown = r.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  return {
    id: String(r.id),
    policy_type: String(r.policy_type),
    policy_key: r.policy_key != null ? String(r.policy_key) : null,
    effective_from: String(r.effective_from).slice(0, 10),
    effective_to: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
    payload,
    notes: r.notes != null ? String(r.notes) : null,
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: normalizePolicyVersionTimestamp(r.created_at),
  };
}

export async function listPolicyVersions(params: {
  policyType: PayrollPolicyType;
  policyKey?: string | null;
}): Promise<PayrollPolicyVersionRow[]> {
  await ensurePayrollPolicyVersionSchema();
  try {
    const rows = (await sequelize.query(
      `SELECT * FROM payroll_policy_versions
       WHERE policy_type = :policyType
         AND (:policyKey IS NULL AND policy_key IS NULL OR policy_key = :policyKey)
         AND (is_deleted IS NULL OR is_deleted = 0)
       ORDER BY created_at DESC, effective_from DESC, id DESC`,
      {
        replacements: {
          policyType: params.policyType,
          policyKey: params.policyKey ?? null,
        },
        type: QueryTypes.SELECT,
      }
    )) as Record<string, unknown>[];
    return rows.map(rowFromDb);
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (!/Unknown column.*is_deleted|ER_BAD_FIELD_ERROR/i.test(msg)) throw err;
    // Legacy table without soft-delete column — repair schema and retry without filter.
    await ensurePayrollPolicyVersionSchema();
    const rows = (await sequelize.query(
      `SELECT * FROM payroll_policy_versions
       WHERE policy_type = :policyType
         AND (:policyKey IS NULL AND policy_key IS NULL OR policy_key = :policyKey)
       ORDER BY created_at DESC, effective_from DESC, id DESC`,
      {
        replacements: {
          policyType: params.policyType,
          policyKey: params.policyKey ?? null,
        },
        type: QueryTypes.SELECT,
      }
    )) as Record<string, unknown>[];
    return rows.map(rowFromDb);
  }
}

export type PolicyVersionDisplayMeta = {
  /** Effective-from date on the most recently saved version (shown in UI). */
  effectiveFrom: string | null;
  scheduledEffectiveFrom: string | null;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

export function pickLatestPolicyVersion(
  versions: PayrollPolicyVersionRow[]
): PayrollPolicyVersionRow | null {
  if (!versions.length) return null;
  return [...versions].sort((a, b) => {
    const byCreated = policyVersionCreatedAtMs(b) - policyVersionCreatedAtMs(a);
    if (byCreated !== 0) return byCreated;
    return String(b.id).localeCompare(String(a.id));
  })[0]!;
}

function pickScheduledPolicyVersion(
  versions: PayrollPolicyVersionRow[],
  latest: PayrollPolicyVersionRow | null,
  monthKey: string
): PayrollPolicyVersionRow | null {
  const latestMonth = latest?.effective_from.slice(0, 7) ?? '';
  if (latestMonth > monthKey) return null;
  const future = versions
    .filter((v) => v.id !== latest?.id && v.effective_from.slice(0, 7) > monthKey)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return future[0] ?? null;
}

export async function getPolicyVersionDisplayMeta(params: {
  policyType: PayrollPolicyType;
  policyKey?: string | null;
  month?: string;
}): Promise<PolicyVersionDisplayMeta> {
  const versions = await listPolicyVersions({
    policyType: params.policyType,
    policyKey: params.policyKey,
  });
  const latest = pickLatestPolicyVersion(versions);
  const monthKey = (params.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const scheduled = pickScheduledPolicyVersion(versions, latest, monthKey);
  return {
    effectiveFrom: latest?.effective_from ?? null,
    scheduledEffectiveFrom: scheduled?.effective_from ?? null,
    lastUpdatedAt: latest?.created_at ?? null,
    lastUpdatedBy: latest?.created_by ?? null,
  };
}

export async function getLatestPolicyVersionPayload<T>(params: {
  policyType: PayrollPolicyType;
  policyKey?: string | null;
}): Promise<{ payload: T; effectiveFrom: string; versionId: string; createdAt: string } | null> {
  const versions = await listPolicyVersions({
    policyType: params.policyType,
    policyKey: params.policyKey,
  });
  const latest = pickLatestPolicyVersion(versions);
  if (!latest) return null;
  return {
    payload: latest.payload as T,
    effectiveFrom: latest.effective_from,
    versionId: latest.id,
    createdAt: latest.created_at,
  };
}

function sensitiveAuditModuleForPolicyType(
  policyType: PayrollPolicyType
): import('../sensitiveAuditService.js').SensitiveModule | null {
  switch (policyType) {
    case 'tax_brackets':
      return 'tax_rules';
    case 'nssf_wage_table':
      return 'nssf_rules';
    case 'exchange_rate':
      return 'exchange_rate';
    case 'compliance_rule':
      return 'payroll_compliance_rule';
    case 'work_day_policy':
      return 'payroll_work_day_policy';
    default:
      return null;
  }
}

function policyAuditEntityType(
  policyType: PayrollPolicyType,
  policyKey?: string | null
): { entityType: string; entityId: string } {
  if (policyType === 'compliance_rule' && policyKey) {
    return { entityType: 'compliance_rule', entityId: policyKey };
  }
  return { entityType: policyType, entityId: policyKey ?? policyType };
}

function policyAuditSummary(
  policyType: PayrollPolicyType,
  payload: unknown,
  effectiveFrom: string
): string {
  if (policyType === 'exchange_rate') {
    const rate = Number((payload as { exchangeRateKhrPerUsd?: number })?.exchangeRateKhrPerUsd);
    if (Number.isFinite(rate)) {
      return `Exchange rate set to ${Math.round(rate).toLocaleString()} KHR/USD (effective ${effectiveFrom})`;
    }
  }
  return `Payroll policy ${policyType} scheduled for ${effectiveFrom}`;
}

export async function createPolicyVersion(params: {
  policyType: PayrollPolicyType;
  policyKey?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  payload: unknown;
  notes?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
}): Promise<PayrollPolicyVersionRow> {
  await ensurePayrollPolicyVersionSchema();
  const effective_from = parseEffectiveFrom(params.effectiveFrom);
  const { assertPayrollMasterDataEditableForEffectiveDate } = await import(
    './payrollMasterDataGuard.js'
  );
  await assertPayrollMasterDataEditableForEffectiveDate(effective_from);

  const priorVersions = await listPolicyVersions({
    policyType: params.policyType,
    policyKey: params.policyKey,
  });
  const previousLatest = pickLatestPolicyVersion(priorVersions);

  const id = payrollPolicyVersionId();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(
    `INSERT INTO payroll_policy_versions
      (id, policy_type, policy_key, effective_from, effective_to, payload, notes,
       created_by, created_at, approved_by, approved_at, is_active, is_deleted)
     VALUES
      (:id, :policyType, :policyKey, :effectiveFrom, :effectiveTo, :payload, :notes,
       :createdBy, :createdAt, :approvedBy, :approvedAt, 1, 0)`,
    {
      replacements: {
        id,
        policyType: params.policyType,
        policyKey: params.policyKey ?? null,
        effectiveFrom: effective_from,
        effectiveTo: params.effectiveTo?.slice(0, 10) ?? null,
        payload: JSON.stringify(params.payload ?? {}),
        notes: params.notes ?? null,
        createdBy: params.createdBy ?? null,
        createdAt: now,
        approvedBy: params.approvedBy ?? params.createdBy ?? null,
        approvedAt: params.approvedBy || params.createdBy ? now : null,
      },
      type: QueryTypes.INSERT,
    }
  );

  const entityKey = params.policyKey
    ? `${params.policyType}:${params.policyKey}`
    : params.policyType;
  const auditEntity = policyAuditEntityType(params.policyType, params.policyKey);
  const auditSummary = policyAuditSummary(params.policyType, params.payload, effective_from);

  try {
    await AuditLog.create({
      id: `audit-ppv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityType: auditEntity.entityType,
      entityId: id,
      action: 'UPDATE',
      oldValue: previousLatest
        ? {
            versionId: previousLatest.id,
            effectiveFrom: previousLatest.effective_from,
            payload: previousLatest.payload,
          }
        : null,
      newValue: {
        versionId: id,
        effectiveFrom: effective_from,
        payload: params.payload,
        notes: params.notes ?? null,
      },
      performedBy: params.createdBy ?? 'system',
      reason: params.notes ?? auditSummary,
      metadata: {
        policyType: params.policyType,
        policyKey: params.policyKey ?? null,
        versionId: id,
        legacyEntityType: 'payroll_policy_version',
        legacyEntityId: entityKey,
        summary: auditSummary,
      },
    } as any);

    const auditModule = sensitiveAuditModuleForPolicyType(params.policyType);
    if (auditModule) {
      const { recordSensitiveAudit } = await import('../sensitiveAuditService.js');
      await recordSensitiveAudit({
        module: auditModule,
        entityId: params.policyKey ? `${params.policyKey}:${id}` : id,
        action: 'UPDATE',
        oldValue: previousLatest?.payload ?? null,
        newValue: {
          effectiveFrom: effective_from,
          payload: params.payload,
          versionId: id,
        },
        createdBy: params.createdBy ?? null,
        approvedBy: params.approvedBy ?? params.createdBy ?? null,
      });
    }
  } catch (auditErr) {
    console.error('[payroll-policy] Audit write failed after policy version insert:', auditErr);
  }
  const created = (await listPolicyVersions({
    policyType: params.policyType,
    policyKey: params.policyKey,
  })).find((r) => r.id === id);
  if (!created) throw new Error('Failed to persist policy version');
  return created;
}

export async function resolvePolicyPayloadForMonth<T>(params: {
  policyType: PayrollPolicyType;
  policyKey?: string | null;
  month: string;
}): Promise<{ payload: T; effectiveFrom: string; versionId: string } | null> {
  const versions = await listPolicyVersions({
    policyType: params.policyType,
    policyKey: params.policyKey,
  });
  const picked = pickPolicyVersionForMonth(versions, params.month.slice(0, 7));
  if (!picked) return null;
  return {
    payload: picked.payload as T,
    effectiveFrom: picked.effective_from,
    versionId: picked.id,
  };
}

/** YYYY-MM-DD in local timezone (Node process TZ). */
function formatLocalDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Default effective date for scheduled policy changes (today, local calendar). */
export function suggestedNextPolicyEffectiveDate(today = new Date()): string {
  return formatLocalDateIso(today);
}
