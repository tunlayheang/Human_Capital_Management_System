// @refresh reset
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createVisibilityAwareInterval } from '../utils/pageVisibility';
import { Notification, NotificationType } from '../types';
import { Api } from '../services/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import {
  playPortalNotificationSound,
  readNotificationSoundMuted,
  unlockNotificationAudio,
  writeNotificationSoundMuted,
} from '../utils/notificationSound';
import {
  ensureBrowserNotificationPermission,
  showBrowserNotification,
  NOTIFICATION_OPEN_EVENT,
  type BrowserNotificationOpenDetail,
} from '../utils/browserNotifications';
import { useWorkspaceNavigate } from '../hooks/useWorkspaceNavigate';
import { splitNavigateTarget } from '../utils/reviewNavigation';
import { isUnauthorizedError } from '../utils/httpError';

function normalizeNotification(row: unknown): Notification | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const typeRaw = String(r.type || 'INFO').toUpperCase();
  const type =
    typeRaw === NotificationType.SUCCESS ||
    typeRaw === NotificationType.WARNING ||
    typeRaw === NotificationType.ERROR
      ? (typeRaw as NotificationType)
      : NotificationType.INFO;
  return {
    id: String(r.id),
    userId: String(r.userId),
    title: String(r.title ?? ''),
    message: String(r.message ?? ''),
    type,
    category: r.category ? String(r.category) : undefined,
    priority: r.priority
      ? (String(r.priority).toUpperCase() as Notification['priority'])
      : undefined,
    entityId: r.entityId ? String(r.entityId) : undefined,
    entityType: r.entityType ? String(r.entityType) : undefined,
    senderId: r.senderId ? String(r.senderId) : undefined,
    isRead: Boolean(r.isRead),
    createdAt: String(r.createdAt || new Date().toISOString()),
    link: r.link ? String(r.link) : undefined,
  };
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  soundMuted: boolean;
  setSoundMuted: (muted: boolean) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const POLL_MS = 10_000;
