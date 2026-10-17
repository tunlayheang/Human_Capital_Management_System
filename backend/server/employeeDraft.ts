/**
 * Draft vs active employee onboarding — shared validation for create/update routes.
 */

export const EMPLOYEE_STATUS_DRAFT = 'draft';
/** @deprecated Legacy rows are normalized to draft on read/write. */
export const EMPLOYEE_STATUS_PROFILE_INCOMPLETE = 'profile_incomplete';
export const EMPLOYEE_STATUS_ACTIVE = 'active';

const OFFBOARDED_EMPLOYEE_STATUSES = new Set([
  'inactive',
  'terminated',
  'resigned',
  'absconded',
  'retired',
  'suspended',
]);

export function normalizeEmployeeLifecycleStatus(status: unknown): string {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();
  if (normalized === EMPLOYEE_STATUS_PROFILE_INCOMPLETE) return EMPLOYEE_STATUS_DRAFT;
  return normalized;
}

function isOffboardedEmployeeStatus(status: string): boolean {
  return OFFBOARDED_EMPLOYEE_STATUSES.has(status);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED_FOR_ACTIVE = [
  'employee_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'department_id',
  'position_id',
  'join_date',
  'gender',
  'birth_date',
  'nationality',
] as const;

function hasText(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

function hasSalary(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n);
}

export function isPlaceholderDraftEmail(email: unknown): boolean {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@pending.iroc');
}

function hasValidWorkEmail(email: unknown): boolean {
  const value = String(email ?? '').trim();
  if (!value || isPlaceholderDraftEmail(value)) return false;
  return EMAIL_RE.test(value);
}

function hasValidEmployeePhone(phone: unknown): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 8;
}

function isLikelyDraftPlaceholderPhone(phone: unknown, employeeId: unknown): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!/^9\d{8}$/.test(digits)) return false;
  const slug = String(employeeId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const fromId = slug.replace(/\D/g, '').slice(-8).padStart(8, '0');
  return digits === `9${fromId}`;
}

function normalizeTimeHm(value: unknown): string {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

/** Merge DB row + incoming employee/salary fields for status resolution. */
export function mergeEmployeeRowForStatusValidation(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  salary?: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...existing,
    ...incoming,
    employee_id: incoming.employee_id ?? existing.employee_id,
  };
  if (salary && typeof salary === 'object') {
    for (const key of SALARY_PAYLOAD_KEYS) {
      if (salary[key] !== undefined) merged[key] = salary[key];
    }
  }
  for (const key of [
    'time_in',
    'time_out',
    'work_days',
    'work_hours',
    'break_duration_minutes',
    'grace_period_minutes',
  ] as const) {
    if (incoming[key] !== undefined) merged[key] = incoming[key];
  }
  merged.time_in = normalizeTimeHm(merged.time_in);
  merged.time_out = normalizeTimeHm(merged.time_out);
  return merged;
}

const SALARY_PAYLOAD_KEYS = [
  'salary_type',
  'base_salary',
  'currency',
  'payment_day',
  'bank_name',
  'bank_account_number',
  'payment_method',
  'tax_id',
  'nssf_id',
  'tax_dependents',
  'nssf_enrolled',
] as const;

/** True when all fields required for an active employee are present (real values, not draft placeholders). */
export function isEmployeePayloadComplete(body: Record<string, unknown>): boolean {
  if (!body || typeof body !== 'object') return false;

  for (const key of REQUIRED_FOR_ACTIVE) {
    if (!hasText(body[key])) return false;
  }

  if (!hasValidWorkEmail(body.email)) return false;
  if (!hasValidEmployeePhone(body.phone)) return false;
  if (isLikelyDraftPlaceholderPhone(body.phone, body.employee_id)) return false;

  if (!hasSalary(body.base_salary)) return false;

  const timeIn = normalizeTimeHm(body.time_in);
  const timeOut = normalizeTimeHm(body.time_out);
  if (!/^\d{2}:\d{2}$/.test(timeIn) || !/^\d{2}:\d{2}$/.test(timeOut)) return false;

  const workDaysRaw = body.work_days;
  const workDays =
    workDaysRaw != null && workDaysRaw !== '' ? Number(workDaysRaw) : 5;
  if (!Number.isFinite(workDays) || workDays < 1) return false;

  if (String(body.marital_status ?? '').toLowerCase() === 'married') {
    if (!hasText(body.spouse_name)) return false;
    if (!hasText(body.spouse_phone)) return false;
  }

  if (!hasText(body.religion)) return false;
  if (!hasText(body.street_address)) return false;
  if (!hasText(body.city)) return false;
  const payMethod = String(body.payment_method ?? 'bank').toLowerCase();
  if (payMethod !== 'cash') {
    if (!hasText(body.bank_name)) return false;
    if (!hasText(body.bank_account_number)) return false;
  }
  if (!hasText(body.emergency_contact_name)) return false;
  if (!hasText(body.emergency_contact_relationship)) return false;
  if (!hasText(body.emergency_contact_phone)) return false;

  const grace = body.grace_period_minutes;
  if (grace == null || grace === '' || !Number.isFinite(Number(grace))) return false;

  const breakMin = body.break_duration_minutes;
  if (breakMin == null || breakMin === '' || !Number.isFinite(Number(breakMin))) return false;

  if (Number(body.base_salary) <= 0) return false;

  return true;
}

