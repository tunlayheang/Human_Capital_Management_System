import { toYmd } from './dashboardDateRange';

/** Calendar date key (YYYY-MM-DD) in the user's local timezone. */
export function localDateKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return toYmd(d);
}

/** Local wall-clock time HH:mm for editing an existing reminder. */
export function localTimeFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '09:00';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Convert selected calendar date + time input to UTC ISO for the API. */
export function toAlertAtIso(dateKey: string, time: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh = 9, mm = 0] = time.split(':').map(Number);
  const local = new Date(y, m - 1, d, hh, mm, 0, 0);
  return local.toISOString();
}

export function normalizeReminderTime(raw?: string | null): string {
  const v = String(raw ?? '').trim();
  if (!v) return '09:00';
  const match = v.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '09:00';
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

type AlertTimingFields = {
  alertAt: string;
  isDone?: boolean;
};

/** True when a pending reminder's scheduled time has passed. */
export function isPersonalAlertOverdue(
  alert: AlertTimingFields,
  nowMs: number = Date.now()
): boolean {
  if (alert.isDone) return false;
  const at = new Date(alert.alertAt).getTime();
  return !Number.isNaN(at) && at < nowMs;
}

/** Pending reminders: overdue first, then soonest upcoming. */
export function sortPendingPersonalAlerts<T extends AlertTimingFields>(
  alerts: T[],
  nowMs: number = Date.now()
): T[] {
  return [...alerts]
    .filter((a) => !a.isDone)
    .sort((a, b) => {
      const aOver = isPersonalAlertOverdue(a, nowMs);
      const bOver = isPersonalAlertOverdue(b, nowMs);
      if (aOver !== bOver) return aOver ? -1 : 1;
      return new Date(a.alertAt).getTime() - new Date(b.alertAt).getTime();
    });
}