const PAGE_SIZE = 30;
const SYNC_STORAGE_KEY = 'hcms.notifications.changed';

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { showToast } = useToast();
  const { goTo } = useWorkspaceNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [soundMuted, setSoundMutedState] = useState(false);
  const fetchingRef = useRef(false);
  const sessionDeadRef = useRef(false);
  const pageRef = useRef(1);
  const notificationsRef = useRef<Notification[]>([]);
  const knownUnreadIdsRef = useRef<Set<string> | null>(null);
  const prevUnreadCountRef = useRef<number | null>(null);
  const soundMutedRef = useRef(soundMuted);
  soundMutedRef.current = soundMuted;
  notificationsRef.current = notifications;

  useEffect(() => {
    sessionDeadRef.current = false;
    setSoundMutedState(readNotificationSoundMuted(user?.id));
    knownUnreadIdsRef.current = null;
    prevUnreadCountRef.current = null;
  }, [user?.id]);

  const setSoundMuted = useCallback(
    (muted: boolean) => {
      setSoundMutedState(muted);
      writeNotificationSoundMuted(user?.id, muted);
    },
    [user?.id]
  );

  const broadcastChange = useCallback(() => {
    try {
      localStorage.setItem(
        SYNC_STORAGE_KEY,
        JSON.stringify({ userId: user?.id || '', at: Date.now() })
      );
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.token) return;
    void ensureBrowserNotificationPermission();
    unlockNotificationAudio();
  }, [isAuthenticated, user?.token]);

  const fetchNotifications = useCallback(async (opts?: { background?: boolean; append?: boolean }) => {
    if (
      !isAuthenticated ||
      !user?.token ||
      authLoading ||
      fetchingRef.current ||
      sessionDeadRef.current
    ) {
      return;
    }
    const { isBackupRestoreSessionGuarded } = await import('../services/api');
    if (isBackupRestoreSessionGuarded()) return;
    fetchingRef.current = true;
    const append = Boolean(opts?.append);
    const requestedPage = append ? pageRef.current + 1 : 1;
    if (append) setLoadingMore(true);
    else if (!opts?.background) setLoading(true);
    try {
      const data = await Api.notifications.getAll(user.id, {
        page: requestedPage,
        limit: PAGE_SIZE,
      });
      const rows = (Array.isArray(data.notifications) ? data.notifications : [])
        .map(normalizeNotification)
        .filter((n): n is Notification => n != null);

      const currentRows = append
        ? [...notificationsRef.current, ...rows].filter(
            (row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index
          )
        : rows;
      const unread = currentRows.filter((n) => !n.isRead);
      const serverUnreadCount =
        typeof data.unreadCount === 'number' ? data.unreadCount : unread.length;
      const prevUnread = prevUnreadCountRef.current;
      const prevKnown = knownUnreadIdsRef.current;
      const newUnread =
        append || prevKnown == null ? [] : unread.filter((n) => !prevKnown.has(n.id));

      // Prefer new unread IDs; also chime when unread count rises (e.g. after returning to tab).
      const shouldChime =
        !soundMutedRef.current &&
        ((prevKnown != null && newUnread.length > 0) ||
          (prevUnread !== null && serverUnreadCount > prevUnread));
      if (shouldChime) {
        playPortalNotificationSound();
      }
      if (newUnread.length > 0) {
        const pushRoles = user?.role ? [String(user.role)] : undefined;
        for (const n of newUnread.slice(0, 3)) {
          showBrowserNotification(n, { roles: pushRoles });
          showToast(
            `${n.title}${n.message ? ` — ${n.message}` : ''}`,
            n.type === NotificationType.ERROR
              ? 'error'
              : n.type === NotificationType.WARNING
                ? 'warning'
                : n.type === NotificationType.SUCCESS
                  ? 'success'
                  : 'info'
          );
        }
      }
      prevUnreadCountRef.current = serverUnreadCount;
      knownUnreadIdsRef.current = new Set(unread.map((n) => n.id));

      setNotifications(currentRows);
      setUnreadCount(serverUnreadCount);
      pageRef.current = requestedPage;
      setHasMore(Boolean(data.pagination?.hasMore));
    } catch (error) {
      if (isUnauthorizedError(error)) {
        const { isBackupRestoreSessionGuarded } = await import('../services/api');
        if (isBackupRestoreSessionGuarded()) return;
        sessionDeadRef.current = true;
        void logout({ skipConfirm: true });
      }
      /* silent when API unavailable */
    } finally {
      setLoading(false);
      setLoadingMore(false);
      fetchingRef.current = false;
    }
  }, [user?.id, user?.token, user?.role, isAuthenticated, authLoading, showToast, logout]);

  useEffect(() => {
    if (!isAuthenticated || !user?.token || authLoading || sessionDeadRef.current) {
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      pageRef.current = 1;
      knownUnreadIdsRef.current = null;
      prevUnreadCountRef.current = null;
      return;
    }
    void fetchNotifications();
    return createVisibilityAwareInterval(
      () => {
        if (!sessionDeadRef.current) void fetchNotifications({ background: true });
      },
      POLL_MS
    );
  }, [fetchNotifications, isAuthenticated, user?.token, authLoading]);

  useEffect(() => {
    if (!isAuthenticated || !user?.token) return;
    const refreshVisible = () => {
      if (sessionDeadRef.current) return;
      if (document.visibilityState === 'visible') {
        void fetchNotifications({ background: true });
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SYNC_STORAGE_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as { userId?: string };
        if (!payload.userId || payload.userId === user.id) refreshVisible();
      } catch {
        refreshVisible();
      }
    };
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [fetchNotifications, isAuthenticated, user?.id, user?.token]);

  const markAsRead = useCallback(async (id: string) => {
    const before = notificationsRef.current;
    const beforeUnread = unreadCount;
    try {
      let wasUnread = false;
      setNotifications((prev) => {
        const row = prev.find((n) => n.id === id);
        wasUnread = Boolean(row && !row.isRead);
        return prev.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      });
      await Api.notifications.markRead(id);
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
        prevUnreadCountRef.current = Math.max(0, (prevUnreadCountRef.current ?? 1) - 1);
      }
      knownUnreadIdsRef.current?.delete(id);
      broadcastChange();
    } catch (error) {
      setNotifications(before);
      setUnreadCount(beforeUnread);
      console.error('Failed to mark notification as read', error);
    }
  }, [broadcastChange, unreadCount]);

  useEffect(() => {
    const onBrowserNotificationOpen = (event: Event) => {
      const detail = (event as CustomEvent<BrowserNotificationOpenDetail>).detail;
      if (!detail?.link) return;
      if (detail.notificationId) void markAsRead(detail.notificationId);
      const { pathname, search } = splitNavigateTarget(detail.link);
      goTo(pathname, search);
    };
    window.addEventListener(NOTIFICATION_OPEN_EVENT, onBrowserNotificationOpen);
    return () => {
      window.removeEventListener(NOTIFICATION_OPEN_EVENT, onBrowserNotificationOpen);
    };
  }, [markAsRead, goTo]);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    try {
      await Api.notifications.markAllRead(user.id);
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      knownUnreadIdsRef.current = new Set();
      prevUnreadCountRef.current = 0;
      broadcastChange();
    } catch (error) {
      console.error('Failed to mark all as read', error);
    }
  }, [user, broadcastChange]);

  const deleteNotification = useCallback(
    async (id: string) => {
      const before = notificationsRef.current;
      const removed = before.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (removed && !removed.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
        knownUnreadIdsRef.current?.delete(id);
      }
      try {
        await Api.notifications.delete(id);
        broadcastChange();
      } catch (error) {
        setNotifications(before);
        if (removed && !removed.isRead) setUnreadCount((prev) => prev + 1);
        console.error('Failed to delete notification', error);
      }
    },
    [broadcastChange]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    await fetchNotifications({ background: true, append: true });
  }, [fetchNotifications, hasMore, loadingMore]);

  const contextValue = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      loadingMore,
      hasMore,
      soundMuted,
      setSoundMuted,
      refresh: () => fetchNotifications(),
      loadMore,
      markAsRead,
      markAllAsRead,
      deleteNotification,
    }),
    [
      notifications,
      unreadCount,
      loading,
      loadingMore,
      hasMore,
      soundMuted,
      setSoundMuted,
      fetchNotifications,
      loadMore,
      markAsRead,
      markAllAsRead,
      deleteNotification,
    ]
  );

  return (
    <NotificationContext.Provider value={contextValue}>{children}</NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotification must be used within a NotificationProvider');
  return context;
};
