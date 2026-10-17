import { getPayrollCalendar, type PayrollCalendarConfig } from '../payrollCalendarService.js';
import { businessDateKey } from '../payrollRunNotificationService.js';
import { isAttendanceCutoffReached } from './payrollAttendanceCutoff.js';
import type {
  PayrollCalendarCycleConfig,
  PayrollCalendarMonthLock,
  PayrollCalendarMonthLocks,
  PayrollCalendarStatusSnapshot,
  PayrollCycleDefinition,
  PayrollGroupConfig,
  ResolvedPayrollCycle,
} from './payrollCalendarCycleTypes.js';
import { PayrollAttendancePeriod } from './payrollHybridSchema.js';
import {
  DEFAULT_PAYROLL_GROUP,
  buildMonthlyCycleForMonth,
  migrateLegacyCalendarToCycles,
  periodBoundsFromCutoffs,
  previousMonthKey,
  syncGroupCyclePeriodBounds,
} from './payrollCalendarMigrate.js';
import { findLockedPayrollRunForMonth } from './payrollPeriodFreezeService.js';

export {
  migrateLegacyCalendarToCycles,
  buildMonthlyCycleForMonth,
  periodBoundsFromCutoffs,
  previousMonthKey,
  syncGroupCyclePeriodBounds,
};

export function calendarIdForYear(year: number): string {
  return `pcal-${year}`;
}

export function cycleIdFor(year: number, month: string, groupId: string): string {
  return `pcycle-${year}-${month.slice(0, 7)}-${groupId}`;
}

function parseCycleConfig(raw: unknown): PayrollCalendarCycleConfig {
  if (raw == null || typeof raw !== 'object') {
    return { groups: [DEFAULT_PAYROLL_GROUP], cyclesByGroup: {} };
  }
  const o = raw as Record<string, unknown>;
  const groups = Array.isArray(o.groups)
    ? (o.groups as PayrollGroupConfig[]).filter((g) => g?.id && g?.name)
    : [DEFAULT_PAYROLL_GROUP];
  const cyclesByGroup =
    o.cyclesByGroup && typeof o.cyclesByGroup === 'object'
      ? (o.cyclesByGroup as Record<string, Record<string, PayrollCycleDefinition>>)
      : {};
  if (!groups.length) groups.push(DEFAULT_PAYROLL_GROUP);
  return { groups, cyclesByGroup };
}

export function attachCycleConfigToCalendar(
  year: number,
  cal: PayrollCalendarConfig
): PayrollCalendarConfig & { cycleConfig: PayrollCalendarCycleConfig } {
  const cycleConfig = migrateLegacyCalendarToCycles(year, cal);
  return { ...cal, cycleConfig };
}

export async function getPayrollCalendarWithCycles(year: number) {
  const cal = await getPayrollCalendar(year);
  return attachCycleConfigToCalendar(year, cal);
}

/** Read cutoff only — does not depend on previous-period bounds. */
export function resolveCycleCutoffDate(
  year: number,
  month: string,
  cal: PayrollCalendarConfig & { cycleConfig?: PayrollCalendarCycleConfig },
  payrollGroupId = 'default'
): string {
  const monthKey = month.slice(0, 7);
  const cycleConfig = cal.cycleConfig ?? migrateLegacyCalendarToCycles(year, cal);
  const group =
    cycleConfig.groups.find((g) => g.id === payrollGroupId) ??
    cycleConfig.groups[0] ??
    DEFAULT_PAYROLL_GROUP;
  const monthIndex = parseInt(monthKey.slice(5, 7), 10) - 1;
  const override = cycleConfig.cyclesByGroup[group.id]?.[monthKey];
  if (override?.attendanceCutoffDate) return override.attendanceCutoffDate.slice(0, 10);
  return buildMonthlyCycleForMonth(year, monthIndex, group, {
    cutoffDate: cal.attendanceCutoffDates?.[monthIndex],
    calculationDate: cal.runDates?.[monthIndex],
  }).attendanceCutoffDate;
}

