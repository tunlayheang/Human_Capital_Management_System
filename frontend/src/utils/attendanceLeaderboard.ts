import { AttendanceRecord, AttendanceStatus, User } from '../types';
import { HCMS_ATTENDANCE_TZ } from './attendanceRecordApi';
import { isEmployeeAllowedSystemAccess } from './employeePortalStatus';
import { isSystemPortalAccount } from './userProfile';
import { isPortalUserExcludedFromPayroll } from './payrollEligibility';

export const ATTENDANCE_SCORE_PRESENT = 10;
export const ATTENDANCE_SCORE_LATE = -5;

export type AttendanceLeaderboardDayDetail = {
  date: string;
  status: string;
  points: number;
  clockIn?: string;
  clockOut?: string;
};

export type AttendanceLeaderboardRow = {
  user: User;
  departmentId: string;
  departmentName: string;
  points: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveOrOffDays: number;
  dayDetails: AttendanceLeaderboardDayDetail[];
  /** Unique rank after full sort (1, 2, 3, …). */
  rank: number;
  listPosition: number;
  /** Same points + on-time + late as another employee (rank still unique via clocks). */
  isTied: boolean;
  /** How many employees share the same score bundle (points / on-time / late). */
  tieGroupSize: number;
  /** Clock punctuality used to break ties and sort. */
  clockStats: AttendanceLeaderboardClockStats;
};

export type AttendanceLeaderboardClockStats = {
  /** Scored days (present/late) with a clock-in. */
  clockedInDays: number;
  /** Scored days with both clock-in and clock-out. */
  completeClockDays: number;
  /** Average arrival time (minutes from midnight, office TZ); lower = earlier. */
  avgClockInMinutes: number | null;
  /** Average departure on complete days; higher = later checkout. */
  avgClockOutMinutes: number | null;
  /** Sum of (clock-out − clock-in) on complete scored days. */
  totalWorkedMs: number;
};

export type AttendanceLeaderboardDateRange = {
  from: string;
  to: string;
};

function todayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default range: first day of current month through today. */
export function defaultLeaderboardDateRange(): AttendanceLeaderboardDateRange {
  const to = todayDateKey();
  const from = `${to.slice(0, 7)}-01`;
  return { from, to };
}

