export type DateRangeValue = {
  from: string;
  to: string;
};

export const EMPTY_DATE_RANGE: DateRangeValue = { from: '', to: '' };

function asYmd(value: string | undefined | null): string {
  return String(value ?? '').trim().slice(0, 10);
}

/**
 * Keep inclusive From ≤ To when either bound changes.
 * If the edited side would invert the range, the other side is clamped to match.
 */
export function orderInclusiveDateRange(
  from: string,
  to: string,
  changed: 'from' | 'to'
): DateRangeValue {
  let fromVal = asYmd(from);
  let toVal = asYmd(to);
  if (fromVal && toVal && fromVal > toVal) {
    if (changed === 'from') toVal = fromVal;
    else fromVal = toVal;
  }
  return { from: fromVal, to: toVal };
}

/** Same as {@link orderInclusiveDateRange} using startDate/endDate field names. */
export function orderInclusiveStartEnd(
  startDate: string,
  endDate: string,
  changed: 'startDate' | 'endDate'
): { startDate: string; endDate: string } {
  const ordered = orderInclusiveDateRange(
    startDate,
    endDate,
    changed === 'startDate' ? 'from' : 'to'
  );
  return { startDate: ordered.from, endDate: ordered.to };
}

/** Swap bounds if inverted (e.g. restoring a saved/custom range). */
export function normalizeInclusiveDateRange(from: string, to: string): DateRangeValue {
  let fromVal = asYmd(from);
  let toVal = asYmd(to);
  if (fromVal && toVal && fromVal > toVal) {
    const swap = fromVal;
    fromVal = toVal;
    toVal = swap;
  }
  return { from: fromVal, to: toVal };
}

export function isDateRangeActive(range: DateRangeValue): boolean {
  return Boolean(range.from?.trim() || range.to?.trim());
}

/** True when `date` (YYYY-MM-DD or ISO) falls within the inclusive range. */
export function recordMatchesDateRange(
  date: string | undefined | null,
  range: DateRangeValue
): boolean {
  if (!isDateRangeActive(range)) return true;
  const key = (date || '').slice(0, 10);
  if (!key) return false;
  if (range.from && key < range.from) return false;
  if (range.to && key > range.to) return false;
  return true;
}

/** True when [start, end] overlaps the filter range (inclusive). */
export function intervalOverlapsDateRange(
  start: string | undefined | null,
  end: string | undefined | null,
  range: DateRangeValue
): boolean {
  if (!isDateRangeActive(range)) return true;
  const s = (start || '').slice(0, 10);
  const e = (end || start || '').slice(0, 10);
  if (!s && !e) return false;
  if (range.to && s && s > range.to) return false;
  if (range.from && e && e < range.from) return false;
  return true;
}

export function countDateRangeFilters(range: DateRangeValue): number {
  let n = 0;
  if (range.from?.trim()) n += 1;
  if (range.to?.trim()) n += 1;
  return n;
}
