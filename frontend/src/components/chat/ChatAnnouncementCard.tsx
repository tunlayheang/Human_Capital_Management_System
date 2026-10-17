import React from 'react';
import { Megaphone } from 'lucide-react';
import { ChatAnnouncement } from '../../types';
import { formatListTime } from './chatTimeline';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

type Props = {
  item: ChatAnnouncement;
  isMe: boolean;
  t: (key: string) => string;
};

function formatExpiryLabel(
  item: ChatAnnouncement,
  t: (key: string) => string
): string | null {
  if (!item.dashboardExpiresAt) {
    return (
      t('chat.announcements.dashboardAlways') ||
      'On dashboard until each person views it'
    );
  }
  const dateStr = formatDateOnlyDisplay(item.dashboardExpiresAt, '');
  if (!dateStr) return null;
  if (item.activeOnDashboard === false) {
    return (t('chat.announcements.dashboardExpired') || 'Off dashboard since {date}').replace(
      '{date}',
      dateStr
    );
  }
  return (
    t('chat.announcements.dashboardUntil') || 'Dashboard until {date} (or sooner after view)'
  ).replace('{date}', dateStr);
}

export const ChatAnnouncementCard: React.FC<Props> = ({ item, isMe, t }) => {
  const when = formatListTime(item.createdAt);
  const expiryLabel = formatExpiryLabel(item, t);

  return (
    <article
      className={`max-w-[min(100%,36rem)] w-full rounded-2xl border overflow-hidden shadow-sm ${
        isMe ? 'ml-auto' : 'mr-auto'
      } border-primary/25 bg-primary/5 dark:bg-slate-900/80 dark:border-primary/30`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/15 bg-primary/10 dark:bg-primary/20">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full shrink-0 bg-primary text-primary-foreground shadow-sm">
          <Megaphone className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#004874] dark:text-blue-200 truncate">
            {item.title || t('chat.announcements.defaultTitle') || 'Company announcement'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
            {item.senderName}
            {when ? ` · ${when}` : ''}
          </p>
        </div>
      </div>
      {expiryLabel && (
        <p
          className={`px-3 py-1 text-[11px] font-medium border-b border-primary/10 ${
            item.activeOnDashboard === false
              ? 'text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/30'
              : 'text-slate-600 dark:text-slate-400 bg-white/50 dark:bg-slate-800/40'
          }`}
        >
          {expiryLabel}
        </p>
      )}
      <div className="px-3 py-3 sm:px-4 sm:py-3.5 bg-white/70 dark:bg-slate-900/50">
        <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
          {item.content}
        </p>
      </div>
    </article>
  );
};
