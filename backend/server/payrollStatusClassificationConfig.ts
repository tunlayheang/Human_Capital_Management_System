/**
 * Config-driven payroll classification for attendance statuses.
 *
 * Each attendance status maps to a payroll day category:
 *   - payable    : contributes to salary entitlement (e.g. PRESENT, LATE)
 *   - deductible : reduces salary (e.g. ABSENT, unapproved absence)
 *   - neutral    : excluded from the divisor entirely (e.g. DAY_OFF)
 *   - leave      : defer to the leave type's own paid/category configuration (ON_LEAVE)
 *
 * Defaults preserve historic behaviour. Overrides are stored in SystemSetting
 * under key `payroll.statusClassification` so future statuses (WFH, Business Trip,
 * Early Out, ...) only need a config entry, not a code change.
 */
import { SystemSetting } from './db.js';

export type PayrollDayCategory = 'payable' | 'deductible' | 'neutral';
export type AttendanceStatusCategory = PayrollDayCategory | 'leave';

export const STATUS_CLASSIFICATION_SETTING_KEY = 'payroll.statusClassification';

/** Default attendance-status -> payroll category map (uppercase status keys). */
export const DEFAULT_ATTENDANCE_STATUS_CATEGORY: Record<string, AttendanceStatusCategory> = {
  PRESENT: 'payable',
  LATE: 'payable',
  // Optional / future statuses — payable when produced by attendance.
  EARLY_OUT: 'payable',
  WFH: 'payable',
  WORK_FROM_HOME: 'payable',
  BUSINESS_TRIP: 'payable',
  PAID_BUSINESS_TRIP: 'payable',
  MISSION: 'payable',
  ABSENT: 'deductible',
  UNAPPROVED_ABSENCE: 'deductible',
  ON_LEAVE: 'leave',
  PAID_LEAVE: 'leave',
  UNPAID_LEAVE: 'leave',
  DAY_OFF: 'neutral',
  AWAITING: 'neutral',
  /** UI / legacy labels normalized to DAY_OFF in payrollAttendanceRecordService. */
  REST: 'neutral',
  HOLIDAY: 'neutral',
  PH: 'neutral',
};

let cache: Record<string, AttendanceStatusCategory> | null = null;
let cacheLoadedAt = 0;
const CACHE_MS = 60_000;

function isCategory(v: unknown): v is AttendanceStatusCategory {
  return v === 'payable' || v === 'deductible' || v === 'neutral' || v === 'leave';
}

function unwrap(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.parse(t);
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

/**
 * Load (and cache) the effective status -> category map, merging stored overrides
 * over the defaults. Safe to call repeatedly; the engine warms it once per run.
 */
export async function loadStatusClassificationConfig(): Promise<
  Record<string, AttendanceStatusCategory>
> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_MS) return cache;

  const merged: Record<string, AttendanceStatusCategory> = {
    ...DEFAULT_ATTENDANCE_STATUS_CATEGORY,
  };
  try {
    const row = await SystemSetting.findOne({
      where: { key: STATUS_CLASSIFICATION_SETTING_KEY },
    });
    const value = unwrap(row?.get('value'));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [status, category] of Object.entries(value as Record<string, unknown>)) {
        if (isCategory(category)) merged[String(status).toUpperCase()] = category;
      }
    }
  } catch {
    // Settings table not ready / not configured — defaults already applied.
  }

  cache = merged;
  cacheLoadedAt = now;
  return merged;
}

/** Synchronous lookup against the last-loaded config (falls back to defaults). */
export function getAttendanceStatusCategory(status: unknown): AttendanceStatusCategory {
  const key = String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const map = cache ?? DEFAULT_ATTENDANCE_STATUS_CATEGORY;
  return map[key] ?? 'deductible';
}

/** PRESENT/LATE-style statuses that count physical attendance for pay. */
export function isPayableAttendanceStatus(status: unknown): boolean {
  return getAttendanceStatusCategory(status) === 'payable';
}

/** Statuses that never participate in the divisor (rest days). */
export function isNeutralAttendanceStatus(status: unknown): boolean {
  return getAttendanceStatusCategory(status) === 'neutral';
}

/** Approved/planned leave or rest days are not unexcused absences for payroll. */
export function isExcusedAttendanceStatus(status: unknown): boolean {
  const cat = getAttendanceStatusCategory(status);
  return cat === 'neutral' || cat === 'leave';
}
