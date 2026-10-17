import { Op } from 'sequelize';
import { OvertimeRequest, OvertimeType, SystemSetting, sequelize } from './db.js';
import {
  coerceOvertimeRuleFlag,
  defaultOvertimeRequestConfig,
  parseLegacyOvertimeConfig,
  type OvertimeType as OvertimeTypeDto,
} from './overtimeTypes.js';

const LEGACY_CONFIG_KEY = 'overtime.requestConfig';
const GLOBAL_MAX_KEY = 'overtime.globalMaxHoursPerMonth';
const REQUEST_TABLE = 'overtimerequests';
const TYPE_TABLE = 'overtimetypes';

function safeParseJsonValue(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parsePositiveNumberFromSetting(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const parsed = safeParseJsonValue(raw);
  if (typeof parsed === 'number' && parsed > 0) return parsed;
  if (typeof parsed === 'string') {
    const n = Number(parsed);
    if (n > 0) return n;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return null;
}

async function upsertOvertimeSetting(key: string, value: unknown): Promise<void> {
  const existing = await SystemSetting.findOne({ where: { key } });
  if (existing) {
    await existing.update({ value });
    return;
  }
  const id = key === GLOBAL_MAX_KEY ? 'ss-overtime-global-max' : `ss-${key.replace(/\./g, '-')}`;
  await SystemSetting.create({
    id,
    key,
    value,
    category: 'overtime',
    description:
      key === GLOBAL_MAX_KEY ? 'Monthly overtime hour cap' : 'Overtime request configuration',
    isPublic: false,
  });
}

async function ensureTimestampColumns(table: string): Promise<void> {
  await ensureColumn(table, 'createdAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(table, 'updatedAt', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
}

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [table, column] }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  if (await columnExists(table, column)) return;
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`[db] Added ${table}.${column}`);
}

function rowToDto(row: { get: (opts?: { plain: true }) => unknown }): OvertimeTypeDto {
  const p = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: String(p.id),
    name: String(p.name),
    nameKh: p.nameKh != null ? String(p.nameKh) : undefined,
    description: p.description != null ? String(p.description) : undefined,
    descriptionKh: p.descriptionKh != null ? String(p.descriptionKh) : undefined,
    rateTier: (p.rateTier as OvertimeTypeDto['rateTier']) || 'daytime_150',
    isActive: p.isActive !== false,
    rules: {
      minHours: Number(p.minHours) || 0.25,
      maxHoursPerDay: Number(p.maxHoursPerDay) || 12,
      minAdvanceDays: Number(p.minAdvanceDays) || 0,
      requireStartEndTime: false,
      requireClockInOut: coerceOvertimeRuleFlag(p.requireClockInOut),
    },
  };
}

export async function upsertOvertimeTypeRow(type: OvertimeTypeDto): Promise<void> {
  await OvertimeType.upsert({
    id: type.id,
    name: type.name,
    nameKh: type.nameKh ?? null,
    description: type.description ?? null,
    descriptionKh: type.descriptionKh ?? null,
    rateTier: type.rateTier,
    isActive: type.isActive,
    minHours: type.rules.minHours,
    maxHoursPerDay: type.rules.maxHoursPerDay,
    minAdvanceDays: type.rules.minAdvanceDays,
    requireStartEndTime: false,
    requireClockInOut: Boolean(type.rules.requireClockInOut),
  });
}

async function migrateTypesFromLegacySetting(): Promise<void> {
  try {
    const count = await OvertimeType.count();
    if (count > 0) return;

    const row = await SystemSetting.findOne({ where: { key: LEGACY_CONFIG_KEY } });
    let types = defaultOvertimeRequestConfig().types;
    let globalMax = defaultOvertimeRequestConfig().globalMaxHoursPerMonth;

    if (row) {
      try {
        const parsed = safeParseJsonValue(row.get('value'));
        if (parsed && typeof parsed === 'object') {
          const o = parsed as Record<string, unknown>;
          if (Array.isArray(o.types) || Array.isArray(o.categories)) {
            const config = parseLegacyOvertimeConfig(parsed);
            types = config.types;
            globalMax = config.globalMaxHoursPerMonth;
          }
        }
      } catch (err) {
        console.warn(
          '[db] Could not parse legacy overtime.requestConfig — using defaults:',
          (err as Error).message
        );
      }
    }

    for (const t of types) {
      await upsertOvertimeTypeRow(t);
    }

    await upsertOvertimeSetting(GLOBAL_MAX_KEY, globalMax);
    console.log(`[db] Migrated ${types.length} overtime type(s) from legacy config to ${TYPE_TABLE}`);
  } catch (err) {
    console.warn(
      '[db] Could not migrate overtime types from legacy config:',
      (err as Error).message
    );
  }
}

