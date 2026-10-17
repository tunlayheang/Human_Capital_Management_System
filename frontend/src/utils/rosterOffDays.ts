/**
 * Planning roster day-off detection — keep in sync with backend/server/rosterOffDays.ts
 */
export function isRosterHoliday(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'holiday' || n === 'h' || n === 'ph') return true;
  if (n === 'public holiday' || n.includes('public holiday')) return true;
  return false;
}

export function isRosterMission(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'mission' || n === 'm') return true;
  if (n === 'business trip' || n.includes('business trip')) return true;
  return false;
}

export function isRosterScheduledOffDay(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'dayoff' || n === 'day off' || n === 'day-off' || n === 'do' || n === 'off') {
    return true;
  }
  if (n === 'weekly off' || n === 'weekend off') return true;
  return /\bday\s*off\b/.test(n);
}

/** Planning roster scheduled rest — Day Off only; PH still counts as staffed/working. */
export function isRosterPlanningRestDay(leaveType: string | null | undefined): boolean {
  return isRosterScheduledOffDay(leaveType);
}

/** Staffing coverage: working + PH + Mission count as on; Day Off and leave cells count as off. */
export function isRosterStaffingOnDay(typeId: string | null | undefined): boolean {
  const tid = String(typeId ?? 'working').trim();
  if (!tid || tid === 'working' || tid === 'holiday' || tid === 'mission') return true;
  if (tid === 'dayoff' || isRosterScheduledOffDay(tid)) return false;
  if (tid.startsWith('leave:')) return false;
  if (isRosterHoliday(tid)) return true;
  if (isRosterMission(tid)) return true;
  return true;
}
