/**
 * Semantic status families — icon + tinted pill (see StatusLabel + statusPalette.css).
 */
export type StatusSemantic =
  | 'pending'
  | 'inProgress'
  | 'submitted'
  | 'inReview'
  | 'success'
  | 'failed'
  | 'expired';

export type StatusContext =
  | 'generic'
  | 'leave'
  | 'overtime'
  | 'payroll'
  | 'payroll_payment'
  | 'movement'
  | 'employee'
  | 'attendance'
  | 'appraisal'
  | 'probation'
  | 'project'
  | 'task'
  | 'settlement';

export type StatusPaletteTokens = {
  bg: string;
  text: string;
  border: string;
  icon: string;
};

export const STATUS_PALETTE: Record<StatusSemantic, StatusPaletteTokens> = {
  pending: {
    bg: 'bg-[#FFF4E5]',
    text: 'text-[#C76A00]',
    border: 'border-[#FFDDB3]',
    icon: 'text-[#E88B0C]',
  },
  inProgress: {
    bg: 'bg-[#E8F4FC]',
    text: 'text-[#0078C1]',
    border: 'border-[#B8DCF5]',
    icon: 'text-[#178FCC]',
  },
  submitted: {
    bg: 'bg-[#F3EEFF]',
    text: 'text-[#6B4FBB]',
    border: 'border-[#DDD0F5]',
    icon: 'text-[#7C5FD4]',
  },
  inReview: {
    bg: 'bg-[#FFFBE8]',
    text: 'text-[#9A7B00]',
    border: 'border-[#F5EAA8]',
    icon: 'text-[#B8940A]',
  },
  success: {
    bg: 'bg-[#E8F8EF]',
    text: 'text-[#1F7A45]',
    border: 'border-[#B8E6CB]',
    icon: 'text-[#28A058]',
  },
  failed: {
    bg: 'bg-[#FDECEC]',
    text: 'text-[#B42318]',
    border: 'border-[#FAC5C5]',
    icon: 'text-[#DC2626]',
  },
  expired: {
    bg: 'bg-[#F1F3F5]',
    text: 'text-[#5C6670]',
    border: 'border-[#DDE1E6]',
    icon: 'text-[#6B7280]',
  },
};

const DARK_OVERRIDES: Record<StatusSemantic, Partial<StatusPaletteTokens>> = {
  pending: {
    bg: 'dark:bg-amber-950/40',
    text: 'dark:text-amber-300',
    border: 'dark:border-amber-800/60',
    icon: 'dark:text-amber-400',
  },
  inProgress: {
    bg: 'dark:bg-sky-950/40',
    text: 'dark:text-sky-300',
    border: 'dark:border-sky-800/60',
    icon: 'dark:text-sky-400',
  },
  submitted: {
    bg: 'dark:bg-violet-950/40',
    text: 'dark:text-violet-300',
    border: 'dark:border-violet-800/60',
    icon: 'dark:text-violet-400',
  },
  inReview: {
    bg: 'dark:bg-yellow-950/35',
    text: 'dark:text-yellow-200',
    border: 'dark:border-yellow-800/50',
    icon: 'dark:text-yellow-400',
  },
  success: {
    bg: 'dark:bg-emerald-950/40',
    text: 'dark:text-emerald-300',
    border: 'dark:border-emerald-800/60',
    icon: 'dark:text-emerald-400',
  },
  failed: {
    bg: 'dark:bg-red-950/40',
    text: 'dark:text-red-300',
    border: 'dark:border-red-800/60',
    icon: 'dark:text-red-400',
  },
  expired: {
    bg: 'dark:bg-slate-800/80',
    text: 'dark:text-slate-300',
    border: 'dark:border-slate-600',
    icon: 'dark:text-slate-400',
  },
};

function normalizeCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

const GENERIC_MAP: Record<string, StatusSemantic> = {
  PENDING: 'pending',
  PENDING_APPROVAL: 'pending',
  PENDING_MANAGER: 'pending',
  PENDING_EMPLOYEE: 'pending',
  PENDING_HR: 'pending',
  PENDING_FINAL_APPROVAL: 'pending',
  PENDING_REMOVAL_APPROVAL: 'pending',
  AWAITING: 'pending',
  PENDING_REVIEW: 'inReview',

  SUBMITTED: 'submitted',
  MANAGER_APPROVED: 'submitted',

  UNDER_REVIEW: 'inReview',
  IN_REVIEW: 'inReview',
  REVIEW_DUE: 'inReview',
  HR_REVIEW: 'inReview',
  MANAGER_REVIEW: 'inReview',
  SUPERVISOR_EVALUATION: 'inReview',
  SELF_REVIEW: 'inReview',
  RETURNED: 'inReview',

  DRAFT: 'inProgress',
  PROCESSING: 'inProgress',
  IN_PROGRESS: 'inProgress',
  REOPENED: 'inProgress',
  PAYMENT_PROCESSING: 'inProgress',
  UPCOMING: 'inProgress',
  EXTENDED: 'inProgress',
  PLANNING: 'inProgress',
  SCHEDULED: 'inProgress',
  EXPORTED: 'inProgress',

  APPROVED: 'success',
  COMPLETED: 'success',
  PAID: 'success',
  LOCKED: 'expired',
  FINALIZED: 'success',
  APPLIED: 'success',
  PASSED: 'success',
  CLOSED: 'success',
  ACTIVE: 'success',
  PRESENT: 'success',
  DONE: 'success',
  FINANCE_APPROVED: 'success',
  MANAGEMENT_APPROVED: 'success',
  HR_APPROVED: 'success',

  REJECTED: 'failed',
  FAILED: 'failed',
  REVERSED: 'failed',
  ABSENT: 'failed',
  LATE: 'failed',

  CANCELLED: 'expired',
  EXPIRED: 'expired',
  INACTIVE: 'expired',
  TERMINATED: 'expired',
  RESIGNED: 'expired',
  ON_LEAVE: 'expired',
  DAY_OFF: 'expired',
  PH: 'failed',
  MISSION: 'inProgress',
  ARCHIVED: 'expired',
  PROFILE_INCOMPLETE: 'inProgress',
};