export function resolvePayrollCycle(
  year: number,
  month: string,
  cal: PayrollCalendarConfig & { cycleConfig?: PayrollCalendarCycleConfig },
  payrollGroupId = 'default',
  previousCutoffDate?: string
): ResolvedPayrollCycle {
  const monthKey = month.slice(0, 7);
  const cycleConfig = cal.cycleConfig ?? migrateLegacyCalendarToCycles(year, cal);
  const group =
    cycleConfig.groups.find((g) => g.id === payrollGroupId) ??
    cycleConfig.groups[0] ??
    DEFAULT_PAYROLL_GROUP;
  const monthIndex = parseInt(monthKey.slice(5, 7), 10) - 1;

  const override = cycleConfig.cyclesByGroup[group.id]?.[monthKey];
  const cycle =
    override ??
    buildMonthlyCycleForMonth(year, monthIndex, group, {
      cutoffDate: cal.attendanceCutoffDates?.[monthIndex],
      calculationDate: cal.runDates?.[monthIndex],
      previousCutoffDate,
    });

  let previousCutoff = previousCutoffDate?.slice(0, 10);
  if (!previousCutoff) {
    const prevKey = previousMonthKey(monthKey);
    const prevYear = parseInt(prevKey.slice(0, 4), 10);
    if (prevYear === year) {
      previousCutoff = resolveCycleCutoffDate(year, prevKey, cal, group.id);
    }
  }

  const withBounds =
    previousCutoff != null
      ? {
          ...cycle,
          ...periodBoundsFromCutoffs(previousCutoff, cycle.attendanceCutoffDate),
        }
      : cycle;

  return {
    ...withBounds,
    cycleId: cycleIdFor(year, monthKey, group.id),
    calendarId: calendarIdForYear(year),
    year,
    payrollGroupId: group.id,
    payrollGroupName: group.name,
  };
}

/** Map a calendar date to the salary month whose cutoff window contains it. */
export async function resolveSalaryMonthForDate(
  dateKey: string,
  payrollGroupId = 'default'
): Promise<string> {
  const d = dateKey.slice(0, 10);
  const calMonth = d.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(calMonth)) return calMonth;

  const [y, m] = calMonth.split('-').map(Number);
  const nextMonth =
    m === 12
      ? `${y + 1}-01`
      : `${y}-${String(m + 1).padStart(2, '0')}`;
  const candidates = [previousMonthKey(calMonth), calMonth, nextMonth];

  for (const month of candidates) {
    try {
      const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
      if (d >= cycle.periodStart.slice(0, 10) && d <= cycle.periodEnd.slice(0, 10)) {
        return cycle.month;
      }
    } catch {
      // Missing calendar for adjacent year — try next candidate.
    }
  }
  return calMonth;
}

export async function resolvePayrollCycleForMonth(
  month: string,
  payrollGroupId = 'default'
): Promise<ResolvedPayrollCycle> {
  const monthKey = month.slice(0, 7);
  const year = parseInt(monthKey.slice(0, 4), 10);
  const cal = await getPayrollCalendarWithCycles(year);
  const prevKey = previousMonthKey(monthKey);
  const prevYear = parseInt(prevKey.slice(0, 4), 10);
  let previousCutoff: string | undefined;
  if (prevYear !== year) {
    const prevCal = await getPayrollCalendarWithCycles(prevYear);
    previousCutoff = resolveCycleCutoffDate(prevYear, prevKey, prevCal, payrollGroupId);
  }
  return resolvePayrollCycle(year, monthKey, cal, payrollGroupId, previousCutoff);
}

