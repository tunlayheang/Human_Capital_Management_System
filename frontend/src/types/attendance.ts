export type EmployeeAttendanceSchedule = {
  workDays: number;
  timeIn: string;
  timeOut: string;
  workHours: number;
  breakDurationMinutes: number;
  gracePeriodMinutes: number | null;
};

export type AttendanceClockRules = {
  requireGps: boolean;
  requireInZoneToClockIn: boolean;
  requireInZoneToClockOut: boolean;
  requireGpsOnClockOut: boolean;
  lateAfterHour: number;
  lateAfterMinute: number;
  gracePeriodMinutes: number;
};

export type OfficeLocationZone = {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workingHoursStart: string;
  workingHoursEnd: string;
  isActive: boolean;
};

export type AttendanceSettingsPayload = {
  rules: AttendanceClockRules;
  offices: OfficeLocationZone[];
};

/** @deprecated Legacy single-office API shape */
export type AttendanceGeofenceConfig = {
  officeId: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workingHoursStart: string;
  workingHoursEnd: string;
  rules: AttendanceClockRules;
};

export function newOfficeZone(partial?: Partial<OfficeLocationZone>): OfficeLocationZone {
  return {
    id: partial?.id ?? 'off-main',
    name: partial?.name ?? 'Main Office',
    address: partial?.address ?? '',
    latitude: partial?.latitude ?? 11.5564,
    longitude: partial?.longitude ?? 104.9282,
    radiusMeters: partial?.radiusMeters ?? 20,
    workingHoursStart: partial?.workingHoursStart ?? '08:00',
    workingHoursEnd: partial?.workingHoursEnd ?? '17:00',
    isActive: true,
    ...partial,
  };
}

/** Default GPS / zone enforcement (editable in Clock rules). */
export const DEFAULT_GPS_RULES = {
  requireGps: true,
  requireInZoneToClockIn: true,
  requireInZoneToClockOut: false,
  requireGpsOnClockOut: true,
} as const;

/** @deprecated Use DEFAULT_GPS_RULES — kept for older imports. */
export const SYSTEM_FIXED_GPS_RULES = DEFAULT_GPS_RULES;

export const DEFAULT_ATTENDANCE_RULES: AttendanceClockRules = {
  ...DEFAULT_GPS_RULES,
  lateAfterHour: 8,
  lateAfterMinute: 0,
  gracePeriodMinutes: 15,
};

/** Parse HH:mm into late-after fields (fallback used when no employee schedule). */
export function lateAfterFromWorkingHoursStart(hhmm: string | null | undefined): {
  lateAfterHour: number;
  lateAfterMinute: number;
} {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) {
    return {
      lateAfterHour: DEFAULT_ATTENDANCE_RULES.lateAfterHour,
      lateAfterMinute: DEFAULT_ATTENDANCE_RULES.lateAfterMinute,
    };
  }
  return {
    lateAfterHour: Math.min(23, Math.max(0, parseInt(m[1], 10) || 0)),
    lateAfterMinute: Math.min(59, Math.max(0, parseInt(m[2], 10) || 0)),
  };
}

export function normalizeAttendanceClockRules(
  raw: Partial<AttendanceClockRules> | null | undefined,
  workingHoursStart?: string | null
): AttendanceClockRules {
  const base = { ...DEFAULT_ATTENDANCE_RULES, ...(raw || {}) };
  const fromOffice = workingHoursStart
    ? lateAfterFromWorkingHoursStart(workingHoursStart)
    : {
        lateAfterHour: Math.min(23, Math.max(0, Math.round(Number(base.lateAfterHour) || 0))),
        lateAfterMinute: Math.min(59, Math.max(0, Math.round(Number(base.lateAfterMinute) || 0))),
      };
  const grace = Math.round(Number(base.gracePeriodMinutes));
  return {
    requireGps: base.requireGps !== false,
    requireInZoneToClockIn: base.requireInZoneToClockIn !== false,
    requireInZoneToClockOut: base.requireInZoneToClockOut === true,
    requireGpsOnClockOut: base.requireGpsOnClockOut !== false,
    lateAfterHour: fromOffice.lateAfterHour,
    lateAfterMinute: fromOffice.lateAfterMinute,
    gracePeriodMinutes: Number.isFinite(grace) ? Math.min(240, Math.max(0, grace)) : 15,
  };
}

export type AttendanceImportBatchResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    row: number;
    employeeId?: string;
    date?: string;
    message: string;
  }>;
};
