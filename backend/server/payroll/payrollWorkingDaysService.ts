/**
 * Calendar-driven payroll working days — scheduled_shift_days uses Planning roster cells.
 * Excludes Day off and Holiday cells; planned leave (AL/SL/…) still counts. Weekly fixed
 * roster off is not subtracted under scheduled_shift_days (only under working_days).
 * Historical payslips keep stored breakdown snapshots (no automatic recalculation).
 */
import { SystemSetting } from '../db.js';
import { getCambodiaPublicHolidays } from '../data/cambodiaPublicHolidays.js';
import { getEmployeeOffDatesForMonth } from '../employeeRosterOffDaysService.js';
import { findActivePlanningRostersForMonth } from '../planningRosterMonthQuery.js';
import { fetchPlanningRosterEntriesMap } from '../monthlyPlanningRosterService.js';
import {
  dateKeyFromYmd,
  isPlanningRosterNonWorkingEntry,
  isRosterHoliday,
  isRosterScheduledOffDay,
  parseMonthPrefix,
} from '../rosterOffDays.js';
import type { ProrationMethod } from './prorationConfigService.js';
import { LEGACY_WORK_DAYS_PER_MONTH } from './payrollPeriodService.js';
import { toDateKey } from './dateKey.js';

export const PAYROLL_CALCULATION_ENGINE_VERSION = 'calendar_v2';

export type PayrollWorkingDaysAudit = {
  engineVersion: typeof PAYROLL_CALCULATION_ENGINE_VERSION;
  payrollPeriodStart: string;
  payrollPeriodEnd: string;
  totalCalendarDays: number;
  totalScheduledWorkingDays: number;
  eligibleWorkingDays: number;
  calculationMethod: ProrationMethod;
  dailyRateDivisor: number;
  /** Contractual payroll divisor (22/24/26) when not using roster-based payroll. */
  payrollBasisDays?: number;
  payrollWorkDayMethod?: string;
  dailyRateSource?: 'employee_basis' | 'company_basis' | 'roster' | 'legacy';
  prorationFactor: number;
  payrollProcessingType: 'MONTHLY' | 'FINAL_SETTLEMENT';
  publicHolidayDates: string[];
  companyWorkingWeekdays: number[];
  usedLegacyFallback: boolean;
  /** True when days were derived from monthly planning roster cells. */
  rosterBased: boolean;
  planningNonWorkingDaysInPeriod: number;
};

export type PayrollPeriodWorkingDaysContext = {
  publicHolidayDates: Set<string>;
  companyWorkingWeekdays: Set<number>;
};

/** Per-employee schedule from Planning roster + fixed weekly roster. */
export type EmployeeRosterSchedule = {
  /** Any saved planning cell (day off, leave, holiday) — working cells are not stored. */
  planningNonWorkingDates: Set<string>;
  /** Planning roster "Day off" cells — excluded from payroll work days. */
  planningDayOffDates: Set<string>;
  /** Planning roster "Holiday" cells — excluded from payroll work days (staffing rest, not paid divisor days). */
  planningHolidayDates: Set<string>;
  /** Weekly off + planning day-off + roster exceptions (used for working_days method only). */
  rosterOffDates: Set<string>;
  /** This employee has at least one non-working planning cell in the pay period. */
  hasPlanningEntriesInPeriod: boolean;
  /** An active monthly Planning roster exists for each month overlapping the period. */
  hasActivePlanningRosterInPeriod: boolean;
};

function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function eachDateInRange(start: string, end: string, fn: (dateKey: string) => void): void {
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (b < a) return;
  const cur = new Date(a);
  while (cur <= b) {
    fn(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    );
    cur.setDate(cur.getDate() + 1);
  }
}