async function migrateRequestExtraData(): Promise<void> {
  try {
    if (!(await columnExists(REQUEST_TABLE, 'extraData'))) return;

    const [rows]: unknown = await sequelize.query(
    `SELECT id, extraData, otTypeId, startTime, endTime, clockIn, clockOut
     FROM \`${REQUEST_TABLE}\`
     WHERE extraData IS NOT NULL`
  );
  if (!Array.isArray(rows)) return;

  for (const raw of rows as Record<string, unknown>[]) {
    const id = String(raw.id);
    let extra: Record<string, unknown> | null = null;
    const blob = raw.extraData;
    if (blob != null && typeof blob === 'object') {
      extra = blob as Record<string, unknown>;
    } else if (typeof blob === 'string') {
      try {
        extra = JSON.parse(blob) as Record<string, unknown>;
      } catch {
        extra = null;
      }
    }
    if (!extra) continue;

    const patch: Record<string, unknown> = {};
    if (!raw.otTypeId && extra.otTypeId) patch.otTypeId = String(extra.otTypeId);
    if (!raw.startTime && extra.startTime) patch.startTime = String(extra.startTime).slice(0, 8);
    if (!raw.endTime && extra.endTime) patch.endTime = String(extra.endTime).slice(0, 8);
    if (!raw.clockIn && extra.clockIn) patch.clockIn = new Date(String(extra.clockIn));
    if (!raw.clockOut && extra.clockOut) patch.clockOut = new Date(String(extra.clockOut));

    if (Object.keys(patch).length === 0) continue;

    const rowModel = await OvertimeRequest.findByPk(id);
    if (rowModel) await rowModel.update(patch);
  }

  console.log('[db] Migrated overtimerequests.extraData into relational columns');
  } catch (err) {
    console.warn(
      '[db] Could not migrate overtimerequests.extraData:',
      (err as Error).message
    );
  }
}

