import { MonthlyFixedRoster, MonthlyRosterEntry } from '../types/roster';

function normalizeEntry(raw: unknown): MonthlyRosterEntry | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const employeeId = String(e.employeeId ?? e.employee_id ?? '').trim();
  const day = Number(e.day);
  const leaveType = String(e.leaveType ?? e.leave_type ?? '').trim();
  if (!employeeId || !Number.isFinite(day) || day < 1 || day > 31 || !leaveType) return null;
  const sourceLeaveRequestId = String(
    e.sourceLeaveRequestId ?? e.source_leave_request_id ?? ''
  ).trim();
  return {
    employeeId,
    day: Math.floor(day),
    leaveType,
    isLocked: Boolean(e.isLocked ?? e.is_locked ?? true),
    sourceLeaveRequestId: sourceLeaveRequestId || null,
  };
}

/** Normalize API / storage row into MonthlyFixedRoster for UI. */
export function normalizePlanningRoster(raw: unknown): MonthlyFixedRoster | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const id = String(row.id ?? '').trim();
  if (!id) return null;

  const monthRaw = Number(row.month);
  const year = Number(row.year);
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 0 && monthRaw <= 11
      ? monthRaw
      : Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
        ? monthRaw - 1
        : new Date().getMonth();

  const entriesRaw = Array.isArray(row.entries) ? row.entries : [];
  const entries = entriesRaw
    .map(normalizeEntry)
    .filter((x): x is MonthlyRosterEntry => x !== null);

  return {
    id,
    month,
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    name: String(row.name ?? '').trim() || 'Roster',
    entries,
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
  };
}

export function normalizePlanningRosterList(raw: unknown): MonthlyFixedRoster[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizePlanningRoster).filter((x): x is MonthlyFixedRoster => x !== null);
}

/** Calendar month index 0–11 for the month before the given period. */
export function previousCalendarMonth(
  year: number,
  monthIndex: number
): { year: number; month: number } {
  if (monthIndex <= 0) return { year: year - 1, month: 11 };
  return { year, month: monthIndex - 1 };
}

/** Prefer the roster for this period with the most recent update (and most entries). */
export function pickBestRosterForMonth(
  rosters: MonthlyFixedRoster[],
  year: number,
  monthIndex: number
): MonthlyFixedRoster | null {
  const matches = rosters.filter((r) => r.year === year && r.month === monthIndex);
  if (!matches.length) return null;
  return [...matches].sort((a, b) => {
    const entryDiff = (b.entries?.length ?? 0) - (a.entries?.length ?? 0);
    if (entryDiff !== 0) return entryDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0];
}
