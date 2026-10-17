import { isPlaceholderDraftEmail } from './employeeDraft';

export type WorkerType = 'regular' | 'specialized' | 'non_specialized';

export const WORKER_TYPE_MAX_MONTHS: Record<WorkerType, number> = {
  regular: 3,
  specialized: 2,
  non_specialized: 1,
};

export type ProbationEmployeeFields = {
  status?: string;
  email?: string;
  join_date?: string;
  employment_type?: string | null;
  probation_period_months?: number | null;
  probation_confirmed_at?: string | null;
  worker_type?: string | null;
};

function employmentUsesArt68Probation(employmentType?: string | null): boolean {
  const t = String(employmentType ?? 'Full-Time')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return t === 'full-time' || t === 'fulltime' || t === 'part-time' || t === 'parttime' || !employmentType;
}

export function normalizeWorkerType(raw: unknown): WorkerType {
  const s = String(raw ?? 'regular')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (s === 'specialized') return 'specialized';
  if (s === 'non_specialized') return 'non_specialized';
  return 'regular';
}

export function maxProbationMonthsForWorkerType(workerType: WorkerType): number {
  return WORKER_TYPE_MAX_MONTHS[workerType];
}

/** Calendar dates in UTC — aligned with backend probationService / MySQL DATE_ADD. */
function parseDateOnly(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const iso = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addCalendarMonths(joinDate: Date, months: number): Date {
  const y = joinDate.getUTCFullYear();
  const m = joinDate.getUTCMonth();
  const day = joinDate.getUTCDate();
  return new Date(Date.UTC(y, m + months, day));
}

export function probationEndDate(joinDateRaw: unknown, probationMonths: number): string | null {
  const months = Math.max(0, Math.floor(Number(probationMonths)));
  if (months <= 0) return null;
  const join = parseDateOnly(joinDateRaw);
  if (!join) return null;
  return formatDateOnly(addCalendarMonths(join, months));
}

export function capProbationMonths(months: number, workerType: WorkerType): number {
  const max = maxProbationMonthsForWorkerType(workerType);
  return Math.min(Math.max(0, Math.floor(months)), max);
}

export function isActiveCompletedEmployee(employee: {
  status?: string;
  email?: string;
}): boolean {
  const status = String(employee.status ?? '').trim().toLowerCase();
  if (status !== 'active') return false;
  if (isPlaceholderDraftEmail(employee.email)) return false;
  return true;
}

/** Mirrors backend isInProbation — shared rule for all UI filters. */
export function isEmployeeInProbation(
  employee: ProbationEmployeeFields,
  asOfDate?: string
): boolean {
  if (!isActiveCompletedEmployee(employee)) return false;
  // Art. 68 probation applies to Full-Time / Part-Time only (not Contract / Intern).
  if (!employmentUsesArt68Probation(employee.employment_type)) return false;

  const join = parseDateOnly(employee.join_date);
  if (!join) return false;

  const asOf = parseDateOnly(asOfDate ?? formatDateOnly(new Date()));
  if (!asOf) return false;

  join.setHours(0, 0, 0, 0);
  asOf.setHours(0, 0, 0, 0);
  if (asOf < join) return false;

  if (employee.probation_confirmed_at) return false;

  const workerType = normalizeWorkerType(employee.worker_type);
  const monthsRaw = employee.probation_period_months;
  const months =
    monthsRaw != null && Number.isFinite(Number(monthsRaw))
      ? capProbationMonths(Number(monthsRaw), workerType)
      : maxProbationMonthsForWorkerType(workerType);
  if (months <= 0) return false;

  const endIso = probationEndDate(employee.join_date, months);
  if (!endIso) return false;
  const end = parseDateOnly(endIso);
  if (!end) return false;
  end.setHours(0, 0, 0, 0);

  return asOf < end;
}

export function formatProbationProfileLabel(employee: ProbationEmployeeFields): string {
  const workerType = normalizeWorkerType(employee.worker_type);
  const monthsRaw = employee.probation_period_months;
  const months =
    monthsRaw != null && Number.isFinite(Number(monthsRaw))
      ? Math.max(0, Math.floor(Number(monthsRaw)))
      : maxProbationMonthsForWorkerType(workerType);
  const capped = employmentUsesArt68Probation(employee.employment_type)
    ? capProbationMonths(months, workerType)
    : months;

  if (employee.probation_confirmed_at) {
    const confirmed = String(employee.probation_confirmed_at).slice(0, 10);
    return `Confirmed on ${confirmed}`;
  }
  if (capped <= 0) return 'No probation';

  const end = probationEndDate(employee.join_date, capped);
  if (!end) return 'No probation';

  const t = String(employee.employment_type ?? '')
    .trim()
    .toLowerCase();
  if (t === 'intern' || t === 'internship') {
    return `Internship ends ${end} (${capped} month${capped === 1 ? '' : 's'})`;
  }
  if (t === 'contract') {
    return `Contract ends ${end} (${capped} month${capped === 1 ? '' : 's'})`;
  }
  return `Probation ends ${end} (${capped} month${capped === 1 ? '' : 's'})`;
}

export const WORKER_TYPE_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'regular', label: 'Regular worker (max 3 months)' },
  { value: 'specialized', label: 'Specialized worker (max 2 months)' },
  { value: 'non_specialized', label: 'Non-specialized worker (max 1 month)' },
];

