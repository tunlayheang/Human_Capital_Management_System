import {
  ChatMuteSettings,
  CHAT_DELETE_WINDOW_MS,
  ChatTarget,
  Message,
  MessageQuote,
  User,
} from '../../types';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

const ONLINE_MS = 5 * 60 * 1000;

/** Hex (no #) for ui-avatars.com — aligned with Tailwind `primary-600`. */
export const CHAT_AVATAR_BG_HEX = '0078C1';

export function chatAvatarFallbackUrl(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${CHAT_AVATAR_BG_HEX}&color=fff`;
}

/** HR display code for chat UI (not internal `employees.id` / `emp-*`). */
export function resolveDisplayEmployeeId(
  user?: Pick<User, 'displayEmployeeId' | 'employeeId'> & {
    employee?: { employee_id?: string } | null;
  } | null
): string {
  if (!user) return '';
  const fromField = String(user.displayEmployeeId ?? '').trim();
  if (fromField) return fromField;
  const fromNested = String(user.employee?.employee_id ?? '').trim();
  if (fromNested) return fromNested;
  return '';
}

/** Readable label when `user.name` is missing from a partial inbox payload. */
export function resolveChatDisplayName(
  user?: Pick<User, 'name' | 'email' | 'displayEmployeeId' | 'employeeId'> & {
    employee?: { employee_id?: string } | null;
  } | null
): string {
  const name = String(user?.name ?? '').trim();
  if (name) return name;
  const email = String(user?.email ?? '').trim();
  if (email) {
    const local = email.split('@')[0]?.trim();
    if (local) return local;
    return email;
  }
  const displayId = resolveDisplayEmployeeId(user);
  if (displayId) return displayId;
  return 'Unknown user';
}

export function isUserOnline(user?: Pick<User, 'isOnline' | 'lastSeenAt'> | null): boolean {
  if (!user) return false;
  if (user.isOnline === true) return true;
  if (user.isOnline === false) return false;
  if (!user.lastSeenAt) return false;
  const t = new Date(user.lastSeenAt).getTime();
  return !Number.isNaN(t) && Date.now() - t < ONLINE_MS;
}

export function formatPresenceLabel(
  user: Pick<User, 'isOnline' | 'lastSeenAt'> | null | undefined,
  t: (key: string) => string
): string {
  if (!user) return t('chat.offline') || 'Offline';
  if (isUserOnline(user)) return t('chat.online') || 'Online';
  if (!user.lastSeenAt) return t('chat.offline') || 'Offline';
  const d = new Date(user.lastSeenAt);
  if (Number.isNaN(d.getTime())) return t('chat.offline') || 'Offline';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t('chat.lastSeenJustNow') || 'Last seen just now';
  if (diff < 3600_000) {
    const m = Math.floor(diff / 60_000);
    return (t('chat.lastSeenMinutes') || 'Last seen {n}m ago').replace('{n}', String(m));
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3600_000);
    return (t('chat.lastSeenHours') || 'Last seen {n}h ago').replace('{n}', String(h));
  }
  return (t('chat.lastSeenDate') || 'Last seen {date}').replace(
    '{date}',
    formatDateOnlyDisplay(d)
  );
}

export function shouldPlayIncomingChatSound(
  muteSettings: ChatMuteSettings | null | undefined,
  prevBySender: Record<string, number>,
  nextBySender: Record<string, number>,
  activeTarget: ChatTarget | null,
  chatPanelOpen: boolean
): boolean {
  // null settings = not loaded yet / default unmuted (do not block the first real increase)
  if (muteSettings?.muteAll) return false;
  return Object.entries(nextBySender).some(([senderId, count]) => {
    const prev = prevBySender[senderId] || 0;
    if (count <= prev) return false;
    if (muteSettings && isSenderMuted(muteSettings, senderId)) return false;
    if (
      chatPanelOpen &&
      activeTarget?.kind === 'direct' &&
      activeTarget.user.id === senderId
    ) {
      return false;
    }
    return true;
  });
}

export function canModifyOwnMessage(msg: Message, currentUserId: string): boolean {
  if (msg.messageType?.startsWith('system_') || msg.systemEvent) return false;
  if (msg.isDeleted || msg.deletedAt) return false;
  if (String(msg.senderId) !== String(currentUserId)) return false;
  const created = new Date(msg.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const age = Date.now() - created;
  return age >= 0 && age <= CHAT_DELETE_WINDOW_MS;
}

export function canDeleteMessage(msg: Message, currentUserId: string): boolean {
  return canModifyOwnMessage(msg, currentUserId);
}

export function canEditMessage(msg: Message, currentUserId: string): boolean {
  return canModifyOwnMessage(msg, currentUserId);
}

export function isConversationMuted(
  settings: ChatMuteSettings | null | undefined,
  target: ChatTarget | null
): boolean {
  if (!settings || !target) return false;
  if (settings.muteAll) return true;
  if (target.kind === 'announcements') return false;
  if (target.kind === 'direct') return settings.mutedDirect.includes(target.user.id);
  return settings.mutedGroups.includes(target.groupId);
}

export function isSenderMuted(
  settings: ChatMuteSettings | null | undefined,
  senderId: string
): boolean {
  if (!settings) return false;
  if (settings.muteAll) return true;
  return settings.mutedDirect.includes(senderId);
}

export function quotePreviewText(msg: Message | MessageQuote): string {
  if ('isDeleted' in msg && (msg.isDeleted || msg.deletedAt)) return 'Message deleted';
  if (msg.deletedAt) return 'Message deleted';
  if (msg.attachmentType === 'image') return 'Photo';
  if (msg.attachmentType === 'pdf' || msg.attachmentType === 'file') return 'PDF';
  const text = (msg.content || '').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text || 'Attachment';
}
