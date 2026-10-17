import { resolveDashboardDateRange, todayYmd } from '../dashboardDateRange.js';

export type PersonalAnalyticsPreset =
  | 'current_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'current_year'
  | 'custom';

export type PersonalAnalyticsRange = {
  preset: PersonalAnalyticsPreset;
  startDate: string;
  endDate: string;
  label: string;
};

function startOfMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function addMonthsYmd(ymd: string, delta: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function resolvePersonalAnalyticsRange(params: {
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): PersonalAnalyticsRange {
  const preset = (params.preset || 'current_year') as PersonalAnalyticsPreset;
  const today = todayYmd();
  const yearStart = `${today.slice(0, 4)}-01-01`;

  if (preset === 'current_month') {
    const startDate = startOfMonth();
    return {
      preset,
      startDate,
      endDate: today,
      label: 'Current month',
    };
  }
  if (preset === 'last_3_months') {
    const startDate = addMonthsYmd(startOfMonth(), -2);
    return { preset, startDate, endDate: today, label: 'Last 3 months' };
  }
  if (preset === 'last_6_months') {
    const startDate = addMonthsYmd(startOfMonth(), -5);
    return { preset, startDate, endDate: today, label: 'Last 6 months' };
  }
  if (preset === 'current_year') {
    return { preset, startDate: yearStart, endDate: today, label: 'Current year' };
  }

  const resolved = resolveDashboardDateRange(params.startDate, params.endDate);
  return {
    preset: 'custom',
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    label: 'Custom range',
  };
}

/** Previous period of equal length immediately before startDate. */
export function previousPeriodRange(range: PersonalAnalyticsRange): PersonalAnalyticsRange {
  const start = new Date(`${range.startDate}T12:00:00`);
  const end = new Date(`${range.endDate}T12:00:00`);
  const spanMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    preset: range.preset,
    startDate: toYmd(prevStart),
    endDate: toYmd(prevEnd),
    label: 'Previous period',
  };
}

export type TrendDirection = 'improved' | 'stable' | 'declined' | 'increasing' | 'decreasing';

export function computeTrend(
  current: number,
  previous: number,
  higherIsBetter = true,
  stableThresholdPct = 3
): TrendDirection {
  if (!Number.isFinite(previous) || previous === 0) {
    if (current > 0) return higherIsBetter ? 'improved' : 'declined';
    return 'stable';
  }
  const deltaPct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(deltaPct) < stableThresholdPct) return 'stable';
  const improved = deltaPct > 0;
  if (higherIsBetter) return improved ? 'improved' : 'declined';
  return improved ? 'declined' : 'improved';
}

export function computeOtTrend(current: number, previous: number): TrendDirection {
  const t = computeTrend(current, previous, true);
  if (t === 'improved') return 'increasing';
  if (t === 'declined') return 'decreasing';
  return 'stable';
}
