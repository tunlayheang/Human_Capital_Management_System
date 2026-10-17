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
    'Leave earned gradually over time; requests limited to accrued-to-date balance.',
  join_date_based:
    'Join-date monthly accrual (join day 1–9 → 1.5, 10–19 → 1, 20–end → 0.5). Requests use yearly entitlement, not the monthly accrual cap.',
  fixed_allocation: 'Fixed leave balance granted yearly. Example: Sick Leave.',
  event_based: 'Leave triggered by specific events. Example: Maternity, Marriage.',
  approval_based: 'No balance tracking. Example: Unpaid Leave.',
};

export type LeaveCategoryRuleCard = {
  category: LeaveCategory;
  accent: string;
  summary: string;
  balance: string;
  renewal: string;
  accrual: string;
  carryForward: string;
  deduction: string;
  doesNot: string[];
  example: string;
};

/** Display copy for Configuration page — mirrors backend category behavior. */
export const LEAVE_CATEGORY_RULES: LeaveCategoryRuleCard[] = [
  {
    category: 'accrual_based',
    accent: 'border-sky-200 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-950/30',
    summary: LEAVE_CATEGORY_DESCRIPTIONS.accrual_based,
    balance: 'Employee balance row created; remaining = opening + accrued + carry-forward − used.',
    renewal: 'Year-end: apply carry-forward cap, open new yearly cycle, reset counters.',
    accrual: 'Monthly job adds the configured rate from the employee join month only; mid-year joiners get a prorated annual cap.',
    carryForward: 'Optional max carry-forward days at year-end (if enabled on the type).',
    deduction: 'Approved leave reduces balance (validated before submit and on approval).',
    doesNot: ['Cannot request more than accrued-to-date'],
    example: 'Strict monthly accrual leave',
  },
  {
    category: 'join_date_based',
    accent: 'border-teal-200 bg-teal-50/80 dark:border-teal-800 dark:bg-teal-950/30',
    summary: LEAVE_CATEGORY_DESCRIPTIONS.join_date_based,
    balance:
      'Tracks monthly accrual for reporting; remaining for requests = yearly entitlement + carry-forward − used (service-period prorated).',
    renewal: 'Year-end: apply carry-forward cap, open new yearly cycle with prorated entitlement.',
    accrual:
      'Join month: day 1–9 → 1.5, 10–19 → 1, 20–end → 0.5. Later months: monthly rate. Amounts always in 0.5-day steps.',
    carryForward: 'Optional max carry-forward days at year-end (if enabled on the type).',
    deduction:
      'Approved leave deducts from yearly remaining — may exceed this month’s accrual if yearly balance allows.',
    doesNot: ['No fractional accruals like 1.2 or 0.4', 'Not limited to 1.5 days per month when requesting'],
    example: 'Annual Leave',
  },
  {
    category: 'fixed_allocation',
    accent: 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30',
    summary: LEAVE_CATEGORY_DESCRIPTIONS.fixed_allocation,
    balance: 'Full yearly allocation stored as entitlement; remaining = entitlement + carry-forward − used.',
    renewal: 'Year-start / year-end job allocates default days per year for assigned employees.',
    accrual: 'No monthly accrual.',
    carryForward: 'Optional carry-forward at year-end when enabled.',
    deduction: 'Approved leave deducts from yearly balance.',
    doesNot: ['No monthly earning of days'],
    example: 'Sick Leave',
  },
  {
    category: 'event_based',
    accent: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30',
    summary: LEAVE_CATEGORY_DESCRIPTIONS.event_based,
    balance: 'No yearly balance row — assignment only (type enabled per employee).',
    renewal: 'No yearly renewal or reset.',
    accrual: 'No monthly accrual.',
    carryForward: 'Not applicable.',
    deduction: 'Usage limited by max times per employment and event trigger (if configured).',
    doesNot: [
      'No default days per year on balance',
      'No carry-forward',
      'No year-end renewal job',
    ],
    example: 'Maternity, Marriage, Paternity',
  },
  {
    category: 'approval_based',
    accent: 'border-violet-200 bg-violet-50/80 dark:border-violet-800 dark:bg-violet-950/30',
    summary: LEAVE_CATEGORY_DESCRIPTIONS.approval_based,
    balance: 'No balance tracking — approval governs each request.',
    renewal: 'No yearly renewal.',
    accrual: 'No monthly accrual.',
    carryForward: 'Not applicable.',
    deduction: 'May affect payroll when “affect payroll” is enabled (e.g. unpaid leave).',
    doesNot: ['No balance row', 'No accrual', 'No carry-forward'],
    example: 'Unpaid Leave',
  },
];

export const LEAVE_CATEGORY_ACCENT_TEXT: Record<LeaveCategory, string> = {
  accrual_based: 'text-sky-700 dark:text-sky-300',
  join_date_based: 'text-teal-700 dark:text-teal-300',
  fixed_allocation: 'text-amber-700 dark:text-amber-300',
  event_based: 'text-emerald-700 dark:text-emerald-300',
  approval_based: 'text-violet-700 dark:text-violet-300',
};