/** Minimum data to persist a draft row (shows on employee list). */
export function canPersistDraft(body: Record<string, unknown>): boolean {
  const hasName = hasText(body.first_name) || hasText(body.last_name);
  const hasId = hasText(body.employee_id);
  return hasName || hasId;
}

export function isDraftRequest(body: Record<string, unknown>): boolean {
  if (body.is_draft === true || body.is_draft === 'true') return true;
  const status = String(body.status ?? '')
    .trim()
    .toLowerCase();
  return status === EMPLOYEE_STATUS_DRAFT;
}

/**
 * Resolve stored status after create/update.
 * - Explicit draft save → draft (only path that creates draft status)
 * - activate_profile requires a complete profile → active; incomplete activate stays prior status
 * - Draft stays draft until explicitly activated with a complete profile
 */
export function resolveEmployeeStatus(params: {
  body: Record<string, unknown>;
  previousStatus?: string | null;
  forceComplete?: boolean;
}): { status: string; markOnboardingComplete: boolean } {
  const { body, previousStatus, forceComplete } = params;
  const prev = normalizeEmployeeLifecycleStatus(previousStatus);

  if (isDraftRequest(body)) {
    return { status: EMPLOYEE_STATUS_DRAFT, markOnboardingComplete: false };
  }

  const explicitStatus = normalizeEmployeeLifecycleStatus(body.status);
  const wantsActivate =
    body.activate_profile === true ||
    body.force_activate === true ||
    explicitStatus === EMPLOYEE_STATUS_ACTIVE ||
    forceComplete === true;

  const complete = isEmployeePayloadComplete(body);

  if (wantsActivate) {
    if (isOffboardedEmployeeStatus(prev)) {
      return { status: prev, markOnboardingComplete: false };
    }
    // Incomplete Finish / Save Profile must not silently become Active or invent Draft.
    if (!complete) {
      if (prev === EMPLOYEE_STATUS_DRAFT || isPlaceholderDraftEmail(body.email) || !prev) {
        return { status: EMPLOYEE_STATUS_DRAFT, markOnboardingComplete: false };
      }
      return { status: prev, markOnboardingComplete: false };
    }
    return {
      status: EMPLOYEE_STATUS_ACTIVE,
      markOnboardingComplete: true,
    };
  }

  // Existing drafts (or placeholder draft emails) stay draft until explicit activate.
  if (prev === EMPLOYEE_STATUS_DRAFT || isPlaceholderDraftEmail(body.email)) {
    return { status: EMPLOYEE_STATUS_DRAFT, markOnboardingComplete: false };
  }

  if (!complete) {
    if (
      prev === EMPLOYEE_STATUS_ACTIVE ||
      prev === 'probation' ||
      prev === 'pending_approval'
    ) {
      return { status: prev, markOnboardingComplete: false };
    }
    if (isOffboardedEmployeeStatus(prev)) {
      return { status: prev, markOnboardingComplete: false };
    }
    // Incomplete create/update without explicit Save Draft — do not invent draft here.
    // Create route rejects these; update keeps prior status when present.
    return { status: prev || EMPLOYEE_STATUS_ACTIVE, markOnboardingComplete: false };
  }

  if (explicitStatus && explicitStatus !== EMPLOYEE_STATUS_ACTIVE) {
    return {
      status: explicitStatus,
      markOnboardingComplete: false,
    };
  }

  // New create with a complete payload and no prior status → active.
  if (complete && !prev) {
    return { status: EMPLOYEE_STATUS_ACTIVE, markOnboardingComplete: true };
  }

  if (complete && prev === EMPLOYEE_STATUS_ACTIVE) {
    return { status: EMPLOYEE_STATUS_ACTIVE, markOnboardingComplete: true };
  }

  return { status: prev || EMPLOYEE_STATUS_DRAFT, markOnboardingComplete: false };
}

