import { AttendanceRecord } from './db.js';
import {
  buildAttendanceStatusContext,
  resolveEmployeeKeysForUser,
} from './attendanceStatusContext.js';
import { enrichAttendanceRecords } from './attendanceRecordStatus.js';
import { serializeAttendanceRecords } from './attendanceRecordSerialize.js';
import {
  DEFAULT_ATTENDANCE_RULES,
  type AttendanceClockRules,
} from './attendanceSettings.js';
import { getEmployeeScheduleForUser } from './employeeAttendanceSchedule.js';
import {
  attachDayOffWorkMeta,
  calcWorkHoursFromClock,
  resolveStoredStatusForClockIn,
} from './attendanceDayOffWork.js';

export type ClockLocation = { lat: number; lng: number } | null;

async function enrichAndSerialize(row: unknown): Promise<Record<string, unknown>> {
  const [enriched] = await enrichAttendanceRecords([row]);
  const [serialized] = serializeAttendanceRecords([enriched]);
  return serialized ?? enriched;
}

export class AttendanceClockError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AttendanceClockError';
  }
}

export async function performClockIn(params: {
  userId: string;
  dateKey: string;
  location: ClockLocation;
  rules?: AttendanceClockRules;
}): Promise<Record<string, unknown>> {
  const { userId, dateKey, location } = params;
  const rules = params.rules ?? DEFAULT_ATTENDANCE_RULES;

  const existing: any = await AttendanceRecord.findOne({
    where: { userId, date: dateKey },
  });

  if (existing?.clockIn) {
    if (!existing.clockOut) {
      throw new AttendanceClockError(
        'Already clocked in for today. Clock out before starting again.',
        409
      );
    }
    throw new AttendanceClockError('Attendance already completed for today', 409);
  }

  const keys = await resolveEmployeeKeysForUser(userId);
  const ctx = await buildAttendanceStatusContext(userId, keys, dateKey, dateKey);
  const schedule = await getEmployeeScheduleForUser(userId);
  const now = new Date();
  const status = resolveStoredStatusForClockIn(now, dateKey, ctx, schedule, rules);
  const locationIn = location ? { lat: location.lat, lng: location.lng } : null;

  let row: any;
  if (existing && !existing.clockIn) {
    existing.clockIn = now.toISOString();
    existing.status = status;
    existing.locationIn = locationIn;
    await existing.save();
    row = existing;
  } else {
    row = await AttendanceRecord.create({
      id: `att-${Date.now()}`,
      userId,
      date: dateKey,
      clockIn: now.toISOString(),
      status,
      locationIn,
    });
  }

  try {
    const { applyLateFieldsToRecord } = await import('./attendanceLateFields.js');
    await applyLateFieldsToRecord({
      id: String(row.id),
      userId,
      date: dateKey,
      clockIn: row.clockIn,
      status: row.status,
    });
    await row.reload();
  } catch (lateErr) {
    console.warn('Late attendance warning processing failed:', (lateErr as Error)?.message);
  }

  const serialized = await enrichAndSerialize(row);
  return attachDayOffWorkMeta(serialized, ctx);
}

export async function performClockOut(params: {
  recordId: string;
  location: ClockLocation;
}): Promise<Record<string, unknown>> {
  const attendance: any = await AttendanceRecord.findByPk(params.recordId);
  if (!attendance) {
    throw new AttendanceClockError('Attendance record not found', 404);
  }
  if (attendance.clockOut) {
    throw new AttendanceClockError('Already clocked out', 409);
  }
  if (!attendance.clockIn) {
    throw new AttendanceClockError('You have not clocked in today', 400);
  }

  const now = new Date();
  attendance.clockOut = now.toISOString();
  attendance.locationOut = params.location
    ? { lat: params.location.lat, lng: params.location.lng }
    : null;
  attendance.workHours = calcWorkHoursFromClock(attendance.clockIn, attendance.clockOut);

  const dateKey = String(attendance.date ?? '').slice(0, 10);
  const userId = String(attendance.userId ?? '');
  const keys = await resolveEmployeeKeysForUser(userId);
  const ctx = await buildAttendanceStatusContext(userId, keys, dateKey, dateKey);
  if (ctx.holidayDates.has(dateKey)) {
    attendance.status = 'PH';
  } else if (ctx.offDates.has(dateKey)) {
    attendance.status = 'DAY_OFF';
  } else if (ctx.missionDates.has(dateKey)) {
    attendance.status = 'MISSION';
  }

  await attendance.save();

  const serialized = await enrichAndSerialize(attendance);
  return attachDayOffWorkMeta(serialized, ctx);
}
