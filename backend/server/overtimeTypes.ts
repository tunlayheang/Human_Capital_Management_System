export type OvertimeRateTier =
  | 'regular_100'
  | 'daytime_150'
  | 'rest_holiday_200'
  | 'night_200';

export type OvertimeTypeRules = {
  minHours: number;
  maxHoursPerDay: number;
  minAdvanceDays: number;
  requireStartEndTime: boolean;
  requireClockInOut: boolean;
};

export type OvertimeType = {
  id: string;
  name: string;
  nameKh?: string;
  description?: string;
  descriptionKh?: string;
  rateTier: OvertimeRateTier;
  isActive: boolean;
  rules: OvertimeTypeRules;
};

export type OvertimeRequestConfig = {
  types: OvertimeType[];
  globalMaxHoursPerMonth: number;
};

export const VALID_OVERTIME_RATE_TIERS = new Set<OvertimeRateTier>([
  'regular_100',
  'daytime_150',
  'rest_holiday_200',
  'night_200',
]);

export function defaultRules(partial?: Partial<OvertimeTypeRules>): OvertimeTypeRules {
  return {
    minHours: 0.25,
    maxHoursPerDay: 12,
    minAdvanceDays: 0,
    requireStartEndTime: false,
    requireClockInOut: false,
    ...partial,
  };
}

export function defaultOvertimeRequestConfig(): OvertimeRequestConfig {
  return {
    globalMaxHoursPerMonth: 80,
    types: [
      {
        id: 'ot-type-0',
        name: 'Regular overtime',
        description: 'Straight-time overtime at base hourly rate (100%).',
        rateTier: 'regular_100',
        isActive: true,
        rules: defaultRules({ minHours: 0.25, maxHoursPerDay: 8 }),
      },
      {
        id: 'ot-type-1',
        name: 'Weekday overtime',
        description: 'Extra hours on a normal working day (150%).',
        rateTier: 'daytime_150',
        isActive: true,
        rules: defaultRules({ minHours: 0.25, maxHoursPerDay: 8 }),
      },
      {
        id: 'ot-type-2',
        name: 'Rest day / public holiday',
        description: 'Work on roster day off or public holiday (200%).',
        rateTier: 'rest_holiday_200',
        isActive: true,
        rules: defaultRules({ maxHoursPerDay: 12 }),
      },
      {
        id: 'ot-type-3',
        name: 'Night shift overtime',
        description: 'Overtime between 22:00 and 06:00 (200%).',
        rateTier: 'night_200',
        isActive: true,
        rules: defaultRules({ requireClockInOut: true }),
      },
    ],
  };
}

/** MySQL TINYINT / JSON may return 1/0/"1"/"true" — not strict boolean true. */
export function coerceOvertimeRuleFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  return false;
}

export function parseRules(raw: unknown, fallback: OvertimeTypeRules): OvertimeTypeRules {
  if (raw == null || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  return {
    minHours: Number(o.minHours) > 0 ? Number(o.minHours) : fallback.minHours,
    maxHoursPerDay:
      Number(o.maxHoursPerDay) > 0 ? Number(o.maxHoursPerDay) : fallback.maxHoursPerDay,
    minAdvanceDays:
      Number(o.minAdvanceDays) >= 0 ? Number(o.minAdvanceDays) : fallback.minAdvanceDays,
    // Start/end time requirement retired from UI — always off for new saves.
    requireStartEndTime: false,
    requireClockInOut:
      o.requireClockInOut !== undefined
        ? coerceOvertimeRuleFlag(o.requireClockInOut)
        : fallback.requireClockInOut,
  };
}

function parseType(raw: unknown, index: number, globalLimits: OvertimeTypeRules): OvertimeType | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rateTier = VALID_OVERTIME_RATE_TIERS.has(o.rateTier as OvertimeRateTier)
    ? (o.rateTier as OvertimeRateTier)
    : VALID_OVERTIME_RATE_TIERS.has(o.suggestedRateTier as OvertimeRateTier)
      ? (o.suggestedRateTier as OvertimeRateTier)
      : 'daytime_150';

  const legacyLimits =
    o.limits && typeof o.limits === 'object' ? (o.limits as Record<string, unknown>) : null;

  const rules = parseRules(
    o.rules ?? legacyLimits,
    defaultRules({
      minHours: legacyLimits?.minHours != null ? Number(legacyLimits.minHours) : globalLimits.minHours,
      maxHoursPerDay:
        legacyLimits?.maxHoursPerDay != null
          ? Number(legacyLimits.maxHoursPerDay)
          : globalLimits.maxHoursPerDay,
      minAdvanceDays:
        legacyLimits?.minAdvanceDays != null
          ? Number(legacyLimits.minAdvanceDays)
          : globalLimits.minAdvanceDays,
    })
  );

  return {
    id: String(o.id || `ot-type-${index}`),
    name: String(o.name || 'Overtime type'),
    nameKh: o.nameKh ? String(o.nameKh) : o.name_kh ? String(o.name_kh) : undefined,
    description: o.description ? String(o.description) : undefined,
    descriptionKh: o.descriptionKh
      ? String(o.descriptionKh)
      : o.description_kh
        ? String(o.description_kh)
        : undefined,
    rateTier,
    isActive: o.isActive !== false,
    rules,
  };
}

function migrateLegacyConfig(raw: Record<string, unknown>): OvertimeRequestConfig {
  const base = defaultOvertimeRequestConfig();
  const globalLimits =
    raw.limits && typeof raw.limits === 'object'
      ? parseRules(raw.limits, defaultRules())
      : defaultRules();

  const legacyCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const legacyTypes = Array.isArray(raw.types) ? raw.types : legacyCategories;

  const types = legacyTypes
    .map((t, i) => parseType(t, i, globalLimits))
    .filter((t): t is OvertimeType => t != null);

  const globalMaxHoursPerMonth =
    Number(raw.globalMaxHoursPerMonth) > 0
      ? Number(raw.globalMaxHoursPerMonth)
      : Number((raw.limits as Record<string, unknown> | undefined)?.maxHoursPerMonth) > 0
        ? Number((raw.limits as Record<string, unknown>).maxHoursPerMonth)
        : base.globalMaxHoursPerMonth;

  return {
    types: types.length ? types : base.types,
    globalMaxHoursPerMonth,
  };
}

/** Parse legacy SystemSetting JSON into config shape. */
export function parseLegacyOvertimeConfig(raw: unknown): OvertimeRequestConfig {
  if (raw == null || typeof raw !== 'object') return defaultOvertimeRequestConfig();
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.types) || Array.isArray(o.categories)) {
    return migrateLegacyConfig(o);
  }
  return defaultOvertimeRequestConfig();
}