export function missingFieldsForActive(body: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const key of REQUIRED_FOR_ACTIVE) {
    if (!hasText(body[key])) {
      missing.push(key);
    }
  }
  if (!hasValidWorkEmail(body.email)) missing.push('email');
  if (!hasValidEmployeePhone(body.phone)) missing.push('phone');
  if (isLikelyDraftPlaceholderPhone(body.phone, body.employee_id)) missing.push('phone');
  if (!hasSalary(body.base_salary)) missing.push('base_salary');
  const timeIn = normalizeTimeHm(body.time_in);
  const timeOut = normalizeTimeHm(body.time_out);
  if (!/^\d{2}:\d{2}$/.test(timeIn)) missing.push('time_in');
  if (!/^\d{2}:\d{2}$/.test(timeOut)) missing.push('time_out');
  const workDaysRaw = body.work_days;
  const workDays =
    workDaysRaw != null && workDaysRaw !== '' ? Number(workDaysRaw) : 5;
  if (!Number.isFinite(workDays) || workDays < 1) missing.push('work_days');
  if (String(body.marital_status ?? '').toLowerCase() === 'married') {
    if (!hasText(body.spouse_name)) missing.push('spouse_name');
    if (!hasText(body.spouse_phone)) missing.push('spouse_phone');
  }
  if (!hasText(body.religion)) missing.push('religion');
  if (!hasText(body.street_address)) missing.push('street_address');
  if (!hasText(body.city)) missing.push('city');
  const payMethod = String(body.payment_method ?? 'bank').toLowerCase();
  if (payMethod !== 'cash') {
    if (!hasText(body.bank_name)) missing.push('bank_name');
    if (!hasText(body.bank_account_number)) missing.push('bank_account_number');
  }
  if (!hasText(body.emergency_contact_name)) missing.push('emergency_contact_name');
  if (!hasText(body.emergency_contact_relationship)) missing.push('emergency_contact_relationship');
  if (!hasText(body.emergency_contact_phone)) missing.push('emergency_contact_phone');
  const grace = body.grace_period_minutes;
  if (grace == null || grace === '' || !Number.isFinite(Number(grace))) {
    missing.push('grace_period_minutes');
  }
  const breakMin = body.break_duration_minutes;
  if (breakMin == null || breakMin === '' || !Number.isFinite(Number(breakMin))) {
    missing.push('break_duration_minutes');
  }
  if (Number(body.base_salary) <= 0) missing.push('base_salary');
  return missing;
}

function draftSlug(employeeId: string): string {
  return String(employeeId || 'draft')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'draft';
}

/** Fill placeholder values so draft rows can be inserted before onboarding is finished.
 * Department/position stay null until the user selects them — never invent placement. */
export function fillDraftCreateFields(body: Record<string, unknown>): Record<string, unknown> {
  const eid = String(body.employee_id ?? '').trim();
  const slug = draftSlug(eid);
  const digits = slug.replace(/\D/g, '').slice(-8).padStart(8, '0');

  return {
    ...body,
    first_name: hasText(body.first_name) ? body.first_name : 'Draft',
    last_name: hasText(body.last_name) ? body.last_name : 'Employee',
    email:
      hasText(body.email) && !isPlaceholderDraftEmail(body.email)
        ? body.email
        : `draft.${slug}@pending.iroc`,
    phone: hasText(body.phone) ? body.phone : `9${digits}`,
    gender: hasText(body.gender) ? body.gender : 'Male',
    birth_date: hasText(body.birth_date) ? body.birth_date : '2000-01-01',
    department_id: hasText(body.department_id) ? body.department_id : null,
    position_id: hasText(body.position_id) ? body.position_id : null,
    join_date: hasText(body.join_date) ? body.join_date : new Date().toISOString().slice(0, 10),
    base_salary: hasSalary(body.base_salary) ? body.base_salary : 0,
    employment_type: hasText(body.employment_type) ? body.employment_type : 'Full-Time',
    nationality: hasText(body.nationality) ? body.nationality : 'Cambodia',
    marital_status: hasText(body.marital_status) ? body.marital_status : 'single',
    time_in: hasText(body.time_in) ? body.time_in : '08:00',
    time_out: hasText(body.time_out) ? body.time_out : '17:00',
    work_hours: body.work_hours ?? 8,
    worker_type: hasText(body.worker_type) ? body.worker_type : 'regular',
    probation_period_months:
      body.probation_period_months != null && body.probation_period_months !== ''
        ? body.probation_period_months
        : 3,
  };
}

export function stripDraftMeta(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.is_draft;
  delete next.activate_profile;
  delete next.force_activate;
  return next;
}
