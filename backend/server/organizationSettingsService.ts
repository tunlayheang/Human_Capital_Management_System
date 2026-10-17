import { Op } from 'sequelize';
import { sequelize } from './db.js';
import {
  AuditLog,
  CompanyProfile,
  SettingsSecurity,
  SettingsPositionLevel,
  SystemSetting,
} from './db.js';
import {
  KEY_BY_TABLE,
  MAPPING_BY_KEY,
  ORG_SETTINGS_SINGLETON_ID,
  ORGANIZATION_SETTING_KEYS,
  COMPANY_PROFILE_COLUMNS,
  type FieldMapping,
} from './organizationSettingsSchema.js';

export { MAPPING_BY_KEY, ORGANIZATION_SETTING_KEYS } from './organizationSettingsSchema.js';
import {
  DEFAULT_POSITION_LEVELS,
  assignTiersFromOrder,
  sortPositionLevels,
  type PositionLevelRecord,
} from './positionLevelDefaults.js';
import { AUDIT_SOURCE_SETTING } from './auditLogConsolidationService.js';

const LEGACY_SPLIT_TABLES = [
  'settings_company_profile',
  'settings_company_branding',
  'settings_company_contact',
  'settings_company_regional',
  'settings_company_compliance',
  'settings_company_documents',
] as const;

