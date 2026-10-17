export type CompanyLanguage = 'en' | 'km';

export type CompanyDateFormatOption = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type CompanyTimeFormatOption = '12 Hour' | '24 Hour';
export type CompanyWeekStartOption = 'Monday' | 'Sunday';

export const COMPANY_LOCALE_CHANGED_EVENT = 'hcms:company-locale-changed';

const STORAGE_KEY_LANGUAGE = 'hcms.company.language';
const STORAGE_KEY_DATE_FORMAT = 'hcms.company.date_format';
const STORAGE_KEY_TIME_FORMAT = 'hcms.company.time_format';
const STORAGE_KEY_WEEK_START = 'hcms.company.week_start';

function safeGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (raw as unknown as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getCompanyLanguage(): CompanyLanguage {
  const fromSession = safeGet<string>(STORAGE_KEY_LANGUAGE);
  if (fromSession === 'km' || fromSession === 'en') return fromSession;
  // Fallback to local language preference (LanguageProvider uses localStorage).
  return 'en';
}

export function getCompanyDateFormatOption(): CompanyDateFormatOption {
  const raw = safeGet<string>(STORAGE_KEY_DATE_FORMAT);
  if (raw === 'DD/MM/YYYY' || raw === 'MM/DD/YYYY' || raw === 'YYYY-MM-DD') return raw;
  return 'DD/MM/YYYY';
}

export function getCompanyTimeFormatOption(): CompanyTimeFormatOption {
  const raw = safeGet<string>(STORAGE_KEY_TIME_FORMAT);
  if (raw === '12 Hour' || raw === '24 Hour') return raw;
  return '24 Hour';
}

export function getCompanyWeekStartOption(): CompanyWeekStartOption {
  const raw = safeGet<string>(STORAGE_KEY_WEEK_START);
  if (raw === 'Monday' || raw === 'Sunday') return raw;
  return 'Monday';
}

export function resolveDateFnsDateFormatPattern(): string {
  const df = getCompanyDateFormatOption();
  // Canonical HCMS display: zero-padded day and month (dd/mm/yyyy).
  if (df === 'DD/MM/YYYY') return 'dd/MM/yyyy';
  if (df === 'MM/DD/YYYY') return 'MM/dd/yyyy';
  return 'yyyy-MM-dd';
}

export function resolveDateFnsTimeFormatPattern(): string {
  const tf = getCompanyTimeFormatOption();
  return tf === '12 Hour' ? 'hh:mm a' : 'HH:mm';
}

export function resolveDateFnsDateTimeFormatPattern(): string {
  return `${resolveDateFnsDateFormatPattern()} ${resolveDateFnsTimeFormatPattern()}`;
}

export function setCompanyLocaleFromSettings(settings: Record<string, unknown>): void {
  const rawLanguage = String(settings['regional.language'] ?? 'English');
  const language: CompanyLanguage = rawLanguage === 'Khmer' ? 'km' : 'en';

  const dateFormat = String(settings['regional.date_format'] ?? 'DD/MM/YYYY');
  const timeFormat = String(settings['regional.time_format'] ?? '24 Hour');
  const weekStart = String(settings['regional.week_start'] ?? 'Monday');

  safeSet(STORAGE_KEY_LANGUAGE, language);
  safeSet(STORAGE_KEY_DATE_FORMAT, dateFormat);
  safeSet(STORAGE_KEY_TIME_FORMAT, timeFormat);
  safeSet(STORAGE_KEY_WEEK_START, weekStart);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(COMPANY_LOCALE_CHANGED_EVENT, {
        detail: { language, dateFormat, timeFormat, weekStart },
      })
    );
  }
}

export function getCompanyWeekStartsOnSundayIndex(): number {
  // 0 = Sunday, 1 = Monday, ... (Sunday-first)
  const ws = getCompanyWeekStartOption();
  return ws === 'Sunday' ? 0 : 1;
}

