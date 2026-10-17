import { todayYmdInCompanyTz } from './companyCalendar';

/** YYYY-MM-DD in company timezone (avoids UTC shift from `Date#toISOString`). */
export function formatLocalDateIso(date: Date = new Date()): string {
  return todayYmdInCompanyTz(date);
}