const COMPANY_PROFILE_DDL = `CREATE TABLE IF NOT EXISTS company_profile (
  id varchar(32) NOT NULL DEFAULT 'default',
  name varchar(255) DEFAULT NULL,
  legal_name varchar(255) DEFAULT NULL,
  short_name varchar(64) DEFAULT NULL,
  industry_type varchar(128) DEFAULT NULL,
  business_type varchar(128) DEFAULT NULL,
  founded_date date DEFAULT NULL,
  website varchar(512) DEFAULT NULL,
  logo_url text DEFAULT NULL,
  banner_logo_url text DEFAULT NULL,
  seal_url text DEFAULT NULL,
  signature_url text DEFAULT NULL,
  main_phone varchar(32) DEFAULT NULL,
  secondary_phone varchar(32) DEFAULT NULL,
  company_email varchar(255) DEFAULT NULL,
  hr_email varchar(255) DEFAULT NULL,
  support_email varchar(255) DEFAULT NULL,
  fax_number varchar(32) DEFAULT NULL,
  default_country varchar(128) DEFAULT NULL,
  timezone varchar(64) DEFAULT NULL,
  date_format varchar(32) DEFAULT NULL,
  time_format varchar(32) DEFAULT NULL,
  currency varchar(8) DEFAULT NULL,
  language varchar(32) DEFAULT NULL,
  week_start varchar(16) DEFAULT NULL,
  registration_number varchar(128) DEFAULT NULL,
  tax_id varchar(128) DEFAULT NULL,
  tax_registration_date date DEFAULT NULL,
  nssf_number varchar(128) DEFAULT NULL,
  patent_number varchar(128) DEFAULT NULL,
  ministry_registration_number varchar(128) DEFAULT NULL,
  labor_registration_number varchar(128) DEFAULT NULL,
  default_tax_rule varchar(64) DEFAULT NULL,
  exchange_rate_source varchar(64) DEFAULT NULL,
  payslip_footer text DEFAULT NULL,
  report_header text DEFAULT NULL,
  report_footer text DEFAULT NULL,
  email_signature text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

function unwrapScalar(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw !== 'string') return raw;
  const t = raw.trim();
  if (!t) return '';
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('[') && t.endsWith(']')) ||
    (t.startsWith('{') && t.endsWith('}'))
  ) {
    try {
      return JSON.parse(t);
    } catch {
      if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
    }
  }
  return raw;
}

function serializeForUi(kind: FieldMapping['kind'], value: unknown): unknown {
  const raw = unwrapScalar(value);
  if (raw == null) return kind === 'json' ? [] : '';
  if (kind === 'boolean') return Boolean(raw);
  if (kind === 'json') {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  if (kind === 'date') {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);
    return String(raw).slice(0, 10);
  }
  return String(raw);
}

function coerceForColumn(kind: FieldMapping['kind'], value: unknown): unknown {
  const raw = unwrapScalar(value);
  if (kind === 'boolean') return Boolean(raw);
  if (kind === 'json') {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }
  if (kind === 'date') {
    const s = String(raw ?? '').trim();
    return s || null;
  }
  const s = String(raw ?? '').trim();
  return s || null;
}

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = (await sequelize.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table: tableName } }
  )) as [unknown[], unknown];
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureCompanyProfileRow(): Promise<Record<string, unknown>> {
  const [row] = await CompanyProfile.findOrCreate({
    where: { id: ORG_SETTINGS_SINGLETON_ID },
    defaults: { id: ORG_SETTINGS_SINGLETON_ID, name: 'Organization' },
  });
  return row.get({ plain: true }) as Record<string, unknown>;
}

async function ensureSecurityRow(): Promise<Record<string, unknown>> {
  const [row] = await SettingsSecurity.findOrCreate({
    where: { id: ORG_SETTINGS_SINGLETON_ID },
    defaults: { id: ORG_SETTINGS_SINGLETON_ID },
  });
  return row.get({ plain: true }) as Record<string, unknown>;
}

function rowToFlatKeys(plain: Record<string, unknown>, mappings: FieldMapping[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of mappings) {
    out[m.key] = serializeForUi(m.kind, plain[m.column]);
  }
  return out;
}

let companyFlatCache: Record<string, unknown> | null = null;
let securityFlatCache: Record<string, unknown> | null = null;

export function invalidateOrganizationSettingsCache(): void {
  companyFlatCache = null;
  securityFlatCache = null;
}

export async function getOrganizationSettingValue(key: string): Promise<unknown | null> {
  if (!MAPPING_BY_KEY.has(key)) return null;
  const mapping = MAPPING_BY_KEY.get(key)!;
  if (mapping.table === 'security') {
    if (!securityFlatCache) securityFlatCache = await loadSecuritySettingsFlat();
    return securityFlatCache[key] ?? null;
  }
  if (!companyFlatCache) companyFlatCache = await loadCompanySettingsFlat();
  return companyFlatCache[key] ?? null;
}

export async function loadCompanySettingsFlat(): Promise<Record<string, unknown>> {
  const plain = await ensureCompanyProfileRow();
  return rowToFlatKeys(plain, KEY_BY_TABLE.company_profile);
}

export async function loadPortalBrandingPublic(): Promise<{
  logo: string;
  frontCover: string;
  companyName: string;
}> {
  const flat = await loadCompanySettingsFlat();
  const shortName = String(flat['company.short_name'] ?? '').trim();
  const legalName = String(flat['company.name'] ?? '').trim();
  return {
    logo: String(flat['branding.logo'] ?? '').trim(),
    frontCover: String(flat['branding.front_cover'] ?? '').trim(),
    companyName: shortName || legalName,
  };
}

export async function loadSecuritySettingsFlat(): Promise<Record<string, unknown>> {
  const plain = await ensureSecurityRow();
  return rowToFlatKeys(plain, KEY_BY_TABLE.security);
}

export async function updateOrganizationSetting(
  key: string,
  value: unknown,
  options?: { userId?: string }
): Promise<void> {
  const mapping = MAPPING_BY_KEY.get(key);
  if (!mapping) {
    throw new Error(`Unknown organization setting key: ${key}`);
  }

  const coerced = coerceForColumn(mapping.kind, value);

  if (mapping.key === 'branding.logo' || mapping.key === 'branding.front_cover') {
    const stored = String(coerced ?? '').trim();
    if (stored.startsWith('data:') && stored.length > 65_000) {
      throw new Error(
        'Image data is too large. Remove the asset and upload the file again using the upload control.'
      );
    }
  }

  if (mapping.table === 'company_profile') {
    const row = await ensureCompanyProfileRow();
    const oldVal = row[mapping.column];
    await CompanyProfile.update(
      { [mapping.column]: coerced },
      { where: { id: ORG_SETTINGS_SINGLETON_ID } }
    );
    invalidateOrganizationSettingsCache();
    if (options?.userId) {
      await AuditLog.create({
        id: `audit-os-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        entityType: 'company_profile',
        entityId: key,
        action: 'UPDATE',
        oldValue: oldVal ?? null,
        newValue: coerced,
        performedBy: options.userId,
        reason: `Company profile field updated`,
        metadata: {
          source: AUDIT_SOURCE_SETTING,
          settingKey: key,
        },
      } as any);
    }
    return;
  }

  const row = await ensureSecurityRow();
  const oldVal = row[mapping.column];
  await SettingsSecurity.update(
    { [mapping.column]: coerced },
    { where: { id: ORG_SETTINGS_SINGLETON_ID } }
  );
  invalidateOrganizationSettingsCache();
  if (options?.userId) {
    await AuditLog.create({
      id: `audit-os-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityType: 'organization_setting',
      entityId: key,
      action: 'UPDATE',
      oldValue: oldVal ?? null,
      newValue: coerced,
      performedBy: options.userId,
      reason: `Security setting field updated`,
      metadata: {
        source: AUDIT_SOURCE_SETTING,
        settingKey: key,
      },
    } as any);
  }
}

export async function bulkUpdateOrganizationSettings(
  patches: Record<string, unknown>,
  options?: { userId?: string }
): Promise<void> {
  for (const [key, value] of Object.entries(patches)) {
    if (!MAPPING_BY_KEY.has(key)) continue;
    await updateOrganizationSetting(key, value, options);
  }
}

export async function listCompanySettingsAsLegacyRows(): Promise<
  Array<{ key: string; value: unknown; category: string }>
> {
  const flat = await loadCompanySettingsFlat();
  return Object.entries(flat).map(([key, value]) => ({
    key,
    value,
    category: key.split('.')[0],
  }));
}

export async function loadPositionLevelsFromTable(): Promise<PositionLevelRecord[]> {
  const rows = await SettingsPositionLevel.findAll({ order: [['sort_order', 'ASC']] });
  if (!rows.length) return DEFAULT_POSITION_LEVELS;
  const mapped = rows.map((r) => {
    const p = r.get({ plain: true }) as Record<string, unknown>;
    const sortOrder = Number(p.sort_order) || 0;
    const tier = Number(p.tier) || 0;
    return {
      code: String(p.code),
      label: String(p.label),
      tier: tier > 0 ? tier : sortOrder,
      sortOrder,
      structureTier: (p.structure_tier as PositionLevelRecord['structureTier']) || 'staff',
    };
  });
  const sorted = sortPositionLevels(mapped);
  return sorted.map((level, index) => ({
    ...level,
    tier: level.tier > 0 ? level.tier : index + 1,
    sortOrder: level.sortOrder > 0 ? level.sortOrder : index + 1,
  }));
}

export async function savePositionLevelsToTable(
  levels: PositionLevelRecord[],
  options?: { userId?: string; previous?: PositionLevelRecord[] }
): Promise<PositionLevelRecord[]> {
  const sorted = assignTiersFromOrder(levels);
  await sequelize.transaction(async (t) => {
    const codes = sorted.map((l) => l.code);
    if (codes.length) {
      await SettingsPositionLevel.destroy({
        where: { code: { [Op.notIn]: codes } },
        transaction: t,
      });
    } else {
      await SettingsPositionLevel.destroy({ where: {}, transaction: t });
    }
    for (const level of sorted) {
      await SettingsPositionLevel.upsert(
        {
          code: level.code,
          label: level.label,
          tier: level.tier,
          sort_order: level.sortOrder,
          structure_tier: level.structureTier,
        },
        { transaction: t }
      );
    }
  });

  if (options?.userId) {
    await AuditLog.create({
      id: `audit-pl-${Date.now()}`,
      entityType: 'settings_position_levels',
      entityId: 'catalog',
      action: 'UPDATE',
      oldValue: options.previous ?? null,
      newValue: sorted,
      performedBy: options.userId,
      reason: 'Position levels catalog updated',
      metadata: {
        source: AUDIT_SOURCE_SETTING,
        settingKey: 'position_levels',
      },
    } as any);
  }

  return sorted;
}

/** Merge legacy split tables into unified company_profile, then drop split tables. */
export async function consolidateCompanyProfileTables(): Promise<{ merged: boolean }> {
  const hasSplit = await Promise.all(LEGACY_SPLIT_TABLES.map((t) => tableExists(t)));
  if (!hasSplit.some(Boolean)) return { merged: false };

  const merged: Record<string, unknown> = { id: ORG_SETTINGS_SINGLETON_ID };

  for (const tableName of LEGACY_SPLIT_TABLES) {
    if (!(await tableExists(tableName))) continue;
    const [rows] = (await sequelize.query(
      `SELECT * FROM \`${tableName}\` WHERE id = :id LIMIT 1`,
      { replacements: { id: ORG_SETTINGS_SINGLETON_ID } }
    )) as [Record<string, unknown>[], unknown];
    const row = rows?.[0];
    if (!row) continue;
    for (const col of COMPANY_PROFILE_COLUMNS) {
      if (row[col] != null && row[col] !== '') {
        merged[col] = row[col];
      }
    }
  }

  await CompanyProfile.upsert(merged as Record<string, unknown>);
  invalidateOrganizationSettingsCache();

  for (const tableName of LEGACY_SPLIT_TABLES) {
    if (await tableExists(tableName)) {
      await sequelize.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    }
  }

  return { merged: true };
}

