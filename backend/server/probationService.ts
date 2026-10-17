/**
 * Cambodia Labour Law Art. 68 — per-employee probation lifecycle.
 * Single source of truth for in-probation state, legal caps, and accrual start dates.
 */

export type WorkerType = 'regular' | 'specialized' | 'non_specialized';

export const WORKER_TYPE_MAX_MONTHS: Record<WorkerType, number> = {
  regular: 3,
  specialized: 2,
  non_specialized: 1,
};

export type ProbationEmployeeSnapshot = {
  status?: string | null;
  join_date?: string | Date | null;
  employment_type?: string | null;
  probation_period_months?: number | null;
  probation_confirmed_at?: string | Date | null;
  worker_type?: string | null;
  email?: string | null;
};

function normalizeEmploymentType(raw: unknown): string {
  const s = String(raw ?? 'Full-Time')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (s === 'part-time' || s === 'parttime') return 'Part-Time';
  if (s === 'contract') return 'Contract';
  if (s === 'intern' || s === 'internship') return 'Intern';
  return 'Full-Time';
}

/** Art. 68 probation applies only to Full-Time / Part-Time. */
export function employmentUsesArt68Probation(employmentType?: unknown): boolean {
  const t = normalizeEmploymentType(employmentType);
  return t === 'Full-Time' || t === 'Part-Time';
}

/** Art. 67 / apprenticeship — engagement period max 24 months. */
export const ENGAGEMENT_PERIOD_MAX_MONTHS = 24;

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

