import { sequelize, SystemSetting } from './db.js';
import { QueryTypes } from 'sequelize';
import { resolveOfficeWorksite, type ResolvedWorksite } from './attendanceGeo';
import { minutesFromIsoIct } from './attendanceTimeZone.js';

export type AttendanceClockRules = {
  requireGps: boolean;
  requireInZoneToClockIn: boolean;
  requireInZoneToClockOut: boolean;
  requireGpsOnClockOut: boolean;
  lateAfterHour: number;
  lateAfterMinute: number;
  gracePeriodMinutes: number;
};

export type OfficeLocationDto = {
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

/** Legacy single-office shape (first active office + rules). */
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

export type AttendanceSettingsPayload = {
  rules: AttendanceClockRules;
  offices: OfficeLocationDto[];
};

const RULES_KEY = 'attendance.clock_rules';
const PRIMARY_OFFICE_KEY = 'attendance.primary_office_id';
/** Single office geofence — JSON object in systemsettings (no officelocations table). */
export const OFFICE_KEY = 'attendance.office_location';
/** @deprecated Legacy key — migrated to OFFICE_KEY */
const LEGACY_OFFICES_KEY = 'attendance.office_locations';

/** Default zone (Phnom Penh) used until HR saves attendance location settings. */
export const DEFAULT_OFFICE_LOCATIONS: OfficeLocationDto[] = [
  {
    id: 'off-main',
    name: 'Main Office',
    address: 'Phnom Penh, Cambodia',
    latitude: 11.5564,
    longitude: 104.9282,
    radiusMeters: 20,
    workingHoursStart: '08:00',
    workingHoursEnd: '17:00',
    isActive: true,
  },
];

/** Default GPS / zone enforcement (editable via Clock rules UI). */
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
  const merged = { ...DEFAULT_ATTENDANCE_RULES, ...(raw || {}) };
  const fromHours = workingHoursStart
    ? lateAfterFromWorkingHoursStart(workingHoursStart)
    : {
        lateAfterHour: Math.min(23, Math.max(0, Math.round(Number(merged.lateAfterHour) || 0))),
        lateAfterMinute: Math.min(59, Math.max(0, Math.round(Number(merged.lateAfterMinute) || 0))),
      };
  const grace = Math.round(Number(merged.gracePeriodMinutes));
  return {
    requireGps: merged.requireGps !== false,
    requireInZoneToClockIn: merged.requireInZoneToClockIn !== false,
    requireInZoneToClockOut: merged.requireInZoneToClockOut === true,
    requireGpsOnClockOut: merged.requireGpsOnClockOut !== false,
    lateAfterHour: fromHours.lateAfterHour,
    lateAfterMinute: fromHours.lateAfterMinute,
    gracePeriodMinutes: Number.isFinite(grace) ? Math.min(240, Math.max(0, grace)) : 15,
  };
}

function parseRules(
  raw: string | Record<string, unknown> | null | undefined,
  workingHoursStart?: string | null
): AttendanceClockRules {
  if (!raw) return normalizeAttendanceClockRules(DEFAULT_ATTENDANCE_RULES, workingHoursStart);
  if (typeof raw === 'object') {
    return normalizeAttendanceClockRules(raw as Partial<AttendanceClockRules>, workingHoursStart);
  }
  try {
    const parsed = JSON.parse(raw);
    return normalizeAttendanceClockRules(
      typeof parsed === 'object' && parsed ? (parsed as Partial<AttendanceClockRules>) : {},
      workingHoursStart
    );
  } catch {
    return normalizeAttendanceClockRules(DEFAULT_ATTENDANCE_RULES, workingHoursStart);
  }
}

function settingStringValue(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') return raw.replace(/^"|"$/g, '');
  return String(raw);
}

async function getRulesFromDb(workingHoursStart?: string | null): Promise<AttendanceClockRules> {
  const row: any = await SystemSetting.findOne({ where: { key: RULES_KEY } });
  return parseRules(row?.value, workingHoursStart);
}

