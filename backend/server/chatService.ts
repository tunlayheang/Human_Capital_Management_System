import { Op, QueryTypes } from 'sequelize';
import { Message, User, sequelize } from './db.js';
import * as chatMeta from './chatMetaRepository.js';
import { createNotification, getUserDisplayName } from './notificationService.js';
import { serializeUserForClient, USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import { setGroupMute } from './chatMuteService.js';
import { listChatPins, pinKeySet, setChatPin } from './chatPinService.js';
import {
  assertUserEligibleForChat,
  filterUsersEligibleForChat,
} from './chatEligibility.js';

export const MESSAGE_DELETE_WINDOW_MS = 5 * 60 * 1000;
export const MESSAGE_EDIT_WINDOW_MS = MESSAGE_DELETE_WINDOW_MS;

export const CHAT_MESSAGE_TYPE_GROUP_RENAME = 'system_group_rename';
export const CHAT_MESSAGE_TYPE_GROUP_LEAVE = 'system_group_leave';
const GROUP_NAME_MAX_LEN = 120;

export type MessageQuoteDto = {
  id: string;
  senderId: string;
  senderName?: string;
  content: string;
  deletedAt?: string;
  attachmentType?: string;
};

function plainRow(row: unknown): Record<string, unknown> {
  return row && typeof (row as { get?: unknown }).get === 'function'
    ? (row as { get: (o: { plain: boolean }) => Record<string, unknown> }).get({ plain: true })
    : (row as Record<string, unknown>);
}

export const CHAT_ATTACHMENT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export function attachmentTypeFromMime(mime: string): 'image' | 'pdf' | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return null;
}

function parseGroupRenamePayload(content: string) {
  try {
    const data = JSON.parse(content) as {
      oldName?: string;
      newName?: string;
    };
    if (data && typeof data === 'object' && data.newName) {
      return {
        kind: 'group_rename' as const,
        oldName: String(data.oldName || ''),
        newName: String(data.newName || ''),
      };
    }
  } catch {
    /* legacy plain text */
  }
  return null;
}

function parseGroupLeavePayload(content: string) {
  try {
    const data = JSON.parse(content) as { memberName?: string };
    if (data && typeof data === 'object') {
      return {
        kind: 'group_leave' as const,
        memberName: String(data.memberName || ''),
      };
    }
  } catch {
    /* ignore */
  }
  return { kind: 'group_leave' as const, memberName: '' };
}

export function serializeMessage(
  row: unknown,
  extras?: {
    replyTo?: MessageQuoteDto | null;
    forwardedLabel?: string;
    editorName?: string;
  }
) {
  const p = plainRow(row);
  const deletedAt = p.deletedAt ? String(p.deletedAt) : undefined;
  const messageType = p.messageType ? String(p.messageType) : undefined;
  let systemEvent: Record<string, unknown> | undefined;
  if (messageType === CHAT_MESSAGE_TYPE_GROUP_RENAME && !deletedAt) {
    const payload = parseGroupRenamePayload(String(p.content ?? ''));
    if (payload) {
      systemEvent = {
        ...payload,
        editorId: String(p.senderId),
        editorName: extras?.editorName,
      };
    }
  } else if (messageType === CHAT_MESSAGE_TYPE_GROUP_LEAVE && !deletedAt) {
    const payload = parseGroupLeavePayload(String(p.content ?? ''));
    systemEvent = {
      ...payload,
      editorId: String(p.senderId),
      editorName: extras?.editorName || payload.memberName,
    };
  }
  return {
    id: String(p.id),
    senderId: String(p.senderId),
    receiverId: p.receiverId ? String(p.receiverId) : null,
    groupId: p.groupId ? String(p.groupId) : null,
    content: deletedAt ? '' : String(p.content ?? ''),
    isRead: Boolean(p.isRead),
    createdAt: String(p.createdAt || new Date().toISOString()),
    attachmentUrl: deletedAt ? undefined : p.attachmentUrl ? String(p.attachmentUrl) : undefined,
    attachmentType: deletedAt
      ? undefined
      : p.attachmentType
        ? String(p.attachmentType)
        : undefined,
    deletedAt,
    isDeleted: Boolean(deletedAt),
    replyToId: p.replyToId ? String(p.replyToId) : undefined,
    forwardedFromId: p.forwardedFromId ? String(p.forwardedFromId) : undefined,
    replyTo: extras?.replyTo ?? undefined,
    forwardedLabel: extras?.forwardedLabel,
    messageType,
    systemEvent,
    editedAt: p.editedAt ? String(p.editedAt) : undefined,
  };
}

