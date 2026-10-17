/**
 * Single source for payroll grid attendance metrics — attendance records and approved leave only.
 */
import type { PayrollAttendanceSummary } from '../payrollCalculation.js';
import type { LeaveDayInfo } from '../approvedLeaveDayMap.js';
import {
  computePayrollAttendanceMetrics,
  type AttendanceRowLike,
} from './payrollAttendanceMetrics.js';

export type PayrollAttendanceSnapshotInput = {
  attendance: AttendanceRowLike[];
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  /** Full-month payroll basis days (salary divisor). */
  payrollBasisDays: number;
  /** Basis days in employment window (mid-month join/resign). */
  eligibleBasisDays?: number;
  paidLeaveDates?: Iterable<string>;
  unpaidLeaveDates?: Iterable<string>;
  leaveByDate?: Map<string, LeaveDayInfo>;
  standardHoursPerDay?: number;
  hourlyRate?: number;
  dailyRate?: number;
  dependents?: number;
  overtimeHours?: number;
};

export type PayrollAttendanceSnapshot = PayrollAttendanceSummary & {
  payrollBasisDays: number;
};

export function buildPayrollAttendanceSnapshot(
  input: PayrollAttendanceSnapshotInput
): PayrollAttendanceSnapshot {
  const payrollBasisDays = Math.max(1, Math.round(input.payrollBasisDays || 26));
  const eligibleBasisDays = Math.max(
    0,
    Math.round(input.eligibleBasisDays ?? payrollBasisDays)
  );

  const metrics = computePayrollAttendanceMetrics({
    attendance: input.attendance,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    joinDate: input.joinDate,
    lastWorkingDate: input.lastWorkingDate,
    workDaysCap: eligibleBasisDays,
    paidLeaveDates: input.paidLeaveDates,
    unpaidLeaveDates: input.unpaidLeaveDates,
    leaveByDate: input.leaveByDate,
  });

  return {
    recordsInPeriod: metrics.recordsInPeriod,
    presentDays: metrics.presentDays,
    paidLeaveDays: metrics.paidLeaveDays,
    unpaidLeaveDays: metrics.unpaidLeaveDays,
    absentDays: metrics.absentDays,
    paidDays: metrics.paidDays,
    payrollBasisDays,
    scheduledWorkDays: payrollBasisDays,
    lateCount: metrics.lateCount,
    totalWorkHours: metrics.totalWorkHours,
    standardHoursPerDay: input.standardHoursPerDay ?? 8,
    hourlyRate: input.hourlyRate ?? 0,
    dailyRate: input.dailyRate,
    dependents: input.dependents ?? 0,
    overtimeHours: input.overtimeHours,
    attendanceSource: 'attendance_module',
  };
}
