/**
 * Scheduled rest days from Planning rosters (not leave types).
 * Premium OT (200%) applies when an employee works on these days.
 */

export function isRosterScheduledOffDay(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'dayoff' || n === 'day off' || n === 'day-off' || n === 'do' || n === 'off') {
    return true;
  }
  if (n === 'weekly off' || n === 'weekend off') return true;
  return /\bday\s*off\b/.test(n);
}

export function isRosterHoliday(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'holiday' || n === 'h' || n === 'ph') return true;
  if (n === 'public holiday' || n.includes('public holiday')) return true;
  return false;
}

/** Mission / business-trip day — staff still clock in/out; attendance status stays Mission. */
export function isRosterMission(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  if (n === 'mission' || n === 'm') return true;
  if (n === 'business trip' || n.includes('business trip')) return true;
  return false;
}

/** Planning roster cell is a leave type (AL/SL/PL/UL), not working, day-off, holiday, or mission. */
export function isRosterPlannedLeaveType(leaveType: string | null | undefined): boolean {
  if (
    !leaveType ||
    isRosterScheduledOffDay(leaveType) ||
    isRosterHoliday(leaveType) ||
    isRosterMission(leaveType)
  ) {
    return false;
  }
  const n = String(leaveType).trim().toLowerCase();
  return n !== 'working' && n !== 'w';
}

/**
 * Planning roster scheduled rest — Day Off only.
 * Public Holiday (PH) is painted for visibility but still counts as a working day for staffing/payroll.
 */
export function isRosterPlanningRestDay(leaveType: string | null | undefined): boolean {
  return isRosterScheduledOffDay(leaveType);
}

/**
 * Monthly planning roster persists cells that differ from the default Working (day off, leave, holiday, mission).
 * Only Day Off is treated as a scheduled rest day; PH, Mission, and leave types use other rules.
 */
export function isPlanningRosterNonWorkingEntry(leaveType: string | null | undefined): boolean {
  if (!leaveType) return false;
  const n = String(leaveType).trim().toLowerCase();
  return n !== 'working' && n !== 'w';
}

export function dateKeyFromYmd(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseMonthPrefix(month: string): { year: number; monthIndex: number } {
  const [ys, ms] = month.slice(0, 7).split('-');
  const year = parseInt(ys, 10) || new Date().getFullYear();
  const monthIndex = Math.max(0, Math.min(11, (parseInt(ms, 10) || 1) - 1));
  return { year, monthIndex };
}