function normalizeOfficeDto(raw: Record<string, unknown>, index = 0): OfficeLocationDto {
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  return {
    id: String(raw.id ?? `off-${index}`),
    name: String(raw.name || 'Office'),
    address: raw.address ? String(raw.address) : undefined,
    latitude: Number.isFinite(latitude) ? latitude : 11.5564,
    longitude: Number.isFinite(longitude) ? longitude : 104.9282,
    radiusMeters: Number(raw.radiusMeters) || 20,
    workingHoursStart: String(raw.workingHoursStart || '08:00'),
    workingHoursEnd: String(raw.workingHoursEnd || '17:00'),
    isActive: raw.isActive !== false,
  };
}

function parseOfficeFromSetting(raw: unknown): OfficeLocationDto | null {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    if (!first || typeof first !== 'object') return null;
    const name = String((first as Record<string, unknown>).name ?? '').trim();
    if (!name) return null;
    return normalizeOfficeDto(first as Record<string, unknown>);
  }
  if (typeof parsed !== 'object') return null;
  const name = String((parsed as Record<string, unknown>).name ?? '').trim();
  if (!name) return null;
  return normalizeOfficeDto(parsed as Record<string, unknown>);
}

async function getOfficeFromSystemSettings(): Promise<OfficeLocationDto | null> {
  const single: any = await SystemSetting.findOne({ where: { key: OFFICE_KEY } });
  if (single) {
    const office = parseOfficeFromSetting(single.value);
    if (office) return office;
  }
  const legacy: any = await SystemSetting.findOne({ where: { key: LEGACY_OFFICES_KEY } });
  if (!legacy) return null;
  return parseOfficeFromSetting(legacy.value);
}

async function saveOfficeToSystemSettings(office: OfficeLocationDto): Promise<void> {
  const normalized = normalizeOfficeDto(
    { ...office, id: office.id || 'off-main', isActive: true },
    0
  );
  const row: any = await SystemSetting.findOne({ where: { key: OFFICE_KEY } });
  if (row) {
    await row.update({ value: normalized });
  } else {
    await SystemSetting.create({
      id: 'ss-attendance-office-location',
      key: OFFICE_KEY,
      value: normalized,
      description: 'Attendance office geofence (single site, GPS clock-in)',
      category: 'attendance',
      isPublic: true,
    });
  }
  await setPrimaryOfficeId(normalized.id);
  invalidateOfficeLocationCache();
}

