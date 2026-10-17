/** Cambodia office time — matches seed-attendance and clock-in storage. */
export const ATTENDANCE_TZ = 'Asia/Phnom_Penh';
export const ATTENDANCE_TZ_OFFSET = '+07:00';

/** YYYY-MM-DD for "today" in office timezone. */
export function dateKeyIct(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ATTENDANCE_TZ }).format(now);
}

const ICT_WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Day of week 0–6 (Sun–Sat) in ICT for a calendar date. */
export function dayOfWeekIct(dateKey: string): number {
  const key = String(dateKey).slice(0, 10);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: ATTENDANCE_TZ,
    weekday: 'short',
  }).format(new Date(`${key}T12:00:00${ATTENDANCE_TZ_OFFSET}`));
  return ICT_WEEKDAY[label.slice(0, 3)] ?? 1;
}

/** Minutes since midnight in ICT. */
export function minutesFromIsoIct(iso: string | Date, fallbackNow?: Date): number {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) {
    return fallbackNow ? minutesNowIct(fallbackNow) : 0;
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATTENDANCE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function minutesNowIct(now = new Date()): number {
  return minutesFromIsoIct(now);
}

/** Add calendar days to YYYY-MM-DD (no timezone shift on the date itself). */
export function addCalendarDays(dateKey: string, delta: number): string {
  const [y, m, d] = String(dateKey)
    .slice(0, 10)
    .split('-')
    .map((x) => parseInt(x, 10));
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + delta);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Human-readable clock time in ICT for audit logs. */
export function formatClockLabelIct(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: ATTENDANCE_TZ,
  }).format(d);
}

/** HH:mm (24h) in ICT from stored ISO. */
export function timeHmFromIsoIct(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: ATTENDANCE_TZ,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** Describe only fields whose stored ISO value actually changed. */
export function buildCorrectionChangeSummary(
  previous: { clockIn: string | null; clockOut: string | null },
  next: { clockIn: string | null; clockOut: string | null }
): string {
  const lines: string[] = [];
  const prevIn = previous.clockIn ?? null;
  const prevOut = previous.clockOut ?? null;
  const nextIn = next.clockIn ?? null;
  const nextOut = next.clockOut ?? null;

  if (prevIn !== nextIn) {
    lines.push(`Check-in: ${formatClockLabelIct(prevIn)} → ${formatClockLabelIct(nextIn)}`);
  }
  if (prevOut !== nextOut) {
    lines.push(`Check-out: ${formatClockLabelIct(prevOut)} → ${formatClockLabelIct(nextOut)}`);
  }

  return lines.length ? lines.join(' | ') : 'No time change';
}

/** Parse HH:mm and return ISO UTC for the given work date in ICT. */
export function combineDateAndTimeIct(dateKey: string, timeHm: string): string {
  const day = String(dateKey).slice(0, 10);
  const match = String(timeHm).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error('Time must be HH:mm (24-hour)');
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error('Invalid time');
  const iso = `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${ATTENDANCE_TZ_OFFSET}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date or time');
  return d.toISOString();
}
