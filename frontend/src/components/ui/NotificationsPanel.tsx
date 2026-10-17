import React, { useMemo, useState } from 'react';
import { Bell, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Notification } from '../../types';
import { formatRelativeTime } from '../../utils';
import { LoadingState } from '../common/LoadingState';
import {
  countUnreadInTab,
  extractActorName,
  filterNotificationsByTab,
  getNotificationAvatarStyle,
  isActionableRequest,
  type NotificationTab,
} from '../../utils/notificationCategories';
import {
  notificationHasNavigation,
  resolveNotificationLink,
} from '../../utils/notificationNavigation';
import { splitNavigateTarget } from '../../utils/reviewNavigation';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { useCompactLayout } from '../../hooks/useCompactLayout';

type Props = {
  onClose?: () => void;
  variant?: 'popover' | 'sheet';
};

const TABS: NotificationTab[] = ['all', 'pending', 'requests', 'reminders', 'updates'];

function renderMessageWithHighlights(message: string, actor: string | null) {
  if (!actor || !message.includes(actor)) {
    return <span>{message}</span>;
  }
  const [before, after] = message.split(actor);
  return (
    <span>
      {before}
      <strong className="font-semibold text-slate-900 dark:text-white">{actor}</strong>
      {after}
    </span>
  );
}

