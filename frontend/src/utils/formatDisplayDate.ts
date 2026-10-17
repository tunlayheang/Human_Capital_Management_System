import { format, isValid, parseISO } from 'date-fns';
import { resolveDateFnsDateFormatPattern, resolveDateFnsDateTimeFormatPattern } from './companyLocaleSettings';

/**
 * Canonical user-facing calendar date pattern across HCMS (display / typing only).
 * APIs continue to use YYYY-MM-DD.
 */
export const DISPLAY_DATE_FORMAT = 'dd/MM/yyyy';
export const DISPLAY_DATETIME_FORMAT = 'dd/MM/yyyy HH:mm';
/** Placeholder shown in date inputs (lowercase for readability). */
export const DISPLAY_DATE_PLACEHOLDER = 'dd/mm/yyyy';

const DEFAULT_EMPTY = '—';

/**
 * Digits-only mask for typed dd/mm/yyyy. Strips letters/symbols and inserts `/`
 * as day/month/year parts are entered (e.g. `0508` → `05/08`, `05082026` → `05/08/2026`).
 */
export function maskDdMmYyyyInput(raw: string): string {
  const digits = String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Parse a date for display. Prefers YYYY-MM-DD calendar parts (noon local)
 * so date-only API values do not shift a day across timezones.
 * Also accepts typed dd/mm/yyyy (day may be 1–2 digits while typing).
 */
export function parseDisplayDateInput(
  value: string | number | Date | null | undefined
): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return isValid(d) ? d : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12, 0, 0);
    return isValid(d) ? d : null;
  }

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd && (raw.length === 10 || raw[10] === 'T' || raw[10] === ' ')) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0);
    return isValid(d) ? d : null;
  }

  const iso = parseISO(raw);
  if (isValid(iso)) return iso;

  const fallback = new Date(raw);
  return isValid(fallback) ? fallback : null;
}

/** Format a date-only value as dd/MM/yyyy (zero-padded day and month). */
export function formatDateOnlyDisplay(
  value: string | number | Date | null | undefined,
  empty: string = DEFAULT_EMPTY
): string {
  const d = parseDisplayDateInput(value);
  if (!d) return empty;
  return format(d, resolveDateFnsDateFormatPattern());
}

/** Alias used by many offboarding / settlement modules. */
export const formatDisplayDate = formatDateOnlyDisplay;

/** Format a date-time as dd/MM/yyyy HH:mm. */
export function formatDateTimeDisplay(
  value: string | number | Date | null | undefined,
  empty: string = DEFAULT_EMPTY
): string {
  if (value == null || value === '') return empty;
  if (typeof value === 'string') {
    const raw = value.trim();
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return formatDateOnlyDisplay(raw, empty);
  }

  let d: Date | null = null;
  if (value instanceof Date) {
    d = isValid(value) ? value : null;
  } else if (typeof value === 'number') {
    const parsed = new Date(value);
    d = isValid(parsed) ? parsed : null;
  } else {
    const raw = String(value).trim();
    const iso = parseISO(raw);
    if (isValid(iso)) d = iso;
    else {
      const fallback = new Date(raw);
      d = isValid(fallback) ? fallback : null;
    }
  }
  if (!d) return empty;
  return format(d, resolveDateFnsDateTimeFormatPattern());
}
