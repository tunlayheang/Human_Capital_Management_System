import { AttendanceRecord } from './db.js';
import { writeDomainAudit } from './domainAuditService.js';
import {
  buildAttendanceStatusContext,
  resolveEmployeeKeysForUser,
} from './attendanceStatusContext.js';
import { resolveAttendanceDisplayStatus } from './attendanceRecordStatus.js';
import { attendanceRecordToJson } from './attendanceRecordSerialize.js';
import { ensureAttendanceRecordCorrectionColumns } from './attendanceRecordSchema.js';
import {
  buildCorrectionChangeSummary,
  combineDateAndTimeIct,
  timeHmFromIsoIct,
} from './attendanceTimeZone.js';
import { DEFAULT_ATTENDANCE_RULES, getAttendanceGeofenceConfig } from './attendanceSettings.js';
import { getEmployeeScheduleForUser } from './employeeAttendanceSchedule.js';

export type UpdateAttendanceTimesInput = {
  /** Only apply check-in when true (frontend detects real edit). */
  changeClockIn?: boolean;
  /** Only apply check-out when true. */
  changeClockOut?: boolean;
  clockInTime?: string | null;
  clockOutTime?: string | null;
  clearClockIn?: boolean;
  clearClockOut?: boolean;
  reason: string;
};

function calcWorkHours(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (ms <= 0) return null;
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

export async function updateAttendanceTimes(
  recordId: string,
  correctorUserId: string,
  body: UpdateAttendanceTimesInput
): Promise<Record<string, unknown>> {
  await ensureAttendanceRecordCorrectionColumns();

  const row: any = await AttendanceRecord.findByPk(recordId);
  if (!row) throw new Error('Attendance record not found');

  const dateKey = String(row.date ?? '').slice(0, 10);
  if (!dateKey) throw new Error('Record has no date');

  const previousClockIn: string | null = row.clockIn ?? null;
  const previousClockOut: string | null = row.clockOut ?? null;

  let clockIn: string | null = previousClockIn;
  let clockOut: string | null = previousClockOut;

  let changeClockIn = body.changeClockIn === true;
  let changeClockOut = body.changeClockOut === true;

  if (body.changeClockIn !== true && body.changeClockOut !== true) {
    const inHm = String(body.clockInTime ?? '').trim();
    const outHm = String(body.clockOutTime ?? '').trim();
    if (body.clearClockIn && previousClockIn) changeClockIn = true;
    else if (inHm && timeHmFromIsoIct(previousClockIn) !== inHm) changeClockIn = true;
    if (body.clearClockOut && previousClockOut) changeClockOut = true;
    else if (outHm && timeHmFromIsoIct(previousClockOut) !== outHm) changeClockOut = true;
  }

  if (changeClockIn) {
    if (body.clearClockIn) {
      clockIn = null;
    } else {
      const hm = String(body.clockInTime ?? '').trim();
      if (!hm) throw new Error('Check-in time is required when changing check-in');
      clockIn = combineDateAndTimeIct(dateKey, hm);
    }
  }

  if (changeClockOut) {
    if (body.clearClockOut) {
      clockOut = null;
    } else {
      const hm = String(body.clockOutTime ?? '').trim();
      if (!hm) throw new Error('Check-out time is required when changing check-out');
      clockOut = combineDateAndTimeIct(dateKey, hm);
    }
  }

  if (!changeClockIn && !changeClockOut) {
    throw new Error('No time fields were marked as changed');
  }

  if (changeClockIn && !body.clearClockIn) {
    const hm = String(body.clockInTime ?? '').trim();
    if (hm && timeHmFromIsoIct(previousClockIn) === hm && previousClockIn) {
      throw new Error('Check-in time is the same as the database value');
    }
  }

  if (changeClockOut && !body.clearClockOut) {
    const hm = String(body.clockOutTime ?? '').trim();
    if (hm && timeHmFromIsoIct(previousClockOut) === hm && previousClockOut) {
      throw new Error('Check-out time is the same as the database value');
    }
  }

  if (clockIn && clockOut) {
    const inMs = new Date(clockIn).getTime();
    const outMs = new Date(clockOut).getTime();
    if (outMs <= inMs) {
      throw new Error('Check-out must be after check-in');
    }
  }

  const hadChange = clockIn !== previousClockIn || clockOut !== previousClockOut;
  if (!hadChange) {
    throw new Error('No time changes provided');
  }

  const reason = String(body.reason ?? '').trim();
  if (reason.length < 3) {
    throw new Error('A reason is required (at least 3 characters)');
  }
  if (reason.length > 500) {
    throw new Error('Reason must be 500 characters or less');
  }

  const correctionSummary = buildCorrectionChangeSummary(
    { clockIn: previousClockIn, clockOut: previousClockOut },
    { clockIn, clockOut }
  );

  row.clockIn = clockIn;
  row.clockOut = clockOut;
  row.workHours = calcWorkHours(clockIn, clockOut);

  const settings = await getAttendanceGeofenceConfig();
  const rules = settings?.rules ?? DEFAULT_ATTENDANCE_RULES;
  const userId = String(row.userId ?? '');
  const schedule = await getEmployeeScheduleForUser(userId);
  try {
    const keys = await resolveEmployeeKeysForUser(userId);
    const ctx =
      dateKey ? await buildAttendanceStatusContext(userId, keys, dateKey, dateKey) : undefined;
    row.status = resolveAttendanceDisplayStatus(
      { clockIn, status: row.status, date: dateKey, userId },
      schedule,
      rules,
      ctx
    );
  } catch (statusErr) {
    console.warn(
      'Attendance status resolve failed during time correction:',
      (statusErr as Error)?.message
    );
    row.status = resolveAttendanceDisplayStatus(
      { clockIn, status: row.status, date: dateKey, userId },
      schedule,
      rules,
      undefined
    );
  }

  row.correctionAt = new Date().toISOString();
  row.correctionBy = String(correctorUserId);
  row.correctionReason = reason;
  row.correctionSummary = correctionSummary;

  await row.save();

  await writeDomainAudit({
    entityType: 'attendance_record',
    entityId: String(row.id),
    action: 'CORRECTION',
    performedBy: correctorUserId,
    oldValue: { clockIn: previousClockIn, clockOut: previousClockOut },
    newValue: { clockIn, clockOut, workHours: row.workHours },
    reason,
    metadata: { correctionSummary, date: dateKey },
  });

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

  return attendanceRecordToJson(row);
}
