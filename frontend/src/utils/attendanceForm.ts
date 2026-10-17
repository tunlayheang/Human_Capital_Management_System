import {
  HCMS_ATTENDANCE_TZ,
  parseAttendanceTimestamp,
} from './attendanceRecordApi';

/** Format ISO timestamp for `<input type="datetime-local" />` (local time). */
export function isoToDatetimeLocal(iso?: string | null): string {
  const d = parseAttendanceTimestamp(iso);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format ISO timestamp for datetime-local using office (ICT) wall time. */
export function isoToDatetimeLocalIct(iso?: string | null): string {
  const d = parseAttendanceTimestamp(iso);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HCMS_ATTENDANCE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const pad = (v: string) => v.padStart(2, '0');
  return `${pick('year')}-${pad(pick('month'))}-${pad(pick('day'))}T${pad(pick('hour'))}:${pad(pick('minute'))}`;
}

/** Format ISO timestamp as HH:mm for `<input type="time" />`. */
export function isoToTimeLocal(iso?: string | null): string {
  const d = parseAttendanceTimestamp(iso);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
