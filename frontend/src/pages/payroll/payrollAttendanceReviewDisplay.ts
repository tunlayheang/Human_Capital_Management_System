import type { SalaryBreakdown } from '../../types';
import { attendanceStatusLabel } from '../../utils/attendanceStatusLabels';

export type AttendanceReviewStatusEntry = {
  status: string;
  count: number;
  label: string;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
};

/** Preferred display order for attendance review chips. */
const REVIEW_STATUS_ORDER = [
  'DAY_OFF',
  'UNAPPROVED_ABSENCE',
  'LATE',
  'UNPAID_LEAVE',
  'PAID_LEAVE',
  'ON_LEAVE',
  'EARLY_OUT',
  'WFH',
  'WORK_FROM_HOME',
  'BUSINESS_TRIP',
  'PAID_BUSINESS_TRIP',
] as const;

/** Statuses excluded from the payroll review column (shown elsewhere or not actionable here). */
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'REST', 'HOLIDAY']);

function normalizeStatusKey(status: string): string {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function toneForStatus(status: string): AttendanceReviewStatusEntry['tone'] {
  const st = normalizeStatusKey(status);
  if (st === 'UNAPPROVED_ABSENCE') return 'danger';
  if (st === 'LATE' || st === 'UNPAID_LEAVE') return 'warning';
  if (st === 'PAID_LEAVE' || st === 'ON_LEAVE' || st === 'PH' || st === 'MISSION') return 'info';
  if (st === 'DAY_OFF') return 'neutral';
  return 'neutral';
}

/** Full status histogram from engine (preferred) or attendance summary fallback. */
export function resolveAttendanceBreakdown(
  breakdown: SalaryBreakdown | undefined
): Record<string, number> {
  const fromEngine = breakdown?.hybrid?.dayClassification?.attendanceBreakdown;
  if (fromEngine && Object.keys(fromEngine).length > 0) {
    const out: Record<string, number> = {};
    for (const [raw, count] of Object.entries(fromEngine)) {
      const n = Math.max(0, Math.round(Number(count) || 0));
      if (n <= 0) continue;
      out[normalizeStatusKey(raw)] = n;
    }
    return out;
  }

  const summary = breakdown?.attendanceSummary;
  const fallback: Record<string, number> = {};
  if (summary?.presentDays && summary.presentDays > 0) fallback.PRESENT = summary.presentDays;
  if (summary?.paidLeaveDays && summary.paidLeaveDays > 0) {
    fallback.PAID_LEAVE = summary.paidLeaveDays;
  }
  if (summary?.unpaidLeaveDays && summary.unpaidLeaveDays > 0) {
    fallback.UNPAID_LEAVE = summary.unpaidLeaveDays;
  }
  if (summary?.absentDays && summary.absentDays > 0) {
    fallback.ABSENT = summary.absentDays;
  }
  if (summary?.lateCount && summary.lateCount > 0) fallback.LATE = summary.lateCount;
  return fallback;
}

function reviewStatusSortRank(status: string): number {
  const idx = REVIEW_STATUS_ORDER.indexOf(status as (typeof REVIEW_STATUS_ORDER)[number]);
  return idx >= 0 ? idx : REVIEW_STATUS_ORDER.length + status.charCodeAt(0);
}

/** Attendance statuses that need payroll/HR review for the period. */
export function getAttendanceReviewStatusEntries(
  breakdown: SalaryBreakdown | undefined
): AttendanceReviewStatusEntry[] {
  const map = resolveAttendanceBreakdown(breakdown);
  const entries: AttendanceReviewStatusEntry[] = [];

  for (const [raw, count] of Object.entries(map)) {
    const key = normalizeStatusKey(raw);
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n <= 0 || SKIP_STATUSES.has(key)) continue;
    entries.push({
      status: key,
      count: n,
      label: attendanceStatusLabel(key),
      tone: toneForStatus(key),
    });
  }

  entries.sort(
    (a, b) =>
      reviewStatusSortRank(a.status) - reviewStatusSortRank(b.status) ||
      a.label.localeCompare(b.label)
  );

  return entries;
}

export function formatAttendanceReviewSummary(entries: AttendanceReviewStatusEntry[]): string {
  if (!entries.length) return 'No attendance items flagged for review';
  return entries.map((e) => `${e.label}: ${e.count}`).join(' · ');
}
