export type DashboardDateRange = {
  startDate: string;
  endDate: string;
  start: Date;
  end: Date;
};

function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function startOfYear(d = new Date()): string {
  return `${d.getFullYear()}-01-01`;
}

export function todayYmd(): string {
  return toYmd(new Date());
}

/** Default report period: calendar year to date. */
export function defaultDashboardRange(): DashboardDateRange {
  return resolveDashboardDateRange(startOfYear(), todayYmd());
}

export function resolveDashboardDateRange(
  startRaw?: string | null,
  endRaw?: string | null
): DashboardDateRange {
  const endParsed = parseYmd(String(endRaw || todayYmd())) ?? new Date();
  let startParsed =
    parseYmd(String(startRaw || startOfYear(endParsed))) ??
    new Date(endParsed.getFullYear(), 0, 1);

  // Copy before any mutation — never alias start/end to the same Date instance.
  let start = new Date(startParsed.getTime());
  let end = new Date(endParsed.getTime());

  if (start.getTime() > end.getTime()) {
    const tmpMs = start.getTime();
    start = new Date(end.getTime());
    end = new Date(tmpMs);
  }

  const maxSpanMs = 366 * 24 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxSpanMs) {
    start = new Date(end.getTime() - maxSpanMs);
  }

  const startDate = toYmd(start);
  const endDate = toYmd(end);
  return {
    startDate,
    endDate,
    start: new Date(`${startDate}T00:00:00.000`),
    end: new Date(`${endDate}T23:59:59.999`),
  };
}

export function formatPeriodLabel(range: DashboardDateRange): string {
  const s = new Date(`${range.startDate}T12:00:00`);
  const e = new Date(`${range.endDate}T12:00:00`);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  if (range.startDate === range.endDate) return s.toLocaleDateString(undefined, opts);
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

/** Month keys (YYYY-MM) inclusive between two dates. */
export function monthKeysInRange(startDate: string, endDate: string): string[] {
  const s = startDate.slice(0, 10);
  const e = endDate.slice(0, 10);
  if (e < s) return [];
  const out: string[] = [];
  let y = Number(s.slice(0, 4));
  let m = Number(s.slice(5, 7));
  const endY = Number(e.slice(0, 4));
  const endM = Number(e.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