async function buildQuoteMap(ids: string[]): Promise<Map<string, MessageQuoteDto>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await Message.findAll({ where: { id: unique } });
  const map = new Map<string, MessageQuoteDto>();
  await Promise.all(
    rows.map(async (raw) => {
      const p = plainRow(raw);
      const id = String(p.id);
      const senderId = String(p.senderId);
      const sender = await loadUserBrief(senderId);
      map.set(id, {
        id,
        senderId,
        senderName: sender?.name,
        content: p.deletedAt ? '' : String(p.content ?? ''),
        deletedAt: p.deletedAt ? String(p.deletedAt) : undefined,
        attachmentType: p.attachmentType ? String(p.attachmentType) : undefined,
      });
    })
  );
  return map;
}

export async function serializeMessagesForClient(rows: unknown[]) {
  const replyIds: string[] = [];
  const forwardIds: string[] = [];
  const editorIds = new Set<string>();
  for (const row of rows) {
    const p = plainRow(row);
    if (p.replyToId) replyIds.push(String(p.replyToId));
    if (p.forwardedFromId) forwardIds.push(String(p.forwardedFromId));
    if (
      (p.messageType === CHAT_MESSAGE_TYPE_GROUP_RENAME ||
        p.messageType === CHAT_MESSAGE_TYPE_GROUP_LEAVE) &&
      p.senderId
    ) {
      editorIds.add(String(p.senderId));
    }
  }
  const quoteMap = await buildQuoteMap([...replyIds, ...forwardIds]);
  const editorNames = new Map<string, string>();
  await Promise.all(
    [...editorIds].map(async (id) => {
      const brief = await loadUserBrief(id);
      if (brief?.name) editorNames.set(id, String(brief.name));
    })
  );
  return rows.map((row) => {
    const p = plainRow(row);
    const replyToId = p.replyToId ? String(p.replyToId) : null;
    const forwardedFromId = p.forwardedFromId ? String(p.forwardedFromId) : null;
    const replyTo = replyToId ? quoteMap.get(replyToId) ?? null : null;
    const fwd = forwardedFromId ? quoteMap.get(forwardedFromId) : undefined;
    const forwardedLabel = fwd?.senderName
      ? `Forwarded from ${fwd.senderName}`
      : forwardedFromId
        ? 'Forwarded message'
        : undefined;
    const editorName =
      p.messageType === CHAT_MESSAGE_TYPE_GROUP_RENAME ||
      p.messageType === CHAT_MESSAGE_TYPE_GROUP_LEAVE
        ? editorNames.get(String(p.senderId))
        : undefined;
    return serializeMessage(row, { replyTo, forwardedLabel, editorName });
  });
}

async function loadUserBrief(userId: string) {
  const user: any = await User.findByPk(userId, { attributes: [...USER_ACCOUNT_ATTRIBUTES] });
  if (!user) return null;
  return serializeUserForClient(user.get({ plain: true }));
}

async function loadUsersBrief(userIds: string[]) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Map<string, Awaited<ReturnType<typeof loadUserBrief>>>();
  const users: any[] = await User.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });
  const map = new Map<string, NonNullable<Awaited<ReturnType<typeof loadUserBrief>>>>();
  await Promise.all(
    users.map(async (row) => {
      const plain = row?.get ? row.get({ plain: true }) : row;
      if (!plain?.id) return;
      const profile = await serializeUserForClient(plain);
      map.set(String(plain.id), profile);
    })
  );
  return map;
}

async function mapDirectUnreadCounts(receiverId: string): Promise<Map<string, number>> {
  const rows = (await Message.findAll({
    attributes: ['senderId', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    where: {
      groupId: { [Op.is]: null },
      receiverId,
      isRead: false,
    },
    group: ['senderId'],
    raw: true,
  })) as Array<{ senderId: string; cnt: string | number }>;
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.senderId) map.set(String(row.senderId), Number(row.cnt) || 0);
  }
  return map;
}

export async function assertGroupMember(groupId: string, userId: string) {
  const row = await chatMeta.findGroupMember(groupId, userId);
  if (!row) throw Object.assign(new Error('Not a member of this group'), { status: 403 });
}

