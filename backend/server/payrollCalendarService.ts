import { PayrollCalendar, SystemSetting } from './db.js';
import {
  buildOvertimeCalendarContext,
  type PayrollOvertimeCalendarContext,
} from './payrollOvertime.js';
import type { PayrollOtDayTier } from './payrollOvertime.js';
import type {
  PayrollCalendarCycleConfig,
  PayrollCycleDefinition,
} from './payroll/payrollCalendarCycleTypes.js';
import {
  migrateLegacyCalendarToCycles,
  syncGroupCyclePeriodBounds,
  DEFAULT_PAYROLL_GROUP,
  dateOnDay,
} from './payroll/payrollCalendarMigrate.js';
import {
  PayrollPeriodFrozenError,
} from './payroll/payrollPeriodFreezeService.js';

const CYCLE_MILESTONE_FIELDS: Array<keyof PayrollCycleDefinition> = [
  'attendanceCutoffDate',
  'payrollCalculationDate',
  'payrollApprovalDate',
  'paymentDate',
];

function cycleMilestoneSnapshot(cycle: PayrollCycleDefinition | undefined | null): string {
  if (!cycle) return '';
  return CYCLE_MILESTONE_FIELDS.map((f) => String(cycle[f] ?? '').slice(0, 10)).join('|');
}

/**
 * Reject edits to months with approved payroll; restore locked cycle rows from DB
 * so adjacent open-month edits cannot rewrite frozen cutoffs/bounds.
 */
async function mergeCycleConfigPreservingLockedMonths(
  year: number,
  existing: PayrollCalendarConfig,
  incoming: PayrollCalendarCycleConfig
): Promise<PayrollCalendarCycleConfig> {
  const { buildPayrollCalendarMonthLocks } = await import(
    './payroll/payrollCalendarCycleService.js'
  );
  const existingCycles = migrateLegacyCalendarToCycles(year, existing);
  const locks = await buildPayrollCalendarMonthLocks(year);
  const groups = incoming.groups?.length ? incoming.groups : existingCycles.groups;
  const cyclesByGroup: Record<string, Record<string, PayrollCycleDefinition>> = {
    ...(incoming.cyclesByGroup ?? {}),
  };

  for (const group of groups.filter((g) => g.active !== false)) {
    const groupId = group.id;
    const locked = locks[groupId] ?? [];
    if (!locked.length) continue;

    const existingGroup = existingCycles.cyclesByGroup[groupId] ?? {};
    const nextGroup = { ...(cyclesByGroup[groupId] ?? {}) };

    for (const { month, status } of locked) {
      const before = existingGroup[month];
      const after = nextGroup[month];
      if (
        before &&
        after &&
        cycleMilestoneSnapshot(before) !== cycleMilestoneSnapshot(after)
      ) {
        throw new PayrollPeriodFrozenError(
          `Payroll for ${month} is already approved (${status}). ` +
            'Cutoff, calculation, approval, and payment dates for this month cannot be changed.'
        );
      }
      // Also catch run that exists but client omitted the month entirely while changing neighbors.
      if (before) {
        nextGroup[month] = { ...before };
      }
    }
    cyclesByGroup[groupId] = nextGroup;
  }

  return { groups, cyclesByGroup };
}

export type PayrollCalendarConfig = {
  year: number;
  runDates: string[];
  /** Per-month attendance lock date for payroll (YYYY-MM-DD). Salary period runs day-after previous cutoff through this cutoff. */
  attendanceCutoffDates: string[];
  defaultAttendanceCutoffDayOfMonth?: number;
  otDayTiers: Record<string, PayrollOtDayTier>;
  defaultRunDayOfMonth: number;
  employerOtNote?: string;
  /** Enterprise cycle definitions (groups + per-month dates). */
  cycleConfig?: PayrollCalendarCycleConfig;
  /** When true, scheduler locks attendance on each month's cutoff date (default: true). */
  autoFreezeAttendanceOnCutoff?: boolean;
};