export async function ensureOrganizationSettingsTables(): Promise<void> {
  await sequelize.query(COMPANY_PROFILE_DDL);
  await CompanyProfile.sync();

  await sequelize.query(`CREATE TABLE IF NOT EXISTS settings_position_levels (
    code varchar(40) NOT NULL,
    label varchar(120) NOT NULL,
    tier int NOT NULL DEFAULT 0,
    sort_order int NOT NULL DEFAULT 0,
    structure_tier enum('manager','officer','staff') NOT NULL DEFAULT 'staff',
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  try {
    await sequelize.query(
      'ALTER TABLE settings_position_levels ADD COLUMN tier int NOT NULL DEFAULT 0 AFTER label'
    );
  } catch {
    /* column already exists */
  }

  await sequelize.query(`CREATE TABLE IF NOT EXISTS settings_security (
    id varchar(32) NOT NULL DEFAULT 'default',
    session_timeout_minutes varchar(16) DEFAULT NULL,
    password_min_length varchar(8) DEFAULT NULL,
    password_complexity json DEFAULT NULL,
    default_portal_password varchar(128) DEFAULT NULL,
    default_portal_password_enabled tinyint(1) NOT NULL DEFAULT 1,
    mfa_required tinyint(1) NOT NULL DEFAULT 0,
    max_login_attempts varchar(8) DEFAULT NULL,
    locked_period_minutes varchar(16) DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  try {
    const { ensureDefaultPortalPasswordColumn } = await import('./defaultPortalPassword.js');
    await ensureDefaultPortalPasswordColumn();
  } catch (err) {
    console.warn(
      '[db] Could not ensure settings_security.default_portal_password:',
      (err as Error)?.message || err
    );
  }

  await SettingsPositionLevel.sync();
  await SettingsSecurity.sync();

  const consolidated = await consolidateCompanyProfileTables();
  if (consolidated.merged) {
    console.log('[db] Merged split settings_company_* tables into company_profile.');
  }
}

export async function migrateOrganizationSettingsFromLegacy(): Promise<{ migrated: number }> {
  await ensureOrganizationSettingsTables();

  const legacyRows = await SystemSetting.findAll({
    where: {
      [Op.or]: [
        { key: { [Op.in]: [...ORGANIZATION_SETTING_KEYS, 'company.position_levels'] } },
        { key: { [Op.like]: 'company.%' } },
        { key: { [Op.like]: 'branding.%' } },
        { key: { [Op.like]: 'contact.%' } },
        { key: { [Op.like]: 'regional.%' } },
        { key: { [Op.like]: 'compliance.%' } },
        { key: { [Op.like]: 'documents.%' } },
        { key: { [Op.like]: 'security.%' } },
      ],
    },
  });

  let migrated = 0;
  const flatPatches: Record<string, unknown> = {};

  for (const row of legacyRows) {
    const plain = row.get({ plain: true }) as { key: string; value: unknown };
    const key = String(plain.key);
    if (key === 'company.position_levels') {
      const parsed = unwrapScalar(plain.value);
      if (Array.isArray(parsed) && parsed.length) {
        const levels: PositionLevelRecord[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const label = String(rec.label ?? '').trim();
          const code = String(rec.code ?? label)
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
          if (!code || !label) continue;
          const tierRaw = String(rec.structureTier ?? rec.structure_tier ?? 'staff').toLowerCase();
          const structureTier =
            tierRaw === 'manager' || tierRaw === 'officer' ? tierRaw : ('staff' as const);
          levels.push({
            code,
            label,
            tier: Number.isFinite(Number(rec.tier))
              ? Number(rec.tier)
              : Number.isFinite(Number(rec.sortOrder ?? rec.sort_order))
                ? Number(rec.sortOrder ?? rec.sort_order)
                : levels.length + 1,
            sortOrder: Number.isFinite(Number(rec.sortOrder ?? rec.sort_order))
              ? Number(rec.sortOrder ?? rec.sort_order)
              : levels.length + 1,
            structureTier,
          });
        }
        if (levels.length) {
          await savePositionLevelsToTable(levels);
          migrated += 1;
        }
      }
      continue;
    }
    if (MAPPING_BY_KEY.has(key)) {
      flatPatches[key] = plain.value;
      migrated += 1;
    }
  }

  if (Object.keys(flatPatches).length) {
    await bulkUpdateOrganizationSettings(flatPatches);
  }

  await ensureCompanyProfileRow();

  const levelCount = await SettingsPositionLevel.count();
  if (levelCount === 0) {
    await savePositionLevelsToTable(DEFAULT_POSITION_LEVELS);
  }

  const security = await SettingsSecurity.findByPk(ORG_SETTINGS_SINGLETON_ID);
  if (!security) {
    await SettingsSecurity.create({
      id: ORG_SETTINGS_SINGLETON_ID,
      session_timeout_minutes: '30',
      password_min_length: '12',
      password_complexity: ['Uppercase', 'Lowercase', 'Numbers', 'Special Characters'],
      mfa_required: false,
      max_login_attempts: '5',
      locked_period_minutes: '15',
    });
  }

  if (legacyRows.length > 0) {
    const keysToRemove = legacyRows.map((r) => String((r.get({ plain: true }) as { key: string }).key));
    await SystemSetting.destroy({ where: { key: { [Op.in]: keysToRemove } } });
  }

  return { migrated };
}
