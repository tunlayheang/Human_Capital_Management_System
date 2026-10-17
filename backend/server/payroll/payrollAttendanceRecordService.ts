/**
 * Payroll attendance rows for metrics — grid statuses match the Attendance module.
 */
import { toDateKey } from './dateKey.js';
import { workHoursFromAttendanceRecord } from '../payrollOvertime.js';

export type AttendanceRowLike = {
  date?: string;
  status?: unknown;
  clockIn?: unknown;
  clockOut?: unknown;
  workHours?: unknown;
  userId?: unknown;
  leaveIsPaid?: unknown;
  /** Roster preview row — not saved until clock-in or day-end reconcile. */
  isGridPlaceholder?: boolean;
};

export function hasAttendanceClockIn(row: AttendanceRowLike): boolean {
  const ci = row.clockIn;
  return ci != null && String(ci).trim() !== '';
}

export function normalizeAttendanceStatusKey(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function recordPriority(status: string, hasClockIn: boolean): number {
  const st = normalizeAttendanceStatusKey(status);
  if ((st === 'PRESENT' || st === 'LATE') && hasClockIn) return 100;
  if (st === 'PAID_LEAVE' || st === 'PH') return 80;
  if (st === 'UNPAID_LEAVE') return 70;
  if (st === 'ABSENT') return 50;
  if (st === 'DAY_OFF') return 10;
  return 30;
}

/** One row per calendar day — highest-priority status wins (matches attendance list saved rows). */
export function dedupeAttendanceRecordsByDate(
  rows: AttendanceRowLike[]
): AttendanceRowLike[] {
  const byDate = new Map<
    string,
    AttendanceRowLike & { _priority: number; _hours: number }
  >();

  for (const row of rows) {
    const d = toDateKey(row.date);
    if (!d) continue;
    const hasClockIn = hasAttendanceClockIn(row);
    const st = normalizeAttendanceStatusKey(row.status);
    const pri = recordPriority(st, hasClockIn);
    const hrs = workHoursFromAttendanceRecord(row);
    const existing = byDate.get(d);
    if (!existing || pri > existing._priority || (pri === existing._priority && hrs > existing._hours)) {
      byDate.set(d, { ...row, status: st, _priority: pri, _hours: hrs });
    }
  }

  return [...byDate.values()].map(({ _priority, _hours, ...row }) => row);
}

/** Map attendance grid rows to payroll metric input (status already resolved for Attendance UI). */
export function normalizePayrollAttendanceGridRows(
  rows: Record<string, unknown>[]
): AttendanceRowLike[] {
  return rows.map((plain) => ({
    date: plain.date,
    status: plain.status,
    clockIn: plain.clockIn,
    clockOut: plain.clockOut,
    workHours: plain.workHours,
    userId: plain.userId,
    leaveIsPaid: plain.leaveIsPaid,
    isGridPlaceholder: plain.isGridPlaceholder === true,
  }));
}

/** One employee — same merge + status rules as the Attendance module list. */
export async function loadPayrollAttendanceForUser(params: {
  userId: string;
  periodStart: string;
  periodEnd: string;
}): Promise<AttendanceRowLike[]> {
  const { buildAttendanceGridForUserRange } = await import('../attendanceListGridService.js');
  const grid = await buildAttendanceGridForUserRange(
    params.userId,
    params.periodStart,
    params.periodEnd
  );
  return normalizePayrollAttendanceGridRows(grid);
}

/** Batch preload — one grid build for the period, grouped by user (payroll preview/run). */
export async function preloadPayrollAttendanceGridForUsers(params: {
  userIds: string[];
  periodStart: string;
  periodEnd: string;
}): Promise<Map<string, AttendanceRowLike[]>> {
  const wanted = new Set(params.userIds.filter(Boolean));
  const byUser = new Map<string, AttendanceRowLike[]>();
  for (const uid of wanted) byUser.set(uid, []);

  if (!wanted.size) return byUser;

  const { buildPayrollAttendanceGridForRange } = await import('../attendanceListGridService.js');
  const allRows = await buildPayrollAttendanceGridForRange(params.periodStart, params.periodEnd);
  for (const row of allRows) {
    const uid = String(row.userId ?? '').trim();
    if (!wanted.has(uid)) continue;
    const [normalized] = normalizePayrollAttendanceGridRows([row as Record<string, unknown>]);
    if (normalized) byUser.get(uid)!.push(normalized);
  }
  return byUser;
}
