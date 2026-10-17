import { QueryTypes } from 'sequelize';
import { sequelize } from './db.js';
import { CHAT_META_KIND, CHAT_META_TABLE } from './chatMetaSchema.js';

const T = CHAT_META_TABLE;

export type ChatGroupRow = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
};

export type ChatGroupMemberRow = {
  id: string;
  groupId: string;
  userId: string;
  joinedAt: string | null;
  lastReadAt: string | null;
};

export type ChatMuteRow = {
  id: string;
  userId: string;
  scope: string;
  targetId: string | null;
  createdAt: string;
};

export type ChatPinRow = {
  id: string;
  userId: string;
  targetKind: 'direct' | 'group';
  targetId: string;
  pinnedAt: string;
};

export type ChatAnnouncementRow = {
  id: string;
  senderId: string;
  title: string | null;
  content: string;
  createdAt: string;
  dashboardExpiresAt: string | null;
};

function mapGroup(r: Record<string, unknown>): ChatGroupRow {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    createdBy: String(r.created_by ?? r.createdBy ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

function mapMember(r: Record<string, unknown>): ChatGroupMemberRow {
  return {
    id: String(r.id),
    groupId: String(r.parent_id ?? r.groupId ?? ''),
    userId: String(r.user_id ?? r.userId ?? ''),
    joinedAt: r.joined_at != null ? String(r.joined_at) : null,
    lastReadAt: r.last_read_at != null ? String(r.last_read_at) : null,
  };
}

function mapMute(r: Record<string, unknown>): ChatMuteRow {
  return {
    id: String(r.id),
    userId: String(r.user_id ?? r.userId ?? ''),
    scope: String(r.scope ?? ''),
    targetId: r.ref_id != null ? String(r.ref_id) : null,
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

function mapPin(r: Record<string, unknown>): ChatPinRow {
  return {
    id: String(r.id),
    userId: String(r.user_id ?? r.userId ?? ''),
    targetKind: String(r.target_kind ?? r.targetKind) === 'group' ? 'group' : 'direct',
    targetId: String(r.ref_id ?? r.targetId ?? ''),
    pinnedAt: String(r.pinned_at ?? r.pinnedAt ?? ''),
  };
}

function mapAnnouncement(r: Record<string, unknown>): ChatAnnouncementRow {
  return {
    id: String(r.id),
    senderId: String(r.sender_id ?? r.senderId ?? ''),
    title: r.title != null ? String(r.title) : null,
    content: String(r.content ?? ''),
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
    dashboardExpiresAt:
      r.dashboard_expires_at != null
        ? String(r.dashboard_expires_at)
        : r.dashboardExpiresAt != null
          ? String(r.dashboardExpiresAt)
          : null,
  };
}

// ——— Groups ———

export async function getGroupById(groupId: string): Promise<ChatGroupRow | null> {
  const rows = (await sequelize.query(
    `SELECT id, name, created_by, created_at FROM ${T}
     WHERE kind = :kind AND id = :id LIMIT 1`,
    { replacements: { kind: CHAT_META_KIND.GROUP, id: groupId }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows[0] ? mapGroup(rows[0]) : null;
}

export async function listGroupsByIds(groupIds: string[]): Promise<ChatGroupRow[]> {
  const ids = [...new Set(groupIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return [];
  const rows = (await sequelize.query(
    `SELECT id, name, created_by, created_at FROM ${T}
     WHERE kind = :kind AND id IN (:ids)`,
    { replacements: { kind: CHAT_META_KIND.GROUP, ids }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapGroup);
}

export async function countGroupMembersByGroupIds(
  groupIds: string[]
): Promise<Map<string, number>> {
  const ids = [...new Set(groupIds.map((id) => String(id).trim()).filter(Boolean))];
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, 0);
  if (!ids.length) return out;
  const rows = (await sequelize.query(
    `SELECT parent_id AS groupId, COUNT(*) AS c FROM ${T}
     WHERE kind = :kind AND parent_id IN (:ids)
     GROUP BY parent_id`,
    { replacements: { kind: CHAT_META_KIND.GROUP_MEMBER, ids }, type: QueryTypes.SELECT }
  )) as Array<{ groupId?: string; c?: number | string }>;
  for (const row of rows) {
    const gid = String(row.groupId ?? '').trim();
    if (gid) out.set(gid, Number(row.c ?? 0));
  }
  return out;
}

export async function createGroup(row: ChatGroupRow): Promise<void> {
  await sequelize.query(
    `INSERT INTO ${T} (id, kind, name, created_by, created_at)
     VALUES (:id, :kind, :name, :createdBy, :createdAt)`,
    {
      replacements: {
        id: row.id,
        kind: CHAT_META_KIND.GROUP,
        name: row.name,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      },
      type: QueryTypes.INSERT,
    }
  );
}

export async function updateGroupName(groupId: string, name: string): Promise<void> {
  await sequelize.query(
    `UPDATE ${T} SET name = :name, updated_at = NOW() WHERE kind = :kind AND id = :id`,
    {
      replacements: { kind: CHAT_META_KIND.GROUP, id: groupId, name },
      type: QueryTypes.UPDATE,
    }
  );
}

// ——— Group members ———

export async function findGroupMember(
  groupId: string,
  userId: string
): Promise<ChatGroupMemberRow | null> {
  const rows = (await sequelize.query(
    `SELECT id, parent_id, user_id, joined_at, last_read_at FROM ${T}
     WHERE kind = :kind AND parent_id = :groupId AND user_id = :userId LIMIT 1`,
    {
      replacements: { kind: CHAT_META_KIND.GROUP_MEMBER, groupId, userId },
      type: QueryTypes.SELECT,
    }
  )) as Record<string, unknown>[];
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function listGroupMembers(groupId: string): Promise<ChatGroupMemberRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, parent_id, user_id, joined_at, last_read_at FROM ${T}
     WHERE kind = :kind AND parent_id = :groupId`,
    { replacements: { kind: CHAT_META_KIND.GROUP_MEMBER, groupId }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapMember);
}

export async function listGroupMembershipsForUser(userId: string): Promise<ChatGroupMemberRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, parent_id, user_id, joined_at, last_read_at FROM ${T}
     WHERE kind = :kind AND user_id = :userId`,
    { replacements: { kind: CHAT_META_KIND.GROUP_MEMBER, userId }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapMember);
}

export async function countGroupMembers(groupId: string): Promise<number> {
  const rows = (await sequelize.query(
    `SELECT COUNT(*) AS c FROM ${T} WHERE kind = :kind AND parent_id = :groupId`,
    { replacements: { kind: CHAT_META_KIND.GROUP_MEMBER, groupId }, type: QueryTypes.SELECT }
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

export async function createGroupMember(row: ChatGroupMemberRow): Promise<void> {
  await sequelize.query(
    `INSERT INTO ${T}
      (id, kind, parent_id, user_id, joined_at, last_read_at, created_at)
     VALUES (:id, :kind, :groupId, :userId, :joinedAt, :lastReadAt, :createdAt)`,
    {
      replacements: {
        id: row.id,
        kind: CHAT_META_KIND.GROUP_MEMBER,
        groupId: row.groupId,
        userId: row.userId,
        joinedAt: row.joinedAt,
        lastReadAt: row.lastReadAt,
        createdAt: row.joinedAt ?? new Date().toISOString(),
      },
      type: QueryTypes.INSERT,
    }
  );
}

export async function updateGroupMemberLastRead(
  groupId: string,
  userId: string,
  lastReadAt: string
): Promise<void> {
  await sequelize.query(
    `UPDATE ${T} SET last_read_at = :lastReadAt, updated_at = NOW()
     WHERE kind = :kind AND parent_id = :groupId AND user_id = :userId`,
    {
      replacements: {
        kind: CHAT_META_KIND.GROUP_MEMBER,
        groupId,
        userId,
        lastReadAt,
      },
      type: QueryTypes.UPDATE,
    }
  );
}

export async function deleteGroupMember(groupId: string, userId: string): Promise<boolean> {
  const [, meta] = (await sequelize.query(
    `DELETE FROM ${T}
     WHERE kind = :kind AND parent_id = :groupId AND user_id = :userId`,
    {
      replacements: {
        kind: CHAT_META_KIND.GROUP_MEMBER,
        groupId,
        userId,
      },
      type: QueryTypes.DELETE,
    }
  )) as [unknown, number | { affectedRows?: number; rowCount?: number }];
  const affected =
    typeof meta === 'number'
      ? meta
      : Number(meta?.affectedRows ?? meta?.rowCount ?? 0);
  return affected > 0;
}

// ——— Mutes ———

export async function listMutesForUser(userId: string): Promise<ChatMuteRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, user_id, scope, ref_id, created_at FROM ${T}
     WHERE kind = :kind AND user_id = :userId`,
    { replacements: { kind: CHAT_META_KIND.MUTE, userId }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapMute);
}

export async function findMute(
  userId: string,
  scope: string,
  targetId: string | null
): Promise<ChatMuteRow | null> {
  const rows = (await sequelize.query(
    targetId == null
      ? `SELECT id, user_id, scope, ref_id, created_at FROM ${T}
         WHERE kind = :kind AND user_id = :userId AND scope = :scope AND ref_id IS NULL LIMIT 1`
      : `SELECT id, user_id, scope, ref_id, created_at FROM ${T}
         WHERE kind = :kind AND user_id = :userId AND scope = :scope AND ref_id = :targetId LIMIT 1`,
    {
      replacements: { kind: CHAT_META_KIND.MUTE, userId, scope, targetId },
      type: QueryTypes.SELECT,
    }
  )) as Record<string, unknown>[];
  return rows[0] ? mapMute(rows[0]) : null;
}

export async function createMute(row: ChatMuteRow): Promise<void> {
  await sequelize.query(
    `INSERT INTO ${T} (id, kind, user_id, scope, ref_id, created_at)
     VALUES (:id, :kind, :userId, :scope, :targetId, :createdAt)`,
    {
      replacements: {
        id: row.id,
        kind: CHAT_META_KIND.MUTE,
        userId: row.userId,
        scope: row.scope,
        targetId: row.targetId,
        createdAt: row.createdAt,
      },
      type: QueryTypes.INSERT,
    }
  );
}

export async function deleteMute(id: string): Promise<void> {
  await sequelize.query(`DELETE FROM ${T} WHERE id = :id AND kind = :kind`, {
    replacements: { id, kind: CHAT_META_KIND.MUTE },
    type: QueryTypes.DELETE,
  });
}

// ——— Pins ———

export async function listPinsForUser(userId: string): Promise<ChatPinRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, user_id, target_kind, ref_id, pinned_at FROM ${T}
     WHERE kind = :kind AND user_id = :userId ORDER BY pinned_at DESC`,
    { replacements: { kind: CHAT_META_KIND.PIN, userId }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapPin);
}

export async function upsertPin(row: ChatPinRow): Promise<void> {
  await deletePin(row.userId, row.targetKind, row.targetId);
  await sequelize.query(
    `INSERT INTO ${T} (id, kind, user_id, target_kind, ref_id, pinned_at, created_at)
     VALUES (:id, :kind, :userId, :targetKind, :targetId, :pinnedAt, :createdAt)`,
    {
      replacements: {
        id: row.id,
        kind: CHAT_META_KIND.PIN,
        userId: row.userId,
        targetKind: row.targetKind,
        targetId: row.targetId,
        pinnedAt: row.pinnedAt,
        createdAt: row.pinnedAt,
      },
      type: QueryTypes.INSERT,
    }
  );
}

export async function deletePin(
  userId: string,
  targetKind: string,
  targetId: string
): Promise<void> {
  await sequelize.query(
    `DELETE FROM ${T}
     WHERE kind = :kind AND user_id = :userId AND target_kind = :targetKind AND ref_id = :targetId`,
    {
      replacements: { kind: CHAT_META_KIND.PIN, userId, targetKind, targetId },
      type: QueryTypes.DELETE,
    }
  );
}

// ——— Announcements ———

export async function listAnnouncements(order: 'ASC' | 'DESC' = 'ASC'): Promise<ChatAnnouncementRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, sender_id, title, content, created_at, dashboard_expires_at FROM ${T}
     WHERE kind = :kind ORDER BY created_at ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT 200`,
    { replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapAnnouncement);
}

export async function listAnnouncementsActiveOnDashboard(
  nowIso: string
): Promise<ChatAnnouncementRow[]> {
  const rows = (await sequelize.query(
    `SELECT id, sender_id, title, content, created_at, dashboard_expires_at FROM ${T}
     WHERE kind = :kind
       AND (dashboard_expires_at IS NULL OR dashboard_expires_at = '' OR dashboard_expires_at > :nowIso)
     ORDER BY created_at ASC LIMIT 200`,
    { replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT, nowIso }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows.map(mapAnnouncement);
}

export async function getAnnouncementById(id: string): Promise<ChatAnnouncementRow | null> {
  const rows = (await sequelize.query(
    `SELECT id, sender_id, title, content, created_at, dashboard_expires_at FROM ${T}
     WHERE kind = :kind AND id = :id LIMIT 1`,
    { replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT, id }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

export async function getLatestAnnouncement(): Promise<ChatAnnouncementRow | null> {
  const rows = (await sequelize.query(
    `SELECT id, sender_id, title, content, created_at, dashboard_expires_at FROM ${T}
     WHERE kind = :kind ORDER BY created_at DESC LIMIT 1`,
    { replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows[0] ? mapAnnouncement(rows[0]) : null;
}

export async function createAnnouncement(row: ChatAnnouncementRow): Promise<void> {
  await sequelize.query(
    `INSERT INTO ${T}
      (id, kind, sender_id, title, content, dashboard_expires_at, created_at)
     VALUES (:id, :kind, :senderId, :title, :content, :dashboardExpiresAt, :createdAt)`,
    {
      replacements: {
        id: row.id,
        kind: CHAT_META_KIND.ANNOUNCEMENT,
        senderId: row.senderId,
        title: row.title,
        content: row.content,
        dashboardExpiresAt: row.dashboardExpiresAt,
        createdAt: row.createdAt,
      },
      type: QueryTypes.INSERT,
    }
  );
}

export async function updateAnnouncementDashboardExpiry(
  id: string,
  dashboardExpiresAt: string | null
): Promise<void> {
  await sequelize.query(
    `UPDATE ${T} SET dashboard_expires_at = :dashboardExpiresAt, updated_at = NOW()
     WHERE kind = :kind AND id = :id`,
    {
      replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT, id, dashboardExpiresAt },
      type: QueryTypes.UPDATE,
    }
  );
}

export async function listAnnouncementIds(): Promise<string[]> {
  const rows = (await sequelize.query(
    `SELECT id FROM ${T} WHERE kind = :kind`,
    { replacements: { kind: CHAT_META_KIND.ANNOUNCEMENT }, type: QueryTypes.SELECT }
  )) as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

export async function findAnnouncementRead(
  announcementId: string,
  userId: string
): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT id FROM ${T}
     WHERE kind = :kind AND ref_id = :announcementId AND user_id = :userId LIMIT 1`,
    {
      replacements: {
        kind: CHAT_META_KIND.ANNOUNCEMENT_READ,
        announcementId,
        userId,
      },
      type: QueryTypes.SELECT,
    }
  )) as unknown[];
  return rows.length > 0;
}

export async function countAnnouncementReadsForUser(
  userId: string,
  announcementIds: string[]
): Promise<number> {
  if (!announcementIds.length) return 0;
  const rows = (await sequelize.query(
    `SELECT COUNT(*) AS c FROM ${T}
     WHERE kind = :kind AND user_id = :userId AND ref_id IN (:ids)`,
    {
      replacements: {
        kind: CHAT_META_KIND.ANNOUNCEMENT_READ,
        userId,
        ids: announcementIds,
      },
      type: QueryTypes.SELECT,
    }
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

export async function createAnnouncementRead(
  id: string,
  announcementId: string,
  userId: string,
  readAt: string
): Promise<void> {
  await sequelize.query(
    `INSERT IGNORE INTO ${T} (id, kind, ref_id, user_id, read_at, created_at)
     VALUES (:id, :kind, :announcementId, :userId, :readAt, :createdAt)`,
    {
      replacements: {
        id,
        kind: CHAT_META_KIND.ANNOUNCEMENT_READ,
        announcementId,
        userId,
        readAt,
        createdAt: readAt,
      },
      type: QueryTypes.INSERT,
    }
  );
}
