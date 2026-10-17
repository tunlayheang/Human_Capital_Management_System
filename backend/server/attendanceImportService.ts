import { AttendanceRecord } from './db.js';
import { resolveEmployeePk, findUserIdByEmployeePk } from './employeeIdentity.js';
import {
  assertAttendanceRecordCreatable,
  assertAttendanceRecordUpdatable,
  AttendanceFrozenError,
  attendanceRecordHasPersistedData,
  loadAttendanceRowForFreezeCheck,
} from './payroll/attendanceFreezeGuard.js';
import {
  assertEligibleForAttendanceOnDate,
  EmployeePayrollBoundaryError,
} from './payroll/employeePayrollEligibility.js';
import { DEFAULT_ATTENDANCE_RULES, getAttendanceGeofenceConfig } from './attendanceSettings.js';
import { getEmployeeScheduleForUser } from './employeeAttendanceSchedule.js';
import {
  buildAttendanceStatusContext,
  resolveEmployeeKeysForUser,
} from './attendanceStatusContext.js';
import { resolveAttendanceDisplayStatus } from './attendanceRecordStatus.js';
import { ensureAttendanceRecordCorrectionColumns } from './attendanceRecordSchema.js';
import {
  buildCorrectionChangeSummary,
  combineDateAndTimeIct,
} from './attendanceTimeZone.js';

const ALLOWED_STATUSES = new Set([
  'PRESENT',
  'LATE',
  'ABSENT',
  'ON_LEAVE',
  'PAID_LEAVE',
  'UNPAID_LEAVE',
  'DAY_OFF',
  'PH',
  'MISSION',
]);

export const MAX_ATTENDANCE_IMPORT_ROWS = 2000;

export type AttendanceImportInputRow = {
  rowNumber?: number;
  employeeId: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string | null;
};

export type AttendanceImportError = {
  row: number;
  employeeId?: string;
  date?: string;
  message: string;
};

export type AttendanceImportBatchResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: AttendanceImportError[];
};

