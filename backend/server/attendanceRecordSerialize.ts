/** Return attendancerecords rows as JSON without recalculating stored fields. */

function parseJsonField(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function attendanceRecordToJson(row: unknown): Record<string, unknown> {
  const plain =
    (row as { get?: (o: { plain: boolean }) => Record<string, unknown> })?.get?.({ plain: true }) ??
    (row as Record<string, unknown>);

  const workHoursRaw = plain.workHours ?? plain.work_hours;
  let workHours: number | null = null;
  if (workHoursRaw != null && workHoursRaw !== '') {
    const n = Number(workHoursRaw);
    workHours = Number.isFinite(n) ? n : null;
  }

  const clockIn =
    plain.clockIn != null ? String(plain.clockIn) : plain.clock_in != null ? String(plain.clock_in) : null;
  const lateMinutes =
    plain.lateMinutes != null
      ? Number(plain.lateMinutes) || 0
      : plain.late_minutes != null
        ? Number(plain.late_minutes) || 0
        : 0;
  let status = String(plain.status ?? '').toUpperCase() || null;
  // Prefer lateMinutes (ICT) over a stale LATE/PRESENT label from server-local TZ bugs.
  if (clockIn && (status === 'LATE' || status === 'PRESENT')) {
    status = lateMinutes > 0 ? 'LATE' : 'PRESENT';
  }

  return {
    id: String(plain.id ?? ''),
    userId: String(plain.userId ?? plain.user_id ?? ''),
    date: String(plain.date ?? '').slice(0, 10),
    clockIn,
    clockOut:
      plain.clockOut != null ? String(plain.clockOut) : plain.clock_out != null ? String(plain.clock_out) : null,
    status,
    workHours,
    locationIn: parseJsonField(plain.locationIn ?? plain.location_in),
    locationOut: parseJsonField(plain.locationOut ?? plain.location_out),
    correctionAt:
      plain.correctionAt != null
        ? String(plain.correctionAt)
        : plain.correction_at != null
          ? String(plain.correction_at)
          : null,
    correctionBy:
      plain.correctionBy != null
        ? String(plain.correctionBy)
        : plain.correction_by != null
          ? String(plain.correction_by)
          : null,
    correctionReason:
      plain.correctionReason != null
        ? String(plain.correctionReason)
        : plain.correction_reason != null
          ? String(plain.correction_reason)
          : null,
    correctionSummary:
      plain.correctionSummary != null
        ? String(plain.correctionSummary)
        : plain.correction_summary != null
          ? String(plain.correction_summary)
          : null,
    createdAt: plain.createdAt ?? plain.created_at ?? null,
    updatedAt: plain.updatedAt ?? plain.updated_at ?? null,
    isGridPlaceholder: plain.isGridPlaceholder === true,
    /** True when row exists in MySQL `attendancerecords` (not a same-day roster preview). */
    persistedInDatabase:
      plain.isGridPlaceholder !== true && !String(plain.id ?? '').startsWith('grid-'),
    leaveTypeLabel:
      plain.leaveTypeLabel != null
        ? String(plain.leaveTypeLabel)
        : plain.leave_type_label != null
          ? String(plain.leave_type_label)
          : null,
    leaveTypeCode:
      plain.leaveTypeCode != null
        ? String(plain.leaveTypeCode)
        : plain.leave_type_code != null
          ? String(plain.leave_type_code)
          : null,
    leaveIsPaid:
      plain.leaveIsPaid === true || plain.leaveIsPaid === false
        ? Boolean(plain.leaveIsPaid)
        : plain.leave_is_paid === true || plain.leave_is_paid === false
          ? Boolean(plain.leave_is_paid)
          : null,
    workedOnDayOff: plain.workedOnDayOff === true,
    requiresOvertimeRequest: plain.requiresOvertimeRequest === true,
    otEligibleHours:
      plain.otEligibleHours != null && plain.otEligibleHours !== ''
        ? Number(plain.otEligibleHours)
        : null,
    lateMinutes,
    lateExcused: Boolean(plain.lateExcused ?? plain.late_excused),
  };
}

export function serializeAttendanceRecords(rows: unknown[]): Record<string, unknown>[] {
  return rows.map(attendanceRecordToJson);
}
