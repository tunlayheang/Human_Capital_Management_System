import { LeaveRequest, LeaveStatus } from '../types';
import { CalendarPlanningEntry } from '../types/roster';
import { MonthlyFixedRoster } from '../types/roster';

export function padDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** YYYY-MM-DD for the user's local calendar today (HTML date inputs). */
export function localTodayIsoDate(date = new Date()): string {
  return padDate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function clampIsoDateNotBeforeToday(
  iso: string,
  today = localTodayIsoDate()
): string {
  const value = String(iso ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < today) return today;
  return value;
}

export function leaveOverlapsMonth(
  startDate: string,
  endDate: string,
  month: number,
  year: number
): boolean {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startMonth = start.getMonth();
  const endMonth = end.getMonth();
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  return (
    (startMonth === month && startYear === year) ||
    (endMonth === month && endYear === year) ||
    (startYear < year && endYear > year) ||
    (startYear === year && endYear === year && startMonth < month && endMonth > month)
  );
}

export function approvedLeavesToEntries(leaves: LeaveRequest[], month: number, year: number): CalendarPlanningEntry[] {
  return leaves
    .filter((l) => l.status === LeaveStatus.APPROVED && leaveOverlapsMonth(l.startDate, l.endDate, month, year))
    .map((l) => ({
      id: l.id,
      userId: l.userId,
      type: l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      isFixedRoster: false,
    }));
}

export function rosterToEntries(
  roster: MonthlyFixedRoster,
  employeeNamesById?: Record<string, string>
): CalendarPlanningEntry[] {
  return roster.entries.map((e, i) => ({
    id: `${roster.id}-${e.employeeId}-${e.day}-${i}`,
    userId: e.employeeId,
    employeeName: employeeNamesById?.[e.employeeId],
    type: e.leaveType,
    startDate: padDate(roster.year, roster.month, e.day),
    endDate: padDate(roster.year, roster.month, e.day),
    isFixedRoster: true,
    fromApprovedLeave: Boolean(e.sourceLeaveRequestId),
  }));
}

export function entryCoversDate(entry: CalendarPlanningEntry, iso: string): boolean {
  const d = new Date(`${iso}T00:00:00`).getTime();
  return d >= new Date(`${entry.startDate}T00:00:00`).getTime() && d <= new Date(`${entry.endDate}T00:00:00`).getTime();
}

/**
 * Portal user ids that already have a roster cell synced from approved leave on this date.
 */
function rosterSyncedPortalUserIdsForDay(
  dayEntries: CalendarPlanningEntry[],
  userIdByEmployeeId: Record<string, string>
): Set<string> {
  const ids = new Set<string>();
  for (const e of dayEntries) {
    if (!e.isFixedRoster || !e.fromApprovedLeave) continue;
    const portalId = userIdByEmployeeId[e.userId] ?? e.userId;
    if (portalId) ids.add(portalId);
  }
  return ids;
}

/** Day entries; hides duplicate approved-leave chips when roster already has the synced cell. */
export function entriesForDay(
  entries: CalendarPlanningEntry[],
  iso: string,
  userIdByEmployeeId: Record<string, string> = {}
): CalendarPlanningEntry[] {
  const dayEntries = entries.filter((e) => entryCoversDate(e, iso));
  const syncedPortalUsers = rosterSyncedPortalUserIdsForDay(dayEntries, userIdByEmployeeId);
  return dayEntries.filter((e) => {
    if (e.isFixedRoster) return true;
    if (syncedPortalUsers.has(e.userId)) return false;
    return true;
  });
}

export function monthName(month: number): string {
  return new Date(2000, month, 1).toLocaleString(undefined, { month: 'long' });
}
