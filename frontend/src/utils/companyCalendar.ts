import { HCMS_ATTENDANCE_TZ } from './attendanceRecordApi';
import { dateKeyInTimeZone } from './attendanceWeek';

/** Default when company.timezone is unset or invalid (matches System Settings). */
export const DEFAULT_COMPANY_TIMEZONE = HCMS_ATTENDANCE_TZ;

export const COMPANY_TZ_CHANGED_EVENT = 'hcms:company-timezone-changed';

const STORAGE_KEY = 'hcms.company.timezone';

let cachedTimezone: string = readStoredTimezone() ?? DEFAULT_COMPANY_TIMEZONE;

function readStoredTimezone(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? resolveCompanyTimezone(raw) : null;
  } catch {
    return null;
  }
}

/** Validate IANA timezone; fall back to Asia/Phnom_Penh. */
export function resolveCompanyTimezone(raw: unknown): string {
  const candidate = String(raw ?? '').trim();
  if (!candidate) return DEFAULT_COMPANY_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_COMPANY_TIMEZONE;
  }
}

export function getCompanyTimezone(): string {
  return cachedTimezone;
}

/** Called when company settings load / change so non-React helpers stay in sync. */
export function setCompanyTimezone(raw: unknown): string {
  const next = resolveCompanyTimezone(raw);
  const changed = next !== cachedTimezone;
  cachedTimezone = next;
  try {
    sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (changed && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COMPANY_TZ_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

/** YYYY-MM-DD for "today" in the company timezone (default Asia/Phnom_Penh). */
export function todayYmdInCompanyTz(now: Date = new Date(), timeZone?: string): string {
  return dateKeyInTimeZone(now, timeZone ?? getCompanyTimezone());
}

/** True when `ymd` is a valid calendar date strictly after company "today". */
export function isFutureCompanyDate(ymd: string | null | undefined, now: Date = new Date()): boolean {
  const day = String(ymd ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day > todayYmdInCompanyTz(now);
}

export const BIRTH_DATE_FUTURE_MESSAGE = 'Date of birth cannot be in the future';
