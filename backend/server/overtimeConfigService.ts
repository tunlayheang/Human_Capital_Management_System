import {
  defaultOvertimeRequestConfig,
  defaultRules,
  parseLegacyOvertimeConfig,
  parseRules,
  VALID_OVERTIME_RATE_TIERS,
  type OvertimeRateTier,
  type OvertimeRequestConfig,
  type OvertimeType,
  type OvertimeTypeRules,
} from './overtimeTypes.js';
import {
  ensureOvertimeSchema,
  getGlobalMaxHoursPerMonth,
  getOvertimeTypeRow,
  listOvertimeTypeRows,
  setGlobalMaxHoursPerMonth,
  upsertOvertimeTypeRow,
} from './overtimeSchema.js';
import { diffAuditSnapshots, pickAuditFields, writeDomainAudit } from './domainAuditService.js';

export type {
  OvertimeRateTier,
  OvertimeTypeRules,
  OvertimeType,
  OvertimeRequestConfig,
} from './overtimeTypes.js';

export { defaultOvertimeRequestConfig, parseLegacyOvertimeConfig };

let schemaReady: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureOvertimeSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export async function getOvertimeRequestConfig(): Promise<OvertimeRequestConfig> {
  await ensureReady();
  try {
    const types = await listOvertimeTypeRows(false);
    const globalMaxHoursPerMonth = await getGlobalMaxHoursPerMonth();
    return {
      types: types.length ? types : defaultOvertimeRequestConfig().types,
      globalMaxHoursPerMonth,
    };
  } catch (err) {
    console.warn(
      '[overtime] Falling back to default config:',
      (err as Error).message
    );
    return defaultOvertimeRequestConfig();
  }
}

export async function saveOvertimeRequestConfig(
  config: OvertimeRequestConfig
): Promise<OvertimeRequestConfig> {
  await ensureReady();
  const parsed = parseLegacyOvertimeConfig(config);
  if (!parsed.types.length) {
    throw new Error('At least one overtime type is required');
  }
  for (const t of parsed.types) {
    await upsertOvertimeTypeRow(t);
  }
  await setGlobalMaxHoursPerMonth(parsed.globalMaxHoursPerMonth);
  return getOvertimeRequestConfig();
}

export type OvertimeTypeInput = {
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  rateTier: OvertimeRateTier;
  isActive?: boolean;
  rules?: Partial<OvertimeTypeRules>;
};

export async function listActiveOvertimeTypes(): Promise<OvertimeType[]> {
  await ensureReady();
  try {
    const types = await listOvertimeTypeRows(true);
    return types.length ? types : defaultOvertimeRequestConfig().types.filter((t) => t.isActive);
  } catch (err) {
    console.warn(
      '[overtime] Falling back to default active types:',
      (err as Error).message
    );
    return defaultOvertimeRequestConfig().types.filter((t) => t.isActive);
  }
}

/** All OT types including inactive — for Config screens. */
export async function listAllOvertimeTypes(): Promise<OvertimeType[]> {
  await ensureReady();
  try {
    const types = await listOvertimeTypeRows(false);
    return types.length ? types : defaultOvertimeRequestConfig().types;
  } catch (err) {
    console.warn(
      '[overtime] Falling back to default types (incl. inactive):',
      (err as Error).message
    );
    return defaultOvertimeRequestConfig().types;
  }
}

export async function createOvertimeType(input: OvertimeTypeInput): Promise<OvertimeType> {
  await ensureReady();
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name is required');
  const rateTier = VALID_OVERTIME_RATE_TIERS.has(input.rateTier) ? input.rateTier : 'daytime_150';
  const type: OvertimeType = {
    id: `ot-type-${Date.now()}`,
    name,
    nameKh: input.nameKh?.trim() || undefined,
    description: input.description?.trim() || undefined,
    descriptionKh: input.descriptionKh?.trim() || undefined,
    rateTier,
    isActive: input.isActive !== false,
    rules: parseRules(input.rules, defaultRules()),
  };
  await upsertOvertimeTypeRow(type);
  await writeDomainAudit({
    entityType: 'overtime_type',
    entityId: type.id,
    action: 'CREATE',
    newValue: pickAuditFields(type as unknown as Record<string, unknown>),
    reason: 'Overtime type created',
  });
  return type;
}

export async function updateOvertimeType(
  id: string,
  input: Partial<OvertimeTypeInput>
): Promise<OvertimeType | null> {
  await ensureReady();
  const current = await getOvertimeTypeRow(id);
  if (!current) return null;
  const next: OvertimeType = {
    ...current,
    name: input.name != null ? String(input.name).trim() : current.name,
    nameKh:
      input.nameKh !== undefined
        ? input.nameKh?.trim() || undefined
        : current.nameKh,
    description:
      input.description !== undefined
        ? input.description?.trim() || undefined
        : current.description,
    descriptionKh:
      input.descriptionKh !== undefined
        ? input.descriptionKh?.trim() || undefined
        : current.descriptionKh,
    rateTier:
      input.rateTier && VALID_OVERTIME_RATE_TIERS.has(input.rateTier)
        ? input.rateTier
        : current.rateTier,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : current.isActive,
    rules: input.rules != null ? parseRules(input.rules, current.rules) : current.rules,
  };
  if (!next.name) throw new Error('Name is required');
  await upsertOvertimeTypeRow(next);
  const diff = diffAuditSnapshots(
    current as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>
  );
  if (diff) {
    await writeDomainAudit({
      entityType: 'overtime_type',
      entityId: id,
      action: 'UPDATE',
      oldValue: diff.oldValue,
      newValue: diff.newValue,
      reason: 'Overtime type updated',
    });
  }
  return next;
}

