import { roundLeaveDays, roundLeaveDaysToHalf } from './leaveBalanceCalc.js';
import {
  DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG,
  type JoinDateTier,
} from './annualLeaveAccrualConfig.js';

export type ProratedEntitlementOptions = {
  /** As-of date: entitlement is 0 until the join date. */
  asOfDate?: string | Date | null;
  monthlyRate?: number;
  joinDateTiers?: JoinDateTier[];
};

export function parseAccrualMonth(month: string): { year: number; monthNum: number } {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthNum = Number.parseInt(month.slice(5, 7), 10);
  return { year, monthNum };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Normalize DB/API join date to YYYY-MM-DD.
 * MySQL DATE / Sequelize often arrives as UTC midnight for that calendar day —
 * prefer UTC parts then, otherwise local calendar parts (avoids ISO shift in +07).
 */
export function normalizeJoinDateOnly(
  joinDate: string | Date | null | undefined
): string | null {
  if (joinDate == null || joinDate === '') return null;
  if (typeof joinDate === 'string') {
    const text = joinDate.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return formatJoinDateParts(parsed);
  }
  if (joinDate instanceof Date) {
    if (Number.isNaN(joinDate.getTime())) return null;
    return formatJoinDateParts(joinDate);
  }
  return null;
}

function formatJoinDateParts(d: Date): string {
  const utcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (utcMidnight) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function joinDateParts(
  joinDate: string | Date | null | undefined
): { year: number; monthNum: number; day: number } | null {
  const iso = normalizeJoinDateOnly(joinDate);
  if (!iso) return null;
  const raw = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(raw.getTime())) return null;
  return {
    year: raw.getUTCFullYear(),
    monthNum: raw.getUTCMonth() + 1,
    day: raw.getUTCDate(),
  };
}

/** First YYYY-MM in calendar `year` when monthly accrual may apply. */
export function firstAccrualMonthInYear(
  joinDate: string | Date | null | undefined,
  year: number
): string | null {
  const parts = joinDateParts(joinDate);
  if (!parts) return `${year}-01`;
  if (parts.year > year) return null;
  if (parts.year < year) return `${year}-01`;
  return `${year}-${String(parts.monthNum).padStart(2, '0')}`;
}

export function isAccrualMonthOnOrAfterJoin(
  joinDate: string | Date | null | undefined,
  accrualMonth: string
): boolean {
  const { year } = parseAccrualMonth(accrualMonth);
  const first = firstAccrualMonthInYear(joinDate, year);
  if (!first) return false;
  return accrualMonth >= first;
}

export function isJoinMonth(
  joinDate: string | Date | null | undefined,
  accrualMonth: string
): boolean {
  const parts = joinDateParts(joinDate);
  if (!parts) return false;
  const { year, monthNum } = parseAccrualMonth(accrualMonth);
  return parts.year === year && parts.monthNum === monthNum;
}

/** Local calendar date as YYYY-MM-DD (same basis as `currentAccrualMonth`). */
export function todayDateOnly(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Annual entitlement cap for mid-year joiners (join month through Dec).
 *
 * Join month uses Cambodian join-day tiers (1–9 → 1.5, 10–19 → 1.0, 20–end → 0.5);
 * later months use the standard monthly rate. Simple `months/12 × 18` is wrong because
 * it always credits a full month in the join month.
 *
 * When `asOfDate` is set, entitlement is 0 until the employee’s join date.
 */
export function proratedYearEntitlementDays(
  joinDate: string | Date | null | undefined,
  year: number,
  fullYearDays: number,
  asOfDateOrOptions?: string | Date | null | ProratedEntitlementOptions,
  maybeOptions?: ProratedEntitlementOptions
): number {
  if (fullYearDays <= 0) return 0;

  let asOfDate: string | Date | null | undefined;
  let options: ProratedEntitlementOptions | undefined;
  if (
    asOfDateOrOptions != null &&
    typeof asOfDateOrOptions === 'object' &&
    !(asOfDateOrOptions instanceof Date) &&
    ('monthlyRate' in asOfDateOrOptions ||
      'joinDateTiers' in asOfDateOrOptions ||
      'asOfDate' in asOfDateOrOptions)
  ) {
    options = asOfDateOrOptions;
    asOfDate = options.asOfDate;
  } else {
    asOfDate = asOfDateOrOptions as string | Date | null | undefined;
    options = maybeOptions;
  }

  const join = normalizeJoinDateOnly(joinDate);
  if (!join) return 0;
  if (asOfDate != null && asOfDate !== '') {
    const asOf = normalizeJoinDateOnly(asOfDate);
    if (asOf && join > asOf) return 0;
  }
  const parts = joinDateParts(join);
  if (!parts || parts.year < year) return roundLeaveDays(fullYearDays);
  if (parts.year > year) return 0;

  const monthlyRate =
    options?.monthlyRate != null && options.monthlyRate > 0
      ? options.monthlyRate
      : DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.monthlyRate;
  const joinDateTiers =
    options?.joinDateTiers && options.joinDateTiers.length > 0
      ? options.joinDateTiers
      : DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.joinDateTiers;

  // Sum tiered join-month + standard months through December (not months/12 × policy).
  const months = listEligibleAccrualMonths(join, year, `${year}-12`);
  let total = 0;
  for (const m of months) {
    total = roundLeaveDaysToHalf(
      total + accrualAmountForMonth(join, m, monthlyRate, joinDateTiers)
    );
  }
  if (fullYearDays > 0) total = Math.min(total, roundLeaveDays(fullYearDays));
  return roundLeaveDaysToHalf(total);
}

/** Whether `year` is the employee's join year (prorated cap applies). */
export function isJoinCalendarYear(
  joinDate: string | Date | null | undefined,
  year: number
): boolean {
  const parts = joinDateParts(joinDate);
  return parts != null && parts.year === year;
}

/**
 * Accrual for one calendar month.
 * Join month: tier by join day (0–9 → 1.5, 10–19 → 1, 20–end → 0.5).
 * Later months: standard monthly rate. Always snapped to 0.5-day steps.
 */
export function accrualAmountForMonth(
  joinDate: string | Date | null | undefined,
  accrualMonth: string,
  monthlyRate: number,
  joinDateTiers: JoinDateTier[]
): number {
  if (monthlyRate <= 0 || !isAccrualMonthOnOrAfterJoin(joinDate, accrualMonth)) return 0;

  if (isJoinMonth(joinDate, accrualMonth)) {
    const parts = joinDateParts(joinDate);
    if (!parts) return roundLeaveDaysToHalf(monthlyRate);
    for (const tier of joinDateTiers) {
      if (parts.day >= tier.from && parts.day <= tier.to) {
        return roundLeaveDaysToHalf(tier.accrual);
      }
    }
    return 0;
  }

  return roundLeaveDaysToHalf(monthlyRate);
}

export function listEligibleAccrualMonths(
  joinDate: string | Date | null | undefined,
  year: number,
  throughMonth: string
): string[] {
  const first = firstAccrualMonthInYear(joinDate, year);
  if (!first || throughMonth < first) return [];

  const throughYear = Number.parseInt(throughMonth.slice(0, 4), 10);
  const throughMonthNum = Number.parseInt(throughMonth.slice(5, 7), 10);
  if (throughYear < year) return [];

  const endMonth = throughYear === year ? throughMonthNum : 12;
  const startMonth = Number.parseInt(first.slice(5, 7), 10);
  const months: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

export function sumEligibleAccrualThroughMonth(
  joinDate: string | Date | null | undefined,
  year: number,
  throughMonth: string,
  monthlyRate: number,
  fullYearEntitlement: number,
  joinDateTiers: JoinDateTier[]
): { accrued: number; lastAccrualMonth: string | null } {
  const months = listEligibleAccrualMonths(joinDate, year, throughMonth);
  let accrued = 0;
  for (const m of months) {
    accrued = roundLeaveDaysToHalf(
      accrued + accrualAmountForMonth(joinDate, m, monthlyRate, joinDateTiers)
    );
  }
  const cap = proratedYearEntitlementDays(joinDate, year, fullYearEntitlement, {
    monthlyRate,
    joinDateTiers,
  });
  if (cap > 0) accrued = Math.min(accrued, cap);
  accrued = roundLeaveDaysToHalf(accrued);
  return {
    accrued,
    lastAccrualMonth: months.length ? months[months.length - 1]! : null,
  };
}

export function resolveAppliedTierForMonth(
  joinDate: string | Date | null | undefined,
  accrualMonth: string,
  joinDateTiers: JoinDateTier[]
): string {
  if (!isJoinMonth(joinDate, accrualMonth)) return 'standard';
  const parts = joinDateParts(joinDate);
  if (!parts) return 'standard';
  for (const tier of joinDateTiers) {
    if (parts.day >= tier.from && parts.day <= tier.to) {
      return `${tier.from}-${tier.to}`;
    }
  }
  return 'none';
}

export function isLastDayOfMonth(d = new Date()): boolean {
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return tomorrow.getMonth() !== d.getMonth();
}

export function previousAccrualMonth(d = new Date()): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

export function currentAccrualMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
