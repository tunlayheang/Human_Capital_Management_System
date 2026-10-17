import { ATTENDANCE_TZ, dateKeyIct } from './attendanceTimeZone.js';
import { getOrganizationSettingValue } from './organizationSettingsService.js';

export const DEFAULT_COMPANY_TIMEZONE = ATTENDANCE_TZ;

let cachedTimezone: string | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

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

export function invalidateCompanyTimezoneCache(): void {
  cachedTimezone = null;
  cacheLoadedAt = 0;
}

/** Company calendar timezone from System Settings (company.timezone). */
export async function getCompanyTimeZone(): Promise<string> {
  const now = Date.now();
  if (cachedTimezone && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedTimezone;
  }
  try {
    const value = await getOrganizationSettingValue('company.timezone');
    cachedTimezone = resolveCompanyTimezone(value);
  } catch {
    cachedTimezone = DEFAULT_COMPANY_TIMEZONE;
  }
  cacheLoadedAt = now;
  return cachedTimezone;
}

export function dateKeyInTimeZone(now: Date = new Date(), timeZone: string = DEFAULT_COMPANY_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

/** YYYY-MM-DD "today" using company.timezone (falls back to Asia/Phnom_Penh). */
export async function todayYmdCompany(now: Date = new Date()): Promise<string> {
  const tz = await getCompanyTimeZone();
  if (tz === ATTENDANCE_TZ) return dateKeyIct(now);
  return dateKeyInTimeZone(now, tz);
}

export function isFutureCalendarDate(ymd: unknown, todayYmd: string): boolean {
  const day = String(ymd ?? '').trim().slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day > todayYmd;
}

export const BIRTH_DATE_FUTURE_MESSAGE = 'Date of birth cannot be in the future';

/** Returns an error message when birth_date is after company today; otherwise null. */
export async function validateBirthDateNotFuture(birthDate: unknown): Promise<string | null> {
  const day = String(birthDate ?? '').trim().slice(0, 10);
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return 'Date of birth must be a valid date (YYYY-MM-DD).';
  }
  const today = await todayYmdCompany();
  if (isFutureCalendarDate(day, today)) return BIRTH_DATE_FUTURE_MESSAGE;
  return null;
}
