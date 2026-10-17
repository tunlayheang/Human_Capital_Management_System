import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const KPI_CONFIG_TABLE = 'kpi_config_items';

export type KpiConfigKind = 'component' | 'attendance_rule' | 'recommendation';

export const LEGACY_KPI_CONFIG_TABLES = [
  'kpi_components',
  'kpi_attendance_deduction_rules',
  'kpi_recommendation_rules',
] as const;

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { table } }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

async function dropTableIfExists(table: string): Promise<void> {
  if (!(await tableExists(table))) return;
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
    console.log(`[kpi-config] Dropped table ${table}.`);
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function ensureKpiConfigTable(): Promise<void> {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS \`${KPI_CONFIG_TABLE}\` (
      id VARCHAR(64) NOT NULL,
      kind VARCHAR(24) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      name VARCHAR(120) NULL,
      description TEXT NULL,
      weight_percent DECIMAL(5,2) NULL,
      scoring_method VARCHAR(16) NULL,
      auto_metric VARCHAR(32) NULL,
      effective_from DATE NULL,
      rule_type VARCHAR(32) NULL,
      min_count INT NULL,
      max_count INT NULL,
      deduction_points DECIMAL(6,2) NULL,
      deduction_mode VARCHAR(24) NULL,
      grade_codes_json JSON NULL,
      recommendation_type VARCHAR(64) NULL,
      message TEXT NULL,
      PRIMARY KEY (id),
      KEY idx_kpi_cfg_kind (kind, active),
      KEY idx_kpi_cfg_kind_sort (kind, sort_order),
      KEY idx_kpi_cfg_att_rule (kind, rule_type, active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

async function migrateLegacyKpiComponentsIfNeeded(): Promise<number> {
  if (!(await tableExists('kpi_components'))) return 0;

  const rows = (await sequelize.query(`SELECT * FROM kpi_components`, {
    type: QueryTypes.SELECT,
  })) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const id = String(row.id);
    const existing = (await sequelize.query(
      `SELECT 1 AS ok FROM \`${KPI_CONFIG_TABLE}\` WHERE id = :id LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { id } }
    )) as Array<{ ok: number }>;
    if (existing.length) continue;

    await sequelize.query(
      `INSERT INTO \`${KPI_CONFIG_TABLE}\`
       (id, kind, sort_order, active, created_at, updated_at, name, description,
        weight_percent, scoring_method, auto_metric, effective_from)
       VALUES (:id, 'component', :sort, :active, :created, :updated, :name, :desc,
        :weight, :method, :metric, :effectiveFrom)`,
      {
        replacements: {
          id,
          sort: row.sort_order ?? 0,
          active: row.active ?? 1,
          created: row.created_at,
          updated: row.updated_at,
          name: row.name,
          desc: row.description,
          weight: row.weight_percent,
          method: row.scoring_method,
          metric: row.auto_metric,
          effectiveFrom: row.effective_from ?? null,
        },
      }
    );
    migrated++;
  }
  return migrated;
}

async function migrateLegacyAttendanceRulesIfNeeded(): Promise<number> {
  if (!(await tableExists('kpi_attendance_deduction_rules'))) return 0;

  const rows = (await sequelize.query(`SELECT * FROM kpi_attendance_deduction_rules`, {
    type: QueryTypes.SELECT,
  })) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const id = String(row.id);
    const existing = (await sequelize.query(
      `SELECT 1 AS ok FROM \`${KPI_CONFIG_TABLE}\` WHERE id = :id LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { id } }
    )) as Array<{ ok: number }>;
    if (existing.length) continue;

    await sequelize.query(
      `INSERT INTO \`${KPI_CONFIG_TABLE}\`
       (id, kind, sort_order, active, created_at, updated_at, rule_type, min_count,
        max_count, deduction_points, deduction_mode)
       VALUES (:id, 'attendance_rule', :sort, :active, NOW(), NOW(), :type, :min,
        :max, :ded, :mode)`,
      {
        replacements: {
          id,
          sort: row.sort_order ?? 0,
          active: row.active ?? 1,
          type: row.rule_type,
          min: row.min_count,
          max: row.max_count,
          ded: row.deduction_points,
          mode: row.deduction_mode ?? 'RANGE',
        },
      }
    );
    migrated++;
  }
  return migrated;
}

async function migrateLegacyRecommendationRulesIfNeeded(): Promise<number> {
  if (!(await tableExists('kpi_recommendation_rules'))) return 0;

  const rows = (await sequelize.query(`SELECT * FROM kpi_recommendation_rules`, {
    type: QueryTypes.SELECT,
  })) as Array<Record<string, unknown>>;

  let migrated = 0;
  for (const row of rows) {
    const id = String(row.id);
    const existing = (await sequelize.query(
      `SELECT 1 AS ok FROM \`${KPI_CONFIG_TABLE}\` WHERE id = :id LIMIT 1`,
      { type: QueryTypes.SELECT, replacements: { id } }
    )) as Array<{ ok: number }>;
    if (existing.length) continue;

    await sequelize.query(
      `INSERT INTO \`${KPI_CONFIG_TABLE}\`
       (id, kind, sort_order, active, created_at, updated_at, grade_codes_json,
        recommendation_type, message)
       VALUES (:id, 'recommendation', :sort, :active, NOW(), NOW(), :grades, :type, :msg)`,
      {
        replacements: {
          id,
          sort: row.sort_order ?? 0,
          active: row.active ?? 1,
          grades: row.grade_codes_json,
          type: row.recommendation_type,
          msg: row.message,
        },
      }
    );
    migrated++;
  }
  return migrated;
}

export async function dropLegacyKpiConfigTablesIfNeeded(): Promise<void> {
  for (const table of LEGACY_KPI_CONFIG_TABLES) {
    await dropTableIfExists(table);
  }
}

/** Unified KPI config: components, attendance rules, recommendation rules. */
export async function ensureKpiConfigSchema(): Promise<void> {
  await ensureKpiConfigTable();

  const comp = await migrateLegacyKpiComponentsIfNeeded();
  const att = await migrateLegacyAttendanceRulesIfNeeded();
  const rec = await migrateLegacyRecommendationRulesIfNeeded();
  if (comp + att + rec > 0) {
    console.log(
      `[kpi-config] Migrated ${comp} component(s), ${att} attendance rule(s), ${rec} recommendation rule(s).`
    );
  }

  await dropLegacyKpiConfigTablesIfNeeded();
}
