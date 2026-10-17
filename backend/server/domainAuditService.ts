import crypto from 'crypto';
import { AuditLog } from './db.js';
import { AUDIT_SOURCE_DOMAIN } from './auditLogConsolidationService.js';

export type DomainAuditPayload = {
  entityType: string;
  entityId: string;
  action: string;
  performedBy?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

const REDACT_KEY = /password|token|pin|secret|otp|authorization/i;

function auditId(): string {
  return `daudit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeForAudit(input: unknown, depth = 0): unknown {
  if (input == null) return input;
  if (depth > 5) return '[truncated]';
  if (Array.isArray(input)) {
    return input.slice(0, 100).map((entry) => sanitizeForAudit(entry, depth + 1));
  }
  if (typeof input !== 'object') {
    if (typeof input === 'string' && input.length > 2000) {
      return `${input.slice(0, 2000)}...`;
    }
    return input;
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEY.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeForAudit(value, depth + 1);
    }
  }
  return out;
}

/** Pick safe fields from a row for audit snapshots. */
export function pickAuditFields(
  row: Record<string, unknown> | null | undefined,
  keys?: string[]
): Record<string, unknown> | null {
  if (!row) return null;
  if (!keys?.length) {
    return sanitizeForAudit(row) as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      out[key] = sanitizeForAudit(row[key]);
    }
  }
  return out;
}

/** Return only fields that changed between before/after snapshots. */
export function diffAuditSnapshots(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys?: string[]
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } | null {
  const beforeSafe = pickAuditFields(before ?? null, keys) ?? {};
  const afterSafe = pickAuditFields(after ?? null, keys) ?? {};
  const keySet = keys?.length
    ? keys
    : Array.from(new Set([...Object.keys(beforeSafe), ...Object.keys(afterSafe)]));
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of keySet) {
    const prev = beforeSafe[key];
    const next = afterSafe[key];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      oldValue[key] = prev ?? null;
      newValue[key] = next ?? null;
    }
  }
  if (!Object.keys(oldValue).length) return null;
  return { oldValue, newValue };
}

/** Structured domain audit row — preferred over raw HTTP mutation logs. */
export async function writeDomainAudit(payload: DomainAuditPayload): Promise<void> {
  const trimmedEntityId = String(payload.entityId ?? '').trim();
  if (!trimmedEntityId) return;
  try {
    const id = auditId();
    await AuditLog.create({
      id: `audit-${id}`,
      entityType: payload.entityType,
      entityId: trimmedEntityId,
      action: payload.action,
      oldValue: payload.oldValue ?? null,
      newValue: payload.newValue ?? null,
      performedBy: payload.performedBy ?? 'system',
      reason:
        payload.reason ??
        `${payload.entityType.replace(/_/g, ' ')} ${payload.action.replace(/_/g, ' ')}`.trim(),
      metadata: {
        source: AUDIT_SOURCE_DOMAIN,
        domainAuditId: id,
        ...(payload.metadata ?? {}),
      },
    } as any);
  } catch (err) {
    console.warn('[domainAudit] write failed:', (err as Error)?.message || err);
  }
}

/** Workflow status transition helper. */
export async function writeWorkflowStatusAudit(params: {
  entityType: string;
  entityId: string;
  action?: string;
  previousStatus: string;
  nextStatus: string;
  performedBy?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeDomainAudit({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action ?? 'STATUS_CHANGE',
    performedBy: params.performedBy,
    oldValue: { status: params.previousStatus },
    newValue: { status: params.nextStatus },
    reason:
      params.reason ??
      `${params.entityType} status ${params.previousStatus} → ${params.nextStatus}`,
    metadata: params.metadata,
  });
}
