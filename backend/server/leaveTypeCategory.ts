export const LEAVE_CATEGORY_VALUES = [
  'accrual_based',
  'join_date_based',
  'fixed_allocation',
  'event_based',
  'approval_based',
] as const;

export type LeaveCategory = (typeof LEAVE_CATEGORY_VALUES)[number];

export const LEAVE_CATEGORY_LABELS: Record<LeaveCategory, string> = {
  accrual_based: 'Accrual-Based',
  join_date_based: 'Join Date Based',
  fixed_allocation: 'Fixed Allocation',
  event_based: 'Event-Based',
  approval_based: 'Approval-Based',
};

export const LEAVE_CATEGORY_DESCRIPTIONS: Record<LeaveCategory, string> = {
  accrual_based:
    'Leave earned gradually over time; requests limited to accrued-to-date balance. Example: strict monthly AL.',
  join_date_based:
    'Join-date monthly accrual (1.5 / 1 / 0.5 by join day) with yearly entitlement for requests. Example: Annual Leave.',
  fixed_allocation: 'Fixed leave balance granted yearly. Example: Sick Leave.',
  event_based: 'Leave triggered by specific events. Example: Maternity, Marriage.',
  approval_based: 'No balance tracking. Example: Unpaid Leave.',
};

const NAME_CATEGORY_RULES: Array<{ pattern: RegExp; category: LeaveCategory }> = [
  { pattern: /\bannual\b/i, category: 'join_date_based' },
  { pattern: /\bsick\b/i, category: 'fixed_allocation' },
  { pattern: /\bmaternity\b/i, category: 'event_based' },
  { pattern: /\bpaternity\b/i, category: 'event_based' },
  { pattern: /\bmarriage\b/i, category: 'event_based' },
  { pattern: /\bunpaid\b/i, category: 'approval_based' },
];

export function suggestLeaveCategoryFromName(name: string): LeaveCategory | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  for (const rule of NAME_CATEGORY_RULES) {
    if (rule.pattern.test(n)) return rule.category;
  }
  return null;
}

export function normalizeLeaveCategory(raw: unknown): LeaveCategory | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (LEAVE_CATEGORY_VALUES.includes(s as LeaveCategory)) return s as LeaveCategory;
  const byLabel = Object.entries(LEAVE_CATEGORY_LABELS).find(
    ([, label]) => label.toLowerCase() === s
  );
  if (byLabel) return byLabel[0] as LeaveCategory;
  return null;
}

/** Infer category for legacy rows missing leaveCategory. */
export function inferLeaveCategory(row: {
  leaveCategory?: unknown;
  name?: unknown;
  code?: unknown;
  daysAllowed?: unknown;
  isPaid?: unknown;
}): LeaveCategory {
  const explicit = normalizeLeaveCategory(row.leaveCategory);
  if (explicit) return explicit;
  const fromName = suggestLeaveCategoryFromName(String(row.name ?? ''));
  if (fromName) return fromName;
  const code = String(row.code ?? '').toUpperCase();
  if (code === 'ANNUAL') return 'join_date_based';
  if (code === 'SICK') return 'fixed_allocation';
  if (['MATERNITY', 'PATERNITY', 'MARRIAGE'].includes(code)) return 'event_based';
  if (code === 'UNPAID' || !row.isPaid) return 'approval_based';
  return Number(row.daysAllowed ?? 0) > 0 ? 'fixed_allocation' : 'approval_based';
}

/** Normalize DB/API active flags (MySQL may return 0/1). */
export function coerceIsActiveFlag(value: unknown, status?: unknown): boolean {
  if (status != null && String(status).toLowerCase() === 'inactive') return false;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value == null || value === '') return true;
  return Boolean(value);
}

export type LeaveTypePayload = {
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  isPaid: boolean;
  daysAllowed: number;
  leaveCategory: LeaveCategory;
  monthlyAccrualRate?: number | null;
  yearlyResetEnabled: boolean;
  maxCarryForward: number;
  allowCarryForward: boolean;
  eventTriggerType?: string | null;
  maxUsagePerEmployment?: number | null;
  affectsPayroll: boolean;
  requiresDocument: boolean;
  requiresApproval: boolean;
  isActive?: boolean;
  code?: string;
  color?: string;
};

