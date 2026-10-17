import { DataTypes, QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const PERSONAL_HUB_ITEM_TABLE = 'personal_hub_items';
export type PersonalHubItemKind = 'note' | 'alert';

export const PersonalHubItem = sequelize.define(
  'PersonalHubItem',
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    body: { type: DataTypes.TEXT, allowNull: true },
    alertAt: { type: DataTypes.DATE, allowNull: true },
    isDone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    alertNotifiedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: PERSONAL_HUB_ITEM_TABLE,
    indexes: [
      { fields: ['userId', 'kind'] },
      { fields: ['userId', 'alertAt'] },
      { fields: ['userId', 'updatedAt'] },
    ],
  }
);

/** @deprecated Use PersonalHubItem with kind=note */
export const PersonalHubNote = PersonalHubItem;
/** @deprecated Use PersonalHubItem with kind=alert */
export const PersonalHubAlert = PersonalHubItem;

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
    console.log(`[personal-hub] Dropped table ${table}.`);
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

/** Remove retired company_regulations table (feature removed). */
export async function dropCompanyRegulationsTableIfNeeded(): Promise<void> {
  await dropTableIfExists('company_regulations');
}

/** Migrate personal_hub_notes + personal_hub_alerts → personal_hub_items. */
export async function migrateLegacyPersonalHubTablesIfNeeded(): Promise<void> {
  if (!(await tableExists(PERSONAL_HUB_ITEM_TABLE))) return;

  if (await tableExists('personal_hub_notes')) {
    const notes = (await sequelize.query(
      `SELECT id, userId, title, body, createdAt, updatedAt FROM personal_hub_notes`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;

    for (const row of notes) {
      const id = String(row.id);
      const existing = (await sequelize.query(
        `SELECT 1 AS ok FROM \`${PERSONAL_HUB_ITEM_TABLE}\` WHERE id = :id LIMIT 1`,
        { type: QueryTypes.SELECT, replacements: { id } }
      )) as Array<{ ok: number }>;
      if (existing.length) continue;

      await sequelize.query(
        `INSERT INTO \`${PERSONAL_HUB_ITEM_TABLE}\`
         (id, userId, kind, title, body, alertAt, isDone, createdAt, updatedAt)
         VALUES (:id, :userId, 'note', :title, :body, NULL, 0, :createdAt, :updatedAt)`,
        {
          replacements: {
            id,
            userId: String(row.userId),
            title: String(row.title ?? ''),
            body: String(row.body ?? ''),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        }
      );
    }
    if (notes.length) {
      console.log(`[personal-hub] Migrated ${notes.length} note(s) into ${PERSONAL_HUB_ITEM_TABLE}.`);
    }
  }

  if (await tableExists('personal_hub_alerts')) {
    const alerts = (await sequelize.query(
      `SELECT id, userId, title, alertAt, notes, isDone, createdAt, updatedAt FROM personal_hub_alerts`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;

    for (const row of alerts) {
      const id = String(row.id);
      const existing = (await sequelize.query(
        `SELECT 1 AS ok FROM \`${PERSONAL_HUB_ITEM_TABLE}\` WHERE id = :id LIMIT 1`,
        { type: QueryTypes.SELECT, replacements: { id } }
      )) as Array<{ ok: number }>;
      if (existing.length) continue;

      await sequelize.query(
        `INSERT INTO \`${PERSONAL_HUB_ITEM_TABLE}\`
         (id, userId, kind, title, body, alertAt, isDone, createdAt, updatedAt)
         VALUES (:id, :userId, 'alert', :title, :body, :alertAt, :isDone, :createdAt, :updatedAt)`,
        {
          replacements: {
            id,
            userId: String(row.userId),
            title: String(row.title ?? ''),
            body: row.notes != null ? String(row.notes) : null,
            alertAt: row.alertAt,
            isDone: row.isDone ? 1 : 0,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        }
      );
    }
    if (alerts.length) {
      console.log(`[personal-hub] Migrated ${alerts.length} alert(s) into ${PERSONAL_HUB_ITEM_TABLE}.`);
    }
  }

  await dropTableIfExists('personal_hub_notes');
  await dropTableIfExists('personal_hub_alerts');
}

async function ensureAlertNotifiedColumn(): Promise<void> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :table
       AND COLUMN_NAME = 'alertNotifiedAt'
     LIMIT 1`,
    { type: QueryTypes.SELECT, replacements: { table: PERSONAL_HUB_ITEM_TABLE } }
  )) as Array<{ ok: number }>;
  if (rows.length) return;
  await sequelize.query(
    `ALTER TABLE \`${PERSONAL_HUB_ITEM_TABLE}\` ADD COLUMN \`alertNotifiedAt\` datetime NULL AFTER \`isDone\``
  );
}

export async function ensurePersonalHubSchema(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`${PERSONAL_HUB_ITEM_TABLE}\` (
      \`id\` varchar(64) NOT NULL,
      \`userId\` varchar(64) NOT NULL,
      \`kind\` varchar(16) NOT NULL,
      \`title\` varchar(255) NOT NULL DEFAULT '',
      \`body\` text NULL,
      \`alertAt\` datetime NULL,
      \`isDone\` tinyint(1) NOT NULL DEFAULT 0,
      \`createdAt\` datetime NOT NULL,
      \`updatedAt\` datetime NOT NULL,
      PRIMARY KEY (\`id\`),
      KEY \`idx_phi_user_kind\` (\`userId\`, \`kind\`),
      KEY \`idx_phi_user_alert\` (\`userId\`, \`alertAt\`),
      KEY \`idx_phi_user_updated\` (\`userId\`, \`updatedAt\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await migrateLegacyPersonalHubTablesIfNeeded();
  await dropCompanyRegulationsTableIfNeeded();
  await ensureAlertNotifiedColumn();
  await sequelize.query(`
    UPDATE \`${PERSONAL_HUB_ITEM_TABLE}\`
    SET alertAt = createdAt
    WHERE kind = 'alert' AND alertAt IS NULL
  `);
  await PersonalHubItem.sync();
}
