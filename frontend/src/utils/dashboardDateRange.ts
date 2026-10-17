import { todayYmdInCompanyTz } from './companyCalendar';
import { formatDateOnlyDisplay } from './formatDisplayDate';

export type DashboardDatePreset = 'ytd' | 'last30' | 'last90' | 'last12m' | 'custom';

export type DashboardDateRangeValue = {
  startDate: string;
  endDate: string;
  preset: DashboardDatePreset;
};

const STORAGE_KEY = 'hcms.dashboard.dateRange';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local-browser calendar YMD (legacy); prefer `todayYmd` for company TZ. */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfYearYmd(ymdOrDate: string | Date = todayYmdInCompanyTz()): string {
  if (typeof ymdOrDate === 'string') {
    const y = ymdOrDate.slice(0, 4);
    return `${y}-01-01`;
  }
  return `${ymdOrDate.getFullYear()}-01-01`;
}

/** Today as YYYY-MM-DD in company timezone (System Settings → Asia/Phnom_Penh by default). */
export function todayYmd(): string {
  return todayYmdInCompanyTz();
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, d || 1);
  const next = new Date(utc + days * 86_400_000);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function rangeFromPreset(preset: DashboardDatePreset): Pick<DashboardDateRangeValue, 'startDate' | 'endDate'> {
  const endDate = todayYmd();
  if (preset === 'ytd') {
    return { startDate: startOfYearYmd(endDate), endDate };
  }
  if (preset === 'last30') {
    return { startDate: addCalendarDaysYmd(endDate, -29), endDate };
  }
  if (preset === 'last90') {
    return { startDate: addCalendarDaysYmd(endDate, -89), endDate };
  }
  if (preset === 'last12m') {
    const [y, m, d] = endDate.split('-').map(Number);
    const prior = new Date(Date.UTC(y - 1, (m || 1) - 1, d || 1));
    prior.setUTCDate(prior.getUTCDate() + 1);
    const startDate = `${prior.getUTCFullYear()}-${pad(prior.getUTCMonth() + 1)}-${pad(prior.getUTCDate())}`;
    return { startDate, endDate };
  }
  return { startDate: startOfYearYmd(endDate), endDate };
}

export function defaultDashboardRange(): DashboardDateRangeValue {
  return { preset: 'ytd', ...rangeFromPreset('ytd') };
}

export function loadStoredDashboardRange(): DashboardDateRangeValue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDashboardRange();
    const parsed = JSON.parse(raw) as DashboardDateRangeValue;
    if (parsed?.startDate && parsed?.endDate) {
      let { startDate, endDate } = parsed;
      if (startDate > endDate) {
        const swap = startDate;
        startDate = endDate;
        endDate = swap;
      }
      return { ...parsed, startDate, endDate };
    }
  } catch {
    /* ignore */
  }
  return defaultDashboardRange();
}

export function saveDashboardRange(value: DashboardDateRangeValue): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDateOnlyDisplay(startDate);
  return `${formatDateOnlyDisplay(startDate)} – ${formatDateOnlyDisplay(endDate)}`;
}