/** Active-employee portal users except the caller — chat directory / group pick list. */
export async function listColleaguesForChat(excludeUserId: string) {
  const users: any[] = await User.findAll({
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
    where: { id: { [Op.ne]: excludeUserId } },
    order: [['email', 'ASC']],
  });
  const plains = users.map((row) => (row?.get ? row.get({ plain: true }) : row));
  const eligible = await filterUsersEligibleForChat(plains);
  return Promise.all(eligible.map((plain) => serializeUserForClient(plain)));
}

export async function listInbox(userId: string) {
  const directMsgs = await Message.findAll({
    where: {
      groupId: { [Op.is]: null },
      [Op.or]: [{ senderId: userId }, { receiverId: userId }],
    },
    order: [['createdAt', 'DESC']],
    limit: 500,
  });

  const partnerMeta = new Map<string, { lastMessage: string; lastAt: string }>();

  for (const raw of directMsgs) {
    const m = raw as any;
    const partnerId = m.senderId === userId ? m.receiverId : m.senderId;
    if (!partnerId || partnerMeta.has(partnerId)) continue;
    partnerMeta.set(partnerId, {
      lastMessage: previewContent(m),
      lastAt: String(m.createdAt),
    });
  }

  const unreadBySender = await mapDirectUnreadCounts(userId);
  const partnerBriefs = await loadUsersBrief([...partnerMeta.keys()]);

  const direct = [...partnerMeta.entries()]
    .map(([partnerId, meta]) => {
      const partner = partnerBriefs.get(partnerId);
      if (!partner) return null;
      return {
        kind: 'direct' as const,
        partnerId,
        partner,
        lastMessage: meta.lastMessage,
        lastMessageAt: meta.lastAt,
        unreadCount: unreadBySender.get(partnerId) ?? 0,
      };
    })
    .filter(Boolean);

  const memberships = await chatMeta.listGroupMembershipsForUser(userId);
  const groupIds = memberships.map((m) => m.groupId);
  const membershipByGroup = new Map(memberships.map((m) => [m.groupId, m]));

  let groupsFiltered: Array<{
    kind: 'group';
    groupId: string;
    name: string;
    memberCount: number;
    lastMessage: string;
    lastMessageAt: string;
    unreadCount: number;
  }> = [];

  if (groupIds.length) {
    try {
      const [groupRows, memberCounts, lastMsgRaw] = await Promise.all([
        chatMeta.listGroupsByIds(groupIds),
        chatMeta.countGroupMembersByGroupIds(groupIds),
        sequelize.query(
          `SELECT m.groupId AS groupId, m.content AS content, m.messageType AS messageType,
                  m.attachmentUrl AS attachmentUrl, m.attachmentType AS attachmentType,
                  m.createdAt AS createdAt
           FROM messages m
           INNER JOIN (
             SELECT groupId, MAX(createdAt) AS maxAt
             FROM messages
             WHERE groupId IN (:groupIds)
             GROUP BY groupId
           ) latest
             ON latest.groupId = m.groupId AND latest.maxAt = m.createdAt`,
          { replacements: { groupIds }, type: QueryTypes.SELECT }
        ),
      ]);
      const lastMsgRows = lastMsgRaw as Array<{
        groupId?: string;
        content?: string;
        messageType?: string;
        attachmentUrl?: string;
        attachmentType?: string;
        createdAt?: string;
      }>;

      const groupById = new Map(groupRows.map((g) => [g.id, g]));
      const lastByGroup = new Map<
        string,
        {
          content?: string;
          messageType?: string;
          attachmentUrl?: string;
          attachmentType?: string;
          createdAt?: string;
        }
      >();
      for (const row of lastMsgRows) {
        const gid = String(row.groupId ?? '').trim();
        if (gid && !lastByGroup.has(gid)) lastByGroup.set(gid, row);
      }

      // One unread count per group (parallel) — previously also fetched group + members + last msg each.
      const unreadEntries = await Promise.all(
        groupIds.map(async (groupId) => {
          const membership = membershipByGroup.get(groupId);
          const lastReadAt = String(membership?.lastReadAt || '');
          const unreadWhere: Record<string, unknown> = {
            groupId,
            senderId: { [Op.ne]: userId },
          };
          if (lastReadAt) unreadWhere.createdAt = { [Op.gt]: lastReadAt };
          const unreadCount = await Message.count({ where: unreadWhere as any });
          return [groupId, unreadCount] as const;
        })
      );
      const unreadByGroup = new Map(unreadEntries);

      groupsFiltered = groupIds
        .map((groupId) => {
          const group = groupById.get(groupId);
          if (!group) return null;
          const lastMsg = lastByGroup.get(groupId);
          return {
            kind: 'group' as const,
            groupId,
            name: String(group.name || 'Group'),
            memberCount: memberCounts.get(groupId) ?? 0,
            lastMessage: lastMsg
              ? previewContent({
                  content: lastMsg.content,
                  messageType: lastMsg.messageType,
                  attachmentUrl: lastMsg.attachmentUrl,
                  attachmentType: lastMsg.attachmentType,
                } as any)
              : '',
            lastMessageAt: lastMsg?.createdAt ? String(lastMsg.createdAt) : '',
            unreadCount: unreadByGroup.get(groupId) ?? 0,
          };
        })
        .filter(Boolean) as typeof groupsFiltered;
    } catch (err) {
      // Keep direct chats usable if group preview SQL fails (e.g. schema drift).
      console.error('[chat] listInbox group preview failed:', err);
      try {
        const groupRows = await chatMeta.listGroupsByIds(groupIds);
        const memberCounts = await chatMeta.countGroupMembersByGroupIds(groupIds);
        const groupById = new Map(groupRows.map((g) => [g.id, g]));
        groupsFiltered = groupIds
          .map((groupId) => {
            const group = groupById.get(groupId);
            if (!group) return null;
            return {
              kind: 'group' as const,
              groupId,
              name: String(group.name || 'Group'),
              memberCount: memberCounts.get(groupId) ?? 0,
              lastMessage: '',
              lastMessageAt: '',
              unreadCount: 0,
            };
          })
          .filter(Boolean) as typeof groupsFiltered;
      } catch (fallbackErr) {
        console.error('[chat] listInbox group fallback failed:', fallbackErr);
        groupsFiltered = [];
      }
    }
  }

  const directFiltered = direct.filter(Boolean) as NonNullable<(typeof direct)[number]>[];

  const pins = await listChatPins(userId);
  const pinned = pinKeySet(pins);

  const sortByPinThenTime = <T extends { lastMessageAt?: string }>(
    items: T[],
    isPinned: (item: T) => boolean
  ) =>
    [...items].sort((a, b) => {
      const ap = isPinned(a) ? 1 : 0;
      const bp = isPinned(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (
        new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime()
      );
    });

  const directSorted = sortByPinThenTime(directFiltered, (d) => pinned.direct.has(d.partnerId)).map(
    (d) => ({ ...d, pinned: pinned.direct.has(d.partnerId) })
  );
  const groupsSorted = sortByPinThenTime(groupsFiltered, (g) => pinned.groups.has(g.groupId)).map(
    (g) => ({ ...g, pinned: pinned.groups.has(g.groupId) })
  );

  const all = [...directSorted, ...groupsSorted].sort((a, b) => {
    const ap = (a as { pinned?: boolean }).pinned ? 1 : 0;
    const bp = (b as { pinned?: boolean }).pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (
      new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime()
    );
  });

  let announcements: Awaited<
    ReturnType<typeof import('./chatAnnouncementService.js').getAnnouncementsInboxSummary>
  > = null;
  try {
    const { getAnnouncementsInboxSummary } = await import('./chatAnnouncementService.js');
    announcements = await getAnnouncementsInboxSummary(userId);
  } catch (annErr) {
    console.warn('[chat] announcements inbox skipped:', (annErr as Error)?.message || annErr);
  }

  const allWithAnnouncements = announcements
    ? [announcements, ...all.filter((item) => (item as { kind?: string }).kind !== 'announcements')]
    : all;

  return {
    direct: directSorted,
    groups: groupsSorted,
    announcements,
    all: allWithAnnouncements,
    pins,
  };
}

/** Limited profile for chat contact card (no salary/bank). */
export async function getChatContactProfile(viewerId: string, targetUserId: string) {
  if (viewerId === targetUserId) return null;
  const brief = await loadUserBrief(targetUserId);
  if (!brief) return null;
  const {
    salary: _s,
    dependents: _d,
    bankAccountName: _b1,
    bankAccountNumber: _b2,
    bankName: _b3,
    taxId: _t,
    nationalId: _n,
    permissionsOverride: _p,
    token: _tok,
    ...safe
  } = brief as Record<string, unknown>;
  return safe;
}

function previewContent(m: any): string {
  if (m.deletedAt || m.get?.('deletedAt')) return 'Message deleted';
  const msgType = String(m.messageType || m.get?.('messageType') || '');
  if (msgType === CHAT_MESSAGE_TYPE_GROUP_RENAME) {
    const payload = parseGroupRenamePayload(String(m.content || m.get?.('content') || ''));
    if (payload?.newName) return `Group name changed to "${payload.newName}"`;
    return 'Group name updated';
  }
  if (msgType === CHAT_MESSAGE_TYPE_GROUP_LEAVE) {
    const payload = parseGroupLeavePayload(String(m.content || m.get?.('content') || ''));
    if (payload.memberName) return `${payload.memberName} left the group`;
    return 'A member left the group';
  }
  if (m.attachmentType === 'pdf' || m.attachmentType === 'file') return 'PDF attachment';
  if (m.attachmentType === 'image' || m.attachmentUrl) return 'Photo';
  const text = String(m.content || '').trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export async function getDirectMessages(userId: string, partnerId: string) {
  return Message.findAll({
    where: {
      groupId: { [Op.is]: null },
      [Op.or]: [
        { senderId: userId, receiverId: partnerId },
        { senderId: partnerId, receiverId: userId },
      ],
    },
    order: [['createdAt', 'ASC']],
  });
}

export async function getGroupMessages(userId: string, groupId: string) {
  await assertGroupMember(groupId, userId);
  return Message.findAll({
    where: { groupId },
    order: [['createdAt', 'ASC']],
  });
}

async function assertValidReply(
  replyToId: string | undefined,
  viewerId: string,
  context: { partnerId?: string; groupId?: string }
) {
  if (!replyToId?.trim()) return;
  const parent: any = await Message.findByPk(replyToId.trim());
  if (!parent) throw Object.assign(new Error('Reply message not found'), { status: 404 });
  if (parent.deletedAt) throw Object.assign(new Error('Cannot reply to a deleted message'), { status: 400 });
  if (context.groupId) {
    if (String(parent.groupId) !== context.groupId) {
      throw Object.assign(new Error('Reply must be in the same conversation'), { status: 400 });
    }
    await assertGroupMember(context.groupId, viewerId);
  } else if (context.partnerId) {
    const inThread =
      (parent.senderId === viewerId && parent.receiverId === context.partnerId) ||
      (parent.senderId === context.partnerId && parent.receiverId === viewerId);
    if (!inThread || parent.groupId) {
      throw Object.assign(new Error('Reply must be in the same conversation'), { status: 400 });
    }
  }
}

export async function sendDirectMessage(input: {
  senderId: string;
  receiverId: string;
  content?: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  replyToId?: string | null;
  forwardedFromId?: string | null;
}) {
  if (!input.content?.trim() && !input.attachmentUrl) {
    throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
  }
  await assertUserEligibleForChat(input.senderId);
  await assertUserEligibleForChat(input.receiverId);
  await assertValidReply(input.replyToId || undefined, input.senderId, {
    partnerId: input.receiverId,
  });
  const now = new Date();
  const msg = await Message.create({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    senderId: input.senderId,
    receiverId: input.receiverId,
    groupId: null,
    content: input.content?.trim() || '',
    isRead: false,
    createdAt: now.toISOString(),
    updatedAt: now,
    attachmentUrl: input.attachmentUrl || null,
    attachmentType: input.attachmentType || null,
    replyToId: input.replyToId?.trim() || null,
    forwardedFromId: input.forwardedFromId?.trim() || null,
  });
  try {
    const { notifyChatDirectMessage } = await import('./notificationService.js');
    void notifyChatDirectMessage({
      messageId: String(msg.get('id')),
      senderId: input.senderId,
      receiverId: input.receiverId,
      preview: input.content?.trim() || (input.attachmentUrl ? 'Sent an attachment' : 'New message'),
    });
  } catch (err) {
    console.warn('[chat] direct message notification failed:', err);
  }
  return msg;
}

export async function sendGroupMessage(input: {
  senderId: string;
  groupId: string;
  content?: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  replyToId?: string | null;
  forwardedFromId?: string | null;
}) {
  await assertUserEligibleForChat(input.senderId);
  await assertGroupMember(input.groupId, input.senderId);
  if (!input.content?.trim() && !input.attachmentUrl) {
    throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
  }
  await assertValidReply(input.replyToId || undefined, input.senderId, { groupId: input.groupId });
  const now = new Date();
  const msg = await Message.create({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    senderId: input.senderId,
    receiverId: null,
    groupId: input.groupId,
    content: input.content?.trim() || '',
    isRead: false,
    createdAt: now.toISOString(),
    updatedAt: now,
    attachmentUrl: input.attachmentUrl || null,
    attachmentType: input.attachmentType || null,
    replyToId: input.replyToId?.trim() || null,
    forwardedFromId: input.forwardedFromId?.trim() || null,
  });
  try {
    const group = await chatMeta.getGroupById(input.groupId);
    const members = await chatMeta.listGroupMembers(input.groupId);
    const { notifyChatGroupMessage } = await import('./notificationService.js');
    void notifyChatGroupMessage({
      messageId: String(msg.get('id')),
      groupId: input.groupId,
      groupName: String(group?.name || 'Group chat'),
      senderId: input.senderId,
      memberUserIds: members.map((m) => String(m.userId)),
      preview: input.content?.trim() || (input.attachmentUrl ? 'Sent an attachment' : 'New message'),
    });
  } catch (err) {
    console.warn('[chat] group message notification failed:', err);
  }
  return msg;
}

function assertOwnMessageWithinModifyWindow(row: any, userId: string, action: 'delete' | 'edit') {
  if (row.messageType && String(row.messageType).startsWith('system_')) {
    throw Object.assign(new Error('System messages cannot be modified'), { status: 403 });
  }
  if (String(row.senderId) !== userId) {
    throw Object.assign(
      new Error(`You can only ${action} your own messages`),
      { status: 403 }
    );
  }
  if (row.deletedAt) {
    throw Object.assign(new Error('Message was deleted'), { status: 400 });
  }
  const createdAt = new Date(String(row.createdAt || 0)).getTime();
  if (Number.isNaN(createdAt) || Date.now() - createdAt > MESSAGE_EDIT_WINDOW_MS) {
    throw Object.assign(
      new Error(`Messages can only be ${action === 'delete' ? 'deleted' : 'edited'} within 5 minutes of sending`),
      { status: 403 }
    );
  }
}

export async function editMessageForUser(
  userId: string,
  messageId: string,
  content: string
) {
  const row: any = await Message.findByPk(messageId);
  if (!row) throw Object.assign(new Error('Message not found'), { status: 404 });
  assertOwnMessageWithinModifyWindow(row, userId, 'edit');
  const trimmed = String(content ?? '').trim();
  if (!trimmed) {
    throw Object.assign(new Error('Message cannot be empty'), { status: 400 });
  }
  const now = new Date().toISOString();
  await row.update({ content: trimmed, editedAt: now });
  return row;
}

export async function deleteMessageForUser(userId: string, messageId: string) {
  const row: any = await Message.findByPk(messageId);
  if (!row) throw Object.assign(new Error('Message not found'), { status: 404 });
  if (row.deletedAt) return row;
  assertOwnMessageWithinModifyWindow(row, userId, 'delete');
  const now = new Date().toISOString();
  await row.update({ deletedAt: now, content: '' });
  return row;
}

export async function forwardMessage(input: {
  userId: string;
  messageId: string;
  receiverId?: string;
  groupId?: string;
}) {
  const original: any = await Message.findByPk(input.messageId);
  if (!original) throw Object.assign(new Error('Message not found'), { status: 404 });
  if (original.deletedAt) {
    throw Object.assign(new Error('Cannot forward a deleted message'), { status: 400 });
  }
  const canAccess =
    String(original.senderId) === input.userId ||
    String(original.receiverId) === input.userId ||
    (original.groupId &&
      (await chatMeta.findGroupMember(String(original.groupId), input.userId)));
  if (!canAccess) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const payload = {
    content: String(original.content || ''),
    attachmentUrl: original.attachmentUrl || null,
    attachmentType: original.attachmentType || null,
    forwardedFromId: String(original.id),
  };

  if (input.groupId) {
    return sendGroupMessage({ senderId: input.userId, groupId: input.groupId, ...payload });
  }
  if (!input.receiverId) {
    throw Object.assign(new Error('receiverId or groupId is required'), { status: 400 });
  }
  return sendDirectMessage({
    senderId: input.userId,
    receiverId: input.receiverId,
    ...payload,
  });
}

export async function markDirectRead(userId: string, partnerId: string) {
  await Message.update(
    { isRead: true },
    {
      where: {
        groupId: { [Op.is]: null },
        senderId: partnerId,
        receiverId: userId,
        isRead: false,
      },
    }
  );
}

export async function markGroupRead(userId: string, groupId: string) {
  await assertGroupMember(groupId, userId);
  const now = new Date().toISOString();
  await chatMeta.updateGroupMemberLastRead(groupId, userId, now);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const direct = await Message.count({
    where: { groupId: { [Op.is]: null }, receiverId: userId, isRead: false },
  });

  const memberships = await chatMeta.listGroupMembershipsForUser(userId);
  const groupUnreadParts = await Promise.all(
    memberships.map(async (m) => {
      const where: any = { groupId: m.groupId, senderId: { [Op.ne]: userId } };
      const lastReadAt = String(m.lastReadAt || '');
      if (lastReadAt) where.createdAt = { [Op.gt]: lastReadAt };
      return Message.count({ where });
    })
  );
  const groupUnread = groupUnreadParts.reduce((sum, n) => sum + n, 0);
  let announcementUnread = 0;
  try {
    const { countUnreadAnnouncements } = await import('./chatAnnouncementService.js');
    announcementUnread = await countUnreadAnnouncements(userId);
  } catch {
    /* optional */
  }
  return direct + groupUnread + announcementUnread;
}

export async function getUnreadBySender(userId: string): Promise<Record<string, number>> {
  const rows = await Message.findAll({
    where: { groupId: { [Op.is]: null }, receiverId: userId, isRead: false },
    attributes: ['senderId'],
  });
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const senderId = (row as any).senderId as string;
    counts[senderId] = (counts[senderId] || 0) + 1;
  }
  return counts;
}

export function isChatAdmin(role: string | undefined): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'ADMIN' || r === 'HR';
}

