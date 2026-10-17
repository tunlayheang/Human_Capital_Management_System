import { Op } from 'sequelize';
import { LeaveRequest } from './db.js';
import { type LeaveDurationFields } from './leaveDuration.js';
import { loadLeaveTypeLookup, resolveLeaveRequestIsPaid } from './approvedLeaveDayMap.js';

function parseDay(s: string): Date {
  return new Date(`${s.slice(0, 10)}T12:00:00`);
}

/** Calendar days of leave overlapping [monthStart, monthEnd] inclusive. */
function overlapDays(
  leave: LeaveDurationFields,
  monthStart: string,
  monthEnd: string
): number {
  const leaveStart = String(leave.startDate).slice(0, 10);
  const leaveEnd = String(leave.endDate).slice(0, 10);

  if (leave.isHalfDay && leaveStart === leaveEnd) {
    if (leaveStart >= monthStart && leaveStart <= monthEnd) return 0.5;
    return 0;
  }

  const s = parseDay(leaveStart);
  const e = parseDay(leaveEnd);
  const ms = parseDay(monthStart);
  const me = parseDay(monthEnd);
  const from = s > ms ? s : ms;
  const to = e < me ? e : me;
  if (to < from) return 0;
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function resolveLeaveWindow(
  monthPrefix: string,
  periodBounds?: { periodStart?: string; periodEnd?: string }
): { monthStart: string; monthEnd: string } | null {
  if (periodBounds?.periodStart && periodBounds?.periodEnd) {
    return {
      monthStart: periodBounds.periodStart.slice(0, 10),
      monthEnd: periodBounds.periodEnd.slice(0, 10),
    };
  }
  const prefix = monthPrefix.slice(0, 7);
  const [y, m] = prefix.split('-').map(Number);
  if (!y || !m) return null;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    monthStart: `${prefix}-01`,
    monthEnd: `${prefix}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Approved unpaid leave days in a payroll period (cutoff window or calendar month). */
export async function countApprovedUnpaidLeaveDays(
  userId: string,
  monthPrefix: string,
  periodBounds?: { periodStart?: string; periodEnd?: string }
): Promise<number> {
  const window = resolveLeaveWindow(monthPrefix, periodBounds);
  if (!window) return 0;
  const { monthStart, monthEnd } = window;

  const rows = await LeaveRequest.findAll({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: monthEnd },
      endDate: { [Op.gte]: monthStart },
    },
  });

  const lookup = await loadLeaveTypeLookup();
  let total = 0;
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      type: string;
      startDate: string;
      endDate: string;
      isHalfDay?: boolean;
      halfDayPeriod?: string | null;
    };
    if (resolveLeaveRequestIsPaid(String(p.type ?? ''), lookup)) continue;
    const fields: LeaveDurationFields = {
      startDate: p.startDate,
      endDate: p.endDate,
      isHalfDay: Boolean(p.isHalfDay),
      halfDayPeriod: p.halfDayPeriod,
    };
    total += overlapDays(fields, monthStart, monthEnd);
  }
  return total;
}

/** Approved leave days in payroll period (all leave types) per portal user. */
export async function countApprovedLeaveDaysByUserForMonth(
  userIds: string[],
  monthPrefix: string,
  periodBounds?: { periodStart?: string; periodEnd?: string }
): Promise<Map<string, { totalDays: number; unpaidDays: number }>> {
  const result = new Map<string, { totalDays: number; unpaidDays: number }>();
  for (const id of userIds) result.set(id, { totalDays: 0, unpaidDays: 0 });
  if (!userIds.length) return result;

  const window = resolveLeaveWindow(monthPrefix, periodBounds);
  if (!window) return result;
  const { monthStart, monthEnd } = window;

  const rows = await LeaveRequest.findAll({
    where: {
      userId: { [Op.in]: userIds },
      status: 'APPROVED',
      startDate: { [Op.lte]: monthEnd },
      endDate: { [Op.gte]: monthStart },
    },
  });

  const lookup = await loadLeaveTypeLookup();
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      userId: string;
      type: string;
      startDate: string;
      endDate: string;
      isHalfDay?: boolean;
      halfDayPeriod?: string | null;
    };
    const uid = String(p.userId);
    const bucket = result.get(uid) ?? { totalDays: 0, unpaidDays: 0 };
    const fields: LeaveDurationFields = {
      startDate: p.startDate,
      endDate: p.endDate,
      isHalfDay: Boolean(p.isHalfDay),
      halfDayPeriod: p.halfDayPeriod,
    };
    const days = overlapDays(fields, monthStart, monthEnd);
    bucket.totalDays += days;
    if (!resolveLeaveRequestIsPaid(String(p.type ?? ''), lookup)) bucket.unpaidDays += days;
    result.set(uid, bucket);
  }

  return result;
}