function daysInclusive(start: string, end: string): number {
  const a = parseYmd(start).getTime();
  const b = parseYmd(end).getTime();
  if (b < a) return 0;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

function monthPrefixesBetween(from: string, to: string): string[] {
  const [y0, m0] = from.slice(0, 7).split('-').map(Number);
  const [y1, m1] = to.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  let y = y0;
  let m = m0;
  while (y * 12 + m <= y1 * 12 + m1) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** ISO weekday 1=Mon..7=Sun → JS Date.getDay() 0=Sun..6=Sat */
function isoWeekdayToJs(iso: number): number {
  if (iso === 7) return 0;
  if (iso >= 1 && iso <= 6) return iso;
  return iso;
}

function unwrapSettingValue(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return JSON.parse(t);
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

/** Company default working weekdays from system settings (Mon–Fri). */
export async function loadCompanyWorkingWeekdays(): Promise<Set<number>> {
  const row = await SystemSetting.findOne({ where: { key: 'workingHours.workingDays' } });
  const raw = unwrapSettingValue(row?.get('value'));
  const weekdays = new Set<number>();
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const iso = Number(v);
      if (Number.isFinite(iso) && iso >= 1 && iso <= 7) weekdays.add(isoWeekdayToJs(iso));
    }
  }
  if (!weekdays.size) {
    for (let d = 1; d <= 5; d++) weekdays.add(d);
  }
  return weekdays;
}

/** Public holidays overlapping [periodStart, periodEnd]. */
export function publicHolidaysInRange(periodStart: string, periodEnd: string): Set<string> {
  const from = periodStart.slice(0, 10);
  const to = periodEnd.slice(0, 10);
  const years = new Set<number>();
  for (const mp of monthPrefixesBetween(from, to)) {
    years.add(parseInt(mp.slice(0, 4), 10));
  }
  const dates = new Set<string>();
  for (const year of years) {
    for (const h of getCambodiaPublicHolidays(year)) {
      const d = String(h.date).slice(0, 10);
      if (d >= from && d <= to) dates.add(d);
    }
  }
  return dates;
}

export async function buildPayrollPeriodWorkingDaysContext(
  periodStart: string,
  periodEnd: string
): Promise<PayrollPeriodWorkingDaysContext> {
  const [companyWorkingWeekdays, publicHolidayDates] = await Promise.all([
    loadCompanyWorkingWeekdays(),
    Promise.resolve(publicHolidaysInRange(periodStart, periodEnd)),
  ]);
  return { companyWorkingWeekdays, publicHolidayDates };
}

function matchesEmployeeId(
  entryEmployeeId: string,
  employeeId: string | null | undefined,
  userId: string | null | undefined,
  employeeDisplayId: string | null | undefined
): boolean {
  const eid = String(entryEmployeeId || '').trim();
  if (!eid) return false;
  if (employeeId && eid === employeeId) return true;
  if (employeeDisplayId && eid === employeeDisplayId) return true;
  if (userId && eid === userId) return true;
  return false;
}

/**
 * Build per-employee schedule: Planning roster marks non-working days; unset cells are working.
 */
export async function buildEmployeeRosterSchedule(params: {
  employeeId?: string | null;
  userId?: string | null;
  employeeDisplayId?: string | null;
  periodStart: string;
  periodEnd: string;
}): Promise<EmployeeRosterSchedule> {
  const from = params.periodStart.slice(0, 10);
  const to = params.periodEnd.slice(0, 10);
  const planningNonWorkingDates = new Set<string>();
  const planningDayOffDates = new Set<string>();
  const planningHolidayDates = new Set<string>();
  const rosterOffDates = new Set<string>();
  let hasPlanningEntriesInPeriod = false;
  let hasActivePlanningRosterInPeriod = false;

  for (const monthPrefix of monthPrefixesBetween(from, to)) {
    const monthOff = await getEmployeeOffDatesForMonth({
      employeeId: params.employeeId,
      userId: params.userId,
      employeeDisplayId: params.employeeDisplayId,
      month: monthPrefix,
    });
    monthOff.forEach((d) => {
      if (d >= from && d <= to) rosterOffDates.add(d);
    });

    const { year, monthIndex } = parseMonthPrefix(monthPrefix);
    const planningRows = await findActivePlanningRostersForMonth(year, monthIndex);
    if (planningRows.length > 0) hasActivePlanningRosterInPeriod = true;
    const entryMap = await fetchPlanningRosterEntriesMap(
      planningRows.map((r) => String(r.get('id')))
    );
    for (const row of planningRows) {
      const rid = String(row.get('id'));
      for (const ent of entryMap.get(rid) ?? []) {
        if (
          !matchesEmployeeId(
            ent.employeeId,
            params.employeeId,
            params.userId,
            params.employeeDisplayId
          )
        ) {
          continue;
        }
        const key = dateKeyFromYmd(year, monthIndex, ent.day);
        if (key < from || key > to) continue;
        if (!isPlanningRosterNonWorkingEntry(ent.leaveType)) continue;
        planningNonWorkingDates.add(key);
        if (isRosterScheduledOffDay(ent.leaveType)) planningDayOffDates.add(key);
        if (isRosterHoliday(ent.leaveType)) planningHolidayDates.add(key);
        hasPlanningEntriesInPeriod = true;
      }
    }
  }

  return {
    planningNonWorkingDates,
    planningDayOffDates,
    planningHolidayDates,
    rosterOffDates,
    hasPlanningEntriesInPeriod,
    hasActivePlanningRosterInPeriod,
  };
}

/**
 * Payroll "work days" from Planning roster (scheduled_shift_days):
 * calendar days minus Day off and Holiday cells. Planned leave (AL/SL/…) still counts.
 */
export function countPlanningRosterWorkDaysInRange(params: {
  periodStart: string;
  periodEnd: string;
  windowStart: string;
  windowEnd: string;
  rosterSchedule: EmployeeRosterSchedule;
  method: ProrationMethod;
  periodContext: PayrollPeriodWorkingDaysContext;
}): { total: number; eligible: number; rosterPublished: boolean } {
  const periodStart = params.periodStart.slice(0, 10);
  const periodEnd = params.periodEnd.slice(0, 10);
  const windowStart = params.windowStart.slice(0, 10);
  const windowEnd = params.windowEnd.slice(0, 10);
  const rosterPublished = params.rosterSchedule.hasActivePlanningRosterInPeriod;

  if (params.method === 'calendar_days') {
    const total = daysInclusive(periodStart, periodEnd);
    const eligStart = windowStart > periodStart ? windowStart : periodStart;
    const eligEnd = windowEnd < periodEnd ? windowEnd : periodEnd;
    const eligible =
      eligEnd >= eligStart ? daysInclusive(eligStart, eligEnd) : 0;
    return { total, eligible, rosterPublished };
  }

  if (params.method === 'scheduled_shift_days') {
    if (!rosterPublished) {
      return { total: 0, eligible: 0, rosterPublished: false };
    }
    let total = 0;
    let eligible = 0;
    eachDateInRange(periodStart, periodEnd, (d) => {
      if (params.rosterSchedule.planningDayOffDates.has(d)) return;
      if (params.rosterSchedule.planningHolidayDates.has(d)) return;
      total += 1;
      if (d >= windowStart && d <= windowEnd) eligible += 1;
    });
    return { total, eligible, rosterPublished: true };
  }

  let total = 0;
  let eligible = 0;
  eachDateInRange(periodStart, periodEnd, (d) => {
    if (params.rosterSchedule.planningDayOffDates.has(d)) return;
    if (params.rosterSchedule.planningHolidayDates.has(d)) return;
    if (params.rosterSchedule.rosterOffDates.has(d)) return;
    const dow = parseYmd(d).getDay();
    if (!params.periodContext.companyWorkingWeekdays.has(dow)) return;
    total += 1;
    if (d >= windowStart && d <= windowEnd) eligible += 1;
  });
  return { total, eligible, rosterPublished };
}

/**
 * Scheduled working day for payroll.
 * - scheduled_shift_days: active Planning roster — calendar days minus Day off and Holiday.
 * - working_days: company weekdays minus weekly roster off, Day off, and Holiday.
 */
export function isEmployeeScheduledWorkingDay(
  dateKey: string,
  ctx: PayrollPeriodWorkingDaysContext,
  roster: EmployeeRosterSchedule,
  method: ProrationMethod
): boolean {
  if (method === 'scheduled_shift_days') {
    if (!roster.hasActivePlanningRosterInPeriod) return false;
    if (roster.planningDayOffDates.has(dateKey)) return false;
    if (roster.planningHolidayDates.has(dateKey)) return false;
    return true;
  }

  if (method === 'calendar_days') return true;

  if (roster.planningDayOffDates.has(dateKey)) return false;
  if (roster.planningHolidayDates.has(dateKey)) return false;
  if (roster.rosterOffDates.has(dateKey)) return false;

  const dow = parseYmd(dateKey).getDay();
  return ctx.companyWorkingWeekdays.has(dow);
}

export function countScheduledWorkingDays(params: {
  periodStart: string;
  periodEnd: string;
  windowStart: string;
  windowEnd: string;
  method: ProrationMethod;
  periodContext: PayrollPeriodWorkingDaysContext;
  rosterSchedule: EmployeeRosterSchedule;
}): { total: number; eligible: number } {
  const periodStart = params.periodStart.slice(0, 10);
  const periodEnd = params.periodEnd.slice(0, 10);
  const windowStart = params.windowStart.slice(0, 10);
  const windowEnd = params.windowEnd.slice(0, 10);

  return countPlanningRosterWorkDaysInRange({
    periodStart,
    periodEnd,
    windowStart,
    windowEnd,
    rosterSchedule: params.rosterSchedule,
    method: params.method,
    periodContext: params.periodContext,
  });
}

/** ICT dates that are scheduled working days inside the employment window (for attendance metrics). */
export function listEligibleScheduledWorkingDays(params: {
  periodStart: string;
  periodEnd: string;
  windowStart: string;
  windowEnd: string;
  method: ProrationMethod;
  periodContext: PayrollPeriodWorkingDaysContext;
  rosterSchedule: EmployeeRosterSchedule;
}): string[] {
  const periodStart = params.periodStart.slice(0, 10);
  const periodEnd = params.periodEnd.slice(0, 10);
  const windowStart = params.windowStart.slice(0, 10);
  const windowEnd = params.windowEnd.slice(0, 10);
  const out: string[] = [];
  eachDateInRange(periodStart, periodEnd, (d) => {
    if (d < windowStart || d > windowEnd) return;
    if (
      isEmployeeScheduledWorkingDay(
        d,
        params.periodContext,
        params.rosterSchedule,
        params.method
      )
    ) {
      out.push(d);
    }
  });
  return out;
}

export type ResolvePayrollWorkingDaysParams = {
  periodStart: string;
  periodEnd: string;
  method: ProrationMethod;
  periodContext: PayrollPeriodWorkingDaysContext;
  rosterSchedule: EmployeeRosterSchedule;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  terminationDate?: unknown;
  legacyFallbackDays?: number;
  payrollProcessingType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
};

/** Employment window within pay period for proration eligibility. */
export function resolveEmploymentWindow(params: {
  periodStart: string;
  periodEnd: string;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  terminationDate?: unknown;
}): {
  effectiveStart: string;
  effectiveEnd: string;
  reason: string | null;
  notEmployed: boolean;
} {
  const periodStart = toDateKey(params.periodStart) ?? params.periodStart.slice(0, 10);
  const periodEnd = toDateKey(params.periodEnd) ?? params.periodEnd.slice(0, 10);
  let effectiveStart = periodStart;
  let effectiveEnd = periodEnd;
  const reasons: string[] = [];

  const join = toDateKey(params.joinDate);
  if (join) {
    if (join > effectiveStart && join <= effectiveEnd) {
      effectiveStart = join;
      reasons.push('mid_month_join');
    } else if (join > effectiveEnd) {
      return {
        effectiveStart,
        effectiveEnd,
        reason: 'not_yet_joined',
        notEmployed: true,
      };
    }
  }

  const boundary = toDateKey(params.lastWorkingDate) ?? toDateKey(params.terminationDate);
  if (boundary) {
    if (boundary < effectiveEnd && boundary >= effectiveStart) {
      effectiveEnd = boundary;
      reasons.push(params.lastWorkingDate ? 'last_working_date' : 'mid_month_resign');
    } else if (boundary < effectiveStart) {
      return {
        effectiveStart,
        effectiveEnd,
        reason: 'terminated_before_period',
        notEmployed: true,
      };
    }
  }

  return {
    effectiveStart,
    effectiveEnd,
    reason: reasons.length ? reasons.join(',') : null,
    notEmployed: false,
  };
}

export function resolvePayrollWorkingDays(
  params: ResolvePayrollWorkingDaysParams
): PayrollWorkingDaysAudit & { prorationReason: string | null; notEmployed: boolean } {
  const periodStart = params.periodStart.slice(0, 10);
  const periodEnd = params.periodEnd.slice(0, 10);
  const employment = resolveEmploymentWindow({
    periodStart,
    periodEnd,
    joinDate: params.joinDate,
    lastWorkingDate: params.lastWorkingDate,
    terminationDate: params.terminationDate,
  });

  const payrollProcessingType = params.payrollProcessingType ?? 'MONTHLY';
  const legacyFallback = params.legacyFallbackDays ?? LEGACY_WORK_DAYS_PER_MONTH;
  const rosterBased =
    params.method === 'scheduled_shift_days'
      ? params.rosterSchedule.hasActivePlanningRosterInPeriod
      : params.rosterSchedule.hasPlanningEntriesInPeriod;

  let planningNonWorkingDaysInPeriod = 0;
  eachDateInRange(periodStart, periodEnd, (d) => {
    if (params.rosterSchedule.planningNonWorkingDates.has(d)) planningNonWorkingDaysInPeriod += 1;
  });

  if (employment.notEmployed) {
    return {
      engineVersion: PAYROLL_CALCULATION_ENGINE_VERSION,
      payrollPeriodStart: periodStart,
      payrollPeriodEnd: periodEnd,
      totalCalendarDays: daysInclusive(periodStart, periodEnd),
      totalScheduledWorkingDays: 0,
      eligibleWorkingDays: 0,
      calculationMethod: params.method,
      dailyRateDivisor: legacyFallback,
      prorationFactor: 0,
      payrollProcessingType,
      publicHolidayDates: [...params.periodContext.publicHolidayDates].sort(),
      companyWorkingWeekdays: [...params.periodContext.companyWorkingWeekdays].sort(
        (a, b) => a - b
      ),
      usedLegacyFallback: true,
      rosterBased,
      planningNonWorkingDaysInPeriod,
      prorationReason: employment.reason,
      notEmployed: true,
    };
  }

  const counts = countPlanningRosterWorkDaysInRange({
    periodStart,
    periodEnd,
    windowStart: employment.effectiveStart,
    windowEnd: employment.effectiveEnd,
    rosterSchedule: params.rosterSchedule,
    method: params.method,
    periodContext: params.periodContext,
  });

  let totalScheduledWorkingDays = counts.total;
  let eligibleWorkingDays = counts.eligible;
  let usedLegacyFallback = false;

  if (
    params.method === 'scheduled_shift_days' &&
    !counts.rosterPublished
  ) {
    usedLegacyFallback = true;
    totalScheduledWorkingDays = legacyFallback;
    eligibleWorkingDays = 0;
  } else if (totalScheduledWorkingDays <= 0 && params.method !== 'calendar_days') {
    usedLegacyFallback = true;
    if (params.method !== 'scheduled_shift_days') {
      totalScheduledWorkingDays = legacyFallback;
      eligibleWorkingDays = 0;
    }
  }

  const prorationFactor =
    totalScheduledWorkingDays > 0
      ? Math.min(
          1,
          Math.round((eligibleWorkingDays / totalScheduledWorkingDays) * 10000) / 10000
        )
      : 0;

  return {
    engineVersion: PAYROLL_CALCULATION_ENGINE_VERSION,
    payrollPeriodStart: periodStart,
    payrollPeriodEnd: periodEnd,
    totalCalendarDays: daysInclusive(periodStart, periodEnd),
    totalScheduledWorkingDays,
    eligibleWorkingDays,
    calculationMethod: params.method,
    dailyRateDivisor: totalScheduledWorkingDays > 0 ? totalScheduledWorkingDays : legacyFallback,
    prorationFactor,
    payrollProcessingType,
    publicHolidayDates: [...params.periodContext.publicHolidayDates].sort(),
    companyWorkingWeekdays: [...params.periodContext.companyWorkingWeekdays].sort((a, b) => a - b),
    usedLegacyFallback,
    rosterBased,
    planningNonWorkingDaysInPeriod,
    prorationReason: employment.reason,
    notEmployed: false,
  };
}

export async function resolvePayrollWorkingDaysForEmployee(params: {
  periodStart: string;
  periodEnd: string;
  method: ProrationMethod;
  periodContext: PayrollPeriodWorkingDaysContext;
  employeeId?: string | null;
  userId?: string | null;
  employeeDisplayId?: string | null;
  joinDate?: unknown;
  lastWorkingDate?: unknown;
  terminationDate?: unknown;
  legacyFallbackDays?: number;
  payrollProcessingType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
}): Promise<
  PayrollWorkingDaysAudit & {
    prorationReason: string | null;
    notEmployed: boolean;
    eligibleScheduledDates: string[];
    planningDayOffDates: string[];
  }
> {
  const periodStart = params.periodStart.slice(0, 10);
  const periodEnd = params.periodEnd.slice(0, 10);
  const rosterSchedule = await buildEmployeeRosterSchedule({
    employeeId: params.employeeId,
    userId: params.userId,
    employeeDisplayId: params.employeeDisplayId,
    periodStart,
    periodEnd,
  });

  const employment = resolveEmploymentWindow({
    periodStart,
    periodEnd,
    joinDate: params.joinDate,
    lastWorkingDate: params.lastWorkingDate,
    terminationDate: params.terminationDate,
  });

  const audit = resolvePayrollWorkingDays({
    periodStart,
    periodEnd,
    method: params.method,
    periodContext: params.periodContext,
    rosterSchedule,
    joinDate: params.joinDate,
    lastWorkingDate: params.lastWorkingDate,
    terminationDate: params.terminationDate,
    legacyFallbackDays: params.legacyFallbackDays,
    payrollProcessingType: params.payrollProcessingType,
  });

  const eligibleScheduledDates = employment.notEmployed
    ? []
    : listEligibleScheduledWorkingDays({
        periodStart,
        periodEnd,
        windowStart: employment.effectiveStart,
        windowEnd: employment.effectiveEnd,
        method: params.method,
        periodContext: params.periodContext,
        rosterSchedule,
      });

  return {
    ...audit,
    eligibleScheduledDates,
    planningDayOffDates: [...rosterSchedule.planningDayOffDates],
    planningHolidayDates: [...rosterSchedule.planningHolidayDates],
  };
}
