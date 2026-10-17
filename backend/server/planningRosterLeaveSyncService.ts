/**
 * When leave is finalized (APPROVED), write non-working cells into the monthly planning roster.
 */
import { Op } from 'sequelize';
import {
  Employee,
  MonthlyPlanningRoster,
  MonthlyPlanningRosterEntry,
  LeaveRequest,
} from './db.js';
import { ensureMonthlyPlanningRosterSchema } from './monthlyPlanningRosterService.js';
import { apiMonthToIndex, findActivePlanningRostersForMonth } from './planningRosterMonthQuery.js';
import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';
import crypto from 'crypto';

export type PlanningRosterLeaveSyncResult = {
  ok: boolean;
  message?: string;
  cellsWritten: number;
  rosterIds: string[];
};

function rosterEntryId(rosterId: string, employeeId: string, day: number): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${rosterId}|${employeeId}|${day}`)
    .digest('hex')
    .slice(0, 40);
  return `mpre-${digest}`;
}

function monthIndexToCalendarMonth(monthIndex: number): number {
  return apiMonthToIndex(monthIndex) + 1;
}

function monthLabelForIndex(monthIndex: number): string {
  return new Date(2000, apiMonthToIndex(monthIndex), 1).toLocaleString('en', {
    month: 'long',
  });
}

function* eachCalendarDay(startIso: string, endIso: string): Generator<{
  year: number;
  monthIndex: number;
  day: number;
}> {
  const start = String(startIso).slice(0, 10);
  const end = String(endIso).slice(0, 10);
  const cur = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime()) || cur > last) return;
  while (cur <= last) {
    yield {
      year: cur.getFullYear(),
      monthIndex: cur.getMonth(),
      day: cur.getDate(),
    };
    cur.setDate(cur.getDate() + 1);
  }
}

function rosterLeaveTypeLabel(leave: {
  type?: string | null;
  isHalfDay?: boolean | null;
  halfDayPeriod?: string | null;
}): string {
  const type = String(leave.type ?? '').trim() || 'Leave';
  if (!leave.isHalfDay) return type;
  const period = String(leave.halfDayPeriod ?? '').trim().toUpperCase();
  if (period === 'AM' || period === 'PM') return `${type} (${period})`;
  return `${type} (Half day)`;
}

async function findOrCreateRosterIdForMonth(
  year: number,
  monthIndex: number
): Promise<string> {
  const rows = await findActivePlanningRostersForMonth(year, monthIndex);
  if (rows.length > 0) {
    return String(rows[0].get('id'));
  }

  const now = new Date();
  const id = `mpr-${Date.now()}`;
  const label = monthLabelForIndex(monthIndex);
  await MonthlyPlanningRoster.create({
    id,
    month: monthIndexToCalendarMonth(monthIndex),
    year,
    name: `${label} ${year} Roster`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`[roster] Auto-created planning roster ${id} for leave sync (${label} ${year})`);
  return id;
}

async function upsertLeaveRosterCell(params: {
  rosterId: string;
  employeeId: string;
  day: number;
  leaveType: string;
  sourceLeaveRequestId: string;
}): Promise<void> {
  const now = new Date();
  await MonthlyPlanningRosterEntry.destroy({
    where: {
      rosterId: params.rosterId,
      employeeId: params.employeeId,
      day: params.day,
    },
  });
  await MonthlyPlanningRosterEntry.create({
    id: rosterEntryId(params.rosterId, params.employeeId, params.day),
    rosterId: params.rosterId,
    employeeId: params.employeeId,
    day: params.day,
    leaveType: params.leaveType,
    isLocked: true,
    sourceLeaveRequestId: params.sourceLeaveRequestId,
    createdAt: now,
    updatedAt: now,
  });
}

/** Apply approved leave dates to planning roster(s); idempotent per leave request id. */
export async function syncApprovedLeaveToPlanningRoster(
  leaveId: string
): Promise<PlanningRosterLeaveSyncResult> {
  await ensureMonthlyPlanningRosterSchema();

  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) {
    return { ok: false, message: 'Leave request not found', cellsWritten: 0, rosterIds: [] };
  }
  if (String(leave.status ?? '').toUpperCase() !== 'APPROVED') {
    return { ok: false, message: 'Leave is not approved', cellsWritten: 0, rosterIds: [] };
  }

  const userId = String(leave.userId ?? '').trim();
  if (!userId) {
    return { ok: false, message: 'Leave has no employee user', cellsWritten: 0, rosterIds: [] };
  }

  const employee = await findEmployeeByUserId(userId);
  if (!employee) {
    return {
      ok: false,
      message: 'No employee record linked to this leave request',
      cellsWritten: 0,
      rosterIds: [],
    };
  }
  const empPlain = employee.get ? employee.get({ plain: true }) : employee;
  const employeePk = String(empPlain.id ?? '').trim();
  if (!employeePk) {
    return { ok: false, message: 'Invalid employee id', cellsWritten: 0, rosterIds: [] };
  }

  const startDate = String(leave.startDate ?? '').slice(0, 10);
  const endDate = String(leave.endDate ?? leave.startDate ?? '').slice(0, 10);
  if (!startDate || !endDate) {
    return { ok: false, message: 'Leave dates are required', cellsWritten: 0, rosterIds: [] };
  }

  const leaveTypeLabel = rosterLeaveTypeLabel(leave);
  const leaveRequestId = String(leave.id);

  await MonthlyPlanningRosterEntry.destroy({
    where: { sourceLeaveRequestId: leaveRequestId },
  });

  const rosterIds = new Set<string>();
  let cellsWritten = 0;

  for (const { year, monthIndex, day } of eachCalendarDay(startDate, endDate)) {
    const rosterId = await findOrCreateRosterIdForMonth(year, monthIndex);
    rosterIds.add(rosterId);
    await upsertLeaveRosterCell({
      rosterId,
      employeeId: employeePk,
      day,
      leaveType: leaveTypeLabel,
      sourceLeaveRequestId: leaveRequestId,
    });
    cellsWritten += 1;
    await MonthlyPlanningRoster.update(
      { updatedAt: new Date() },
      { where: { id: rosterId } }
    );
  }

  if (cellsWritten > 0) {
    console.log(
      `[roster] Synced approved leave ${leaveRequestId} → ${cellsWritten} cell(s) (${leaveTypeLabel})`
    );
  }

  return {
    ok: true,
    cellsWritten,
    rosterIds: [...rosterIds],
  };
}

/** Remove planning cells created from a leave request (reject / cancel after sync). */
export async function removeLeaveFromPlanningRoster(leaveId: string): Promise<number> {
  await ensureMonthlyPlanningRosterSchema();
  const removed = await MonthlyPlanningRosterEntry.destroy({
    where: { sourceLeaveRequestId: String(leaveId) },
  });
  if (removed > 0) {
    console.log(`[roster] Removed ${removed} planning cell(s) for leave ${leaveId}`);
  }
  return removed;
}