export const NotificationsPanel: React.FC<Props> = ({ onClose, variant }) => {
  const { goTo } = useWorkspaceNavigate();
  const { t } = useLanguage();
  const compact = useCompactLayout();
  const isSheet = variant === 'sheet' || compact;
  const { user } = useAuth();
  const userRoles = user?.role ? [user.role] : [];
  const [tab, setTab] = useState<NotificationTab>('all');
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    loadMore,
    hasMore,
    loadingMore,
    loading,
    soundMuted,
    setSoundMuted,
  } = useNotification();

  const navOptions = useMemo(() => ({ roles: userRoles }), [userRoles]);
  const visible = useMemo(
    () =>
      filterNotificationsByTab(notifications, tab).filter((notification) =>
        readFilter === 'all'
          ? true
          : readFilter === 'unread'
            ? !notification.isRead
            : notification.isRead
      ),
    [notifications, readFilter, tab]
  );

  const openLink = async (n: Notification) => {
    const target = resolveNotificationLink(n, navOptions);
    if (!target) return;
    if (!n.isRead) await markAsRead(n.id);
    const { pathname, search } = splitNavigateTarget(target);
    goTo(pathname, search);
    onClose?.();
  };

  const handleNotificationClick = async (n: Notification) => {
    const target = resolveNotificationLink(n, navOptions);
    if (target) {
      await openLink(n);
      return;
    }
    if (!n.isRead) await markAsRead(n.id);
  };

  const dismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markAsRead(id);
  };

  const tabLabel = (key: NotificationTab) => {
    const map: Record<NotificationTab, string> = {
      all: t('notifications.tabs.all') || 'All',
      pending: t('notifications.tabs.pending') || 'Pending',
      requests: t('notifications.tabs.requests') || 'Requests',
      reminders: t('notifications.tabs.reminders') || 'Reminders',
      updates: t('notifications.tabs.updates') || 'Updates',
    };
    return map[key];
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 max-h-full bg-slate-50 dark:bg-slate-900 ${
        isSheet ? 'min-h-[50dvh]' : ''
      }`}
    >
      <div className="shrink-0 px-4 sm:px-5 pt-4 sm:pt-5 pb-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 shadow-sm">
        {isSheet && (
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-3" aria-hidden />
        )}
        <div className="flex items-start justify-between gap-3 mb-3 sm:mb-4">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              {t('header.notifications') || 'Notifications'}
            </h2>
            {unreadCount > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {(t('notifications.unreadCount') || '{n} unread').replace(
                  '{n}',
                  String(unreadCount > 99 ? '99+' : unreadCount)
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setSoundMuted(!soundMuted)}
              className={`p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full transition-colors ${
                soundMuted
                  ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              aria-label={
                soundMuted
                  ? t('notifications.unmuteSound') || 'Unmute notification sound'
                  : t('notifications.muteSound') || 'Mute notification sound'
              }
              title={
                soundMuted
                  ? t('notifications.unmuteSound') || 'Unmute notification sound'
                  : t('notifications.muteSound') || 'Mute notification sound'
              }
            >
              {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1 -mx-1 px-1">
          {TABS.map((key) => {
            const unread = countUnreadInTab(notifications, key);
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`shrink-0 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors min-h-[32px] ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {tabLabel(key)}
                {unread > 0 ? (
                  <span className={`ml-1 tabular-nums ${active ? 'opacity-90' : 'text-primary'}`}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 mt-2" aria-label="Read status filter">
          {(['all', 'unread', 'read'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setReadFilter(value)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium capitalize ${
                readFilter === value
                  ? 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t(`notifications.readFilter.${value}`) || value}
            </button>
          ))}
        </div>

        {unreadCount > 0 && (
          <div className="flex justify-end mt-2 sm:mt-3">
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="text-xs font-semibold text-primary hover:text-primary/90 underline-offset-2 hover:underline min-h-[36px] px-1"
            >
              {t('notifications.markAllRead') || 'Mark all as read'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
        {loading && notifications.length === 0 ? (
          <LoadingState
            variant="panel"
            layout="list"
            label={t('notifications.loading') || 'Loading notifications…'}
          />
        ) : visible.length === 0 ? (
          <div className="hcms-empty-state max-w-sm mx-auto">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Bell className="w-7 h-7 opacity-40" />
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              {tab === 'all'
                ? t('header.noNotifications') || 'No notifications'
                : t('notifications.emptyTab') || 'Nothing in this category yet.'}
            </p>
            <p className="text-sm mt-1.5 leading-relaxed">
              {t('notifications.emptyAll') ||
                'Requests, reminders, and pending work from HR workflows appear here.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((n) => {
              const actor = extractActorName(n.message);
              const avatar = getNotificationAvatarStyle(n);
              const actionable = isActionableRequest(n, navOptions);
              const showUnreadDot = !n.isRead;
              const navigable = notificationHasNavigation(n, navOptions);
              const interactive = navigable || actionable || !n.isRead;

              return (
                <li
                  key={n.id}
                  className={`relative ${
                    !n.isRead
                      ? 'bg-white dark:bg-slate-800/50'
                      : 'bg-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteNotification(n.id);
                    }}
                    className="absolute right-2 top-2 z-10 p-2 rounded-full text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    aria-label={t('notifications.delete') || 'Delete notification'}
                    title={t('notifications.delete') || 'Delete notification'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleNotificationClick(n)}
                    className={`w-full text-left pl-4 sm:pl-5 pr-11 py-3.5 sm:py-4 transition-colors ${
                      interactive
                        ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 active:bg-slate-100 dark:active:bg-slate-800'
                        : 'cursor-default'
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="relative shrink-0">
                        <div
                          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-xs font-bold ${avatar.className}`}
                        >
                          {avatar.initials}
                        </div>
                        {showUnreadDot && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 dark:text-slate-300 leading-snug line-clamp-3">
                          <strong className="font-semibold text-slate-900 dark:text-white">
                            {n.title}
                          </strong>
                          {n.message ? (
                            <> {renderMessageWithHighlights(n.message, actor)}</>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-400 mt-1.5 tabular-nums">
                          {formatRelativeTime(n.createdAt)}
                        </p>
                        {navigable && !actionable && (
                          <p className="mt-2.5 text-xs font-semibold text-primary">
                            {t('notifications.tapToOpen') || 'Tap to open'}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>

                  {actionable && (
                    <div className="flex flex-wrap gap-2 px-4 sm:px-5 pb-3.5 -mt-1">
                      <button
                        type="button"
                        onClick={() => void openLink(n)}
                        className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors min-h-[36px]"
                      >
                        {t('notifications.review') || 'Review'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void dismiss(e, n.id)}
                        className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors min-h-[36px]"
                      >
                        {t('notifications.dismiss') || 'Dismiss'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && visible.length > 0 && (
          <div className="p-3 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingMore
                ? t('common.loading') || 'Loading…'
                : t('notifications.loadMore') || 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