export function validateLeaveTypePayload(
  body: Partial<LeaveTypePayload>
): { ok: true } | { ok: false; message: string } {
  const name = String(body.name ?? '').trim();
  if (!name) return { ok: false, message: 'Leave type name is required' };

  const category = normalizeLeaveCategory(body.leaveCategory);
  if (!category) return { ok: false, message: 'Leave category is required' };

  switch (category) {
    case 'accrual_based':
    case 'join_date_based': {
      const rate = Number(body.monthlyAccrualRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return {
          ok: false,
          message: 'Monthly accrual rate is required for this leave category',
        };
      }
      const days = Number(body.daysAllowed);
      if (!Number.isFinite(days) || days < 0) {
        return { ok: false, message: 'Default days per year is required' };
      }
      break;
    }
    case 'fixed_allocation': {
      const days = Number(body.daysAllowed);
      if (!Number.isFinite(days) || days <= 0) {
        return { ok: false, message: 'Default days per year is required for fixed allocation leave' };
      }
      break;
    }
    case 'event_based': {
      const trigger = String(body.eventTriggerType ?? '').trim();
      if (!trigger) {
        return { ok: false, message: 'Event trigger type is required for event-based leave' };
      }
      break;
    }
    case 'approval_based':
      break;
    default:
      return { ok: false, message: 'Invalid leave category' };
  }

  return { ok: true };
}

export function normalizeLeaveTypeBody(
  body: Record<string, unknown>
): LeaveTypePayload {
  const name = String(body.name ?? '').trim();
  const category =
    normalizeLeaveCategory(body.leaveCategory) ??
    suggestLeaveCategoryFromName(name) ??
    'fixed_allocation';

  const allowCarryForward = Boolean(body.allowCarryForward ?? body.carryForward);
  const maxCarryForward = allowCarryForward
    ? Math.max(0, Number(body.maxCarryForward ?? body.carryoverLimit ?? 0))
    : 0;

  const base: LeaveTypePayload = {
    name,
    nameKh: String(body.nameKh ?? body.name_kh ?? '').trim() || undefined,
    description: String(body.description ?? '').trim() || undefined,
    descriptionKh:
      String(body.descriptionKh ?? body.description_kh ?? '').trim() || undefined,
    isPaid: Boolean(body.isPaid ?? true),
    daysAllowed: Math.max(0, Number(body.daysAllowed ?? 0)),
    leaveCategory: category,
    monthlyAccrualRate: null,
    yearlyResetEnabled: Boolean(body.yearlyResetEnabled ?? false),
    maxCarryForward,
    allowCarryForward,
    eventTriggerType: null,
    maxUsagePerEmployment: null,
    affectsPayroll: Boolean(body.affectsPayroll ?? true),
    requiresDocument: Boolean(body.requiresDocument ?? false),
    requiresApproval: Boolean(body.requiresApproval ?? body.requireApproval ?? true),
    isActive: coerceIsActiveFlag(body.isActive, body.status),
    code: body.code ? String(body.code) : undefined,
    color: body.color ? String(body.color) : undefined,
  };

  switch (category) {
    case 'accrual_based':
    case 'join_date_based':
      base.monthlyAccrualRate =
        Number(body.monthlyAccrualRate ?? body.accrualRate ?? 0) || null;
      base.daysAllowed = Math.max(0, Number(body.daysAllowed ?? 0));
      base.allowCarryForward = allowCarryForward;
      base.maxCarryForward = maxCarryForward;
      break;
    case 'fixed_allocation':
      base.monthlyAccrualRate = null;
      base.daysAllowed = Math.max(0, Number(body.daysAllowed ?? 0));
      base.allowCarryForward = allowCarryForward;
      base.maxCarryForward = maxCarryForward;
      break;
    case 'event_based':
      base.daysAllowed = 0;
      base.monthlyAccrualRate = null;
      base.allowCarryForward = false;
      base.maxCarryForward = 0;
      base.yearlyResetEnabled = false;
      base.eventTriggerType = String(body.eventTriggerType ?? '').trim() || null;
      base.maxUsagePerEmployment =
        body.maxUsagePerEmployment != null && body.maxUsagePerEmployment !== ''
          ? Math.max(0, Number(body.maxUsagePerEmployment))
          : null;
      base.requiresDocument = Boolean(body.requiresDocument);
      break;
    case 'approval_based':
      base.daysAllowed = 0;
      base.monthlyAccrualRate = null;
      base.allowCarryForward = false;
      base.maxCarryForward = 0;
      base.yearlyResetEnabled = false;
      base.affectsPayroll = Boolean(body.affectsPayroll ?? true);
      base.isPaid = !base.affectsPayroll;
      base.requiresApproval = Boolean(body.requiresApproval ?? body.requireApproval ?? true);
      break;
  }

  return base;
}

