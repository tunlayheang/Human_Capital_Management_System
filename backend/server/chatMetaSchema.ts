import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

/** Avoids collision with orphan `chat_meta.ibd` left by corrupted XAMPP installs. */
export const CHAT_META_TABLE = 'hcms_chat_meta';

export const CHAT_META_KIND = {
  GROUP: 'group',
  GROUP_MEMBER: 'group_member',
  MUTE: 'mute',
  PIN: 'pin',
  ANNOUNCEMENT: 'announcement',
  ANNOUNCEMENT_READ: 'announcement_read',
} as const;

export type ChatMetaKind = (typeof CHAT_META_KIND)[keyof typeof CHAT_META_KIND];

async function tableExists(table: string): Promise<boolean> {
  const [rows]: unknown = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    { replacements: [table], type: QueryTypes.SELECT }
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function ensureChatMetaSchema(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS hcms_chat_meta (
      id VARCHAR(64) NOT NULL,
      kind VARCHAR(32) NOT NULL,
      user_id VARCHAR(64) NULL,
      ref_id VARCHAR(64) NULL,
      parent_id VARCHAR(64) NULL,
      scope VARCHAR(32) NULL,
      target_kind VARCHAR(16) NULL,
      name VARCHAR(255) NULL,
      title VARCHAR(255) NULL,
      content TEXT NULL,
      sender_id VARCHAR(64) NULL,
      created_by VARCHAR(64) NULL,
      dashboard_expires_at VARCHAR(64) NULL,
      joined_at VARCHAR(64) NULL,
      last_read_at VARCHAR(64) NULL,
      read_at VARCHAR(64) NULL,
      pinned_at VARCHAR(64) NULL,
      created_at VARCHAR(64) NOT NULL,
      updated_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY idx_hcms_chat_meta_kind (kind),
      KEY idx_hcms_chat_meta_user (user_id),
      KEY idx_hcms_chat_meta_parent (parent_id),
      KEY idx_hcms_chat_meta_ref (ref_id),
      KEY idx_hcms_chat_meta_created (created_at),
      KEY idx_hcms_chat_meta_kind_user (kind, user_id),
      KEY idx_hcms_chat_meta_kind_parent (kind, parent_id),
      KEY idx_hcms_chat_meta_kind_created (kind, created_at),
      KEY idx_hcms_chat_meta_kind_ref (kind, ref_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await migrateLegacyChatTablesIfNeeded();
}

async function countChatMeta(): Promise<number> {
  const rows = (await sequelize.query(`SELECT COUNT(*) AS c FROM hcms_chat_meta`, {
    type: QueryTypes.SELECT,
  })) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

async function migrateLegacyChatTablesIfNeeded(): Promise<void> {
  if ((await countChatMeta()) > 0) return;

  let migrated = 0;

  if (await tableExists('chatgroups')) {
    const groups = (await sequelize.query(
      `SELECT id, name, createdBy, createdAt FROM chatgroups`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const g of groups) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, name, created_by, created_at)
         VALUES (:id, :kind, :name, :createdBy, :createdAt)`,
        {
          replacements: {
            id: String(g.id),
            kind: CHAT_META_KIND.GROUP,
            name: String(g.name ?? ''),
            createdBy: String(g.createdBy ?? ''),
            createdAt: String(g.createdAt ?? new Date().toISOString()),
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (await tableExists('chatgroupmembers')) {
    const members = (await sequelize.query(
      `SELECT id, groupId, userId, joinedAt, lastReadAt, updatedAt FROM chatgroupmembers`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const m of members) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, parent_id, user_id, joined_at, last_read_at, created_at, updated_at)
         VALUES (:id, :kind, :parentId, :userId, :joinedAt, :lastReadAt, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: String(m.id),
            kind: CHAT_META_KIND.GROUP_MEMBER,
            parentId: String(m.groupId),
            userId: String(m.userId),
            joinedAt: m.joinedAt ? String(m.joinedAt) : null,
            lastReadAt: m.lastReadAt ? String(m.lastReadAt) : null,
            createdAt: m.joinedAt ? String(m.joinedAt) : new Date().toISOString(),
            updatedAt: m.updatedAt ?? null,
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (await tableExists('chatmutes')) {
    const mutes = (await sequelize.query(
      `SELECT id, userId, scope, targetId, createdAt FROM chatmutes`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const row of mutes) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, user_id, scope, ref_id, created_at)
         VALUES (:id, :kind, :userId, :scope, :refId, :createdAt)`,
        {
          replacements: {
            id: String(row.id),
            kind: CHAT_META_KIND.MUTE,
            userId: String(row.userId),
            scope: String(row.scope),
            refId: row.targetId ? String(row.targetId) : null,
            createdAt: String(row.createdAt ?? new Date().toISOString()),
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (await tableExists('chatpins')) {
    const pins = (await sequelize.query(
      `SELECT id, userId, targetKind, targetId, pinnedAt FROM chatpins`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const row of pins) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, user_id, target_kind, ref_id, pinned_at, created_at)
         VALUES (:id, :kind, :userId, :targetKind, :refId, :pinnedAt, :createdAt)`,
        {
          replacements: {
            id: String(row.id),
            kind: CHAT_META_KIND.PIN,
            userId: String(row.userId),
            targetKind: String(row.targetKind),
            refId: String(row.targetId),
            pinnedAt: String(row.pinnedAt),
            createdAt: String(row.pinnedAt),
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (await tableExists('chat_announcements')) {
    const announcements = (await sequelize.query(
      `SELECT id, senderId, title, content, createdAt, dashboardExpiresAt FROM chat_announcements`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const row of announcements) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, sender_id, title, content, dashboard_expires_at, created_at)
         VALUES (:id, :kind, :senderId, :title, :content, :dashboardExpiresAt, :createdAt)`,
        {
          replacements: {
            id: String(row.id),
            kind: CHAT_META_KIND.ANNOUNCEMENT,
            senderId: String(row.senderId),
            title: row.title ? String(row.title) : null,
            content: String(row.content ?? ''),
            dashboardExpiresAt: row.dashboardExpiresAt ? String(row.dashboardExpiresAt) : null,
            createdAt: String(row.createdAt ?? new Date().toISOString()),
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (await tableExists('chat_announcement_reads')) {
    const reads = (await sequelize.query(
      `SELECT id, announcementId, userId, readAt FROM chat_announcement_reads`,
      { type: QueryTypes.SELECT }
    )) as Array<Record<string, unknown>>;
    for (const row of reads) {
      await sequelize.query(
        `INSERT IGNORE INTO hcms_chat_meta
          (id, kind, ref_id, user_id, read_at, created_at)
         VALUES (:id, :kind, :refId, :userId, :readAt, :createdAt)`,
        {
          replacements: {
            id: String(row.id),
            kind: CHAT_META_KIND.ANNOUNCEMENT_READ,
            refId: String(row.announcementId),
            userId: String(row.userId),
            readAt: row.readAt ? String(row.readAt) : null,
            createdAt: row.readAt ? String(row.readAt) : new Date().toISOString(),
          },
          type: QueryTypes.INSERT,
        }
      );
      migrated += 1;
    }
  }

  if (migrated > 0) {
    console.log(`[hcms_chat_meta] Migrated ${migrated} legacy chat row(s) into hcms_chat_meta.`);
  }
}
