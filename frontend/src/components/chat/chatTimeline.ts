import { Message } from '../../types';
import { isSystemChatMessage } from './chatSystemMessage';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

export function formatListTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  }
  return formatDateOnlyDisplay(d);
}

export function formatBubbleTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  ) {
    return 'Today';
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday';
  }
  return formatDateOnlyDisplay(d);
}

export type DateSeparator = { type: 'date'; label: string; key: string };
export type SystemEventItem = { type: 'system'; key: string; message: Message };
export type MessageCluster = {
  type: 'cluster';
  key: string;
  isMe: boolean;
  senderName?: string;
  messages: Message[];
};

export type TimelineItem = DateSeparator | SystemEventItem | MessageCluster;

const CLUSTER_GAP_MS = 5 * 60 * 1000;

export function buildMessageTimeline(
  messages: Message[],
  currentUserId: string,
  resolveSenderName?: (senderId: string) => string | undefined
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastDateKey = '';

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const dateKey = new Date(msg.createdAt).toDateString();
    if (dateKey !== lastDateKey) {
      lastDateKey = dateKey;
      items.push({ type: 'date', label: formatDateLabel(msg.createdAt), key: `date-${dateKey}` });
    }

    if (isSystemChatMessage(msg)) {
      items.push({ type: 'system', key: `system-${msg.id}`, message: msg });
      continue;
    }

    const isMe = msg.senderId === currentUserId;
    const senderName = !isMe ? resolveSenderName?.(msg.senderId) : undefined;
    const prev = items[items.length - 1];
    const prevLast =
      prev?.type === 'cluster' ? prev.messages[prev.messages.length - 1] : undefined;

    const canMerge =
      prev?.type === 'cluster' &&
      prev.isMe === isMe &&
      (isMe || prev.senderName === senderName) &&
      prevLast &&
      new Date(msg.createdAt).getTime() - new Date(prevLast.createdAt).getTime() < CLUSTER_GAP_MS;

    if (canMerge && prev?.type === 'cluster') {
      prev.messages.push(msg);
    } else {
      items.push({
        type: 'cluster',
        key: `cluster-${msg.id}`,
        isMe,
        senderName,
        messages: [msg],
      });
    }
  }

  return items;
}
