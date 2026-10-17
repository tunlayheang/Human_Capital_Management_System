/**
 * Sunday-first month calendar helpers.
 * Civil dates use local noon so weekday alignment matches the real calendar
 * (avoids UTC midnight shifting the day in some zones).
 */

export const SUNDAY_FIRST_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function parseYearMonth(value: string): { year: number; monthIndex: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

/** 0 = Sunday … 6 = Saturday for a civil calendar date. */
export function weekdaySundayFirst(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day, 12, 0, 0).getDay();
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0).getDate();
}

/** Empty cells before day 1 so day 1 lands under the correct weekday header. */
export function leadingEmptyCount(year: number, monthIndex: number): number {
  return weekdaySundayFirst(year, monthIndex, 1);
}

export function trailingEmptyCount(year: number, monthIndex: number): number {
  const lead = leadingEmptyCount(year, monthIndex);
  const days = daysInMonth(year, monthIndex);
  const rem = (lead + days) % 7;
  return rem === 0 ? 0 : 7 - rem;
}

export type MonthGridCell =
  | { kind: 'empty'; key: string }
  | { kind: 'day'; key: string; day: number; date: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymdKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/** Full Sunday-first grid (leading + in-month + trailing empties). */
export function buildSundayFirstMonthGrid(year: number, monthIndex: number): MonthGridCell[] {
  const lead = leadingEmptyCount(year, monthIndex);
  const last = daysInMonth(year, monthIndex);
  const cells: MonthGridCell[] = [];

  for (let i = 0; i < lead; i++) {
    cells.push({ kind: 'empty', key: `lead-${year}-${monthIndex}-${i}` });
  }
  for (let day = 1; day <= last; day++) {
    cells.push({
      kind: 'day',
      key: ymdKey(year, monthIndex, day),
      day,
      date: ymdKey(year, monthIndex, day),
    });
  }
  const trail = trailingEmptyCount(year, monthIndex);
  for (let i = 0; i < trail; i++) {
    cells.push({ kind: 'empty', key: `trail-${year}-${monthIndex}-${i}` });
  }
  return cells;
}
