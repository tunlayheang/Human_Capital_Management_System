/**
 * Attendance- and leave-driven day classification for payroll audit.
 * Denominator = payroll basis days in the employment window (not roster schedules).
 */
import { toDateKey } from './dateKey.js';
import {
  getAttendanceStatusCategory,
  type AttendanceStatusCategory,
} from '../payrollStatusClassificationConfig.js';
import type { LeaveDayInfo, LeavePayrollCategory } from '../approvedLeaveDayMap.js';
import { computePayrollAttendanceMetrics } from './payrollAttendanceMetrics.js';

export type AttendanceRecordLike = {
  date?: string;
  status?: unknown;
  clockIn?: unknown;
  clockOut?: unknown;
};

export type LeaveBreakdownLine = {
  code: string | null;
  name: string;
  paid: boolean;
  category: LeavePayrollCategory;
  days: number;
};

export type PayrollDayClassification = {
  eligiblePeriod: { start: string; end: string } | null;
  totalScheduledWorkingDays: number;
  scheduledWorkingDays: number;
  payableDays: number;
  deductibleDays: number;
  neutralDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unexcusedAbsentDays: number;
  attendanceBreakdown: Record<string, number>;
  leaveBreakdown: LeaveBreakdownLine[];
  finalized: boolean;
};

function inWindow(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey <= end;
}

export function classifyPayrollDays(params: {
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  windowStart: string | null;
  windowEnd: string | null;
  payrollBasisDays: number;
  eligibleBasisDays: number;
  attendance: AttendanceRecordLike[];
  paidLeaveDates?: Iterable<string>;
  unpaidLeaveDates?: Iterable<string>;
  leaveByDate?: Map<string, LeaveDayInfo>;
  unpaidLeaveDays?: number;
  attendanceFinalized: boolean;
}): PayrollDayClassification {
  const start = params.windowStart ? toDateKey(params.windowStart) : null;
  const end = params.windowEnd ? toDateKey(params.windowEnd) : null;
  const eligiblePeriod = start && end && end >= start ? { start, end } : null;

  const scheduledWorkingDays = Math.max(0, Math.round(params.eligibleBasisDays));
  const totalScheduledWorkingDays = Math.max(
    scheduledWorkingDays,
    Math.round(params.payrollBasisDays)
  );

  const attendanceBreakdown: Record<string, number> = {};
  let neutralDays = 0;

  for (const rec of params.attendance) {
    const d = toDateKey(rec.date);
    if (!d) continue;
    if (eligiblePeriod && !inWindow(d, eligiblePeriod.start, eligiblePeriod.end)) continue;

    const status = String(rec.status ?? '').toUpperCase() || 'UNKNOWN';
    attendanceBreakdown[status] = (attendanceBreakdown[status] ?? 0) + 1;

    const category: AttendanceStatusCategory = getAttendanceStatusCategory(status);
    if (category === 'neutral') neutralDays += 1;
  }

  const metrics = computePayrollAttendanceMetrics({
    attendance: params.attendance,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    joinDate: params.joinDate,
    lastWorkingDate: params.lastWorkingDate,
    workDaysCap: scheduledWorkingDays,
    paidLeaveDates: params.paidLeaveDates
      ? new Set(
          [...params.paidLeaveDates]
            .map((d) => toDateKey(d))
            .filter((d): d is string => Boolean(d))
        )
      : undefined,
    unpaidLeaveDates: params.unpaidLeaveDates
      ? new Set(
          [...params.unpaidLeaveDates]
            .map((d) => toDateKey(d))
            .filter((d): d is string => Boolean(d))
        )
      : undefined,
    leaveByDate: params.leaveByDate,
  });

  const presentDays = metrics.presentDays;
  const paidLeaveDays = metrics.paidLeaveDays;
  const unexcusedAbsentDays = metrics.absentDays;
  const unpaidLeaveFromAttendance = metrics.unpaidLeaveDays;
  const unpaidLeaveDays = Math.max(
    0,
    Math.round(Math.max(params.unpaidLeaveDays ?? 0, unpaidLeaveFromAttendance) * 100) / 100
  );

  let payableDays: number;
  let deductibleDays: number;
  if (!params.attendanceFinalized) {
    payableDays = scheduledWorkingDays;
    deductibleDays = 0;
  } else {
    payableDays = Math.min(scheduledWorkingDays, metrics.paidDays);
    deductibleDays = Math.max(0, scheduledWorkingDays - payableDays);
  }

  const leaveGroups = new Map<string, LeaveBreakdownLine>();
  if (params.leaveByDate) {
    for (const [dateKey, info] of params.leaveByDate) {
      const d = toDateKey(dateKey) ?? dateKey.slice(0, 10);
      if (eligiblePeriod && !inWindow(d, eligiblePeriod.start, eligiblePeriod.end)) continue;
      const key = (info.typeCode ?? info.typeLabel ?? 'LEAVE').toUpperCase();
      const existing = leaveGroups.get(key);
      if (existing) {
        existing.days += 1;
      } else {
        leaveGroups.set(key, {
          code: info.typeCode,
          name: info.typeLabel,
          paid: info.isPaid,
          category: info.payrollCategory,
          days: 1,
        });
      }
    }
  }
  const leaveBreakdown = [...leaveGroups.values()].sort((a, b) => b.days - a.days);

  return {
    eligiblePeriod,
    totalScheduledWorkingDays,
    scheduledWorkingDays,
    payableDays,
    deductibleDays,
    neutralDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    unexcusedAbsentDays,
    attendanceBreakdown,
    leaveBreakdown,
    finalized: params.attendanceFinalized,
  };
}
