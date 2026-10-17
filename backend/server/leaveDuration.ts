export type LeaveHalfDayPeriod = 'AM' | 'PM';

export type LeaveDurationFields = {
  startDate: string;
  endDate: string;
  isHalfDay?: boolean | null;
  halfDayPeriod?: LeaveHalfDayPeriod | string | null;
};

/** Inclusive calendar days between ISO dates; half-day on a single date counts as 0.5. */
export function leaveDurationDays(fields: LeaveDurationFields): number {
  const startDate = String(fields.startDate ?? '').slice(0, 10);
  const endDate = String(fields.endDate ?? '').slice(0, 10);
  if (!startDate || !endDate) return 0;

  if (fields.isHalfDay) {
    if (startDate !== endDate) return 0;
    return 0.5;
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diff = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
}

/** Calendar days of leave overlapping [rangeStart, rangeEnd] inclusive. */
export function leaveOverlapDaysInRange(
  fields: LeaveDurationFields,
  rangeStart: string,
  rangeEnd: string
): number {
  const leaveStart = String(fields.startDate ?? '').slice(0, 10);
  const leaveEnd = String(fields.endDate ?? '').slice(0, 10);
  if (!leaveStart || !leaveEnd) return 0;

  if (fields.isHalfDay && leaveStart === leaveEnd) {
    if (leaveStart >= rangeStart && leaveStart <= rangeEnd) return 0.5;
    return 0;
  }

  const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
  const s = parseDay(leaveStart);
  const e = parseDay(leaveEnd);
  const rs = parseDay(rangeStart);
  const re = parseDay(rangeEnd);
  if ([s, e, rs, re].some((d) => Number.isNaN(d.getTime()))) return 0;
  const from = s > rs ? s : rs;
  const to = e < re ? e : re;
  if (to < from) return 0;
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

export function formatLeaveDateRange(fields: LeaveDurationFields): string {
  const startDate = String(fields.startDate ?? '').slice(0, 10);
  const endDate = String(fields.endDate ?? '').slice(0, 10);
  if (fields.isHalfDay && startDate && startDate === endDate) {
    const period =
      String(fields.halfDayPeriod ?? '').toUpperCase() === 'PM'
        ? 'Afternoon'
        : String(fields.halfDayPeriod ?? '').toUpperCase() === 'AM'
          ? 'Morning'
          : 'Half day';
    return `${startDate} (${period})`;
  }
  if (startDate === endDate) return startDate;
  return `${startDate} → ${endDate}`;
}

export function normalizeHalfDayPeriod(
  raw: unknown
): LeaveHalfDayPeriod | null {
  const p = String(raw ?? '').trim().toUpperCase();
  if (p === 'AM' || p === 'PM') return p;
  return null;
}

export type NormalizedLeaveBody = {
  userId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
  isHalfDay: boolean;
  halfDayPeriod: LeaveHalfDayPeriod | null;
  assignedManagerId: string;
  /** Optional; when set, server verifies manager belongs to this department. */
  assignedDepartmentId?: string;
};

/** Validate and normalize leave create payload. Returns error message or normalized body. */
export function normalizeLeaveCreateBody(
  data: Record<string, unknown>
): { ok: true; body: NormalizedLeaveBody } | { ok: false; message: string } {
  const userId = String(data.userId ?? data.employeeId ?? '').trim();
  const type = String(data.type ?? '').trim();
  const reason = String(data.reason ?? '').trim();
  let startDate = String(data.startDate ?? '').slice(0, 10);
  let endDate = String(data.endDate ?? '').slice(0, 10);
  const isHalfDay = Boolean(data.isHalfDay);

  if (!userId) return { ok: false, message: 'User is required' };
  if (!type) return { ok: false, message: 'Leave type is required' };
  if (!startDate) return { ok: false, message: 'Start date is required' };
  if (!reason) return { ok: false, message: 'Reason is required' };

  let halfDayPeriod: LeaveHalfDayPeriod | null = null;

  if (isHalfDay) {
    if (!endDate) endDate = startDate;
    endDate = startDate;
    halfDayPeriod = normalizeHalfDayPeriod(data.halfDayPeriod);
    if (!halfDayPeriod) {
      return { ok: false, message: 'Select morning or afternoon for half-day leave' };
    }
  } else {
    if (!endDate) return { ok: false, message: 'End date is required' };
    halfDayPeriod = null;
  }

  if (new Date(startDate) > new Date(endDate)) {
    return { ok: false, message: 'End date must be on or after start date' };
  }

  const assignedManagerId = String(
    data.assignedManagerId ?? data.managerId ?? data.approverId ?? ''
  ).trim();
  const assignedDepartmentId = String(
    data.assignedDepartmentId ?? data.departmentId ?? ''
  ).trim();

  return {
    ok: true,
    body: {
      userId,
      type,
      startDate,
      endDate,
      reason,
      isHalfDay,
      halfDayPeriod,
      assignedManagerId,
      ...(assignedDepartmentId ? { assignedDepartmentId } : {}),
    },
  };
}
