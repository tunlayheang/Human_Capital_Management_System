import { Message } from '../../types';

export function isSystemChatMessage(msg: Message): boolean {
  return Boolean(msg.messageType?.startsWith('system_') || msg.systemEvent);
}

export function formatSystemChatText(
  msg: Message,
  t: (key: string) => string | undefined,
  currentUserId?: string
): string {
  const ev = msg.systemEvent;
  if (ev?.kind === 'group_leave') {
    const member =
      ev.editorId === currentUserId
        ? t('chat.you') || 'You'
        : ev.editorName || ev.memberName || t('chat.someone') || 'Someone';
    return (t('chat.memberLeftGroup') || '{member} left the group').replace('{member}', member);
  }
  if (ev?.kind === 'group_rename' && ev.newName) {
    const editor =
      ev.editorId === currentUserId
        ? t('chat.you') || 'You'
        : ev.editorName || t('chat.someone') || 'Someone';
    if (ev.oldName) {
      return (t('chat.groupRenamedFromTo') || '{editor} renamed the group from "{old}" to "{new}"')
        .replace('{editor}', editor)
        .replace('{old}', ev.oldName)
        .replace('{new}', ev.newName);
    }
    return (t('chat.groupRenamedTo') || '{editor} set the group name to "{new}"')
      .replace('{editor}', editor)
      .replace('{new}', ev.newName);
  }
  if (ev?.kind === 'group_rename') {
    return t('chat.groupRenamedGeneric') || 'Group name was updated';
  }
  return t('chat.groupRenamedGeneric') || 'Group name was updated';
}

/** @deprecated Prefer formatSystemChatText */
export function formatGroupRenameSystemText(
  msg: Message,
  t: (key: string) => string | undefined,
  currentUserId?: string
): string {
  return formatSystemChatText(msg, t, currentUserId);
}
