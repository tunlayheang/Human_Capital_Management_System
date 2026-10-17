import { todayYmdInCompanyTz } from '../utils/companyCalendar';

/** Normalize API / form values to `YYYY-MM-DD` for date inputs and payroll APIs. */
export function toDateOnlyString(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return todayYmdInCompanyTz(raw);
  }
  const s = String(raw).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return todayYmdInCompanyTz(d);
  return s.slice(0, 10);
}

export function pickEmployeeLastWorkingDate(
  emp: { last_working_date?: unknown; lastWorkingDate?: unknown } | null | undefined
): string {
  if (!emp) return '';
  return toDateOnlyString(emp.last_working_date ?? emp.lastWorkingDate);
}
