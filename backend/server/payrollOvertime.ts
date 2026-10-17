/**
 * Cambodia payroll overtime hour split (150% / 200% buckets).
 * Default working days: daytime OT when actual clock-out is after scheduled time_out.
 * Night window 22:00–05:00 ICT → 200%. Calendar + holidays → premium rules.
 */

export type PayrollOtDayTier = 'daytime_ot' | 'premium';

export type PayrollOvertimeCalendarContext = {
  holidayDates: Set<string>;
  otDayTiers: Map<string, PayrollOtDayTier>;
  /** Scheduled rest days from Planning roster (replaces fixed Sunday). */
  employeeOffDates?: Set<string>;
};

export type EmployeeScheduleForOt = {
  /** Scheduled end of shift (HH:MM, ICT). */
  timeOut: string;
};

const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 5;
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_TIME_OUT = '17:00';

function dateKeyFromRecord(rec: { date?: string }): string {
  return String(rec.date || '').slice(0, 10);
}

export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time || typeof time !== 'string') return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** ICT wall-clock instant for date + HH:MM on that calendar day. */
export function scheduleEndMs(dateKey: string, timeOut: string): number | null {
  const tm = parseTimeToMinutes(timeOut ?? DEFAULT_TIME_OUT);
  if (!tm || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const hh = String(Math.floor(tm / 60)).padStart(2, '0');
  const mm = String(tm % 60).padStart(2, '0');
  const t = new Date(`${dateKey}T${hh}:${mm}:00+07:00`).getTime();
  return Number.isFinite(t) ? t : null;
}

function ictHourOfDay(ms: number): number {
  return new Date(ms + ICT_OFFSET_MS).getUTCHours();
}

/** Night hours between two UTC instants (ICT night window). */
export function nightHoursBetweenMs(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;

  const stepMs = 5 * 60 * 1000;
  let nightMs = 0;
  for (let t = startMs; t < endMs; t += stepMs) {
    const chunkEnd = Math.min(t + stepMs, endMs);
    const h = ictHourOfDay(t);
    if (h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR) {
      nightMs += chunkEnd - t;
    }
  }
  return Math.round((nightMs / (1000 * 60 * 60)) * 100) / 100;
}

export function nightHoursFromClock(clockIn?: string | null, clockOut?: string | null): number {
  if (!clockIn || !clockOut) return 0;
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  return nightHoursBetweenMs(start, end);
}

export function workHoursFromAttendanceRecord(rec: {
  workHours?: unknown;
  clockIn?: string | null;
  clockOut?: string | null;
}): number {
  if (rec.workHours != null && Number(rec.workHours) > 0) return Number(rec.workHours);
  if (rec.clockIn && rec.clockOut) {
    const ms = new Date(rec.clockOut).getTime() - new Date(rec.clockIn).getTime();
    if (ms > 0) return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
  }
  return 0;
}

function resolveDayTier(
  dateKey: string,
  calendar: PayrollOvertimeCalendarContext
): PayrollOtDayTier | 'default' {
  const explicit = calendar.otDayTiers.get(dateKey);
  if (explicit) return explicit;
  if (calendar.holidayDates.has(dateKey)) return 'premium';
  if (calendar.employeeOffDates?.has(dateKey)) return 'premium';
  return 'default';
}

/** Daytime OT = duration after scheduled time_out until clock-out (150%); night slices → 200%. */
function splitLateAfterScheduleOt(
  rec: {
    clockIn?: string | null;
    clockOut?: string | null;
  },
  dateKey: string,
  schedule: EmployeeScheduleForOt,
  standardDailyHours: number,
  worked: number
): { hours150: number; hours200: number } {
  const nightInWork = nightHoursFromClock(rec.clockIn, rec.clockOut);
  const endMs = scheduleEndMs(dateKey, schedule.timeOut);

  if (rec.clockOut && endMs != null) {
    const inMs = rec.clockIn ? new Date(rec.clockIn).getTime() : NaN;
    const outMs = new Date(rec.clockOut).getTime();

    if (Number.isFinite(outMs) && outMs > endMs) {
      const nightInLate = nightHoursBetweenMs(endMs, outMs);
      const lateHrs = (outMs - endMs) / (1000 * 60 * 60);
      const hours150 = Math.max(0, lateHrs - nightInLate);
      const nightBeforeEnd =
        Number.isFinite(inMs) && inMs < endMs
          ? nightHoursBetweenMs(inMs, Math.min(outMs, endMs))
          : 0;
      return {
        hours150: Math.round(hours150 * 100) / 100,
        hours200: Math.round((nightInLate + nightBeforeEnd) * 100) / 100,
      };
    }

    return { hours150: 0, hours200: nightInWork };
  }

  // No clock-out: fallback to excess hours vs standard day length
  const extra = Math.max(0, worked - standardDailyHours);
  const nightInExtra = Math.min(nightInWork, extra);
  return {
    hours150: Math.max(0, extra - nightInExtra),
    hours200: nightInWork,
  };
}

function splitDayOvertimeHours(
  rec: {
    clockIn?: string | null;
    clockOut?: string | null;
  },
  dateKey: string,
  schedule: EmployeeScheduleForOt,
  worked: number,
  standardDailyHours: number,
  tier: PayrollOtDayTier | 'default'
): { hours150: number; hours200: number } {
  if (worked <= 0 && !rec.clockOut) return { hours150: 0, hours200: 0 };

  if (tier === 'premium') {
    return { hours150: 0, hours200: worked };
  }

  if (tier === 'daytime_ot' || tier === 'default') {
    return splitLateAfterScheduleOt(rec, dateKey, schedule, standardDailyHours, worked);
  }

  return { hours150: 0, hours200: 0 };
}

export function computeOvertimeHoursForAttendance(params: {
  attendance: Array<{
    date?: string;
    workHours?: unknown;
    clockIn?: string | null;
    clockOut?: string | null;
  }>;
  month: string;
  standardDailyHours: number;
  calendar: PayrollOvertimeCalendarContext;
  schedule?: EmployeeScheduleForOt;
}): { hours150: number; hours200: number } {
  const monthPrefix = params.month.slice(0, 7);
  const schedule = params.schedule ?? { timeOut: DEFAULT_TIME_OUT };
  let hours150 = 0;
  let hours200 = 0;

  for (const rec of params.attendance) {
    if (!String(rec.date || '').startsWith(monthPrefix)) continue;
    const dateKey = dateKeyFromRecord(rec);
    if (!dateKey) continue;

    const worked = workHoursFromAttendanceRecord(rec);
    const tier = resolveDayTier(dateKey, params.calendar);
    const split = splitDayOvertimeHours(
      rec,
      dateKey,
      schedule,
      worked,
      params.standardDailyHours,
      tier
    );
    hours150 += split.hours150;
    hours200 += split.hours200;
  }

  return {
    hours150: Math.round(hours150 * 100) / 100,
    hours200: Math.round(hours200 * 100) / 100,
  };
}

export function buildOvertimeCalendarContext(
  _year: number,
  holidayDates: string[],
  otDayTiers: Record<string, PayrollOtDayTier>,
  employeeOffDates?: Iterable<string>
): PayrollOvertimeCalendarContext {
  const tiers = new Map<string, PayrollOtDayTier>();
  for (const [date, tier] of Object.entries(otDayTiers || {})) {
    if (tier === 'daytime_ot' || tier === 'premium') tiers.set(date.slice(0, 10), tier);
  }
  const off =
    employeeOffDates != null
      ? new Set([...employeeOffDates].map((d) => d.slice(0, 10)))
      : undefined;
  return {
    holidayDates: new Set(holidayDates.map((d) => d.slice(0, 10))),
    otDayTiers: tiers,
    employeeOffDates: off,
  };
}

/** Merge employee roster off-days into a shared payroll calendar context. */
export function withEmployeeOffDates(
  calendar: PayrollOvertimeCalendarContext,
  employeeOffDates: Set<string>
): PayrollOvertimeCalendarContext {
  return {
    ...calendar,
    employeeOffDates: new Set(employeeOffDates),
  };
}

export function upcomingPayrollRunAlerts(
  runDates: string[],
  fromDate: Date = new Date(),
  withinDays = 7
): Array<{ date: string; daysUntil: number }> {
  const start = fromDate.getTime();
  const end = start + withinDays * 24 * 60 * 60 * 1000;
  const alerts: Array<{ date: string; daysUntil: number }> = [];

  for (const d of runDates) {
    const key = d.slice(0, 10);
    const t = new Date(`${key}T12:00:00`).getTime();
    if (t >= start - 24 * 60 * 60 * 1000 && t <= end) {
      const daysUntil = Math.ceil((t - start) / (24 * 60 * 60 * 1000));
      alerts.push({ date: key, daysUntil: Math.max(0, daysUntil) });
    }
  }

  return alerts.sort((a, b) => a.date.localeCompare(b.date));
}
