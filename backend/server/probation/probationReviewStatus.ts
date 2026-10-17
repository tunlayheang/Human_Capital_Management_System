import { addCalendarDays, formatDateOnly, parseDateOnly } from '../probationService.js';
import type { ProbationReviewStatus } from './probationReviewTypes.js';

export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseDateOnly(fromIso);
  const to = parseDateOnly(toIso);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export function effectiveProbationReviewDate(input: {
  probationEnd: string;
  nextReviewDate?: string | null;
}): string {
  const next = formatDateOnly(input.nextReviewDate);
  if (next) return next;
  return input.probationEnd;
}

export function deriveProbationReviewStatus(input: {
  today: string;
  probationEnd: string;
  nextReviewDate?: string | null;
  probationConfirmedAt?: string | null;
  lastReviewStatus?: string | null;
  hasOpenDraft?: boolean;
}): { status: ProbationReviewStatus; daysRemaining: number; overdue: boolean } {
  if (input.probationConfirmedAt) {
    return { status: 'PASSED', daysRemaining: 0, overdue: false };
  }

  const effectiveEnd = effectiveProbationReviewDate(input);
  const daysRemaining = daysBetween(input.today, effectiveEnd);
  const overdue = daysRemaining < 0;

  const last = String(input.lastReviewStatus ?? '').toUpperCase();
  if (last === 'REJECTED') {
    return { status: 'REJECTED', daysRemaining: 0, overdue: false };
  }
  if (last === 'PASSED') {
    return { status: 'PASSED', daysRemaining: 0, overdue: false };
  }
  if (last === 'FAILED') {
    return { status: 'FAILED', daysRemaining, overdue };
  }
  if (last === 'EXTENDED') {
    return { status: 'EXTENDED', daysRemaining, overdue };
  }
  if (last === 'PENDING_FINAL_APPROVAL') {
    return { status: 'PENDING_FINAL_APPROVAL', daysRemaining, overdue };
  }
  if (last === 'PENDING_HR') {
    return { status: 'PENDING_HR', daysRemaining, overdue };
  }
  if (last === 'PENDING_EMPLOYEE') {
    return { status: 'PENDING_EMPLOYEE', daysRemaining, overdue };
  }
  if (last === 'PENDING_MANAGER') {
    return { status: 'PENDING_MANAGER', daysRemaining, overdue };
  }
  if (input.hasOpenDraft || last === 'IN_REVIEW') {
    return { status: 'IN_REVIEW', daysRemaining, overdue };
  }
  if (overdue || daysRemaining <= 14) {
    return { status: 'REVIEW_DUE', daysRemaining, overdue };
  }
  return { status: 'UPCOMING', daysRemaining, overdue };
}

export function addDaysToDate(iso: string, days: number): string {
  const d = parseDateOnly(iso);
  if (!d) return iso;
  return formatDateOnly(addCalendarDays(d, days))!;
}
