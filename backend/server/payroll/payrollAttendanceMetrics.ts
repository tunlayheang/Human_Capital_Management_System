/**
 * Payroll attendance metrics — sourced from saved attendance records and approved leave only.
 */
import { toDateKey } from './dateKey.js';
import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import { workHoursFromAttendanceRecord } from '../payrollOvertime.js';
import {
  getAttendanceStatusCategory,
  isNeutralAttendanceStatus,
} from '../payrollStatusClassificationConfig.js';
import {
  dedupeAttendanceRecordsByDate,
  normalizeAttendanceStatusKey,
  type AttendanceRowLike,
  hasAttendanceClockIn,
} from './payrollAttendanceRecordService.js';

export type PayrollAttendanceMetrics = {
  /** Payroll basis days in the employment window (for display / caps). */
  workingDays: number;
  /** PRESENT/LATE with clock-in only (excludes paid/unpaid leave statuses). */
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  /** ABSENT records only (excludes unpaid leave and rest days). */
  absentDays: number;
  /** Distinct paid dates for salary proration (present ∪ paid leave, capped). */
  paidDays: number;
  lateCount: number;
  /** Distinct calendar days with a saved attendance row in the window. */
  recordsInPeriod: number;
  /** Work hours from present/late rows with clock-in only. */
  totalWorkHours: number;
  windowStart: string;
  windowEnd: string;
  lastPresentDate: string | null;
};

function resolvePayWindow(params: {
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
}): { windowStart: string; windowEnd: string } | null {
  const periodStart = toDateKey(params.periodStart) ?? params.periodStart.slice(0, 10);
  const periodEnd = toDateKey(params.periodEnd) ?? params.periodEnd.slice(0, 10);
  const join = toDateKey(params.joinDate);
  const lwd = toDateKey(params.lastWorkingDate);

  let windowStart = periodStart;
  if (join && join > windowStart) windowStart = join;

  let windowEnd = periodEnd;
  if (lwd && lwd < windowEnd) windowEnd = lwd;

  if (windowEnd < windowStart) return null;
  return { windowStart, windowEnd };
}

export {
  hasAttendanceClockIn,
  type AttendanceRowLike,
} from './payrollAttendanceRecordService.js';

export function isPaidLeaveDate(
  dateKey: string,
  paidLeaveDates?: ReadonlySet<string>,
  leaveByDate?: Map<string, LeaveDayInfo>
): boolean {
  if (paidLeaveDates?.has(dateKey)) return true;
  const info = leaveByDate?.get(dateKey);
  if (!info) return false;
  if (info.isPaid) return true;
  return info.payrollCategory === 'payable';
}

export function isUnpaidLeaveDate(
  dateKey: string,
  unpaidLeaveDates?: ReadonlySet<string>,
  leaveByDate?: Map<string, LeaveDayInfo>
): boolean {
  if (unpaidLeaveDates?.has(dateKey)) return true;
  const info = leaveByDate?.get(dateKey);
  if (!info) return false;
  if (!info.isPaid) return true;
  return info.payrollCategory === 'deductible';
}

