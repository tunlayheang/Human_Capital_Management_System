import { Notification } from '../types';
import { notificationHasNavigation } from './notificationNavigation';

/** In-app notification tabs (excludes chat / Messages). */
export type NotificationTab = 'all' | 'requests' | 'reminders' | 'pending' | 'updates';

export function categorizeNotification(n: Notification): Exclude<NotificationTab, 'all'> {
  const title = n.title.toLowerCase();
  const message = n.message.toLowerCase();
  const id = String(n.id ?? '').toLowerCase();
  const link = String(n.link ?? '').toLowerCase();
  const category = String(n.category || '').toUpperCase();

  if (category === 'APPROVAL') return 'requests';
  if (
    category === 'TASK' &&
    (title.includes('due') || title.includes('overdue') || title.includes('deadline'))
  ) {
    return 'reminders';
  }

  if (
    id.startsWith('ra-pending-') ||
    title.includes('pending work') ||
    title.includes('action needed') ||
    title.includes('your turn') ||
    title.includes('needs your approval') ||
    message.includes('your turn')
  ) {
    return 'pending';
  }

  if (
    title.includes('reminder') ||
    title.includes('due') ||
    title.includes('overdue') ||
    title.includes('alert') ||
    id.includes('reminder') ||
    id.includes('personal-hub-alert') ||
    id.includes('probation-remind') ||
    id.includes('appraisal-period') ||
    id.includes('roster-remind') ||
    id.includes('payroll-run-day') ||
    (link.includes('personal') && (title.includes('due') || message.includes('due')))
  ) {
    return 'reminders';
  }

  if (
    title.includes('pending') ||
    title.includes('ready for review') ||
    title.includes('override pending') ||
    title.includes('request pending') ||
    title.includes('awaiting') ||
    title.includes('submitted') ||
    title.includes('sensitive change') ||
    message.includes('requested') ||
    message.includes('review in') ||
    message.includes('approve before') ||
    message.includes('approval needed') ||
    id.startsWith('leave-pending') ||
    id.startsWith('ot-pending') ||
    id.startsWith('perm-req-') ||
    id.startsWith('sensitive-pending-') ||
    id.includes('approval-turn') ||
    id.includes('approval-assigned')
  ) {
    return 'requests';
  }

  if (
    title.includes('approved') ||
    title.includes('declined') ||
    title.includes('rejected') ||
    title.includes('available') ||
    title.includes('completed') ||
    title.includes('resolved') ||
    title.includes('paid') ||
    title.includes('applied')
  ) {
    return 'updates';
  }

  return 'updates';
}

export function filterNotificationsByTab(
  notifications: Notification[],
  tab: NotificationTab
): Notification[] {
  if (tab === 'all') return notifications;
  return notifications.filter((n) => categorizeNotification(n) === tab);
}

export function countUnreadInTab(
  notifications: Notification[],
  tab: NotificationTab
): number {
  return filterNotificationsByTab(
    notifications.filter((n) => !n.isRead),
    tab
  ).length;
}

export function isActionableRequest(
  n: Notification,
  options?: { roles?: string[] }
): boolean {
  const cat = categorizeNotification(n);
  return (
    (cat === 'requests' || cat === 'pending' || cat === 'reminders') &&
    notificationHasNavigation(n, options)
  );
}

/** First person name at start of workflow messages, e.g. "Jane Doe requested …". */
export function extractActorName(message: string): string | null {
  const m = message.match(
    /^([A-Za-z\u00C0-\u024F][\w\u00C0-\u024F.'-]*(?:\s+[A-Za-z\u00C0-\u024F][\w\u00C0-\u024F.'-]*)+)\s+(requested|submitted|needs)/i
  );
  if (m?.[1]) return m[1].trim();
  return null;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getNotificationAvatarStyle(n: Notification): {
  initials: string;
  className: string;
} {
  const cat = categorizeNotification(n);
  if (cat === 'reminders') {
    return { initials: 'RM', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' };
  }
  if (cat === 'pending') {
    return { initials: 'PW', className: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' };
  }

  const actor = extractActorName(n.message);
  if (actor) {
    return {
      initials: getInitials(actor),
      className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
    };
  }

  const link = n.link || '';
  if (link.includes('payroll')) {
    return { initials: 'PR', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
  }
  if (link.includes('leaves')) {
    return { initials: 'LV', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' };
  }
  if (link.includes('overtime')) {
    return { initials: 'OT', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' };
  }
  if (link.includes('permissions')) {
    return { initials: 'AC', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' };
  }
  if (link.includes('performance') || link.includes('probation') || link.includes('appraisal')) {
    return { initials: 'PF', className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300' };
  }
  if (link.includes('projects')) {
    return { initials: 'TK', className: 'bg-slate-800 text-white dark:bg-slate-600' };
  }

  return {
    initials: getInitials(n.title),
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
  };
}