function daysBetween(fromKey: string, toKey: string): number {
  const a = new Date(`${fromKey}T12:00:00`);
  const b = new Date(`${toKey}T12:00:00`);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

export async function getAttendanceFreezeRow(month: string, payrollGroupId: string) {
  const monthKey = month.slice(0, 7);
  return PayrollAttendancePeriod.findOne({
    where: { month: monthKey, payrollGroupId },
  });
}

/**
 * Months whose payroll run is already approved/locked — milestone dates must stay fixed.
 * Scans each active group × 12 months via findLockedPayrollRunForMonth.
 */
export async function buildPayrollCalendarMonthLocks(
  year: number
): Promise<PayrollCalendarMonthLocks> {
  const cal = await getPayrollCalendarWithCycles(year);
  const cycleConfig = cal.cycleConfig!;
  const locks: PayrollCalendarMonthLocks = {};

  for (const group of cycleConfig.groups.filter((g) => g.active !== false)) {
    const rows: PayrollCalendarMonthLock[] = [];
    for (let m = 0; m < 12; m++) {
      const month = `${year}-${String(m + 1).padStart(2, '0')}`;
      const run = await findLockedPayrollRunForMonth(month, group.id);
      if (!run) continue;
      rows.push({
        month,
        status: String(run.status ?? 'APPROVED').toUpperCase(),
      });
    }
    locks[group.id] = rows;
  }

  return locks;
}

export async function buildPayrollCalendarStatus(
  year?: number
): Promise<PayrollCalendarStatusSnapshot> {
  const today = businessDateKey();
  const y = year ?? parseInt(today.slice(0, 4), 10);
  const cal = await getPayrollCalendarWithCycles(y);
  const cycleConfig = cal.cycleConfig!;

  const groups = await Promise.all(
    cycleConfig.groups.filter((g) => g.active !== false).map(async (group) => {
      let activeCycle: ResolvedPayrollCycle | null = null;
      let nextCycle: ResolvedPayrollCycle | null = null;

      for (let m = 0; m < 12; m++) {
        const month = `${y}-${String(m + 1).padStart(2, '0')}`;
        const cycle = await resolvePayrollCycleForMonth(month, group.id);
        if (today >= cycle.periodStart && today <= cycle.periodEnd) {
          activeCycle = cycle;
        }
        if (!nextCycle && today < cycle.periodStart) {
          nextCycle = cycle;
        }
      }
      if (!activeCycle) {
        activeCycle = await resolvePayrollCycleForMonth(today.slice(0, 7), group.id);
      }

      const row = await getAttendanceFreezeRow(activeCycle.month, group.id);
      const plain = row?.get({ plain: true }) as Record<string, unknown> | undefined;
      const status = String(plain?.status ?? 'OPEN') as 'OPEN' | 'FINALIZED' | 'LOCKED';
      const isAttendanceLocked = status === 'LOCKED' || status === 'FINALIZED';
      const isCutoffReached = isAttendanceCutoffReached(activeCycle.attendanceCutoffDate);

      return {
        groupId: group.id,
        groupName: group.name,
        activeCycle,
        nextCycle,
        attendanceStatus: status,
        attendanceFrozenAt: (plain?.finalizedAt as string) ?? null,
        freezeTrigger: (plain?.freezeTrigger as string) ?? null,
        daysUntilCutoff:
          today < activeCycle.attendanceCutoffDate
            ? daysBetween(today, activeCycle.attendanceCutoffDate)
            : 0,
        daysUntilCalculation:
          today < activeCycle.payrollCalculationDate
            ? daysBetween(today, activeCycle.payrollCalculationDate)
            : 0,
        isCutoffReached,
        isAttendanceLocked,
      };
    })
  );

  return {
    businessDate: today,
    calendarId: calendarIdForYear(y),
    year: y,
    groups,
  };
}

/** Cycles that should be auto-frozen when ICT midnight on the cutoff date has passed. */
export async function listCyclesDueForFreeze(now = new Date()): Promise<
  Array<{ cycle: ResolvedPayrollCycle; year: number }>
> {
  const dateKey = businessDateKey(now);
  const year = parseInt(dateKey.slice(0, 4), 10);
  const cal = await getPayrollCalendarWithCycles(year);
  if (cal.autoFreezeAttendanceOnCutoff === false) {
    return [];
  }
  const due: Array<{ cycle: ResolvedPayrollCycle; year: number }> = [];

  for (const group of cal.cycleConfig!.groups.filter((g) => g.active !== false)) {
    for (let m = 0; m < 12; m++) {
      const cycle = resolvePayrollCycle(year, `${year}-${String(m + 1).padStart(2, '0')}`, cal, group.id);
      if (!isAttendanceCutoffReached(cycle.attendanceCutoffDate, now)) continue;

      const row = await getAttendanceFreezeRow(cycle.month, group.id);
      const status = String(row?.get('status') ?? 'OPEN').toUpperCase();
      // Already frozen by HR or scheduler — do not re-lock or re-notify.
      if (status === 'LOCKED' || status === 'FINALIZED') continue;

      due.push({ cycle, year });
    }
  }

  return due;
}