export function leaveTypeToApiShape(row: Record<string, unknown>) {
  const category = inferLeaveCategory(row);
  const allowCarryForward = Number(row.carryoverLimit ?? row.maxCarryForward ?? 0) > 0;
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    nameKh:
      row.nameKh != null
        ? String(row.nameKh)
        : row.name_kh != null
          ? String(row.name_kh)
          : undefined,
    code: row.code != null ? String(row.code) : undefined,
    description: row.description != null ? String(row.description) : undefined,
    descriptionKh:
      row.descriptionKh != null
        ? String(row.descriptionKh)
        : row.description_kh != null
          ? String(row.description_kh)
          : undefined,
    isPaid: Boolean(row.isPaid ?? true),
    daysAllowed: Number(row.daysAllowed ?? 0),
    leaveCategory: category,
    leaveCategoryLabel: LEAVE_CATEGORY_LABELS[category],
    monthlyAccrualRate:
      row.monthlyAccrualRate != null
        ? Number(row.monthlyAccrualRate)
        : row.accrualRate != null
          ? Number(row.accrualRate)
          : null,
    yearlyResetEnabled: Boolean(row.yearlyResetEnabled ?? false),
    maxCarryForward: Number(row.maxCarryForward ?? row.carryoverLimit ?? 0),
    allowCarryForward,
    eventTriggerType: row.eventTriggerType != null ? String(row.eventTriggerType) : null,
    maxUsagePerEmployment:
      row.maxUsagePerEmployment != null ? Number(row.maxUsagePerEmployment) : null,
    affectsPayroll: Boolean(row.affectsPayroll ?? !row.isPaid),
    requiresDocument: Boolean(row.requiresDocument ?? false),
    requiresApproval: Boolean(row.requiresApproval ?? true),
    isActive: coerceIsActiveFlag(row.isActive, row.status),
    color: row.color != null ? String(row.color) : undefined,
  };
}

/** Categories that maintain a yearly leave balance row. */
export function leaveCategoryTracksBalance(category: LeaveCategory): boolean {
  return (
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation'
  );
}

export function leaveCategorySupportsMonthlyAccrual(category: LeaveCategory): boolean {
  return category === 'accrual_based' || category === 'join_date_based';
}

/** Types that accrue by join date and use yearly entitlement for request remaining. */
export function leaveCategoryUsesJoinDateAccrual(category: LeaveCategory): boolean {
  return category === 'join_date_based' || category === 'accrual_based';
}

export function leaveCategorySupportsYearlyRenewal(category: LeaveCategory): boolean {
  return (
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation'
  );
}

export function leaveCategorySkipsRenewal(category: LeaveCategory): boolean {
  return category === 'event_based' || category === 'approval_based';
}

export function payloadToDbFields(payload: LeaveTypePayload): Record<string, unknown> {
  return {
    name: payload.name,
    nameKh: payload.nameKh ?? null,
    description: payload.description ?? null,
    descriptionKh: payload.descriptionKh ?? null,
    isPaid: payload.isPaid,
    daysAllowed: payload.daysAllowed,
    leaveCategory: payload.leaveCategory,
    monthlyAccrualRate: payload.monthlyAccrualRate,
    yearlyResetEnabled: payload.yearlyResetEnabled,
    maxCarryForward: payload.maxCarryForward,
    eventTriggerType: payload.eventTriggerType,
    maxUsagePerEmployment: payload.maxUsagePerEmployment,
    affectsPayroll: payload.affectsPayroll,
    requiresDocument: payload.requiresDocument,
    requiresApproval: payload.requiresApproval,
    isActive: payload.isActive !== false,
    color: payload.color ?? '#3B82F6',
  };
}