const DEFAULT_EMPLOYER_OT_NOTE =
  'Companies generally need approval from the Ministry of Labour for OT arrangements. Some newer regulations require advance submission through the labour management system (LACMS).';

function normalizeCalendarConfigRaw(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function parseConfig(raw: unknown): Omit<PayrollCalendarConfig, 'year'> {
  const o = normalizeCalendarConfigRaw(raw);
  if (!o) {
    return {
      runDates: [],
      attendanceCutoffDates: [],
      otDayTiers: {},
      defaultRunDayOfMonth: 28,
      autoFreezeAttendanceOnCutoff: true,
    };
  }
  const runDates = Array.isArray(o.runDates)
    ? o.runDates.map((d) => String(d).slice(0, 10)).filter(Boolean)
    : [];
  const attendanceCutoffDates = Array.isArray(o.attendanceCutoffDates)
    ? o.attendanceCutoffDates.map((d) => String(d).slice(0, 10)).filter(Boolean)
    : [];
  const defaultAttendanceCutoffDayOfMonth =
    Number(o.defaultAttendanceCutoffDayOfMonth) > 0
      ? Number(o.defaultAttendanceCutoffDayOfMonth)
      : undefined;
  const otDayTiers: Record<string, PayrollOtDayTier> = {};
  if (o.otDayTiers && typeof o.otDayTiers === 'object') {
    for (const [k, v] of Object.entries(o.otDayTiers as Record<string, string>)) {
      if (v === 'daytime_ot' || v === 'premium') otDayTiers[k.slice(0, 10)] = v;
    }
  }
  const defaultRunDayOfMonth =
    Number(o.defaultRunDayOfMonth) > 0 ? Number(o.defaultRunDayOfMonth) : 28;
  const autoFreezeAttendanceOnCutoff =
    o.autoFreezeAttendanceOnCutoff === false ? false : true;

  return {
    runDates: [...new Set(runDates)],
    attendanceCutoffDates: [...new Set(attendanceCutoffDates)],
    defaultAttendanceCutoffDayOfMonth,
    otDayTiers,
    defaultRunDayOfMonth,
    employerOtNote:
      typeof o.employerOtNote === 'string' ? o.employerOtNote : DEFAULT_EMPLOYER_OT_NOTE,
    autoFreezeAttendanceOnCutoff,
  };
}

async function getDefaultRunDayOfMonth(): Promise<number> {
  const paymentDay = await SystemSetting.findOne({ where: { key: 'payroll.paymentDay' } });
  const raw = paymentDay?.get('value');
  const n =
    typeof raw === 'number'
      ? raw
      : parseInt(String(raw ?? '28').replace(/"/g, ''), 10) || 28;
  return n > 0 && n <= 31 ? n : 28;
}

/** Seed run dates for each month when none saved yet. */
export function defaultRunDatesForYear(year: number, dayOfMonth: number): string[] {
  const dates: string[] = [];
  for (let m = 0; m < 12; m++) {
    const last = new Date(year, m + 1, 0).getDate();
    const d = Math.min(dayOfMonth, last);
    dates.push(`${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return dates;
}

export async function getPayrollCalendar(year: number): Promise<PayrollCalendarConfig> {
  const defaultDay = await getDefaultRunDayOfMonth();
  const row = await PayrollCalendar.findByPk(`pcal-${year}`);
  if (!row) {
    const empty: PayrollCalendarConfig = {
      year,
      runDates: defaultRunDatesForYear(year, defaultDay),
      attendanceCutoffDates: [],
      otDayTiers: {},
      defaultRunDayOfMonth: defaultDay,
      employerOtNote: DEFAULT_EMPLOYER_OT_NOTE,
      autoFreezeAttendanceOnCutoff: true,
    };
    empty.cycleConfig = migrateLegacyCalendarToCycles(year, empty);
    return empty;
  }
  const plain = row.get({ plain: true }) as { config?: unknown };
  const parsed = parseConfig(plain.config);
  const runDates =
    parsed.runDates.length > 0
      ? parsed.runDates
      : defaultRunDatesForYear(year, parsed.defaultRunDayOfMonth || defaultDay);
  const base: PayrollCalendarConfig = {
    year,
    ...parsed,
    runDates,
    defaultRunDayOfMonth: parsed.defaultRunDayOfMonth || defaultDay,
  };
  const rowConfig = normalizeCalendarConfigRaw(plain.config) ?? {};
  if (rowConfig.cycleConfig) {
    base.cycleConfig = rowConfig.cycleConfig as PayrollCalendarCycleConfig;
  }
  // Always sync cutoff-to-cutoff period windows (fills missing months + refreshes bounds).
  base.cycleConfig = migrateLegacyCalendarToCycles(year, base);
  return base;
}

export async function savePayrollCalendar(
  year: number,
  body: Partial<PayrollCalendarConfig>
): Promise<PayrollCalendarConfig> {
  const existing = await getPayrollCalendar(year);
  const runDates = Array.isArray(body.runDates)
    ? [...new Set(body.runDates.map((d) => String(d).slice(0, 10)).filter(Boolean))]
    : existing.runDates;
  const otDayTiers =
    body.otDayTiers && typeof body.otDayTiers === 'object'
      ? Object.fromEntries(
          Object.entries(body.otDayTiers).filter(
            ([, v]) => v === 'daytime_ot' || v === 'premium'
          )
        )
      : existing.otDayTiers;
  const defaultRunDayOfMonth =
    body.defaultRunDayOfMonth != null && body.defaultRunDayOfMonth > 0
      ? body.defaultRunDayOfMonth
      : existing.defaultRunDayOfMonth;
  const attendanceCutoffDates = Array.isArray(body.attendanceCutoffDates)
    ? [...new Set(body.attendanceCutoffDates.map((d) => String(d).slice(0, 10)).filter(Boolean))]
    : existing.attendanceCutoffDates ?? [];
  const defaultAttendanceCutoffDayOfMonth =
    body.defaultAttendanceCutoffDayOfMonth != null &&
    body.defaultAttendanceCutoffDayOfMonth > 0
      ? body.defaultAttendanceCutoffDayOfMonth
      : existing.defaultAttendanceCutoffDayOfMonth;

  let cycleConfig = body.cycleConfig ?? existing.cycleConfig;
  if (!cycleConfig) {
    cycleConfig = migrateLegacyCalendarToCycles(year, {
      ...existing,
      runDates,
      attendanceCutoffDates,
      defaultAttendanceCutoffDayOfMonth,
    });
  } else {
    cycleConfig = await mergeCycleConfigPreservingLockedMonths(year, existing, cycleConfig);

    // Always recompute pay-period windows from consecutive cutoffs so Month filter matches calendar.
    const groups = cycleConfig.groups?.length ? cycleConfig.groups : [DEFAULT_PAYROLL_GROUP];
    const cyclesByGroup = { ...(cycleConfig.cyclesByGroup ?? {}) };
    let previousYearDecemberCutoff: string | undefined;
    try {
      const prevCal = await getPayrollCalendar(year - 1);
      const prevCycle = prevCal.cycleConfig?.cyclesByGroup?.default?.[`${year - 1}-12`];
      previousYearDecemberCutoff =
        prevCycle?.attendanceCutoffDate?.slice(0, 10) ??
        prevCal.attendanceCutoffDates?.[11]?.slice(0, 10);
    } catch {
      previousYearDecemberCutoff = undefined;
    }
    for (const g of groups) {
      const group = g ?? DEFAULT_PAYROLL_GROUP;
      const fallbackPrev =
        previousYearDecemberCutoff ??
        dateOnDay(year - 1, 11, group.defaultAttendanceCutoffDay ?? 25);
      cyclesByGroup[group.id] = syncGroupCyclePeriodBounds(
        year,
        group,
        cyclesByGroup[group.id] ?? {},
        fallbackPrev
      );
    }

    // Re-apply locked month definitions after bound sync (neighbor cutoffs must not rewrite them).
    const { buildPayrollCalendarMonthLocks } = await import(
      './payroll/payrollCalendarCycleService.js'
    );
    const locks = await buildPayrollCalendarMonthLocks(year);
    const existingCycles = migrateLegacyCalendarToCycles(year, existing);
    for (const group of groups.filter((g) => g.active !== false)) {
      for (const { month } of locks[group.id] ?? []) {
        const frozen = existingCycles.cyclesByGroup[group.id]?.[month];
        if (frozen) {
          cyclesByGroup[group.id] = {
            ...(cyclesByGroup[group.id] ?? {}),
            [month]: { ...frozen },
          };
        }
      }
    }

    cycleConfig = { ...cycleConfig, groups, cyclesByGroup };
  }
  if (cycleConfig?.cyclesByGroup?.default) {
    const cutoffs: string[] = [];
    const runs: string[] = [];
    for (let m = 0; m < 12; m++) {
      const month = `${year}-${String(m + 1).padStart(2, '0')}`;
      const c = cycleConfig.cyclesByGroup.default[month];
      if (c) {
        cutoffs.push(c.attendanceCutoffDate);
        runs.push(c.payrollCalculationDate);
      }
    }
    if (cutoffs.length === 12) attendanceCutoffDates.splice(0, attendanceCutoffDates.length, ...cutoffs);
    if (runs.length === 12) runDates.splice(0, runDates.length, ...runs);
  }

  const autoFreezeAttendanceOnCutoff =
    body.autoFreezeAttendanceOnCutoff === false
      ? false
      : body.autoFreezeAttendanceOnCutoff === true
        ? true
        : existing.autoFreezeAttendanceOnCutoff !== false;

  const config = {
    runDates,
    attendanceCutoffDates,
    defaultAttendanceCutoffDayOfMonth,
    otDayTiers,
    defaultRunDayOfMonth,
    employerOtNote: body.employerOtNote ?? existing.employerOtNote ?? DEFAULT_EMPLOYER_OT_NOTE,
    cycleConfig,
    autoFreezeAttendanceOnCutoff,
  };

  await PayrollCalendar.upsert({
    id: `pcal-${year}`,
    year,
    config,
  });

  if (autoFreezeAttendanceOnCutoff) {
    try {
      const { runAttendanceFreezeJobDeduped } = await import(
        './payroll/attendanceFreezeScheduler.js'
      );
      const frozen = await runAttendanceFreezeJobDeduped();
      if (frozen > 0) {
        console.log(
          `[payroll] Auto-froze ${frozen} attendance period(s) after calendar save (auto-freeze on).`
        );
      }
    } catch (err) {
      console.warn(
        '[payroll] Could not run attendance auto-freeze after calendar save:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const { dispatchPayrollRunRemindersForDate, businessDateKey } = await import(
    './payrollRunNotificationService.js'
  );
  void dispatchPayrollRunRemindersForDate(businessDateKey()).catch((err) => {
    console.warn(
      '[payroll] Could not dispatch payroll run reminders after save:',
      err instanceof Error ? err.message : err
    );
  });

  return { year, ...config };
}

export async function getPayrollCalendarForMonth(
  year: number,
  monthNum: number
): Promise<PayrollCalendarConfig> {
  return getPayrollCalendar(year);
}

export async function ensurePayrollCalendarSchema(): Promise<void> {
  await PayrollCalendar.sync();
}

export async function getOvertimeCalendarContextForYear(
  year: number
): Promise<PayrollOvertimeCalendarContext> {
  const { getCambodiaPublicHolidays } = await import('./data/cambodiaPublicHolidays.js');
  const holidays = getCambodiaPublicHolidays(year).map((h) => String(h.date).slice(0, 10));
  const cal = await getPayrollCalendar(year);
  return buildOvertimeCalendarContext(year, holidays, cal.otDayTiers);
}