export const DEFAULT_REGULAR_PROBATION_MONTHS = 3;

/** Read probation / engagement period fields from API row (snake_case or camelCase). */
export function readProbationFieldsFromRecord(record: Record<string, unknown>): {
  workerType: WorkerType;
  probationPeriodMonths: number;
  probationEnd: string;
} {
  const employmentType = String(
    record.employment_type ?? record.employmentType ?? 'Full-Time'
  );
  const rawMonths =
    record.probation_period_months ?? record.probationPeriodMonths ?? null;
  const parsed =
    rawMonths != null && rawMonths !== '' && Number.isFinite(Number(rawMonths))
      ? Math.max(0, Math.floor(Number(rawMonths)))
      : DEFAULT_REGULAR_PROBATION_MONTHS;

  let months = parsed;
  let workerType = normalizeWorkerType(
    record.worker_type ?? record.workerType ?? 'regular'
  );
  if (employmentUsesArt68Probation(employmentType)) {
    months = capProbationMonths(parsed, workerType);
    // Prefer months→worker_type mapping for Art. 68 consistency.
    if (months <= 1) workerType = 'non_specialized';
    else if (months === 2) workerType = 'specialized';
    else workerType = 'regular';
  } else {
    months = Math.min(parsed, 24);
    workerType = 'regular';
  }

  const joinDate = record.join_date ?? record.joinDate ?? '';
  const probationEnd = probationEndDate(joinDate, months) ?? '';
  return { workerType, probationPeriodMonths: months, probationEnd };
}

/** Legacy: derive months when an end date was entered directly. */
export function probationMonthsFromJoinAndEnd(
  joinDateStr?: string,
  probationEndStr?: string
): number | undefined {
  if (!joinDateStr?.trim() || !probationEndStr?.trim()) return undefined;
  const endIso = parseDateOnly(probationEndStr);
  if (!endIso) return undefined;
  const endStr = formatDateOnly(endIso);
  for (let n = 0; n <= 36; n++) {
    if (probationEndDate(joinDateStr, n) === endStr) {
      return n;
    }
  }
  return undefined;
}

/** Resolve months to persist — direct input wins; legacy end date is fallback. */
export function resolveProbationMonthsForSave(input: {
  joinDate?: string;
  workerType?: string | null;
  probationPeriodMonths?: number | string | null;
  probationEnd?: string | null;
}): number {
  const workerType = normalizeWorkerType(input.workerType);
  const fromEnd = probationMonthsFromJoinAndEnd(
    input.joinDate,
    input.probationEnd ?? undefined
  );
  const raw = input.probationPeriodMonths;
  const explicit =
    raw != null && raw !== '' && Number.isFinite(Number(raw))
      ? Number(raw)
      : fromEnd ?? DEFAULT_REGULAR_PROBATION_MONTHS;
  return capProbationMonths(explicit, workerType);
}
