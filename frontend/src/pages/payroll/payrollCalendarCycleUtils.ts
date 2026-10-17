import type {
  PayrollCalendarCycleConfig,
  PayrollCycleDefinition,
  PayrollGroupConfig,
} from '../../types';
import { dateKey } from './payrollCalendarUtils';

export type CyclePaintField =
  | 'attendanceCutoffDate'
  | 'payrollCalculationDate'
  | 'payrollApprovalDate'
  | 'paymentDate';

export const CYCLE_PAINT_OPTIONS: Array<{
  field: CyclePaintField;
  label: string;
  swatch: string;
}> = [
  { field: 'attendanceCutoffDate', label: 'Cutoff', swatch: 'bg-amber-400 ring-1 ring-amber-500' },
  { field: 'payrollCalculationDate', label: 'Calculation', swatch: 'bg-primary-400 ring-1 ring-primary-500' },
  { field: 'payrollApprovalDate', label: 'Approval', swatch: 'bg-violet-400 ring-1 ring-violet-500' },
  { field: 'paymentDate', label: 'Payment', swatch: 'bg-emerald-400 ring-1 ring-emerald-500' },
];

export const DEFAULT_PAYROLL_GROUP: PayrollGroupConfig = {
  id: 'default',
  name: 'Default payroll group',
  periodType: 'monthly',
  defaultAttendanceCutoffDay: 25,
  defaultPayrollCalculationDay: 28,
  defaultPayrollApprovalDay: 29,
  defaultPaymentDay: 31,
  active: true,
};

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function dateOnDay(year: number, monthIndex: number, dayOfMonth: number): string {
  const last = lastDayOfMonth(year, monthIndex);
  const d = Math.min(Math.max(1, dayOfMonth), last);
  return dateKey(year, monthIndex, d);
}

