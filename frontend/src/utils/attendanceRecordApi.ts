import { AttendanceRecord, AttendanceStatus } from '../types';

/** Must match backend seed/clock storage (Asia/Phnom_Penh). */
export const HCMS_ATTENDANCE_TZ = 'Asia/Phnom_Penh';
export const HCMS_ATTENDANCE_TZ_OFFSET = '+07:00';

/** Parse stored attendance clock timestamps (ISO or MySQL datetime) reliably. */
export function parseAttendanceTimestamp(raw?: string | null): Date | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text || text === 'null' || text === 'undefined') return null;

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const withTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
      ? normalized
      : `${normalized}${HCMS_ATTENDANCE_TZ_OFFSET}`;
    const d = new Date(withTz);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pick the best attendance row for a calendar day (prefers real clock times). */
export function pickAttendanceForDate(
  records: AttendanceRecord[],
  dateKey: string
): AttendanceRecord | null {
  const day = dateKey.slice(0, 10);
  const matches = records.filter((r) => String(r.date ?? '').slice(0, 10) === day);
  if (!matches.length) return null;

  const withClock = matches.filter((r) => r.clockIn || r.clockOut);
  const persisted = withClock.filter(
    (r) => r.persistedInDatabase !== false && !String(r.id ?? '').startsWith('grid-')
  );

  return persisted[0] ?? withClock[0] ?? matches[0];
}

/** Display clock time as stored for Cambodia office (matches DB after seed/clock-in). */
export function formatAttendanceClockDisplay(iso?: string | null): string {
  if (!iso) return '—';
  const d = parseAttendanceTimestamp(iso);
  if (!d) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: HCMS_ATTENDANCE_TZ,
  }).format(d);
}

/** HH:mm (24h) in Cambodia office timezone — for edit inputs. */
export type PendingAttendanceTimeEdit = {
  clockInTime: string;
  clockOutTime: string;
  clearClockIn: boolean;
  clearClockOut: boolean;
};

