import { PERM } from '../constants/permissionKeys';

/** Open the chat module (read inbox, announcements, messages). */
export function canAccessChatModule(
  hasPermission: (key: string) => boolean,
  _userRole?: string
): boolean {
  return hasPermission(PERM.CHAT_VIEW) || hasPermission(PERM.CHAT_SEND);
}

/** Post company-wide announcements — matrix grant or Admin/HR role. */
export function canPostChatAnnouncements(
  userRole?: string,
  hasPermission?: (key: string) => boolean
): boolean {
  if (hasPermission?.(PERM.CHAT_ANNOUNCEMENTS_MANAGE)) return true;
  const r = String(userRole ?? '').toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'HR';
}

/** Send direct / group chat messages. */
export function canSendChatMessages(
  hasPermission: (key: string) => boolean,
  _userRole?: string
): boolean {
  return hasPermission(PERM.CHAT_SEND);
}

export function isChatPath(pathname: string): boolean {
  const path = pathname.replace(/\/$/, '') || '/';
  return path === '/chat' || path.startsWith('/chat/');
}