const CONTEXT_OVERRIDES: Partial<Record<StatusContext, Record<string, StatusSemantic>>> = {
  leave: {
    MANAGER_APPROVED: 'submitted',
    RETURNED: 'inReview',
  },
  overtime: {
    RETURNED: 'inReview',
    CANCELLED: 'expired',
  },
  movement: {
    SCHEDULED: 'inReview',
    APPROVED: 'inReview',
  },
  payroll: {
    DRAFT: 'inProgress',
    UNDER_REVIEW: 'inReview',
    PENDING_APPROVAL: 'pending',
    HOLDING: 'pending',
    APPROVED: 'success',
    LOCKED: 'expired',
    FINALIZED: 'success',
    PAYMENT_PROCESSING: 'inProgress',
    PAID: 'success',
    REJECTED: 'failed',
    CANCELLED: 'expired',
    REVERSED: 'expired',
  },
  payroll_payment: {
    pending: 'pending',
    exported: 'inProgress',
    paid: 'success',
  },
  employee: {
    DRAFT: 'inProgress',
    PROFILE_INCOMPLETE: 'inProgress',
    PENDING_APPROVAL: 'pending',
    OFFBOARDING: 'inReview',
    ACTIVE: 'success',
    INACTIVE: 'expired',
    TERMINATED: 'expired',
    RESIGNED: 'expired',
  },
  attendance: {
    LATE: 'pending',
    ABSENT: 'failed',
    AWAITING: 'failed',
    ON_LEAVE: 'inReview',
    DAY_OFF: 'expired',
    PH: 'failed',
    MISSION: 'inProgress',
  },
  appraisal: {
    DRAFT: 'inProgress',
    REOPENED: 'inProgress',
    PENDING_MANAGER: 'pending',
    PENDING_EMPLOYEE: 'pending',
    PENDING_HR: 'inReview',
    PENDING_FINAL_APPROVAL: 'pending',
    SUBMITTED: 'submitted',
    APPROVED: 'success',
    CLOSED: 'success',
  },
  probation: {
    UPCOMING: 'inProgress',
    REVIEW_DUE: 'pending',
    IN_REVIEW: 'inReview',
    EXTENDED: 'inProgress',
  },
  project: {
    PLANNING: 'inProgress',
    ACTIVE: 'inProgress',
    COMPLETED: 'success',
    ON_HOLD: 'expired',
  },
  task: {
    TODO: 'pending',
    IN_PROGRESS: 'inProgress',
    DONE: 'success',
  },
  settlement: {
    DRAFT: 'inProgress',
    SUBMITTED: 'submitted',
    HR_APPROVED: 'inReview',
    FINANCE_APPROVED: 'inReview',
    MANAGEMENT_APPROVED: 'inReview',
    PAID: 'success',
  },
};

export function resolveStatusSemantic(
  raw: string,
  context: StatusContext = 'generic'
): StatusSemantic {
  const code = normalizeCode(raw);
  const lower = String(raw ?? '').trim().toLowerCase();

  const contextMap = CONTEXT_OVERRIDES[context];
  if (contextMap?.[code]) return contextMap[code]!;
  if (contextMap?.[lower]) return contextMap[lower]!;

  if (GENERIC_MAP[code]) return GENERIC_MAP[code]!;
  if (GENERIC_MAP[lower.toUpperCase()]) return GENERIC_MAP[lower.toUpperCase()]!;

  if (lower.includes('pending') || lower.includes('await')) return 'pending';
  if (lower.includes('review')) return 'inReview';
  if (lower.includes('submit')) return 'submitted';
  if (lower.includes('progress') || lower.includes('draft')) return 'inProgress';
  if (lower.includes('approv') || lower.includes('complete') || lower.includes('paid') || lower.includes('pass'))
    return 'success';
  if (lower.includes('reject') || lower.includes('fail')) return 'failed';
  if (lower.includes('cancel') || lower.includes('expir') || lower.includes('inactive')) return 'expired';

  return 'expired';
}

export function statusSemanticClass(semantic: StatusSemantic): string {
  return `hcms-status-tag hcms-status-tag--${semantic}`;
}

export function statusTagClassNames(semantic: StatusSemantic): string {
  const tokens = STATUS_PALETTE[semantic];
  const dark = DARK_OVERRIDES[semantic];
  return [
    statusSemanticClass(semantic),
    tokens.bg,
    dark.bg,
    tokens.text,
    dark.text,
    tokens.border,
    dark.border,
    'border',
  ]
    .filter(Boolean)
    .join(' ');
}

export function statusIconClassNames(semantic: StatusSemantic): string {
  const tokens = STATUS_PALETTE[semantic];
  const dark = DARK_OVERRIDES[semantic];
  return [tokens.icon, dark.icon].filter(Boolean).join(' ');
}

export function formatStatusCodeLabel(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '—';
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHr\b/g, 'HR')
    .replace(/\bId\b/g, 'ID');
}
