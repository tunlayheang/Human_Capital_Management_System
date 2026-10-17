import type {
  PayrollCalendarCycleConfig,
  PayrollCycleDefinition,
  PayrollGroupConfig,
} from './payrollCalendarCycleTypes.js';

type CalendarMigrateInput = {
  runDates?: string[];
  attendanceCutoffDates?: string[];
  defaultAttendanceCutoffDayOfMonth?: number;
  defaultRunDayOfMonth?: number;
  cycleConfig?: PayrollCalendarCycleConfig;
};

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
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
 * Example: June cutoff 25 + July cutoff 25 → July period 2026-06-26 → 2026-07-25.
 */
export function periodBoundsFromCutoffs(
  previousCutoffDate: string,
  attendanceCutoffDate: string
): { periodStart: string; periodEnd: string } {
  const cutoff = attendanceCutoffDate.slice(0, 10);
  const prev = previousCutoffDate.slice(0, 10);
  let periodStart = dayAfter(prev);
  if (periodStart > cutoff) {
    // Misconfigured cutoffs (e.g. moved earlier than previous) — fall back to same-day window.
    periodStart = cutoff;
  }
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
  legacy?: {
    cutoffDate?: string;
    calculationDate?: string;
    previousCutoffDate?: string;
  }
): PayrollCycleDefinition {
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

  const attendanceCutoffDate =
    legacy?.cutoffDate?.slice(0, 10) ??
    dateOnDay(year, monthIndex, group.defaultAttendanceCutoffDay);
  const previousCutoffDate =
    legacy?.previousCutoffDate?.slice(0, 10) ??
    defaultPreviousCutoffDate(year, monthIndex, group);
  const { periodStart, periodEnd } = periodBoundsFromCutoffs(
    previousCutoffDate,
    attendanceCutoffDate
  );

  const payrollCalculationDate =
    legacy?.calculationDate?.slice(0, 10) ??
    dateOnDay(year, monthIndex, group.defaultPayrollCalculationDay);
  const payrollApprovalDate = dateOnDay(year, monthIndex, group.defaultPayrollApprovalDay);
  const paymentDate = group.defaultPaymentDay
    ? dateOnDay(year, monthIndex, group.defaultPaymentDay)
    : dateOnDay(year, monthIndex, lastDayOfMonth(year, monthIndex));

  return {
    month,
    periodStart,
    periodEnd,
    attendanceCutoffDate,
    payrollCalculationDate,
    payrollApprovalDate,
    paymentDate,
  };
}

/** Recompute pay-period bounds from consecutive cutoff dates for a year's cycles. */
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
      next[month] ??
      buildMonthlyCycleForMonth(year, m, group, { previousCutoffDate: previousCutoff });
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

export function migrateLegacyCalendarToCycles(
  year: number,
  cal: CalendarMigrateInput
): PayrollCalendarCycleConfig {
  const parsed: PayrollCalendarCycleConfig = cal.cycleConfig
    ? {
        groups: cal.cycleConfig.groups?.length
          ? cal.cycleConfig.groups
          : [DEFAULT_PAYROLL_GROUP],
        cyclesByGroup: { ...(cal.cycleConfig.cyclesByGroup ?? {}) },
      }
    : {
        groups: [DEFAULT_PAYROLL_GROUP],
        cyclesByGroup: {},
      };
  const group =
    parsed.groups.find((g) => g.id === 'default') ??
    ({
      ...DEFAULT_PAYROLL_GROUP,
      defaultPayrollCalculationDay: cal.defaultRunDayOfMonth ?? 28,
    } as PayrollGroupConfig);

  if (!parsed.cyclesByGroup.default) parsed.cyclesByGroup.default = {};

  let previousCutoff = dateOnDay(year - 1, 11, group.defaultAttendanceCutoffDay);
  for (let m = 0; m < 12; m++) {
    const month = `${year}-${String(m + 1).padStart(2, '0')}`;
    const existing = parsed.cyclesByGroup.default[month];
    if (existing?.attendanceCutoffDate) {
      const cutoff = existing.attendanceCutoffDate.slice(0, 10);
      const { periodStart, periodEnd } = periodBoundsFromCutoffs(previousCutoff, cutoff);
      parsed.cyclesByGroup.default[month] = {
        ...existing,
        month,
        attendanceCutoffDate: cutoff,
        periodStart,
        periodEnd,
      };
      previousCutoff = cutoff;
      continue;
    }
    const cutoff =
      cal.attendanceCutoffDates?.[m] && String(cal.attendanceCutoffDates[m]).startsWith(month)
        ? String(cal.attendanceCutoffDates[m]).slice(0, 10)
        : cal.defaultAttendanceCutoffDayOfMonth
          ? dateOnDay(year, m, cal.defaultAttendanceCutoffDayOfMonth)
          : undefined;
    const calc =
      cal.runDates?.[m] && String(cal.runDates[m]).startsWith(month)
        ? String(cal.runDates[m]).slice(0, 10)
        : undefined;
    const built = buildMonthlyCycleForMonth(year, m, group, {
      cutoffDate: cutoff,
      calculationDate: calc,
      previousCutoffDate: previousCutoff,
    });
    parsed.cyclesByGroup.default[month] = built;
    previousCutoff = built.attendanceCutoffDate;
  }

  // Sync any other payroll groups the same way.
  for (const g of parsed.groups) {
    if (g.id === 'default') continue;
    const cycles = parsed.cyclesByGroup[g.id] ?? {};
    parsed.cyclesByGroup[g.id] = syncGroupCyclePeriodBounds(year, g, cycles);
  }

  return parsed;
}