function calcWorkHours(clockIn: string | null, clockOut: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (ms <= 0) return null;
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

export function normalizeImportDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function normalizeImportTimeHm(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeStatus(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (!ALLOWED_STATUSES.has(s)) return null;
  return s;
}

async function resolveUserIdForEmployeeRef(
  employeeRef: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  const key = String(employeeRef ?? '').trim();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  const pk = await resolveEmployeePk(key);
  const userId = pk ? await findUserIdByEmployeePk(pk) : null;
  cache.set(key, userId);
  return userId;
}

async function resolveImportedStatus(
  userId: string,
  dateKey: string,
  clockIn: string | null,
  explicitStatus: string | null,
  rules: typeof DEFAULT_ATTENDANCE_RULES,
  scheduleCache: Map<string, Awaited<ReturnType<typeof getEmployeeScheduleForUser>>>,
  keysCache: Map<string, Awaited<ReturnType<typeof resolveEmployeeKeysForUser>>>
): Promise<string> {
  if (explicitStatus) return explicitStatus;
  if (!clockIn) throw new Error('Status or Check In is required');

  let schedule = scheduleCache.get(userId);
  if (!schedule) {
    schedule = await getEmployeeScheduleForUser(userId);
    scheduleCache.set(userId, schedule);
  }
  let keys = keysCache.get(userId);
  if (!keys) {
    keys = await resolveEmployeeKeysForUser(userId);
    keysCache.set(userId, keys);
  }
  const ctx = await buildAttendanceStatusContext(userId, keys, dateKey, dateKey);
  return resolveAttendanceDisplayStatus(
    { clockIn, status: 'PRESENT', date: dateKey, userId },
    schedule,
    rules,
    ctx
  );
}

type ParsedImportRow = {
  rowNumber: number;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string | null;
  clockInIso: string | null;
  clockOutIso: string | null;
};

function parseImportRow(
  row: AttendanceImportInputRow,
  fallbackRowNumber: number
): { parsed?: ParsedImportRow; error?: string } {
  const rowNumber = Number(row.rowNumber) > 0 ? Number(row.rowNumber) : fallbackRowNumber;
  const employeeId = String(row.employeeId ?? '').trim();
  if (!employeeId) return { error: 'Employee ID is required' };

  const date = normalizeImportDate(row.date);
  if (!date) return { error: 'Date must be YYYY-MM-DD' };

  const checkInHm = normalizeImportTimeHm(row.checkIn);
  if (row.checkIn != null && String(row.checkIn).trim() && !checkInHm) {
    return { error: 'Check In must be HH:mm (24-hour)' };
  }

  const checkOutHm = normalizeImportTimeHm(row.checkOut);
  if (row.checkOut != null && String(row.checkOut).trim() && !checkOutHm) {
    return { error: 'Check Out must be HH:mm (24-hour)' };
  }

  const status = normalizeStatus(row.status);
  if (row.status != null && String(row.status).trim() && !status) {
    return { error: 'Invalid status' };
  }

  if (!checkInHm && !checkOutHm && !status) {
    return { error: 'Provide Check In, Check Out, and/or Status' };
  }

  let clockInIso: string | null = null;
  let clockOutIso: string | null = null;
  try {
    if (checkInHm) clockInIso = combineDateAndTimeIct(date, checkInHm);
    if (checkOutHm) clockOutIso = combineDateAndTimeIct(date, checkOutHm);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid date or time' };
  }

  if (clockInIso && clockOutIso && new Date(clockOutIso).getTime() <= new Date(clockInIso).getTime()) {
    return { error: 'Check Out must be after Check In' };
  }

  return {
    parsed: {
      rowNumber,
      employeeId,
      date,
      checkIn: checkInHm,
      checkOut: checkOutHm,
      status,
      clockInIso,
      clockOutIso,
    },
  };
}

type ImportRuntime = {
  rules: typeof DEFAULT_ATTENDANCE_RULES;
  scheduleCache: Map<string, Awaited<ReturnType<typeof getEmployeeScheduleForUser>>>;
  keysCache: Map<string, Awaited<ReturnType<typeof resolveEmployeeKeysForUser>>>;
  applyLateFieldsToRecord: (args: {
    id: string;
    userId: string;
    date: string;
    clockIn: string | null;
    status: string | null;
  }) => Promise<unknown>;
};

async function upsertImportedRow(
  parsed: ParsedImportRow,
  userId: string,
  correctorUserId: string,
  reason: string,
  runtime: ImportRuntime
): Promise<'created' | 'updated' | 'skipped'> {
  const { date, clockInIso, clockOutIso } = parsed;
  const existing: any = await AttendanceRecord.findOne({ where: { userId, date } });
  const freezeRow = existing ? (existing.get({ plain: true }) as Record<string, unknown>) : null;

  const resolvedStatus = await resolveImportedStatus(
    userId,
    date,
    clockInIso,
    parsed.status,
    runtime.rules,
    runtime.scheduleCache,
    runtime.keysCache
  );

  const nextClockIn = clockInIso ?? existing?.clockIn ?? null;
  const nextClockOut = clockOutIso ?? existing?.clockOut ?? null;
  const nextStatus = parsed.status ?? resolvedStatus;
  const nextWorkHours = calcWorkHours(nextClockIn, nextClockOut);

  if (existing) {
    const unchanged =
      String(existing.clockIn ?? '') === String(nextClockIn ?? '') &&
      String(existing.clockOut ?? '') === String(nextClockOut ?? '') &&
      String(existing.status ?? '').toUpperCase() === String(nextStatus ?? '').toUpperCase();
    if (unchanged) return 'skipped';

    if (attendanceRecordHasPersistedData(freezeRow)) {
      await assertAttendanceRecordUpdatable(date, freezeRow);
    } else {
      await assertAttendanceRecordCreatable(date, freezeRow);
    }
    const previous = {
      clockIn: existing.clockIn ?? null,
      clockOut: existing.clockOut ?? null,
    };
    existing.clockIn = nextClockIn;
    existing.clockOut = nextClockOut;
    existing.status = nextStatus;
    existing.workHours = nextWorkHours;
    existing.correctionAt = new Date().toISOString();
    existing.correctionBy = correctorUserId;
    existing.correctionReason = reason;
    existing.correctionSummary = buildCorrectionChangeSummary(previous, {
      clockIn: nextClockIn,
      clockOut: nextClockOut,
    });
    await existing.save();

    try {
      await runtime.applyLateFieldsToRecord({
        id: String(existing.id),
        userId,
        date,
        clockIn: existing.clockIn,
        status: existing.status,
      });
    } catch (lateErr) {
      console.warn('Late attendance warning processing failed:', (lateErr as Error)?.message);
    }

    return 'updated';
  }

  const existingForCreate = await loadAttendanceRowForFreezeCheck(userId, date);
  await assertAttendanceRecordCreatable(date, existingForCreate);

  const row = await AttendanceRecord.create({
    id: `att-${userId}-${date}`,
    userId,
    date,
    clockIn: nextClockIn,
    clockOut: nextClockOut,
    status: nextStatus,
    workHours: nextWorkHours,
    locationIn: null,
    locationOut: null,
    correctionAt: new Date().toISOString(),
    correctionBy: correctorUserId,
    correctionReason: reason,
    correctionSummary: 'Imported attendance record',
  });

  try {
    await runtime.applyLateFieldsToRecord({
      id: String(row.id),
      userId,
      date,
      clockIn: row.clockIn,
      status: row.status,
    });
  } catch (lateErr) {
    console.warn('Late attendance warning processing failed:', (lateErr as Error)?.message);
  }

  return 'created';
}

export async function importAttendanceRows(
  rows: AttendanceImportInputRow[],
  correctorUserId: string,
  reason: string
): Promise<AttendanceImportBatchResult> {
  await ensureAttendanceRecordCorrectionColumns();

  const importReason = String(reason ?? '').trim();
  if (importReason.length < 3) {
    throw new Error('Import reason is required (at least 3 characters)');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No rows to import');
  }
  if (rows.length > MAX_ATTENDANCE_IMPORT_ROWS) {
    throw new Error(`Import is limited to ${MAX_ATTENDANCE_IMPORT_ROWS} rows per file`);
  }

  const result: AttendanceImportBatchResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const userIdCache = new Map<string, string | null>();
  const settings = await getAttendanceGeofenceConfig();
  const { applyLateFieldsToRecord } = await import('./attendanceLateFields.js');
  const runtime: ImportRuntime = {
    rules: settings?.rules ?? DEFAULT_ATTENDANCE_RULES,
    scheduleCache: new Map(),
    keysCache: new Map(),
    applyLateFieldsToRecord,
  };

  for (let index = 0; index < rows.length; index += 1) {
    const input = rows[index];
    const { parsed, error: parseError } = parseImportRow(input, index + 1);
    if (parseError || !parsed) {
      result.errors.push({
        row: parsed?.rowNumber ?? index + 1,
        employeeId: String(input.employeeId ?? '').trim() || undefined,
        date: normalizeImportDate(input.date) ?? undefined,
        message: parseError ?? 'Invalid row',
      });
      continue;
    }

    try {
      const userId = await resolveUserIdForEmployeeRef(parsed.employeeId, userIdCache);
      if (!userId) {
        result.errors.push({
          row: parsed.rowNumber,
          employeeId: parsed.employeeId,
          date: parsed.date,
          message: 'Employee ID not found or not linked to a portal user',
        });
        continue;
      }

      await assertEligibleForAttendanceOnDate(userId, parsed.date);

      const outcome = await upsertImportedRow(
        parsed,
        userId,
        correctorUserId,
        importReason,
        runtime
      );
      if (outcome === 'created') result.created += 1;
      else if (outcome === 'updated') result.updated += 1;
      else result.skipped += 1;
    } catch (e) {
      let message = e instanceof Error ? e.message : 'Import failed';
      if (e instanceof AttendanceFrozenError) message = e.message;
      if (e instanceof EmployeePayrollBoundaryError) message = e.message;
      result.errors.push({
        row: parsed.rowNumber,
        employeeId: parsed.employeeId,
        date: parsed.date,
        message,
      });
    }
  }

  return result;
}