async function ensureOvertimeTypesTable(): Promise<void> {
  if (await tableExists(TYPE_TABLE)) return;
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`${TYPE_TABLE}\` (
      \`id\` varchar(255) NOT NULL,
      \`name\` varchar(255) NOT NULL,
      \`nameKh\` varchar(255) DEFAULT NULL,
      \`description\` text DEFAULT NULL,
      \`descriptionKh\` text DEFAULT NULL,
      \`rateTier\` enum('regular_100','daytime_150','rest_holiday_200','night_200') NOT NULL DEFAULT 'daytime_150',
      \`isActive\` tinyint(1) NOT NULL DEFAULT 1,
      \`minHours\` decimal(4,2) NOT NULL DEFAULT 0.25,
      \`maxHoursPerDay\` decimal(5,2) NOT NULL DEFAULT 12.00,
      \`minAdvanceDays\` int(11) NOT NULL DEFAULT 0,
      \`requireStartEndTime\` tinyint(1) NOT NULL DEFAULT 0,
      \`requireClockInOut\` tinyint(1) NOT NULL DEFAULT 0,
      \`createdAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      KEY \`overtimetypes_is_active\` (\`isActive\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log(`[db] Created ${TYPE_TABLE} table`);
}

async function ensureOvertimeTypeColumns(): Promise<void> {
  await ensureColumn(TYPE_TABLE, 'name', "VARCHAR(255) NOT NULL DEFAULT 'Overtime type'");
  await ensureColumn(TYPE_TABLE, 'nameKh', 'VARCHAR(255) NULL');
  await ensureColumn(TYPE_TABLE, 'description', 'TEXT NULL');
  await ensureColumn(TYPE_TABLE, 'descriptionKh', 'TEXT NULL');
  await ensureColumn(
    TYPE_TABLE,
    'rateTier',
    "ENUM('regular_100', 'daytime_150', 'rest_holiday_200', 'night_200') NOT NULL DEFAULT 'daytime_150'"
  );
  await ensureColumn(TYPE_TABLE, 'isActive', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureColumn(TYPE_TABLE, 'minHours', 'DECIMAL(4,2) NOT NULL DEFAULT 0.25');
  await ensureColumn(TYPE_TABLE, 'maxHoursPerDay', 'DECIMAL(5,2) NOT NULL DEFAULT 12.00');
  await ensureColumn(TYPE_TABLE, 'minAdvanceDays', 'INT(11) NOT NULL DEFAULT 0');
  await ensureColumn(TYPE_TABLE, 'requireStartEndTime', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(TYPE_TABLE, 'requireClockInOut', 'TINYINT(1) NOT NULL DEFAULT 0');
}

async function ensureRequestColumns(): Promise<void> {
  await ensureColumn(REQUEST_TABLE, 'otTypeId', 'VARCHAR(255) NULL');
  await ensureColumn(REQUEST_TABLE, 'startTime', 'VARCHAR(8) NULL');
  await ensureColumn(REQUEST_TABLE, 'endTime', 'VARCHAR(8) NULL');
  await ensureColumn(REQUEST_TABLE, 'clockIn', 'DATETIME NULL');
  await ensureColumn(REQUEST_TABLE, 'clockOut', 'DATETIME NULL');
  await ensureColumn(
    REQUEST_TABLE,
    'rateTier',
    "ENUM('regular_100', 'daytime_150', 'rest_holiday_200', 'night_200') NOT NULL DEFAULT 'daytime_150'"
  );
}

const RATE_TIER_ENUM_DDL =
  "ENUM('regular_100', 'daytime_150', 'rest_holiday_200', 'night_200') NOT NULL DEFAULT 'daytime_150'";

const REQUEST_STATUS_ENUM_DDL =
  "ENUM('PENDING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED') NOT NULL DEFAULT 'PENDING'";

/** Expand MySQL ENUM so RETURNED / CANCELLED can be stored on existing DBs. */
async function ensureStatusEnumIncludesReturned(): Promise<void> {
  if (!(await tableExists(REQUEST_TABLE))) return;
  if (!(await columnExists(REQUEST_TABLE, 'status'))) return;
  try {
    const [rows]: unknown = await sequelize.query(
      `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'status' LIMIT 1`,
      { replacements: [REQUEST_TABLE] }
    );
    const columnType = String(
      Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
        ? (rows[0] as { columnType?: string }).columnType ?? ''
        : ''
    );
    const needsReturned = !columnType.includes('RETURNED');
    const needsCancelled = !columnType.includes('CANCELLED');
    if (!needsReturned && !needsCancelled) return;
    await sequelize.query(
      `ALTER TABLE \`${REQUEST_TABLE}\` MODIFY COLUMN \`status\` ${REQUEST_STATUS_ENUM_DDL}`
    );
    console.log(
      `[db] Expanded ${REQUEST_TABLE}.status ENUM` +
        (needsReturned ? ' with RETURNED' : '') +
        (needsCancelled ? ' with CANCELLED' : '')
    );
  } catch (err) {
    console.warn(
      `[db] Could not expand ${REQUEST_TABLE}.status ENUM:`,
      (err as Error).message
    );
  }
}

/** Expand MySQL ENUM so Regular OT (100%) can be stored on existing DBs. */
async function ensureRateTierEnumIncludesRegular100(): Promise<void> {
  for (const table of [TYPE_TABLE, REQUEST_TABLE]) {
    if (!(await tableExists(table))) continue;
    if (!(await columnExists(table, 'rateTier'))) continue;
    try {
      const [rows]: unknown = await sequelize.query(
        `SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'rateTier' LIMIT 1`,
        { replacements: [table] }
      );
      const columnType = String(
        Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
          ? (rows[0] as { columnType?: string }).columnType ?? ''
          : ''
      );
      if (columnType.includes('regular_100')) continue;
      await sequelize.query(
        `ALTER TABLE \`${table}\` MODIFY COLUMN \`rateTier\` ${RATE_TIER_ENUM_DDL}`
      );
      console.log(`[db] Expanded ${table}.rateTier ENUM with regular_100`);
    } catch (err) {
      console.warn(
        `[db] Could not expand ${table}.rateTier ENUM:`,
        (err as Error).message
      );
    }
  }
}

