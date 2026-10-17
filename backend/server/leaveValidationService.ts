import { Op } from 'sequelize';
import { LeaveBalance, LeaveRequest, LeaveType } from './db.js';
import { leaveDurationDays } from './leaveDuration.js';
import { computeLeaveRemaining, type LeaveBalanceComponents } from './leaveBalanceCalc.js';
import {
  inferLeaveCategory,
  leaveCategoryTracksBalance,
  type LeaveCategory,
} from './leaveTypeCategory.js';
import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';
import { syncBalanceUsedFromRequests } from './leaveBalanceService.js';

const BLOCKING_STATUSES = ['PENDING', 'APPLIED', 'APPROVED'];

export type LeaveRequestInput = {
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDayPeriod?: string | null;
  excludeRequestId?: string;
};

function parseDay(s: string): Date {
  return new Date(`${String(s).slice(0, 10)}T12:00:00`);
}

function periodsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const a0 = parseDay(aStart).getTime();
  const a1 = parseDay(aEnd).getTime();
  const b0 = parseDay(bStart).getTime();
  const b1 = parseDay(bEnd).getTime();
  return a0 <= b1 && b0 <= a1;
}

async function findLeaveTypeByRequestType(requestType: string): Promise<{
  row: Record<string, unknown>;
  category: LeaveCategory;
} | null> {
  const types = await LeaveType.findAll({ where: { isActive: true } });
  const a = String(requestType ?? '').trim().toLowerCase();
  for (const typeRow of types) {
    const t = typeRow.get ? typeRow.get({ plain: true }) : typeRow;
    const id = String(t.id ?? '').trim().toLowerCase();
    const name = String(t.name ?? '').trim().toLowerCase();
    const code = String(t.code ?? '').trim().toLowerCase();
    if (a === id || a === name || a === code || name.includes(a) || a.includes(name)) {
      const category = inferLeaveCategory(t);
      return { row: t as Record<string, unknown>, category };
    }
    const aWord = a.split(/\s+/)[0];
    const nameWord = name.split(/\s+/)[0];
    if (aWord && aWord === nameWord) {
      return { row: t as Record<string, unknown>, category: inferLeaveCategory(t) };
    }
  }
  return null;
}

export async function hasOverlappingLeave(input: LeaveRequestInput): Promise<boolean> {
  const where: Record<string, unknown> = {
    userId: input.userId,
    status: { [Op.in]: BLOCKING_STATUSES },
  };
  if (input.excludeRequestId) {
    where.id = { [Op.ne]: input.excludeRequestId };
  }

  const rows = await LeaveRequest.findAll({ where });
  for (const row of rows) {
    const r = row.get ? row.get({ plain: true }) : row;
    if (
      periodsOverlap(
        input.startDate,
        input.endDate,
        String(r.startDate),
        String(r.endDate)
      )
    ) {
      return true;
    }
  }
  return false;
}

async function countEventUsage(
  userId: string,
  leaveTypeId: string,
  maxPerEmployment: number | null
): Promise<{ ok: boolean; message?: string }> {
  if (maxPerEmployment == null || maxPerEmployment <= 0) return { ok: true };

  const typeRow = await LeaveType.findByPk(leaveTypeId);
  if (!typeRow) return { ok: true };
  const t = typeRow.get ? typeRow.get({ plain: true }) : typeRow;
  const typeName = String(t.name ?? '');
  const code = String(t.code ?? '');

  const rows = await LeaveRequest.findAll({
    where: {
      userId,
      status: { [Op.in]: ['APPROVED', 'APPLIED', 'PENDING'] },
    },
  });

  let count = 0;
  for (const row of rows) {
    const r = row.get ? row.get({ plain: true }) : row;
    const reqType = String(r.type ?? '').trim().toLowerCase();
    const n = typeName.toLowerCase();
    const c = code.toLowerCase();
    if (reqType === n || reqType === c || n.includes(reqType) || reqType.includes(n)) {
      count += 1;
    }
  }

  if (count >= maxPerEmployment) {
    return {
      ok: false,
      message: `Maximum ${maxPerEmployment} request(s) allowed for this event-based leave type`,
    };
  }
  return { ok: true };
}