function isoFromIctHm(dateKey: string, hm: string): string | null {
  const day = dateKey.slice(0, 10);
  const match = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const iso = `${day}T${String(match[1]).padStart(2, '0')}:${match[2]}:00+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Detect which fields really differ from DB (ICT wall time). */
export function detectAttendanceTimeChanges(
  record: Pick<AttendanceRecord, 'clockIn' | 'clockOut' | 'date'>,
  edit: PendingAttendanceTimeEdit
): {
  changeClockIn: boolean;
  changeClockOut: boolean;
  clearClockIn: boolean;
  clearClockOut: boolean;
  clockInTime?: string;
  clockOutTime?: string;
  lines: string[];
  summary: string;
  hasChange: boolean;
} {
  const prevInHm = attendanceTimeHmFromIso(record.clockIn);
  const prevOutHm = attendanceTimeHmFromIso(record.clockOut);
  const inHm = edit.clockInTime.trim();
  const outHm = edit.clockOutTime.trim();

  let changeClockIn = false;
  let changeClockOut = false;

  if (edit.clearClockIn && record.clockIn) {
    changeClockIn = true;
  } else if (inHm) {
    const nextIso = isoFromIctHm(record.date, inHm);
    const prevIso = record.clockIn ?? null;
    if (nextIso !== prevIso) changeClockIn = true;
  }

  if (edit.clearClockOut && record.clockOut) {
    changeClockOut = true;
  } else if (outHm) {
    const nextIso = isoFromIctHm(record.date, outHm);
    const prevIso = record.clockOut ?? null;
    if (nextIso !== prevIso) changeClockOut = true;
  }

  const lines: string[] = [];

  if (changeClockIn) {
    const from = formatAttendanceClockDisplay(record.clockIn);
    let to = '—';
    if (!edit.clearClockIn && inHm) {
      const iso = isoFromIctHm(record.date, inHm);
      to = iso ? formatAttendanceClockDisplay(iso) : inHm;
    }
    lines.push(`Check-in: ${from} → ${to}`);
  }

  if (changeClockOut) {
    const from = formatAttendanceClockDisplay(record.clockOut);
    let to = '—';
    if (!edit.clearClockOut && outHm) {
      const iso = isoFromIctHm(record.date, outHm);
      to = iso ? formatAttendanceClockDisplay(iso) : outHm;
    }
    lines.push(`Check-out: ${from} → ${to}`);
  }

  return {
    changeClockIn,
    changeClockOut,
    clearClockIn: changeClockIn && edit.clearClockIn,
    clearClockOut: changeClockOut && edit.clearClockOut,
    clockInTime: changeClockIn && !edit.clearClockIn ? inHm : undefined,
    clockOutTime: changeClockOut && !edit.clearClockOut ? outHm : undefined,
    lines,
    summary: lines.join(' | '),
    hasChange: changeClockIn || changeClockOut,
  };
}

/** Preview "from → to" before save (only fields that actually change). */
export function buildPendingCorrectionSummary(
  record: Pick<AttendanceRecord, 'clockIn' | 'clockOut' | 'date'>,
  edit: PendingAttendanceTimeEdit
): { summary: string; hasChange: boolean; lines: string[] } {
  const d = detectAttendanceTimeChanges(record, edit);
  return { summary: d.summary, hasChange: d.hasChange, lines: d.lines };
}

export function attendanceTimeHmFromIso(iso?: string | null): string {
  if (!iso) return '';
  const d = parseAttendanceTimestamp(iso);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: HCMS_ATTENDANCE_TZ,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function parseLocation(
  value: unknown
): AttendanceRecord['locationIn'] | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object' && value !== null && 'lat' in (value as object)) {
    return value as AttendanceRecord['locationIn'];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && 'lat' in parsed) {
        return parsed as AttendanceRecord['locationIn'];
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function normalizeClockField(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text || text === 'null' || text === 'undefined') return undefined;
  return text;
}

/** Map API / Sequelize row to AttendanceRecord (attendancerecords table). */
export function normalizeAttendanceRecord(row: unknown): AttendanceRecord {
  const r = row as Record<string, unknown>;
  const statusRaw = String(r.status ?? '').toUpperCase();
  const status = (
    statusRaw && Object.values(AttendanceStatus).includes(statusRaw as AttendanceStatus)
      ? statusRaw
      : AttendanceStatus.ABSENT
  ) as AttendanceStatus;

  return {
    id: String(r.id ?? ''),
    userId: String(r.userId ?? r.user_id ?? ''),
    date: String(r.date ?? '').slice(0, 10),
    clockIn: normalizeClockField(r.clockIn ?? r.clock_in),
    clockOut: normalizeClockField(r.clockOut ?? r.clock_out),
    status,
    workHours:
      typeof r.workHours === 'number'
        ? r.workHours
        : typeof r.work_hours === 'number'
          ? (r.work_hours as number)
          : undefined,
    locationIn: parseLocation(r.locationIn ?? r.location_in),
    locationOut: parseLocation(r.locationOut ?? r.location_out),
    correctionAt:
      r.correctionAt != null
        ? String(r.correctionAt)
        : r.correction_at != null
          ? String(r.correction_at)
          : undefined,
    correctionBy:
      r.correctionBy != null
        ? String(r.correctionBy)
        : r.correction_by != null
          ? String(r.correction_by)
          : undefined,
    correctionReason:
      r.correctionReason != null
        ? String(r.correctionReason)
        : r.correction_reason != null
          ? String(r.correction_reason)
          : undefined,
    correctionSummary:
      r.correctionSummary != null
        ? String(r.correctionSummary)
        : r.correction_summary != null
          ? String(r.correction_summary)
          : undefined,
    isGridPlaceholder: r.isGridPlaceholder === true,
    persistedInDatabase:
      r.persistedInDatabase === true ||
      (r.isGridPlaceholder !== true && !String(r.id ?? '').startsWith('grid-')),
    workedOnDayOff: r.workedOnDayOff === true,
    requiresOvertimeRequest: r.requiresOvertimeRequest === true,
    otEligibleHours:
      r.otEligibleHours != null && r.otEligibleHours !== ''
        ? Number(r.otEligibleHours)
        : undefined,
    lateMinutes:
      r.lateMinutes != null
        ? Number(r.lateMinutes) || 0
        : r.late_minutes != null
          ? Number(r.late_minutes) || 0
          : undefined,
    lateExcused: Boolean(r.lateExcused ?? r.late_excused),
  };
}

export function normalizeAttendanceRecordList(rows: unknown): AttendanceRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeAttendanceRecord).filter((r) => r.id && r.userId && r.date);
}