export async function deleteOvertimeType(
  id: string,
  opts?: { effectiveFrom?: string; performedBy?: string }
): Promise<boolean> {
  await ensureReady();
  const current = await getOvertimeTypeRow(id);
  if (!current) return false;
  const { OvertimeRequest, OvertimeType } = await import('./db.js');
  // Keep historical OT requests; clear the FK so the type row can be removed.
  await OvertimeRequest.update({ otTypeId: null }, { where: { otTypeId: id } });
  await OvertimeType.destroy({ where: { id } });
  const effectiveFrom = String(opts?.effectiveFrom ?? '')
    .trim()
    .slice(0, 10);
  await writeDomainAudit({
    entityType: 'overtime_type',
    entityId: id,
    action: 'DELETE',
    performedBy: opts?.performedBy,
    oldValue: pickAuditFields(current as unknown as Record<string, unknown>),
    reason: effectiveFrom
      ? `Overtime type deleted (effective ${effectiveFrom})`
      : 'Overtime type deleted',
  });
  return true;
}

export async function updateOvertimeGlobalSettings(patch: {
  globalMaxHoursPerMonth?: number;
}): Promise<{ globalMaxHoursPerMonth: number }> {
  await ensureReady();
  if (patch.globalMaxHoursPerMonth != null) {
    await setGlobalMaxHoursPerMonth(Number(patch.globalMaxHoursPerMonth));
  }
  return { globalMaxHoursPerMonth: await getGlobalMaxHoursPerMonth() };
}

export async function findActiveOvertimeType(otTypeId: string): Promise<OvertimeType | null> {
  await ensureReady();
  const id = String(otTypeId || '').trim();
  if (!id) return null;
  const row = await getOvertimeTypeRow(id);
  return row?.isActive ? row : null;
}

export type OvertimeCreateBody = {
  userId: string;
  employeeId?: string | null;
  workDate: string;
  hours: number;
  rateTier?: OvertimeRateTier;
  reason: string;
  otTypeId: string;
  startTime?: string;
  endTime?: string;
  clockIn?: string;
  clockOut?: string;
};

export function normalizeOvertimeTimeFields(body: OvertimeCreateBody): {
  startTime: string | null;
  endTime: string | null;
  clockIn: Date | null;
  clockOut: Date | null;
} {
  const startTime = String(body.startTime ?? '').trim() || null;
  const endTime = String(body.endTime ?? '').trim() || null;
  const clockInRaw = String(body.clockIn ?? '').trim();
  const clockOutRaw = String(body.clockOut ?? '').trim();
  return {
    startTime,
    endTime,
    clockIn: clockInRaw ? new Date(clockInRaw) : null,
    clockOut: clockOutRaw ? new Date(clockOutRaw) : null,
  };
}

export async function validateOvertimeCreateBody(body: OvertimeCreateBody): Promise<string | null> {
  const otTypeId = String(body.otTypeId || '').trim();
  const otType = await findActiveOvertimeType(otTypeId);
  if (!otType) return 'Select a valid overtime type';

  if (!body.workDate) return 'Work date is required';

  const h = Number(body.hours);
  if (!Number.isFinite(h) || h <= 0) return 'Hours are required';
  if (h < otType.rules.minHours) {
    return `Minimum ${otType.rules.minHours} hour(s) for "${otType.name}"`;
  }
  if (h > otType.rules.maxHoursPerDay) {
    return `Maximum ${otType.rules.maxHoursPerDay} hours per day for "${otType.name}"`;
  }

  if (!String(body.reason || '').trim()) return 'Reason is required';

  const rateTier = body.rateTier ?? otType.rateTier;
  if (!VALID_OVERTIME_RATE_TIERS.has(rateTier)) return 'Rate type is required';

  const { clockIn, clockOut } = normalizeOvertimeTimeFields(body);

  if (otType.rules.requireClockInOut) {
    if (!clockIn) return 'Clock-in is required for this overtime type';
    if (!clockOut) return 'Clock-out is required for this overtime type';
  }

  if (otType.rules.minAdvanceDays > 0 && body.workDate) {
    const work = new Date(`${body.workDate}T12:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((work.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < otType.rules.minAdvanceDays) {
      return `"${otType.name}" must be submitted at least ${otType.rules.minAdvanceDays} day(s) before the work date`;
    }
  }

  return null;
}