export function dayAfter(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function previousMonthKey(month: string): string {
  const key = month.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Salary month window: day after previous cutoff → this month's cutoff (inclusive).
 * Example: June cutoff 25 + July cutoff 25 → July 2026-06-26 → 2026-07-25.
 */
export function periodBoundsFromCutoffs(
  previousCutoffDate: string,
  attendanceCutoffDate: string
): { periodStart: string; periodEnd: string } {
  const cutoff = attendanceCutoffDate.slice(0, 10);
  const prev = previousCutoffDate.slice(0, 10);
  let periodStart = dayAfter(prev);
  if (periodStart > cutoff) periodStart = cutoff;
  return { periodStart, periodEnd: cutoff };
}

export function defaultPreviousCutoffDate(
  year: number,
  monthIndex: number,
  group: PayrollGroupConfig
): string {
  if (monthIndex <= 0) {
    return dateOnDay(year - 1, 11, group.defaultAttendanceCutoffDay);
  }
  return dateOnDay(year, monthIndex - 1, group.defaultAttendanceCutoffDay);
}

export function buildMonthlyCycleForMonth(
  year: number,
  monthIndex: number,
  group: PayrollGroupConfig,
  previousCutoffDate?: string
): PayrollCycleDefinition {
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const attendanceCutoffDate = dateOnDay(year, monthIndex, group.defaultAttendanceCutoffDay);
  const prevCutoff = previousCutoffDate ?? defaultPreviousCutoffDate(year, monthIndex, group);
  const { periodStart, periodEnd } = periodBoundsFromCutoffs(prevCutoff, attendanceCutoffDate);
  return {
    month,
    periodStart,
    periodEnd,
    attendanceCutoffDate,
    payrollCalculationDate: dateOnDay(year, monthIndex, group.defaultPayrollCalculationDay),
    payrollApprovalDate: dateOnDay(year, monthIndex, group.defaultPayrollApprovalDay),
    paymentDate: dateOnDay(year, monthIndex, group.defaultPaymentDay),
  };
}

export function getGroupConfig(
  config: PayrollCalendarCycleConfig,
  groupId: string
): PayrollGroupConfig {
  return config.groups.find((g) => g.id === groupId) ?? DEFAULT_PAYROLL_GROUP;
}

/** Recompute pay-period bounds from consecutive cutoff dates. */
export function syncGroupCyclePeriodBounds(
  year: number,
  group: PayrollGroupConfig,
  groupCycles: Record<string, PayrollCycleDefinition>,
  previousYearDecemberCutoff?: string
): Record<string, PayrollCycleDefinition> {
  const next: Record<string, PayrollCycleDefinition> = { ...groupCycles };
  let previousCutoff =
    previousYearDecemberCutoff?.slice(0, 10) ??
    dateOnDay(year - 1, 11, group.defaultAttendanceCutoffDay);

  for (let m = 0; m < 12; m++) {
    const month = `${year}-${String(m + 1).padStart(2, '0')}`;
    const current =
      next[month] ?? buildMonthlyCycleForMonth(year, m, group, previousCutoff);
    const cutoff = current.attendanceCutoffDate?.slice(0, 10) || previousCutoff;
    const { periodStart, periodEnd } = periodBoundsFromCutoffs(previousCutoff, cutoff);
    next[month] = {
      ...current,
      month,
      attendanceCutoffDate: cutoff,
      periodStart,
      periodEnd,
    };
    previousCutoff = cutoff;
  }
  return next;
}

/** Ensure every month in the year has a cycle row for the group. */
export function ensureCyclesForYear(
  config: PayrollCalendarCycleConfig,
  year: number,
  groupId: string,
  previousYearDecemberCutoff?: string
): PayrollCalendarCycleConfig {
  const group = getGroupConfig(config, groupId);
  const cyclesByGroup = { ...config.cyclesByGroup };
  const groupCycles = syncGroupCyclePeriodBounds(
    year,
    group,
    { ...(cyclesByGroup[groupId] ?? {}) },
    previousYearDecemberCutoff
  );

  cyclesByGroup[groupId] = groupCycles;
  return { ...config, cyclesByGroup };
}

export function updateCycleDateField(
  config: PayrollCalendarCycleConfig,
  year: number,
  groupId: string,
  monthIndex: number,
  field: CyclePaintField,
  dayKey: string
): PayrollCalendarCycleConfig {
  const withCycles = ensureCyclesForYear(config, year, groupId);
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const cyclesByGroup = { ...withCycles.cyclesByGroup };
  const groupCycles = { ...cyclesByGroup[groupId] };
  const current = { ...groupCycles[month] };
  groupCycles[month] = { ...current, [field]: dayKey };
  cyclesByGroup[groupId] = groupCycles;
  const group = getGroupConfig(withCycles, groupId);
  // Keep salary windows aligned whenever a cutoff (or any milestone) is painted.
  cyclesByGroup[groupId] = syncGroupCyclePeriodBounds(year, group, groupCycles);
  return { ...withCycles, cyclesByGroup };
}

/** Map a calendar date to the salary month whose cutoff window contains it. */
export function salaryMonthForDate(
  dateKeyStr: string,
  year: number,
  groupCycles: Record<string, PayrollCycleDefinition>,
  group: PayrollGroupConfig = DEFAULT_PAYROLL_GROUP
): { year: number; month: number } {
  const d = dateKeyStr.slice(0, 10);
  const synced = syncGroupCyclePeriodBounds(year, group, groupCycles);
  for (let m = 0; m < 12; m++) {
    const month = `${year}-${String(m + 1).padStart(2, '0')}`;
    const cycle = synced[month];
    if (!cycle) continue;
    if (d >= cycle.periodStart.slice(0, 10) && d <= cycle.periodEnd.slice(0, 10)) {
      return { year, month: m + 1 };
    }
  }
  // Fallback: calendar month of the date.
  const parsed = new Date(`${d}T12:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
  }
  return { year, month: 1 };
}
