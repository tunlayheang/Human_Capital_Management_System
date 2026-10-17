import type { AttendanceClockRules } from './attendanceSettings';
import { DEFAULT_ATTENDANCE_RULES } from './attendanceSettings';
import { minutesFromIsoIct } from './attendanceTimeZone.js';
import { findEmployeeByUserId } from './userAccountService.js';

export { findEmployeeByUserId } from './userAccountService.js';

export type EmployeeAttendanceSchedule = {
  workDays: number;
  timeIn: string;
  timeOut: string;
  workHours: number;
  breakDurationMinutes: number;
  gracePeriodMinutes: number | null;
};

export const DEFAULT_EMPLOYEE_SCHEDULE: EmployeeAttendanceSchedule = {
  workDays: 5,
  timeIn: '08:00',
  timeOut: '17:00',
  workHours: 8,
  breakDurationMinutes: 60,
  gracePeriodMinutes: null,
};

export function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time || typeof time !== 'string') return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function computeWorkHoursFromTimes(
  timeIn: string,
  timeOut: string,
  breakDurationMinutes = 0
): number {
  const start = parseTimeToMinutes(timeIn);
  const end = parseTimeToMinutes(timeOut);
  if (start == null || end == null) return DEFAULT_EMPLOYEE_SCHEDULE.workHours;
  let span = end - start;
  if (span <= 0) span += 24 * 60;
  const hours = (span - Math.max(0, breakDurationMinutes)) / 60;
  return Math.round(Math.max(0, hours) * 100) / 100;
}

export function scheduleFromEmployeeRow(employee: any): EmployeeAttendanceSchedule {
  const timeIn = String(employee?.time_in ?? DEFAULT_EMPLOYEE_SCHEDULE.timeIn).slice(0, 5);
  const timeOut = String(employee?.time_out ?? DEFAULT_EMPLOYEE_SCHEDULE.timeOut).slice(0, 5);
  const breakDurationMinutes =
    employee?.break_duration_minutes != null
      ? Number(employee.break_duration_minutes)
      : DEFAULT_EMPLOYEE_SCHEDULE.breakDurationMinutes;
  const workDays =
    employee?.work_days != null
      ? Math.min(7, Math.max(1, Number(employee.work_days)))
      : DEFAULT_EMPLOYEE_SCHEDULE.workDays;
  const workHours =
    employee?.work_hours != null && Number(employee.work_hours) > 0
      ? Number(employee.work_hours)
      : computeWorkHoursFromTimes(timeIn, timeOut, breakDurationMinutes);

  return {
    workDays,
    timeIn,
    timeOut,
    workHours,
    breakDurationMinutes,
    gracePeriodMinutes:
      employee?.grace_period_minutes != null ? Number(employee.grace_period_minutes) : null,
  };
}

export async function getEmployeeScheduleForUser(
  userId: string
): Promise<EmployeeAttendanceSchedule | null> {
  const employee = await findEmployeeByUserId(userId);
  if (!employee) return null;
  return scheduleFromEmployeeRow(employee);
}

/**
 * Batch schedule lookup for roster / enrich paths — one User query + one Employee query
 * instead of N × findEmployeeByUserId round-trips.
 */
export async function getEmployeeSchedulesForUsers(
  userIds: string[]
): Promise<Map<string, EmployeeAttendanceSchedule | null>> {
  const { Op } = await import('sequelize');
  const { User, Employee } = await import('./db.js');

  const map = new Map<string, EmployeeAttendanceSchedule | null>();
  const ids = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  for (const id of ids) map.set(id, null);
  if (!ids.length) return map;

  const users: Array<{ get: (o: { plain: boolean }) => Record<string, unknown> }> = await User.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'employeeId', 'email'],
  });

  const linkIds = new Set<string>();
  const emails = new Set<string>();
  const metaByUser = new Map<string, { employeeId: string; email: string }>();
  for (const row of users) {
    const plain = row.get({ plain: true });
    const userId = String(plain.id ?? '').trim();
    if (!userId) continue;
    const employeeId = String(plain.employeeId ?? '').trim();
    const email = String(plain.email ?? '')
      .trim()
      .toLowerCase();
    metaByUser.set(userId, { employeeId, email });
    if (employeeId) linkIds.add(employeeId);
    if (email) emails.add(email);
  }

  const orClauses: Record<string, unknown>[] = [];
  if (linkIds.size) {
    const links = [...linkIds];
    orClauses.push({ id: { [Op.in]: links } });
    orClauses.push({ employee_id: { [Op.in]: links } });
  }
  if (emails.size) orClauses.push({ email: { [Op.in]: [...emails] } });
  if (!orClauses.length) return map;

  const employees = await Employee.findAll({
    where: { [Op.or]: orClauses },
    attributes: [
      'id',
      'employee_id',
      'email',
      'time_in',
      'time_out',
      'work_hours',
      'work_days',
      'break_duration_minutes',
      'grace_period_minutes',
    ],
  });

  const byId = new Map<string, Record<string, unknown>>();
  const byDisplayId = new Map<string, Record<string, unknown>>();
  const byEmail = new Map<string, Record<string, unknown>>();
  for (const row of employees) {
    const plain = (
      row as { get: (o: { plain: boolean }) => Record<string, unknown> }
    ).get({ plain: true });
    const pk = String(plain.id ?? '').trim();
    if (pk) byId.set(pk, plain);
    const displayId = String(plain.employee_id ?? '').trim();
    if (displayId) byDisplayId.set(displayId, plain);
    const email = String(plain.email ?? '')
      .trim()
      .toLowerCase();
    if (email) byEmail.set(email, plain);
  }

  for (const [userId, meta] of metaByUser) {
    const emp =
      (meta.employeeId && byId.get(meta.employeeId)) ||
      (meta.employeeId && byDisplayId.get(meta.employeeId)) ||
      (meta.email && byEmail.get(meta.email)) ||
      null;
    map.set(userId, emp ? scheduleFromEmployeeRow(emp) : null);
  }

  return map;
}

export function attendanceLateStatusForClockIn(
  clockIn: Date,
  schedule: EmployeeAttendanceSchedule | null,
  globalRules: AttendanceClockRules = DEFAULT_ATTENDANCE_RULES
): 'PRESENT' | 'LATE' {
  const fallbackIn = `${String(globalRules.lateAfterHour).padStart(2, '0')}:${String(globalRules.lateAfterMinute).padStart(2, '0')}`;
  const timeIn = schedule?.timeIn ?? fallbackIn;
  const startMinutes = parseTimeToMinutes(timeIn);
  // Always compare in Asia/Phnom_Penh — server local TZ (often UTC on Render) would invert early ICT mornings.
  const nowMinutes = minutesFromIsoIct(clockIn);
  if (startMinutes == null) {
    const cutoff =
      globalRules.lateAfterHour * 60 + globalRules.lateAfterMinute + globalRules.gracePeriodMinutes;
    return nowMinutes > cutoff ? 'LATE' : 'PRESENT';
  }

  const grace =
    schedule?.gracePeriodMinutes != null
      ? schedule.gracePeriodMinutes
      : globalRules.gracePeriodMinutes;
  const cutoff = startMinutes + grace;
  return nowMinutes > cutoff ? 'LATE' : 'PRESENT';
}