export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const iso = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateOnly(value: string | Date | null | undefined): string | null {
  const d = parseDateOnly(value);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Calendar month add — aligned with MySQL DATE_ADD(join_date, INTERVAL n MONTH). */
export function addCalendarMonths(joinDate: Date, months: number): Date {
  const y = joinDate.getUTCFullYear();
  const m = joinDate.getUTCMonth();
  const day = joinDate.getUTCDate();
  const out = new Date(Date.UTC(y, m + months, day));
  return out;
}

export function addCalendarDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function resolveProbationPeriodMonths(
  raw: unknown,
  workerType: WorkerType,
  explicit = false
): number {
  if (raw === 0 || raw === '0') return 0;
  const n = raw != null && raw !== '' ? Math.floor(Number(raw)) : NaN;
  if (!explicit && !Number.isFinite(n)) {
    return maxProbationMonthsForWorkerType(workerType);
  }
  if (!Number.isFinite(n) || n < 0) return maxProbationMonthsForWorkerType(workerType);
  return n;
}

export function applyProbationLegalCap(
  requestedMonths: number,
  workerType: WorkerType
): { months: number; capped: boolean; maxMonths: number } {
  const max = maxProbationMonthsForWorkerType(workerType);
  const requested = Math.max(0, Math.floor(Number(requestedMonths)));
  if (requested > max) {
    return { months: max, capped: true, maxMonths: max };
  }
  return { months: requested, capped: false, maxMonths: max };
}

/** Exclusive probation end (first calendar day after probation). */
export function computedProbationEndDate(
  joinDateRaw: string | Date | null | undefined,
  probationMonths: number
): string | null {
  const months = Math.max(0, Math.floor(Number(probationMonths)));
  if (months <= 0) return null;
  const join = parseDateOnly(joinDateRaw);
  if (!join) return null;
  return formatDateOnly(addCalendarMonths(join, months));
}

/**
 * True when employee is actively serving probation (Art. 68 lifecycle).
 * HR confirmation short-circuits before the computed end date.
 */
export function isInProbation(
  employee: ProbationEmployeeSnapshot,
  asOfDate?: string | Date | null
): boolean {
  if (!employmentUsesArt68Probation(employee.employment_type)) return false;

  const status = String(employee.status ?? '')
    .trim()
    .toLowerCase();
  if (status !== 'active') return false;

  const join = parseDateOnly(employee.join_date);
  if (!join) return false;

  const asOf = parseDateOnly(asOfDate ?? new Date());
  if (!asOf) return false;

  const joinStr = formatDateOnly(join)!;
  const asOfStr = formatDateOnly(asOf)!;
  if (asOfStr < joinStr) return false;

  if (employee.probation_confirmed_at != null && employee.probation_confirmed_at !== '') {
    return false;
  }

  const workerType = normalizeWorkerType(employee.worker_type);
  const months = resolveProbationPeriodMonths(
    employee.probation_period_months,
    workerType,
    true
  );
  if (months <= 0) return false;

  const endStr = computedProbationEndDate(joinStr, months);
  if (!endStr) return false;

  return asOfStr < endStr;
}

/** Past computed end, not yet confirmed — due for probation review. */
export function isProbationReviewDue(
  employee: ProbationEmployeeSnapshot,
  asOfDate?: string | Date | null
): boolean {
  if (employee.probation_confirmed_at != null && employee.probation_confirmed_at !== '') {
    return false;
  }
  const workerType = normalizeWorkerType(employee.worker_type);
  const months = resolveProbationPeriodMonths(
    employee.probation_period_months,
    workerType,
    true
  );
  if (months <= 0) return false;

  const endStr = computedProbationEndDate(employee.join_date, months);
  if (!endStr) return false;

  const asOfStr = formatDateOnly(asOfDate ?? new Date());
  if (!asOfStr) return false;

  return asOfStr >= endStr;
}

/** Probation review list: currently in probation OR overdue for confirmation. */
export function isProbationReviewScope(
  employee: ProbationEmployeeSnapshot,
  asOfDate?: string | Date | null
): boolean {
  const status = String(employee.status ?? '')
    .trim()
    .toLowerCase();
  if (status !== 'active') return false;
  return isInProbation(employee, asOfDate) || isProbationReviewDue(employee, asOfDate);
}

/**
 * First day seniority / indemnity accrual may begin (day after probation ends).
 * confirmed_at → day after confirmation; months=0 → join_date; else computed exclusive end.
 */
export function resolveProbationAccrualStartDate(
  employee: ProbationEmployeeSnapshot
): string | null {
  const joinStr = formatDateOnly(employee.join_date);
  if (!joinStr) return null;

  const workerType = normalizeWorkerType(employee.worker_type);
  const months = resolveProbationPeriodMonths(
    employee.probation_period_months,
    workerType,
    true
  );

  if (months <= 0) return joinStr;

  const confirmedStr = formatDateOnly(employee.probation_confirmed_at);
  if (confirmedStr) {
    const confirmed = parseDateOnly(confirmedStr)!;
    return formatDateOnly(addCalendarDays(confirmed, 1));
  }

  return computedProbationEndDate(joinStr, months) ?? joinStr;
}

export type ProbationValidationInput = {
  employment_type?: unknown;
  worker_type?: unknown;
  probation_period_months?: unknown;
  join_date?: string | Date | null;
};

export type ProbationValidationResult = {
  ok: boolean;
  workerType: WorkerType;
  probationPeriodMonths: number;
  capped: boolean;
  warning?: string;
  error?: string;
};

export function validateProbationFields(
  input: ProbationValidationInput,
  existing?: ProbationEmployeeSnapshot | null,
  asOfDate?: string | Date | null
): ProbationValidationResult {
  const employmentType = normalizeEmploymentType(
    input.employment_type ?? existing?.employment_type ?? 'Full-Time'
  );
  const usesProbation = employmentUsesArt68Probation(employmentType);

  let workerType = normalizeWorkerType(
    input.worker_type ?? existing?.worker_type ?? 'regular'
  );
  const joinDate = input.join_date ?? existing?.join_date ?? null;

  const explicitMonths =
    input.probation_period_months !== undefined && input.probation_period_months !== null;
  let requested = resolveProbationPeriodMonths(
    input.probation_period_months ?? existing?.probation_period_months,
    workerType,
    explicitMonths || existing?.probation_period_months != null
  );

  let capped = false;
  let warning: string | undefined;

  if (usesProbation) {
    // Derive worker_type from months so UI no longer needs a separate Worker Type control.
    if (requested <= 1) workerType = 'non_specialized';
    else if (requested === 2) workerType = 'specialized';
    else workerType = 'regular';

    const cap = applyProbationLegalCap(requested, workerType);
    capped = cap.capped;
    if (cap.capped) {
      requested = cap.months;
      warning = `Probation length capped to ${cap.months} month(s) (Labour Law Art. 68).`;
    }
  } else {
    workerType = 'regular';
    const max = ENGAGEMENT_PERIOD_MAX_MONTHS;
    if (requested > max) {
      requested = max;
      capped = true;
      warning =
        employmentType === 'Contract'
          ? `Contract period capped to ${max} months (Labour Law Art. 67 — max 2 years).`
          : `Internship period capped to ${max} months (apprenticeship max 2 years).`;
    }
    requested = Math.max(0, Math.floor(requested));
  }

  const asOfStr = formatDateOnly(asOfDate ?? new Date()) ?? '';

  if (usesProbation && existing?.probation_confirmed_at) {
    const existingMonths = resolveProbationPeriodMonths(
      existing.probation_period_months,
      normalizeWorkerType(existing.worker_type),
      true
    );
    if (requested > existingMonths) {
      return {
        ok: false,
        workerType,
        probationPeriodMonths: requested,
        capped,
        error: 'Probation cannot be extended after HR has confirmed the review.',
      };
    }
  }

  if (usesProbation) {
    const existingJoin = formatDateOnly(existing?.join_date ?? joinDate);
    const existingMonthsForEnd = resolveProbationPeriodMonths(
      existing?.probation_period_months,
      normalizeWorkerType(existing?.worker_type ?? workerType),
      true
    );
    const originalEnd =
      existingJoin && existingMonthsForEnd > 0
        ? computedProbationEndDate(existingJoin, existingMonthsForEnd)
        : null;

    const newJoin = formatDateOnly(joinDate ?? existing?.join_date);
    const newEnd =
      newJoin && requested > 0 ? computedProbationEndDate(newJoin, requested) : null;

    if (originalEnd && newEnd && asOfStr >= originalEnd && newEnd > originalEnd) {
      return {
        ok: false,
        workerType,
        probationPeriodMonths: requested,
        capped,
        error:
          'Probation cannot be renewed or extended beyond the original end date (Labour Law Art. 68).',
      };
    }
  }

  return {
    ok: true,
    workerType,
    probationPeriodMonths: requested,
    capped,
    warning,
  };
}

/** Sequelize literal clauses for employee list "in probation" filter. */
export function probationInFilterSqlLiterals(): string[] {
  return [
    "status = 'active'",
    "LOWER(REPLACE(COALESCE(employment_type, 'Full-Time'), '_', '-')) IN ('full-time', 'fulltime', 'part-time', 'parttime')",
    'join_date IS NOT NULL',
    'probation_confirmed_at IS NULL',
    'COALESCE(probation_period_months, 0) > 0',
    'CURDATE() >= join_date',
    'CURDATE() < DATE_ADD(join_date, INTERVAL LEAST(COALESCE(probation_period_months, 0), 3) MONTH)',
  ];
}

export function formatProbationStatusLabel(
  employee: ProbationEmployeeSnapshot,
  asOfDate?: string | Date | null
): string {
  const workerType = normalizeWorkerType(employee.worker_type);
  const months = resolveProbationPeriodMonths(
    employee.probation_period_months,
    workerType,
    true
  );

  const confirmedStr = formatDateOnly(employee.probation_confirmed_at);
  if (confirmedStr) {
    return `Confirmed on ${confirmedStr}`;
  }
  if (months <= 0) {
    return 'No probation';
  }
  const endStr = computedProbationEndDate(employee.join_date, months);
  if (!endStr) return 'No probation';
  const inProb = isInProbation(employee, asOfDate);
  const suffix = inProb ? '' : ' (ended)';
  return `Probation ends ${endStr} (${months} month${months === 1 ? '' : 's'})${suffix}`;
}