export async function validateLeaveRequest(
  input: LeaveRequestInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  const userId = String(input.userId ?? '').trim();
  if (!userId) return { ok: false, message: 'User is required' };

  const days = leaveDurationDays({
    startDate: input.startDate,
    endDate: input.endDate,
    isHalfDay: input.isHalfDay,
    halfDayPeriod: input.halfDayPeriod,
  });
  if (days <= 0) return { ok: false, message: 'Invalid leave duration' };

  if (await hasOverlappingLeave(input)) {
    return { ok: false, message: 'Leave dates overlap an existing request' };
  }

  const match = await findLeaveTypeByRequestType(input.type);
  if (!match) {
    return { ok: false, message: 'Unknown leave type' };
  }

  const { row: typeRow, category } = match;

  if (category === 'event_based') {
    const maxUsage = typeRow.maxUsagePerEmployment != null
      ? Number(typeRow.maxUsagePerEmployment)
      : null;
    const usageCheck = await countEventUsage(
      userId,
      String(typeRow.id),
      maxUsage
    );
    if (!usageCheck.ok) return { ok: false, message: usageCheck.message! };
    return { ok: true };
  }

  if (category === 'approval_based') {
    return { ok: true };
  }

  if (!leaveCategoryTracksBalance(category)) {
    return { ok: true };
  }

  const employee = await findEmployeeByUserId(userId);
  const empId = employee ? String(employee.get ? employee.get('id') : employee.id) : null;
  if (!empId) {
    return { ok: false, message: 'Employee record not found for balance check' };
  }

  const year = Number.parseInt(String(input.startDate).slice(0, 4), 10);
  const balance: any = await LeaveBalance.findOne({
    where: { employeeId: empId, leaveTypeId: String(typeRow.id), year },
  });
  if (!balance) {
    return {
      ok: false,
      message: 'No leave balance assigned for this type and year',
    };
  }

  await syncBalanceUsedFromRequests(empId, String(typeRow.id), year, userId);

  const refreshed: any = await LeaveBalance.findByPk(balance.id);
  const b = refreshed.get ? refreshed.get({ plain: true }) : refreshed;
  const remaining = computeLeaveRemaining(
    {
      openingBalance: Number(b.openingBalance ?? 0),
      accrued: Number(b.accrued ?? 0),
      entitlement: Number(b.entitlement ?? 0),
      carriedOver: Number(b.carriedOver ?? 0),
      used: Number(b.used ?? 0),
    },
    category
  );

  if (days > remaining) {
    return {
      ok: false,
      message: `Insufficient leave balance (${remaining} day(s) remaining, ${days} requested)`,
    };
  }

  return { ok: true };
}

export async function validateLeaveApproval(leaveId: string): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, message: 'Leave request not found' };

  return validateLeaveRequest({
    userId: String(leave.userId),
    type: String(leave.type),
    startDate: String(leave.startDate),
    endDate: String(leave.endDate),
    isHalfDay: Boolean(leave.isHalfDay),
    halfDayPeriod: leave.halfDayPeriod,
    excludeRequestId: leaveId,
  });
}

export async function applyLeaveBalanceOnApproval(leaveId: string): Promise<void> {
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave || String(leave.status).toUpperCase() !== 'APPROVED') return;

  const match = await findLeaveTypeByRequestType(String(leave.type));
  if (!match || !leaveCategoryTracksBalance(match.category)) return;

  const employee = await findEmployeeByUserId(String(leave.userId));
  const empId = employee ? String(employee.get ? employee.get('id') : employee.id) : null;
  if (!empId) return;

  const year = Number.parseInt(String(leave.startDate).slice(0, 4), 10);
  await syncBalanceUsedFromRequests(
    empId,
    String(match.row.id),
    year,
    String(leave.userId)
  );
  const balance: any = await LeaveBalance.findOne({
    where: { employeeId: empId, leaveTypeId: String(match.row.id), year },
  });
  if (balance) {
    const plain = balance.get({ plain: true }) as LeaveBalanceComponents;
    const remaining = computeLeaveRemaining(plain);
    if (remaining <= 2) {
      const { createNotification } = await import('./notificationService.js');
      await createNotification({
        id: `leave-balance-low-${empId}-${String(match.row.id)}-${year}`,
        userId: String(leave.userId),
        title: 'Leave balance low',
        message: `You have ${remaining.toFixed(1)} day${remaining === 1 ? '' : 's'} of ${String(leave.type)} leave remaining for ${year}.`,
        type: 'WARNING',
        category: 'LEAVE',
        priority: 'NORMAL',
        entityId: String(match.row.id),
        entityType: 'LEAVE_BALANCE',
        link: '/leaves',
      });
    }
  }
}
