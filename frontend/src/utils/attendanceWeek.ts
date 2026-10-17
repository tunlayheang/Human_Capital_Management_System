import { HCMS_ATTENDANCE_TZ } from './attendanceRecordApi';
import { formatDateOnlyDisplay } from './formatDisplayDate';
import { format } from 'date-fns';
import { getCompanyWeekStartsOnSundayIndex } from './companyLocaleSettings';

const WEEKDAY_ORDER_SUNDAY_FIRST = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** YYYY-MM-DD for a moment in Cambodia office timezone. */
export function dateKeyInTimeZone(date: Date, timeZone: string = HCMS_ATTENDANCE_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function weekdayIndexSundayFirst(date: Date, timeZone: string = HCMS_ATTENDANCE_TZ): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const idx = WEEKDAY_ORDER_SUNDAY_FIRST.indexOf(wd as (typeof WEEKDAY_ORDER_SUNDAY_FIRST)[number]);
  return idx >= 0 ? idx : 0;
}

export function addDaysToDateKey(dateKey: string, days: number, timeZone: string = HCMS_ATTENDANCE_TZ): string {
  const base = new Date(`${dateKey}T12:00:00+07:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return dateKeyInTimeZone(base, timeZone);
}

/** Start-of-week (YYYY-MM-DD) containing `ref` in office TZ, based on `regional.week_start`. */
export function weekStartOfWeekContaining(ref: Date = new Date(), timeZone: string = HCMS_ATTENDANCE_TZ): string {
  const todayKey = dateKeyInTimeZone(ref, timeZone);
  const weekdayIndex = weekdayIndexSundayFirst(ref, timeZone); // 0..6, Sunday-first
  const weekStartsOnSundayIndex = getCompanyWeekStartsOnSundayIndex(); // 0=Sun, 1=Mon
  const offset = (weekdayIndex - weekStartsOnSundayIndex + 7) % 7;
  return addDaysToDateKey(todayKey, -offset, timeZone);
}

/** Back-compat alias (older naming assumed Monday-first). */
export function mondayOfWeekContaining(ref: Date = new Date(), timeZone: string = HCMS_ATTENDANCE_TZ): string {
  return weekStartOfWeekContaining(ref, timeZone);
}

export type WeekDayCell = {
  dateKey: string;
  /** 0 = Mon … 6 = Sun */
  dayIndex: number;
  isToday: boolean;
  isFuture: boolean;
};

export function buildWeekDays(startKey: string, todayKey: string): WeekDayCell[] {
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const dateKey = addDaysToDateKey(startKey, dayIndex);
    return {
      dateKey,
      dayIndex,
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
    };
  });
}

export function formatWeekRangeLabel(startKey: string, _locale?: string): string {
  const endKey = addDaysToDateKey(startKey, 6);
  return `${formatDateOnlyDisplay(startKey)} – ${formatDateOnlyDisplay(endKey)}`;
}

export function weekdayShortLabel(dateKey: string, locale?: string, timeZone: string = HCMS_ATTENDANCE_TZ): string {
  const d = new Date(`${dateKey}T12:00:00+07:00`);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(d);
}

export function dayMonthLabel(dateKey: string, _locale?: string): string {
  const d = new Date(`${dateKey}T12:00:00+07:00`);
  return format(d, 'dd/MM');
}

export function isWeekendDateKey(dateKey: string, timeZone: string = HCMS_ATTENDANCE_TZ): boolean {
  const d = new Date(`${dateKey}T12:00:00+07:00`);
  const idx = weekdayIndexSundayFirst(d, timeZone);
  return idx === 0 || idx === 6; // Sunday / Saturday
}
