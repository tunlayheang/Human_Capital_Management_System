import { Op } from 'sequelize';
import { User } from './db.js';
import { getUserDisplayName, notifyUserIds } from './notificationService.js';
import { serializeUserForClient, USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import * as chatMeta from './chatMetaRepository.js';

export function canPostChatAnnouncement(role: unknown): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'HR';
}

/** Role gate (Admin/HR) or explicit `chat.announcements.manage` grant. Managers are not allowed by default. */
export async function actorCanPostChatAnnouncement(actor: {
  id?: string;
  role?: string;
}): Promise<boolean> {
  const role = String(actor?.role ?? '').toUpperCase();
  // Managers must not post/manage announcements even if an old matrix grant remains.
  if (role === 'MANAGER') return false;
  if (canPostChatAnnouncement(actor?.role)) return true;
  const userId = String(actor?.id ?? '').trim();
  if (!userId) return false;
  const { getEffectivePermissionsForUser, hasEffectivePermission } = await import(
    './effectivePermissions.js'
  );
  const map = await getEffectivePermissionsForUser(userId);
  return hasEffectivePermission(map, 'chat.announcements.manage', actor?.role);
}

export type ChatAnnouncementDto = {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  title: string | null;
  content: string;
  createdAt: string;
  read: boolean;
  dashboardExpiresAt: string | null;
  activeOnDashboard: boolean;
};

function previewAnnouncement(content: string, title?: string | null): string {
  const head = String(title ?? '').trim();
  const body = String(content ?? '').trim();
  if (head) return body.length > 60 ? `${head}: ${body.slice(0, 60)}…` : `${head}: ${body}`;
  return body.length > 80 ? `${body.slice(0, 80)}…` : body;
}

/** Normalize date input (YYYY-MM-DD or ISO) to end-of-day ISO for dashboard expiry. */
export function normalizeDashboardExpiresAt(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const end = new Date(`${raw}T23:59:59.999`);
    if (Number.isNaN(end.getTime())) {
      throw Object.assign(new Error('Invalid expiry date'), { status: 400 });
    }
    return end.toISOString();
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error('Invalid expiry date'), { status: 400 });
  }
  return d.toISOString();
}

export function isActiveOnDashboard(dashboardExpiresAt: unknown, now = Date.now()): boolean {
  const exp = dashboardExpiresAt == null ? '' : String(dashboardExpiresAt).trim();
  if (!exp) return true;
  const t = new Date(exp).getTime();
  if (Number.isNaN(t)) return true;
  return t >= now;
}