export function normalizeLeaderboardDateRange(
  from: string,
  to: string
): AttendanceLeaderboardDateRange {
  let f = String(from ?? '').trim().slice(0, 10);
  let t = String(to ?? '').trim().slice(0, 10);
  if (!f) f = defaultLeaderboardDateRange().from;
  if (!t) t = todayDateKey();
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

export function attendanceRecordInRange(
  record: Pick<AttendanceRecord, 'date'>,
  range: AttendanceLeaderboardDateRange
): boolean {
  const date = String(record.date ?? '').trim().slice(0, 10);
  if (date.length < 10) return false;
  return date >= range.from && date <= range.to;
}

/** Points for one day; ABSENT / ON_LEAVE / DAY_OFF contribute 0. */
export function attendanceDayPoints(status: string | AttendanceStatus | undefined): number {
  const s = String(status ?? '').toUpperCase();
  if (s === AttendanceStatus.PRESENT) return ATTENDANCE_SCORE_PRESENT;
  if (s === AttendanceStatus.LATE) return ATTENDANCE_SCORE_LATE;
  return 0;
}

/** Same score bundle (points, on-time, late) — rank may still differ via clock times. */
export function isLeaderboardScoreTie(a: AttendanceLeaderboardRow, b: AttendanceLeaderboardRow): boolean {
  return (
    a.points === b.points &&
    a.presentDays === b.presentDays &&
    a.lateDays === b.lateDays
  );
}

/** @deprecated Use isLeaderboardScoreTie */
export function isLeaderboardMetricsTie(a: AttendanceLeaderboardRow, b: AttendanceLeaderboardRow): boolean {
  return isLeaderboardScoreTie(a, b);
}

function clockHmToMinutes(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: HCMS_ATTENDANCE_TZ,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function computeLeaderboardClockStats(
  dayDetails: AttendanceLeaderboardDayDetail[]
): AttendanceLeaderboardClockStats {
  let clockedInDays = 0;
  let completeClockDays = 0;
  let sumInMinutes = 0;
  let inCount = 0;
  let sumOutMinutes = 0;
  let outCount = 0;
  let totalWorkedMs = 0;

  for (const d of dayDetails) {
    if (d.points === 0) continue;
    const inMin = clockHmToMinutes(d.clockIn);
    const outMin = clockHmToMinutes(d.clockOut);
    const inMs = d.clockIn ? new Date(d.clockIn).getTime() : NaN;
    const outMs = d.clockOut ? new Date(d.clockOut).getTime() : NaN;

    if (inMin != null) {
      clockedInDays += 1;
      sumInMinutes += inMin;
      inCount += 1;
    }
    if (
      inMin != null &&
      outMin != null &&
      Number.isFinite(inMs) &&
      Number.isFinite(outMs) &&
      outMs > inMs
    ) {
      completeClockDays += 1;
      sumOutMinutes += outMin;
      outCount += 1;
      totalWorkedMs += outMs - inMs;
    }
  }

  return {
    clockedInDays,
    completeClockDays,
    avgClockInMinutes: inCount > 0 ? sumInMinutes / inCount : null,
    avgClockOutMinutes: outCount > 0 ? sumOutMinutes / outCount : null,
    totalWorkedMs,
  };
}

function formatAvgClockMinutes(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Why `row` sorts above `other` when metrics differ; null when not ranked above. */
export function leaderboardRankAdvantageOver(
  row: AttendanceLeaderboardRow,
  other: AttendanceLeaderboardRow
): 'points' | 'onTime' | 'late' | 'clockComplete' | 'clockIn' | 'hoursWorked' | 'name' | null {
  if (row.points > other.points) return 'points';
  if (row.points < other.points) return null;
  if (row.presentDays > other.presentDays) return 'onTime';
  if (row.presentDays < other.presentDays) return null;
  if (row.lateDays < other.lateDays) return 'late';
  if (row.lateDays > other.lateDays) return null;

  const rc = row.clockStats;
  const oc = other.clockStats;
  if (rc.completeClockDays > oc.completeClockDays) return 'clockComplete';
  if (rc.completeClockDays < oc.completeClockDays) return null;

  const rIn = rc.avgClockInMinutes;
  const oIn = oc.avgClockInMinutes;
  if (rIn != null && oIn != null && rIn < oIn) return 'clockIn';
  if (rIn != null && oIn == null) return 'clockIn';
  if (rIn == null && oIn != null) return null;

  if (rc.totalWorkedMs > oc.totalWorkedMs) return 'hoursWorked';
  if (rc.totalWorkedMs < oc.totalWorkedMs) return null;

  return 'name';
}

function userDisplayNameSort(a: User, b: User): number {
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
}

/** Full performance sort: score, then clock in/out punctuality, then name. */
export function compareLeaderboardByPerformance(
  a: AttendanceLeaderboardRow,
  b: AttendanceLeaderboardRow
): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.presentDays !== a.presentDays) return b.presentDays - a.presentDays;
  if (a.lateDays !== b.lateDays) return a.lateDays - b.lateDays;

  const ac = a.clockStats;
  const bc = b.clockStats;
  if (bc.completeClockDays !== ac.completeClockDays) {
    return bc.completeClockDays - ac.completeClockDays;
  }

  const aHasIn = ac.avgClockInMinutes != null;
  const bHasIn = bc.avgClockInMinutes != null;
  if (aHasIn && !bHasIn) return -1;
  if (!aHasIn && bHasIn) return 1;
  if (aHasIn && bHasIn && ac.avgClockInMinutes! !== bc.avgClockInMinutes!) {
    return ac.avgClockInMinutes! - bc.avgClockInMinutes!;
  }

  if (bc.totalWorkedMs !== ac.totalWorkedMs) return bc.totalWorkedMs - ac.totalWorkedMs;

  return userDisplayNameSort(a.user, b.user);
}

export function formatLeaderboardAvgClockIn(minutes: number | null): string {
  return formatAvgClockMinutes(minutes);
}

type PerformanceRankMeta = {
  rank: number;
  isTied: boolean;
  tieGroupSize: number;
};

function assignPerformanceRanks(rows: AttendanceLeaderboardRow[]): Map<string, PerformanceRankMeta> {
  const sorted = [...rows].sort(compareLeaderboardByPerformance);
  const map = new Map<string, PerformanceRankMeta>();
  sorted.forEach((row, idx) => {
    const scorePeers = sorted.filter((r) => isLeaderboardScoreTie(r, row)).length;
    map.set(row.user.id, {
      rank: idx + 1,
      isTied: scorePeers > 1,
      tieGroupSize: scorePeers,
    });
  });
  return map;
}

/** Employee immediately above `row` in performance order (for rank explanations). */
export function leaderboardRowAboveByPerformance(
  row: AttendanceLeaderboardRow,
  allRows: AttendanceLeaderboardRow[]
): AttendanceLeaderboardRow | null {
  const sorted = [...allRows].sort(compareLeaderboardByPerformance);
  const idx = sorted.findIndex((r) => r.user.id === row.user.id);
  if (idx <= 0) return null;
  return sorted[idx - 1] ?? null;
}

/** Podium badge colors: 1 gold, 2 silver, 3 bronze, 4+ neutral. Ties keep podium colors. */
export function leaderboardRankBadgeClassName(rank: number): string {
  if (rank === 1) {
    return 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white ring-4 ring-yellow-100 dark:ring-yellow-900/30';
  }
  if (rank === 2) {
    return 'bg-gradient-to-br from-slate-300 to-slate-400 text-white ring-4 ring-slate-100 dark:ring-slate-800';
  }
  if (rank === 3) {
    return 'bg-gradient-to-br from-amber-600 to-amber-700 text-white ring-4 ring-amber-100 dark:ring-amber-900/30';
  }
  return 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400';
}

export function resolveDepartmentName(
  departmentId: string | undefined,
  departmentNames: Record<string, string>
): string {
  const id = String(departmentId ?? '').trim();
  if (!id) return '—';
  return departmentNames[id] || '—';
}

/** Filter by department; list sorted by rank (score) by default. */
export function applyLeaderboardView(
  rows: AttendanceLeaderboardRow[],
  options: { departmentId?: string } = {}
): AttendanceLeaderboardRow[] {
  const deptFilter = options.departmentId?.trim();
  let list = rows;
  if (deptFilter && deptFilter !== 'all') {
    list = list.filter((r) => String(r.user.departmentId || r.departmentId || '') === deptFilter);
  }
  const perfRanks = assignPerformanceRanks(list);
  const sorted = [...list].sort(compareLeaderboardByPerformance);
  return sorted.map((row, idx) => {
    const meta = perfRanks.get(row.user.id)!;
    return {
      ...row,
      rank: meta.rank,
      isTied: meta.isTied,
      tieGroupSize: meta.tieGroupSize,
      listPosition: idx + 1,
    };
  });
}

export function buildAttendanceLeaderboard(
  users: User[],
  records: AttendanceRecord[],
  range: AttendanceLeaderboardDateRange,
  departmentNames: Record<string, string> = {}
): AttendanceLeaderboardRow[] {
  const normalized = normalizeLeaderboardDateRange(range.from, range.to);
  const rangeRecords = records.filter((r) => attendanceRecordInRange(r, normalized));

  const activeUsers = users.filter((user) => {
    if (isSystemPortalAccount(user) || isPortalUserExcludedFromPayroll(user.role)) {
      return false;
    }
    const hrStatus = user.employee?.status;
    if (hrStatus == null || String(hrStatus).trim() === '') return false;
    return isEmployeeAllowedSystemAccess(hrStatus);
  });

  const rows = activeUsers.map((user) => {
    const userRecs = rangeRecords.filter((r) => r.userId === user.id);
    let points = 0;
    let presentDays = 0;
    let lateDays = 0;
    let absentDays = 0;
    let leaveOrOffDays = 0;
    const dayDetails: AttendanceLeaderboardDayDetail[] = [];

    for (const r of userRecs) {
      const s = String(r.status ?? '').toUpperCase();
      const dayPts = attendanceDayPoints(r.status);
      points += dayPts;
      if (s === AttendanceStatus.PRESENT) presentDays += 1;
      else if (s === AttendanceStatus.LATE) lateDays += 1;
      else if (s === AttendanceStatus.ABSENT) absentDays += 1;
      else if (s === AttendanceStatus.ON_LEAVE || s === AttendanceStatus.DAY_OFF) leaveOrOffDays += 1;

      dayDetails.push({
        date: String(r.date ?? '').slice(0, 10),
        status: s,
        points: dayPts,
        clockIn: r.clockIn,
        clockOut: r.clockOut,
      });
    }

    dayDetails.sort((a, b) => b.date.localeCompare(a.date));
    const clockStats = computeLeaderboardClockStats(dayDetails);

    const departmentId = String(user.departmentId ?? '').trim();
    return {
      user,
      departmentId,
      departmentName: resolveDepartmentName(departmentId, departmentNames),
      points,
      presentDays,
      lateDays,
      absentDays,
      leaveOrOffDays,
      dayDetails,
      clockStats,
      rank: 0,
      listPosition: 0,
      isTied: false,
      tieGroupSize: 1,
    };
  });

  return applyLeaderboardView(rows, { departmentId: 'all' });
}