/** Ensure catalog default types exist (idempotent by id / rate tier). */
async function ensureDefaultOvertimeTypes(): Promise<void> {
  if (!(await tableExists(TYPE_TABLE))) return;
  for (const type of defaultOvertimeRequestConfig().types) {
    const byId = await OvertimeType.findByPk(type.id);
    if (byId) continue;
    const byTier = await OvertimeType.findOne({ where: { rateTier: type.rateTier } });
    if (byTier) continue;
    await upsertOvertimeTypeRow(type);
    console.log(`[db] Seeded overtime type ${type.id} (${type.rateTier})`);
  }
}

export async function ensureOvertimeSchema(): Promise<void> {
  try {
    await OvertimeType.sync();
  } catch (err) {
    console.warn('[db] OvertimeType.sync() warning:', (err as Error).message);
  }
  await ensureOvertimeTypesTable();
  if (await tableExists(TYPE_TABLE)) {
    await ensureOvertimeTypeColumns();
    await ensureTimestampColumns(TYPE_TABLE);
  }

  // Upgrade legacy table: add columns before sync() adds indexes on otTypeId.
  // Fresh DB: skip ALTER; sync() creates overtimerequests with full schema.
  if (await tableExists(REQUEST_TABLE)) {
    await ensureRequestColumns();
    await ensureTimestampColumns(REQUEST_TABLE);
  }
  try {
    await OvertimeRequest.sync();
  } catch (err) {
    console.warn('[db] OvertimeRequest.sync() warning:', (err as Error).message);
  }

  await ensureRateTierEnumIncludesRegular100();
  await ensureStatusEnumIncludesReturned();
  await migrateTypesFromLegacySetting();
  await ensureDefaultOvertimeTypes();
  await migrateRequestExtraData();

  // Drop legacy JSON blob once data is on columns (ignore if already dropped).
  if (await columnExists(REQUEST_TABLE, 'extraData')) {
    try {
      await sequelize.query(`ALTER TABLE \`${REQUEST_TABLE}\` DROP COLUMN \`extraData\``);
      console.log('[db] Dropped overtimerequests.extraData');
    } catch (err) {
      console.warn('[db] Could not drop overtimerequests.extraData:', (err as Error).message);
    }
  }
}

export async function listOvertimeTypeRows(activeOnly = false): Promise<OvertimeTypeDto[]> {
  const where = activeOnly ? { isActive: true } : {};
  const rows = await OvertimeType.findAll({
    where,
    order: [['name', 'ASC']],
  });
  return rows.map((r) => rowToDto(r));
}

export async function getOvertimeTypeRow(id: string): Promise<OvertimeTypeDto | null> {
  const row = await OvertimeType.findByPk(String(id || '').trim());
  return row ? rowToDto(row) : null;
}

export async function getGlobalMaxHoursPerMonth(): Promise<number> {
  const row = await SystemSetting.findOne({ where: { key: GLOBAL_MAX_KEY } });
  if (row) {
    const n = parsePositiveNumberFromSetting(row.get('value'));
    if (n != null) return n;
  }
  const legacy = await SystemSetting.findOne({ where: { key: LEGACY_CONFIG_KEY } });
  if (legacy) {
    try {
      const parsed = safeParseJsonValue(legacy.get('value'));
      if (parsed && typeof parsed === 'object') {
        const n = parsePositiveNumberFromSetting(
          (parsed as Record<string, unknown>).globalMaxHoursPerMonth
        );
        if (n != null) return n;
      }
    } catch {
      /* fall through to default */
    }
  }
  return defaultOvertimeRequestConfig().globalMaxHoursPerMonth;
}

export async function setGlobalMaxHoursPerMonth(value: number): Promise<number> {
  const n = Number(value);
  if (!(n > 0)) throw new Error('globalMaxHoursPerMonth must be positive');
  await upsertOvertimeSetting(GLOBAL_MAX_KEY, n);
  return n;
}

export async function countOvertimeRequestsUsingType(typeId: string): Promise<number> {
  return OvertimeRequest.count({
    where: {
      otTypeId: typeId,
      status: { [Op.in]: ['PENDING', 'APPROVED'] },
    },
  });
}