async function legacyOfficelocationsTableExists(): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'officelocations' LIMIT 1`,
    { type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

/** Drop legacy `officelocations` table — location lives in systemsettings only. */
export async function dropLegacyOfficelocationsTable(): Promise<void> {
  if (!(await legacyOfficelocationsTableExists())) return;
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await sequelize.query('DROP TABLE IF EXISTS `officelocations`');
    console.log('[attendance] Dropped legacy officelocations table.');
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** Import legacy table / array key, then drop officelocations. */
export async function migrateLegacyOfficelocationsIfNeeded(): Promise<void> {
  let office = await getOfficeFromSystemSettings();

  if (office) {
    const singleRow: any = await SystemSetting.findOne({ where: { key: OFFICE_KEY } });
    if (!singleRow) {
      await saveOfficeToSystemSettings(office);
    }
    const legacyRow: any = await SystemSetting.findOne({ where: { key: LEGACY_OFFICES_KEY } });
    if (legacyRow) {
      await legacyRow.destroy();
    }
  }

  if (!office && (await legacyOfficelocationsTableExists())) {
    const rows = (await sequelize.query(
      `SELECT id, name, address, latitude, longitude, radiusMeters, workingHoursStart, workingHoursEnd
       FROM officelocations WHERE isActive = 1 ORDER BY name ASC LIMIT 1`,
      { type: QueryTypes.SELECT }
    )) as Record<string, unknown>[];
    if (rows[0]) {
      office = normalizeOfficeDto(rows[0]);
      await saveOfficeToSystemSettings(office);
      console.log('[attendance] Migrated office from officelocations to systemsettings.');
    }
  }

  await dropLegacyOfficelocationsTable();
}

const OFFICE_CACHE_TTL_MS = 60_000;
let officeLocationCache: { at: number; office: OfficeLocationDto } | null = null;

/** Clear cached office DTO (call after office settings writes). Migration runs at DB init only. */
export function invalidateOfficeLocationCache(): void {
  officeLocationCache = null;
}

export async function getPrimaryOfficeLocation(): Promise<OfficeLocationDto> {
  const now = Date.now();
  if (officeLocationCache && now - officeLocationCache.at < OFFICE_CACHE_TTL_MS) {
    return officeLocationCache.office;
  }
  const office = (await getOfficeFromSystemSettings()) ?? { ...DEFAULT_OFFICE_LOCATIONS[0] };
  officeLocationCache = { at: now, office };
  return office;
}

export async function getOfficeById(officeId: string): Promise<OfficeLocationDto | null> {
  const office = await getPrimaryOfficeLocation();
  if (!officeId || office.id === officeId) return office;
  return null;
}

/** API compat — always returns zero or one office. */
export async function listActiveOfficeLocations(): Promise<OfficeLocationDto[]> {
  const office = await getPrimaryOfficeLocation();
  return office.isActive === false ? [] : [office];
}

async function getPrimaryOfficeId(): Promise<string | null> {
  const row: any = await SystemSetting.findOne({ where: { key: PRIMARY_OFFICE_KEY } });
  const primary = settingStringValue(row?.value);
  if (primary) return primary;
  const offices = await listActiveOfficeLocations();
  return offices[0]?.id ?? null;
}

async function setPrimaryOfficeId(officeId: string): Promise<void> {
  const primaryRow: any = await SystemSetting.findOne({ where: { key: PRIMARY_OFFICE_KEY } });
  if (primaryRow) {
    await primaryRow.update({ value: officeId });
  } else {
    await SystemSetting.create({
      id: 'ss-attendance-primary-office',
      key: PRIMARY_OFFICE_KEY,
      value: officeId,
      description: 'Primary office (QR default, legacy display)',
      category: 'attendance',
      isPublic: false,
    });
  }
}

export async function getAttendanceSettings(): Promise<AttendanceSettingsPayload> {
  const offices = await listActiveOfficeLocations();
  const workingHoursStart = offices[0]?.workingHoursStart ?? null;
  const rules = await getRulesFromDb(workingHoursStart);
  return { rules, offices };
}

const GEOFENCE_CACHE_TTL_MS = 60_000;
let geofenceConfigCache: { at: number; data: AttendanceGeofenceConfig | null } | null = null;

export function invalidateAttendanceGeofenceCache(): void {
  geofenceConfigCache = null;
}

export async function getAttendanceGeofenceConfig(): Promise<AttendanceGeofenceConfig | null> {
  const now = Date.now();
  if (geofenceConfigCache && now - geofenceConfigCache.at < GEOFENCE_CACHE_TTL_MS) {
    return geofenceConfigCache.data;
  }

  const { rules, offices } = await getAttendanceSettings();
  if (!offices.length) {
    geofenceConfigCache = { at: now, data: null };
    return null;
  }

  const primaryId = await getPrimaryOfficeId();
  const office = offices.find((o) => o.id === primaryId) ?? offices[0];

  const data: AttendanceGeofenceConfig = {
    officeId: office.id,
    name: office.name,
    address: office.address,
    latitude: office.latitude,
    longitude: office.longitude,
    radiusMeters: office.radiusMeters,
    workingHoursStart: office.workingHoursStart,
    workingHoursEnd: office.workingHoursEnd,
    rules: normalizeAttendanceClockRules(rules, office.workingHoursStart),
  };
  geofenceConfigCache = { at: now, data };
  return data;
}

export async function saveAttendanceSettings(
  input: Partial<AttendanceSettingsPayload>,
  updatedBy?: string | null
): Promise<AttendanceSettingsPayload> {
  invalidateOfficeLocationCache();
  invalidateAttendanceGeofenceCache();

  let workingHoursStart: string | null = null;
  if (Array.isArray(input.offices) && input.offices.length) {
    const first = input.offices.find((o) => String(o.name ?? '').trim());
    if (first) {
      const normalizedOffice = normalizeOfficeDto(
        {
          id: first.id || 'off-main',
          name: first.name,
          address: first.address,
          latitude: first.latitude,
          longitude: first.longitude,
          radiusMeters: first.radiusMeters,
          workingHoursStart: first.workingHoursStart,
          workingHoursEnd: first.workingHoursEnd,
          isActive: first.isActive !== false,
        },
        0
      );
      workingHoursStart = normalizedOffice.workingHoursStart;
      await saveOfficeToSystemSettings(normalizedOffice);
    }
  }
  if (!workingHoursStart) {
    const existing = await getPrimaryOfficeLocation();
    workingHoursStart = existing.workingHoursStart;
  }

  // Persist clock rules from the UI (GPS toggles + grace). Late-after fallback follows office hours.
  const existingRules = await getRulesFromDb(workingHoursStart);
  const incoming = input.rules || {};
  const rules = normalizeAttendanceClockRules(
    {
      ...existingRules,
      ...incoming,
      gracePeriodMinutes:
        incoming.gracePeriodMinutes != null
          ? Number(incoming.gracePeriodMinutes)
          : existingRules.gracePeriodMinutes,
    },
    workingHoursStart
  );

  const rulesRow: any = await SystemSetting.findOne({ where: { key: RULES_KEY } });
  if (rulesRow) {
    await rulesRow.update({ value: rules });
  } else {
    await SystemSetting.create({
      id: 'ss-attendance-clock-rules',
      key: RULES_KEY,
      value: rules,
      description: 'Attendance clock-in/out geofence and GPS rules',
      category: 'attendance',
      isPublic: false,
    });
  }

  return getAttendanceSettings();
}

/** @deprecated Use saveAttendanceSettings — accepts legacy single-office body. */
export async function saveAttendanceGeofenceConfig(
  input: Partial<AttendanceGeofenceConfig>
): Promise<AttendanceGeofenceConfig> {
  const payload: Partial<AttendanceSettingsPayload> = {};
  if (input.rules) payload.rules = input.rules;
  const hasOfficeFields =
    input.name != null ||
    input.latitude != null ||
    input.longitude != null ||
    input.officeId != null;
  if (hasOfficeFields) {
    payload.offices = [
      {
        id: input.officeId || '',
        name: input.name || 'Main Office',
        address: input.address,
        latitude: input.latitude ?? 11.5564,
        longitude: input.longitude ?? 104.9282,
        radiusMeters: input.radiusMeters ?? 20,
        workingHoursStart: input.workingHoursStart || '08:00',
        workingHoursEnd: input.workingHoursEnd || '17:00',
        isActive: true,
      },
    ];
  }
  await saveAttendanceSettings(payload);
  const saved = await getAttendanceGeofenceConfig();
  if (!saved) throw new Error('Failed to load saved attendance settings');
  return saved;
}

/** Primary office worksite (org default fallback when department has no office). */
export async function getPrimaryOfficeWorksite(): Promise<ResolvedWorksite | null> {
  const config = await getAttendanceGeofenceConfig();
  if (!config) return null;
  return resolveOfficeWorksite({
    name: config.name,
    latitude: config.latitude,
    longitude: config.longitude,
    radiusMeters: config.radiusMeters,
  });
}

export function attendanceLateStatus(now: Date, rules: AttendanceClockRules): string {
  const cutoffMinutes = rules.lateAfterHour * 60 + rules.lateAfterMinute + rules.gracePeriodMinutes;
  const nowMinutes = minutesFromIsoIct(now);
  return nowMinutes > cutoffMinutes ? 'LATE' : 'PRESENT';
}