export function computePayrollAttendanceMetrics(params: {
  attendance: AttendanceRowLike[];
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  /** Eligible payroll basis days in employment window. */
  workDaysCap?: number;
  paidLeaveDates?: Iterable<string>;
  unpaidLeaveDates?: Iterable<string>;
  leaveByDate?: Map<string, LeaveDayInfo>;
}): PayrollAttendanceMetrics {
  const cap = Math.max(0, Math.floor(params.workDaysCap ?? 0));
  const window = resolvePayWindow(params);
  const periodStart = toDateKey(params.periodStart) ?? params.periodStart.slice(0, 10);
  const periodEnd = toDateKey(params.periodEnd) ?? params.periodEnd.slice(0, 10);

  if (!window) {
    return {
      workingDays: 0,
      presentDays: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      absentDays: 0,
      paidDays: 0,
      lateCount: 0,
      recordsInPeriod: 0,
      totalWorkHours: 0,
      windowStart: periodStart,
      windowEnd: periodEnd,
      lastPresentDate: null,
    };
  }

  const { windowStart, windowEnd } = window;
  const paidLeaveSet = new Set<string>();
  if (params.paidLeaveDates) {
    for (const raw of params.paidLeaveDates) {
      const d = toDateKey(raw);
      if (d && d >= windowStart && d <= windowEnd) paidLeaveSet.add(d);
    }
  }
  const unpaidLeaveSet = new Set<string>();
  if (params.unpaidLeaveDates) {
    for (const raw of params.unpaidLeaveDates) {
      const d = toDateKey(raw);
      if (d && d >= windowStart && d <= windowEnd) unpaidLeaveSet.add(d);
    }
  }

  const inWindow = params.attendance.filter((row) => {
    const d = toDateKey(row.date);
    return d && d >= windowStart && d <= windowEnd;
  });
  const rows = dedupeAttendanceRecordsByDate(inWindow);

  const workingDays = cap;
  const presentDates = new Set<string>();
  const clockPresentDates = new Set<string>();
  const paidLeaveOnlyDates = new Set<string>();
  const unpaidLeaveOnlyDates = new Set<string>();
  const absentDates = new Set<string>();
  const neutralDates = new Set<string>();
  let lateCount = 0;
  let lastPresentDate: string | null = null;
  let totalWorkHours = 0;

  for (const row of rows) {
    const d = toDateKey(row.date);
    if (!d) continue;

    const st = normalizeAttendanceStatusKey(row.status);
    const hasClockIn = hasAttendanceClockIn(row);

    if (isNeutralAttendanceStatus(st) || st === 'DAY_OFF') {
      neutralDates.add(d);
      continue;
    }

    if (st === 'LATE' && hasClockIn) lateCount += 1;

    if (st === 'PRESENT' || st === 'LATE') {
      if (!hasClockIn) continue;
      if (isPaidLeaveDate(d, paidLeaveSet, params.leaveByDate)) {
        presentDates.add(d);
        paidLeaveOnlyDates.add(d);
        if (!lastPresentDate || d > lastPresentDate) lastPresentDate = d;
        continue;
      }
      if (isUnpaidLeaveDate(d, unpaidLeaveSet, params.leaveByDate)) {
        unpaidLeaveOnlyDates.add(d);
        continue;
      }
      clockPresentDates.add(d);
      presentDates.add(d);
      totalWorkHours += workHoursFromAttendanceRecord(row);
      if (!lastPresentDate || d > lastPresentDate) lastPresentDate = d;
      continue;
    }

    if (st === 'PAID_LEAVE' || st === 'PH') {
      presentDates.add(d);
      paidLeaveOnlyDates.add(d);
      if (!lastPresentDate || d > lastPresentDate) lastPresentDate = d;
      continue;
    }

    if (st === 'UNPAID_LEAVE') {
      unpaidLeaveOnlyDates.add(d);
      continue;
    }

    if (st === 'ON_LEAVE') {
      if (isPaidLeaveDate(d, paidLeaveSet, params.leaveByDate)) {
        presentDates.add(d);
        paidLeaveOnlyDates.add(d);
        if (!lastPresentDate || d > lastPresentDate) lastPresentDate = d;
      } else {
        unpaidLeaveOnlyDates.add(d);
      }
      continue;
    }

    if (st === 'ABSENT' || getAttendanceStatusCategory(st) === 'deductible') {
      if (row.isGridPlaceholder && !hasClockIn) {
        neutralDates.add(d);
        continue;
      }
      if (!isUnpaidLeaveDate(d, unpaidLeaveSet, params.leaveByDate)) {
        absentDates.add(d);
      }
    }
  }

  const presentDays = clockPresentDates.size;
  const paidLeaveDays = paidLeaveOnlyDates.size;
  const unpaidLeaveDays = unpaidLeaveOnlyDates.size;
  const absentDays = absentDates.size;
  const paidDays =
    cap > 0 ? Math.min(cap, presentDates.size) : presentDates.size;

  return {
    workingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    paidDays,
    lateCount,
    recordsInPeriod: rows.length,
    totalWorkHours: Math.round(totalWorkHours * 100) / 100,
    windowStart,
    windowEnd,
    lastPresentDate,
  };
}