export async function createGroupChat(input: {
  name: string;
  createdBy: string;
  memberIds: string[];
}) {
  const name = String(input.name || '').trim();
  if (!name) throw Object.assign(new Error('Group name is required'), { status: 400 });

  await assertUserEligibleForChat(input.createdBy);
  const requested = [
    ...new Set(input.memberIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  for (const memberId of requested) {
    await assertUserEligibleForChat(memberId);
  }

  const uniqueMembers = [...new Set([input.createdBy, ...requested])];

  const groupId = `grp-${Date.now()}`;
  const now = new Date().toISOString();
  await chatMeta.createGroup({
    id: groupId,
    name,
    createdBy: input.createdBy,
    createdAt: now,
  });

  await Promise.all(
    uniqueMembers.map((userId) =>
      chatMeta.createGroupMember({
        id: `cgm-${groupId}-${userId}`,
        groupId,
        userId,
        joinedAt: now,
        lastReadAt: now,
      })
    )
  );

  const inviterName = await getUserDisplayName(input.createdBy);
  const invitees = uniqueMembers.filter((id) => id !== input.createdBy);
  await Promise.all(
    invitees.map((userId) =>
      createNotification({
        userId,
        title: 'Group chat invitation',
        message: `${inviterName} added you to the group "${name}". Open Inbox to view messages.`,
        type: 'INFO',
        link: `/chat?group=${encodeURIComponent(groupId)}`,
        id: `chat-invite-${groupId}-${userId}`,
      })
    )
  );

  return { id: groupId, name, memberCount: uniqueMembers.length };
}

export async function inviteToGroup(input: {
  groupId: string;
  invitedBy: string;
  memberIds: string[];
}) {
  await assertGroupMember(input.groupId, input.invitedBy);
  const group = await chatMeta.getGroupById(input.groupId);
  if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

  const groupName = String(group.name || '');
  const inviterName = await getUserDisplayName(input.invitedBy);
  const now = new Date().toISOString();
  const added: string[] = [];

  for (const userId of input.memberIds) {
    const uid = String(userId).trim();
    if (!uid) continue;
    await assertUserEligibleForChat(uid);
    const existing = await chatMeta.findGroupMember(input.groupId, uid);
    if (existing) continue;
    await chatMeta.createGroupMember({
      id: `cgm-${input.groupId}-${uid}-${Date.now()}`,
      groupId: input.groupId,
      userId: uid,
      joinedAt: now,
      lastReadAt: now,
    });
    added.push(uid);
    await createNotification({
      userId: uid,
      title: 'Group chat invitation',
      message: `${inviterName} invited you to "${groupName}". Open Inbox to join the conversation.`,
      type: 'INFO',
      link: `/chat?group=${encodeURIComponent(input.groupId)}`,
      id: `chat-invite-${input.groupId}-${uid}-${Date.now()}`,
    });
  }

  return { addedCount: added.length, added };
}

export async function getGroupDetail(groupId: string, userId: string) {
  await assertGroupMember(groupId, userId);
  const group = await chatMeta.getGroupById(groupId);
  if (!group) return null;
  const members = await chatMeta.listGroupMembers(groupId);
  const users = await Promise.all(members.map((m) => loadUserBrief(m.userId)));
  return {
    id: groupId,
    name: String(group.name),
    memberCount: members.length,
    members: users.filter(Boolean),
  };
}

export async function updateGroupChatName(input: {
  groupId: string;
  userId: string;
  name: string;
}) {
  await assertGroupMember(input.groupId, input.userId);
  const group = await chatMeta.getGroupById(input.groupId);
  if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

  const newName = String(input.name || '').trim();
  if (!newName) throw Object.assign(new Error('Group name is required'), { status: 400 });
  if (newName.length > GROUP_NAME_MAX_LEN) {
    throw Object.assign(new Error(`Group name must be ${GROUP_NAME_MAX_LEN} characters or less`), {
      status: 400,
    });
  }

  const oldName = String(group.name || '').trim();
  if (oldName === newName) {
    return { id: input.groupId, name: newName, changed: false as const };
  }

  const now = new Date();
  await chatMeta.updateGroupName(input.groupId, newName);

  const editorName = await getUserDisplayName(input.userId);
  const systemMsg = await Message.create({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    senderId: input.userId,
    receiverId: null,
    groupId: input.groupId,
    content: JSON.stringify({ oldName, newName }),
    messageType: CHAT_MESSAGE_TYPE_GROUP_RENAME,
    isRead: false,
    createdAt: now.toISOString(),
    updatedAt: now,
    attachmentUrl: null,
    attachmentType: null,
    replyToId: null,
    forwardedFromId: null,
  });

  const [serialized] = await serializeMessagesForClient([systemMsg]);
  return {
    id: input.groupId,
    name: newName,
    changed: true as const,
    systemMessage: serialized,
    editorName,
  };
}

/** Any group member may leave. Posts a system notice for remaining members. */
export async function leaveGroupChat(input: { groupId: string; userId: string }) {
  const membership = await chatMeta.findGroupMember(input.groupId, input.userId);
  if (!membership) {
    throw Object.assign(new Error('You are not a member of this group'), { status: 403 });
  }
  const group = await chatMeta.getGroupById(input.groupId);
  if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

  const memberName = await getUserDisplayName(input.userId);
  const now = new Date();

  // Notify remaining members before removing membership.
  const systemMsg = await Message.create({
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    senderId: input.userId,
    receiverId: null,
    groupId: input.groupId,
    content: JSON.stringify({ memberName }),
    messageType: CHAT_MESSAGE_TYPE_GROUP_LEAVE,
    isRead: false,
    createdAt: now.toISOString(),
    updatedAt: now,
    attachmentUrl: null,
    attachmentType: null,
    replyToId: null,
    forwardedFromId: null,
  });

  await chatMeta.deleteGroupMember(input.groupId, input.userId);
  const stillMember = await chatMeta.findGroupMember(input.groupId, input.userId);
  if (stillMember) {
    throw Object.assign(new Error('Could not leave this group'), { status: 500 });
  }

  // Clear personal mute/pin for this group (best-effort).
  try {
    await setGroupMute(input.userId, input.groupId, false);
  } catch {
    /* ignore */
  }
  try {
    await setChatPin(input.userId, 'group', input.groupId, false);
  } catch {
    /* ignore */
  }

  const [serialized] = await serializeMessagesForClient([systemMsg]);
  const remaining = await chatMeta.countGroupMembers(input.groupId);
  return {
    groupId: input.groupId,
    left: true as const,
    memberCount: remaining,
    systemMessage: serialized,
    memberName,
  };
}