async function serializeAnnouncementRow(
  row: chatMeta.ChatAnnouncementRow,
  userId: string
): Promise<ChatAnnouncementDto> {
  const id = row.id;
  const senderId = row.senderId;
  const dashboardExpiresAt = row.dashboardExpiresAt;
  const read = await chatMeta.findAnnouncementRead(id, userId);
  let senderName = 'Management';
  let senderRole = '';
  try {
    const sender: any = await User.findByPk(senderId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
    if (sender) {
      const plain = await serializeUserForClient(sender.get({ plain: true }));
      senderName = String(plain.name || senderName);
      senderRole = String(plain.role || '');
    }
  } catch {
    senderName = await getUserDisplayName(senderId).catch(() => senderName);
  }
  return {
    id,
    senderId,
    senderName,
    senderRole,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    read,
    dashboardExpiresAt,
    activeOnDashboard: isActiveOnDashboard(dashboardExpiresAt),
  };
}

export async function countUnreadAnnouncements(userId: string): Promise<number> {
  const ids = await chatMeta.listAnnouncementIds();
  if (!ids.length) return 0;
  const readCount = await chatMeta.countAnnouncementReadsForUser(userId, ids);
  return Math.max(0, ids.length - readCount);
}

export async function getAnnouncementsInboxSummary(userId: string) {
  const latest = await chatMeta.getLatestAnnouncement();
  const unreadCount = await countUnreadAnnouncements(userId);
  if (!latest) {
    return {
      kind: 'announcements' as const,
      lastMessage: '',
      lastMessageAt: '',
      unreadCount,
      pinned: true,
    };
  }
  return {
    kind: 'announcements' as const,
    lastMessage: previewAnnouncement(latest.content, latest.title),
    lastMessageAt: latest.createdAt,
    unreadCount,
    pinned: true,
  };
}

export async function listAnnouncementsForUser(userId: string): Promise<ChatAnnouncementDto[]> {
  const rows = await chatMeta.listAnnouncements('ASC');
  return Promise.all(rows.map((row) => serializeAnnouncementRow(row, userId)));
}

export async function listAnnouncementsForDashboard(userId: string): Promise<ChatAnnouncementDto[]> {
  const nowIso = new Date().toISOString();
  const rows = await chatMeta.listAnnouncementsActiveOnDashboard(nowIso);
  const items = await Promise.all(rows.map((row) => serializeAnnouncementRow(row, userId)));
  return items.filter((a) => !a.read);
}

export async function updateAnnouncementDashboardExpiry(
  announcementId: string,
  dashboardExpiresAt: string | null,
  userId: string
): Promise<ChatAnnouncementDto> {
  const row = await chatMeta.getAnnouncementById(announcementId);
  if (!row) {
    throw Object.assign(new Error('Announcement not found'), { status: 404 });
  }
  await chatMeta.updateAnnouncementDashboardExpiry(announcementId, dashboardExpiresAt);
  return serializeAnnouncementRow({ ...row, dashboardExpiresAt }, userId);
}

export async function markAnnouncementsRead(userId: string): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid) return;
  const ids = await chatMeta.listAnnouncementIds();
  const now = new Date().toISOString();
  await Promise.all(
    ids.map(async (announcementId) => {
      const existing = await chatMeta.findAnnouncementRead(announcementId, uid);
      if (existing) return;
      await chatMeta.createAnnouncementRead(
        `car-${announcementId}-${uid}`,
        announcementId,
        uid,
        now
      );
    })
  );
  // Also clear announcement rows from the notification inbox queue for this user.
  try {
    const { markAnnouncementNotificationsRead } = await import('./notificationService.js');
    await markAnnouncementNotificationsRead(uid);
  } catch {
    /* non-fatal */
  }
}

export async function createChatAnnouncement(input: {
  senderId: string;
  title?: string;
  content: string;
  dashboardExpiresAt?: string | null;
}): Promise<ChatAnnouncementDto> {
  const content = String(input.content ?? '').trim();
  if (!content) {
    throw Object.assign(new Error('Announcement message is required'), { status: 400 });
  }
  const title = String(input.title ?? '').trim() || null;
  const dashboardExpiresAt = normalizeDashboardExpiresAt(input.dashboardExpiresAt);
  if (!dashboardExpiresAt) {
    throw Object.assign(new Error('A dashboard display end date is required'), { status: 400 });
  }
  const id = `ann-${Date.now()}`;
  const createdAt = new Date().toISOString();
  await chatMeta.createAnnouncement({
    id,
    senderId: input.senderId,
    title,
    content,
    createdAt,
    dashboardExpiresAt,
  });

  const recipients: any[] = await User.findAll({
    where: {
      isActive: true,
      id: { [Op.ne]: input.senderId },
    },
    attributes: ['id'],
  });
  const recipientIds = recipients.map((u) => String(u.id)).filter(Boolean);
  const senderName = await getUserDisplayName(input.senderId);
  const snippet = previewAnnouncement(content, title);
  await notifyUserIds(recipientIds, {
    title: title || 'Company announcement',
    message: `${senderName}: ${snippet}`,
    type: 'INFO',
    category: 'ANNOUNCEMENT',
    priority: 'HIGH',
    entityId: id,
    entityType: 'ANNOUNCEMENT',
    senderId: input.senderId,
    link: '/chat?announcements=1',
    idPrefix: `chat-ann-${id}`,
  });

  return serializeAnnouncementRow(
    { id, senderId: input.senderId, title, content, createdAt, dashboardExpiresAt },
    input.senderId
  );
}
