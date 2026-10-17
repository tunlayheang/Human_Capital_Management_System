import { Op } from 'sequelize';
import { AttendanceRecord, LeaveRequest } from '../db.js';
import { resolveLastWorkingDate } from './employeePayrollEligibility.js';

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE']);

async function isDateCoveredByApprovedLeave(userId: string, date: string): Promise<boolean> {
  const d = date.slice(0, 10);
  const row = await LeaveRequest.findOne({
    where: {
      userId,
      status: 'APPROVED',
      startDate: { [Op.lte]: d },
      endDate: { [Op.gte]: d },
    },
  });
  return Boolean(row);
}

/**
 * Last day with approved present/late attendance before absence streak.
 * Falls back to stored last_working_date / last_valid_working_date on employee.
 */
export async function computeLastValidWorkingDate(params: {
  userId: string;
  employee?: Record<string, unknown> | null;
  lookbackDays?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ date: string | null; source: string }> {
  const periodFrom = params.dateFrom?.slice(0, 10);
  const periodTo = params.dateTo?.slice(0, 10);
  const periodBound = Boolean(periodFrom && periodTo);

  if (!periodBound) {
    const stored =
      (params.employee?.last_valid_working_date as string) ??
      resolveLastWorkingDate(params.employee ?? null);
    if (stored) {
      return { date: String(stored).slice(0, 10), source: 'employee_record' };
    }
  }

  let startStr: string;
  let endStr: string;
  if (periodBound) {
    startStr = periodFrom!;
    endStr = periodTo!;
    const cursor = new Date(`${endStr}T12:00:00`);
    for (;;) {
      const date = cursor.toISOString().slice(0, 10);
      if (date < startStr) break;
      const statusRec = await AttendanceRecord.findOne({
        where: { userId: params.userId, date },
      });
      const status = statusRec
        ? String(statusRec.get('status') ?? '').toUpperCase()
        : '';
      if (PRESENT_STATUSES.has(status)) {
        return { date, source: 'attendance_period' };
      }
      if (status === 'ABSENT') {
        const onLeave = await isDateCoveredByApprovedLeave(params.userId, date);
        if (!onLeave) {
          cursor.setDate(cursor.getDate() - 1);
          continue;
        }
      }
      break;
    }
    return { date: null, source: 'none' };
  }

  const lookback = params.lookbackDays ?? 120;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - lookback);
  startStr = start.toISOString().slice(0, 10);
  endStr = end.toISOString().slice(0, 10);

  const records = await AttendanceRecord.findAll({
    where: {
      userId: params.userId,
      date: { [Op.between]: [startStr, endStr] },
    },
    order: [['date', 'DESC']],
  });

  let lastPresent: string | null = null;
  let consecutiveUnapprovedAbsent = 0;

  for (const rec of records) {
    const plain = rec.get({ plain: true }) as { date: string; status: string };
    const date = String(plain.date).slice(0, 10);
    const status = String(plain.status ?? '').toUpperCase();

    if (PRESENT_STATUSES.has(status)) {
      if (consecutiveUnapprovedAbsent === 0) {
        lastPresent = date;
        break;
      }
    }

    if (status === 'ABSENT') {
      const onLeave = await isDateCoveredByApprovedLeave(params.userId, date);
      if (!onLeave) {
        consecutiveUnapprovedAbsent += 1;
      } else {
        consecutiveUnapprovedAbsent = 0;
      }
    } else if (
      status === 'ON_LEAVE' ||
      status === 'PAID_LEAVE' ||
      status === 'UNPAID_LEAVE' ||
      status === 'DAY_OFF'
    ) {
      consecutiveUnapprovedAbsent = 0;
    }
  }

  if (lastPresent) {
    return { date: lastPresent, source: 'attendance_scan' };
  }

  return { date: null, source: 'none' };
}

export async function persistLastValidWorkingDate(
  employeePk: string,
  date: string,
  source: string
): Promise<void> {
  const { Employee } = await import('../db.js');
  await Employee.update(
    {
      last_valid_working_date: date.slice(0, 10),
      last_working_date: date.slice(0, 10),
    },
    { where: { id: employeePk } }
  );
  const { writePayrollAuditLog } = await import('./payrollAuditService.js');
  await writePayrollAuditLog({
    entityType: 'employee',
    entityId: employeePk,
    actionType: 'LAST_VALID_WORKING_DATE_SET',
    newValue: { lastValidWorkingDate: date, source },
  });
}