export const EVENT_TRIGGER_OPTIONS = [
  'Maternity',
  'Paternity',
  'Marriage',
  'Bereavement',
  'Medical',
  'Other',
] as const;

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
  if (code === 'UNPAID' || row.isPaid === false) return 'approval_based';
  return Number(row.daysAllowed ?? 0) > 0 ? 'fixed_allocation' : 'approval_based';
}

export type LeaveTypeFormPayload = {
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  isPaid: boolean;
  daysAllowed: number;
  leaveCategory: LeaveCategory;
  monthlyAccrualRate: number | null;
  yearlyResetEnabled: boolean;
  maxCarryForward: number;
  allowCarryForward: boolean;
  eventTriggerType: string;
  maxUsagePerEmployment: number | null;
  affectsPayroll: boolean;
  requiresDocument: boolean;
  requiresApproval: boolean;
  isActive: boolean;
};

/** Normalize DB/API active flags (MySQL may return 0/1). */
export function coerceIsActiveFlag(value: unknown, status?: unknown): boolean {
  if (status != null && String(status).toLowerCase() === 'inactive') return false;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value == null || value === '') return true;
  return Boolean(value);
}

export function validateLeaveTypeForm(
  payload: LeaveTypeFormPayload
): string | null {
  if (!payload.name.trim()) return 'Leave type name is required';
  if (!payload.leaveCategory) return 'Leave category is required';

  switch (payload.leaveCategory) {
    case 'accrual_based':
    case 'join_date_based':
      if (!payload.monthlyAccrualRate || payload.monthlyAccrualRate <= 0) {
        return 'Monthly accrual rate is required';
      }
      if (payload.daysAllowed < 0 || Number.isNaN(payload.daysAllowed)) {
        return 'Default days per year is required';
      }
      break;
    case 'fixed_allocation':
      if (!payload.daysAllowed || payload.daysAllowed <= 0) {
        return 'Default days per year is required';
      }
      break;
    case 'event_based':
      if (!payload.eventTriggerType.trim()) return 'Event trigger type is required';
      break;
    case 'approval_based':
      break;
  }
  return null;
}

export function buildLeaveTypePayload(form: LeaveTypeFormPayload): LeaveTypeFormPayload & {
  status: 'active' | 'inactive';
} {
  const out = {
    ...form,
    name: form.name.trim(),
    nameKh: form.nameKh?.trim() || undefined,
    description: form.description?.trim() || undefined,
    descriptionKh: form.descriptionKh?.trim() || undefined,
    status: form.isActive ? ('active' as const) : ('inactive' as const),
  };

  switch (form.leaveCategory) {
    case 'accrual_based':
    case 'join_date_based':
      break;
    case 'fixed_allocation':
      out.monthlyAccrualRate = null;
      break;
    case 'event_based':
      out.daysAllowed = 0;
      out.monthlyAccrualRate = null;
      out.allowCarryForward = false;
      out.maxCarryForward = 0;
      out.yearlyResetEnabled = false;
      break;
    case 'approval_based':
      out.daysAllowed = 0;
      out.monthlyAccrualRate = null;
      out.allowCarryForward = false;
      out.maxCarryForward = 0;
      out.yearlyResetEnabled = false;
      out.isPaid = !form.affectsPayroll;
      break;
  }

  return out;
}

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

export function leaveCategorySupportsYearlyRenewal(category: LeaveCategory): boolean {
  return (
    category === 'accrual_based' ||
    category === 'join_date_based' ||
    category === 'fixed_allocation'
  );
}

export function parseLeaveTypeRow(row: Record<string, unknown>) {
  const category = inferLeaveCategory(row);
  const allowCarryForward =
    Boolean(row.allowCarryForward) || Number(row.maxCarryForward ?? row.carryoverLimit ?? 0) > 0;
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
    isPaid: Boolean(row.isPaid ?? row.is_paid ?? true),
    daysAllowed: Number(row.daysAllowed ?? row.days_allowed ?? 0),
    leaveCategory: category,
    monthlyAccrualRate:
      row.monthlyAccrualRate != null
        ? Number(row.monthlyAccrualRate)
        : row.accrualRate != null
          ? Number(row.accrualRate)
          : null,
    yearlyResetEnabled: Boolean(row.yearlyResetEnabled ?? false),
    maxCarryForward: Number(row.maxCarryForward ?? row.carryoverLimit ?? 0),
    allowCarryForward,
    eventTriggerType: row.eventTriggerType != null ? String(row.eventTriggerType) : '',
    maxUsagePerEmployment:
      row.maxUsagePerEmployment != null ? Number(row.maxUsagePerEmployment) : null,
    affectsPayroll: Boolean(row.affectsPayroll ?? !row.isPaid),
    requiresDocument: Boolean(row.requiresDocument ?? false),
    requiresApproval: Boolean(row.requiresApproval ?? true),
    isActive: coerceIsActiveFlag(row.isActive, row.status),
  };
}
