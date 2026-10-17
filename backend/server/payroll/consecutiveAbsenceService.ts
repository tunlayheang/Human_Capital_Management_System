import { Op } from 'sequelize';
import { AttendanceRecord, Employee, LeaveRequest, User } from '../db.js';
import { findEmployeeByUserId } from '../employeeAttendanceSchedule.js';
import {
  EmployeeAbandonmentCase,
} from './abandonmentSchema.js';
import {
  getAbandonmentPolicy,
  thresholdForGroup,
} from './abandonmentPolicyService.js';
import { notifyRoles, notifyUserIds } from '../notificationService.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { flagPotentialAbandonment } from './abandonmentCaseService.js';

const PRESENT = new Set(['PRESENT', 'LATE']);

async function isUnapprovedAbsent(userId: string, date: string): Promise<boolean> {
  const rec = await AttendanceRecord.findOne({
    where: { userId, date: date.slice(0, 10) },
  });
  if (!rec) return false;
  const status = String(rec.get('status') ?? '').toUpperCase();
  if (status !== 'ABSENT') return false;
  const d = date.slice(0, 10);
  const onLeave = await LeaveRequest.findOne({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: d },
      endDate: { [Op.gte]: d },
    },
  });
  return !onLeave;
}

export type AbsencePeriod = {
  dateFrom: string;
  dateTo: string;
};

/** Count trailing calendar days (from anchorDate backward) of consecutive unapproved absence. */
export async function countConsecutiveUnapprovedAbsences(
  userId: string,
  anchorDate = new Date().toISOString().slice(0, 10),
  period?: AbsencePeriod
): Promise<number> {
  const anchor = period?.dateTo?.slice(0, 10) ?? anchorDate.slice(0, 10);
  const minDate = period?.dateFrom?.slice(0, 10);
  let count = 0;
  const cursor = new Date(`${anchor}T12:00:00`);
  const maxIterations = period ? 366 : 60;

  for (let i = 0; i < maxIterations; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (minDate && date < minDate) break;
    const absent = await isUnapprovedAbsent(userId, date);
    if (!absent) break;
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

async function resolveManagerUserId(employeeEmail: string | null): Promise<string | null> {
  if (!employeeEmail) return null;
  const emp = await Employee.findOne({ where: { email: employeeEmail } });
  if (!emp) return null;
  const managerId = emp.get('manager_id') ?? emp.get('managerId');
  if (!managerId) return null;
  const mgr = await Employee.findByPk(String(managerId));
  if (!mgr?.email) return null;
  const user = await User.findOne({ where: { email: String(mgr.email) } });
  return user ? String(user.get('id')) : null;
}

export async function scanEmployeeForConsecutiveAbsence(params: {
  userId: string;
  payrollGroupId?: string;
  period?: AbsencePeriod;
}): Promise<{
  count: number;
  flagged: boolean;
  threshold: number;
  autoFlagEnabled: boolean;
  dateFrom?: string;
  dateTo?: string;
}> {
  const policy = await getAbandonmentPolicy();
  const threshold = thresholdForGroup(policy, params.payrollGroupId ?? 'default');
  const count = await countConsecutiveUnapprovedAbsences(
    params.userId,
    params.period?.dateTo,
    params.period
  );
  const periodMeta = params.period
    ? { dateFrom: params.period.dateFrom, dateTo: params.period.dateTo }
    : {};

  if (!policy.autoFlagEnabled) {
    return { count, flagged: false, threshold, autoFlagEnabled: false, ...periodMeta };
  }

  if (count < threshold) {
    return { count, flagged: false, threshold, autoFlagEnabled: true, ...periodMeta };
  }

  const linked = await findEmployeeByUserId(params.userId);
  if (!linked) {
    return {
      count,
      flagged: false,
      threshold,
      autoFlagEnabled: policy.autoFlagEnabled,
      ...periodMeta,
    };
  }
  const plain = linked.get({ plain: true }) as Record<string, unknown>;
  const status = String(plain.status ?? 'active').toLowerCase();
  if (status === 'absconded' || status === 'resigned' || status === 'terminated') {
    return {
      count,
      flagged: false,
      threshold,
      autoFlagEnabled: policy.autoFlagEnabled,
      ...periodMeta,
    };
  }

  const displayId = String(plain.employee_id ?? plain.employeeId);
  const caseRow = await flagPotentialAbandonment({
    employeeDisplayId: displayId,
    employeePk: String(plain.id),
    consecutiveDays: count,
    thresholdDays: threshold,
    payrollGroupId: params.payrollGroupId ?? 'default',
  });

  await notifyRoles(policy.notifyRoles, {
    title: 'Potential job abandonment',
    message: `${displayId}: ${count} consecutive unapproved absences (threshold ${threshold}). HR review required.`,
    type: 'WARNING',
    link: '/employees/offboarding',
    idPrefix: `abandon-flag-${displayId}-${count}`,
  });

  const managerUserId = await resolveManagerUserId(
    plain.email ? String(plain.email) : null
  );
  if (managerUserId) {
    await notifyUserIds([managerUserId], {
      title: 'Team member absence alert',
      message: `${displayId} has ${count} consecutive unapproved absences. Please coordinate with HR.`,
      type: 'WARNING',
      link: '/employees/offboarding',
      idPrefix: `abandon-mgr-${displayId}`,
    });
  }

  await writePayrollAuditLog({
    entityType: 'abandonment_case',
    entityId: String(caseRow.id),
    actionType: 'CONSECUTIVE_ABSENCE_THRESHOLD',
    newValue: { count, threshold, employeeId: displayId },
  });

  return { count, flagged: true, threshold, autoFlagEnabled: true, ...periodMeta };
}

/** Daily job — scan active portal users linked to employees. */
export async function runConsecutiveAbsenceScan(): Promise<number> {
  const users = await User.findAll({
    where: { isActive: true },
    attributes: ['id'],
  });
  let flagged = 0;
  for (const u of users) {
    const userId = String(u.get('id'));
    const emp = await findEmployeeByUserId(userId);
    if (!emp) continue;
    const plain = emp.get({ plain: true }) as { status?: string };
    if (String(plain.status ?? '').toLowerCase() !== 'active') continue;
    const { flagged: did } = await scanEmployeeForConsecutiveAbsence({ userId });
    if (did) flagged += 1;
  }
  return flagged;
}
