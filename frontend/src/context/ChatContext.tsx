// @refresh reset
import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatMuteSettings, ChatTarget, User } from '../types';
import { Api } from '../services/api';
import { useAuth } from './AuthContext';
import { usePinLock } from './PinLockContext';
import { LAYOUT_COMPACT_MAX_PX, prefersFullPageChat } from '../hooks/useCompactLayout';
import { shouldPlayIncomingChatSound } from '../components/chat/chatUtils';
import { createVisibilityAwareInterval } from '../utils/pageVisibility';
import { playChatNotificationSound } from '../utils/notificationSound';
import { isUnauthorizedError } from '../utils/httpError';

interface ChatContextType {
  isOpen: boolean;
  activeTarget: ChatTarget | null;
  /** @deprecated use activeTarget */
  activeUser: User | null;
  unreadCount: number;
  toggleChat: () => void;
  /** Opens the floating chat panel (does not navigate away). */
  openChat: () => void;
  openChatWith: (user: User) => void;
  openGroupChat: (groupId: string, name: string, memberCount: number) => void;
  /** Opens the full-page /chat route and closes the panel. */
  openFullPageChat: () => void;
  closeChat: () => void;
  minimizeChat: () => void;
  setActiveTarget: (target: ChatTarget | null) => void;
  /** @deprecated use setActiveTarget */
  setActiveUser: (user: User | null) => void;
  markAsRead: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  muteSettings: ChatMuteSettings | null;
  refreshMuteSettings: () => Promise<void>;
  setMuteAll: (muted: boolean) => Promise<void>;
  setConversationMute: (target: ChatTarget, muted: boolean) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const CHAT_WIDGET_OPEN_KEY = 'hcms_chat_widget_open';
const UNREAD_POLL_MS = import.meta.env.PROD ? 30_000 : 12_000;

function readStoredChatOpen(): boolean {
  try {
    return sessionStorage.getItem(CHAT_WIDGET_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const { showPinOverlay } = usePinLock();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTarget, setActiveTarget] = useState<ChatTarget | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [muteSettings, setMuteSettings] = useState<ChatMuteSettings | null>(null);
  const prevUnreadBySenderRef = useRef<Record<string, number> | null>(null);
  const sessionDeadRef = useRef(false);
  const muteSettingsRef = useRef(muteSettings);
  muteSettingsRef.current = muteSettings;
  const activeTargetRef = useRef(activeTarget);
  activeTargetRef.current = activeTarget;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    sessionDeadRef.current = false;
  }, [user?.id]);

  const activeUser = activeTarget?.kind === 'direct' ? activeTarget.user : null;

  const refreshMuteSettings = useCallback(async () => {
    if (!isAuthenticated || !user?.id || authLoading || sessionDeadRef.current) {
      setMuteSettings(null);
      return;
    }
    const { isBackupRestoreSessionGuarded } = await import('../services/api');
    if (isBackupRestoreSessionGuarded()) return;
    try {
      setMuteSettings(await Api.chat.getMuteSettings());
    } catch (error) {
      if (isUnauthorizedError(error)) {
        const { isBackupRestoreSessionGuarded: stillRestoring } = await import('../services/api');
        if (stillRestoring()) return;
        sessionDeadRef.current = true;
        void logout({ skipConfirm: true });
      }
    }
  }, [user?.id, isAuthenticated, authLoading, logout]);

  const refreshUnread = useCallback(async () => {
    if (!isAuthenticated || !user?.id || authLoading || sessionDeadRef.current) {
      setUnreadCount(0);
      prevUnreadBySenderRef.current = null;
      return;
    }
    const { isBackupRestoreSessionGuarded } = await import('../services/api');
    if (isBackupRestoreSessionGuarded()) return;
    try {
      const [count, bySender] = await Promise.all([
        Api.chat.getUnreadCount(user.id),
        Api.chat.getUnreadBySender(),
      ]);
      const prevMap = prevUnreadBySenderRef.current;
      // Seed baseline on first successful poll — do not chime for pre-existing unread.
      if (prevMap === null) {
        prevUnreadBySenderRef.current = bySender;
        setUnreadCount(count);
        return;
      }
      if (
        shouldPlayIncomingChatSound(
          muteSettingsRef.current,
          prevMap,
          bySender,
          activeTargetRef.current,
          isOpenRef.current
        )
      ) {
        playChatNotificationSound();
      }
      prevUnreadBySenderRef.current = bySender;
      setUnreadCount(count);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        const { isBackupRestoreSessionGuarded: stillRestoring } = await import('../services/api');
        if (stillRestoring()) return;
        sessionDeadRef.current = true;
        void logout({ skipConfirm: true });
      }
    }
  }, [user?.id, isAuthenticated, authLoading, logout]);

  const setMuteAll = useCallback(async (muted: boolean) => {
    setMuteSettings(await Api.chat.setMuteAll(muted));
  }, []);

  const setConversationMute = useCallback(async (target: ChatTarget, muted: boolean) => {
    if (target.kind === 'announcements') return;
    const next =
      target.kind === 'direct'
        ? await Api.chat.setDirectMute(target.user.id, muted)
        : await Api.chat.setGroupMute(target.groupId, muted);
    setMuteSettings(next);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !user?.token || authLoading || sessionDeadRef.current) return;
    void refreshMuteSettings();
    void refreshUnread();
    return createVisibilityAwareInterval(() => {
      if (!sessionDeadRef.current) void refreshUnread();
    }, UNREAD_POLL_MS);
  }, [refreshUnread, refreshMuteSettings, isAuthenticated, user?.token, authLoading]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !user?.token || authLoading) return;
    const ping = () => {
      if (!user?.token) return;
      void import('../services/api').then(({ isBackupRestoreSessionGuarded }) => {
        if (isBackupRestoreSessionGuarded()) return;
        Api.chat.presenceHeartbeat().catch(() => {});
      });
    };
    ping();
    return createVisibilityAwareInterval(ping, 60_000);
  }, [isAuthenticated, user?.id, authLoading]);

  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    if (readStoredChatOpen() && !prefersFullPageChat()) setIsOpen(true);
  }, [isAuthenticated, authLoading]);

  useEffect(() => {
    if (showPinOverlay && isOpen) setIsOpen(false);
  }, [showPinOverlay, isOpen]);

  // Close desktop dock when viewport enters compact chrome (widget unmounts; chat is /chat).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${LAYOUT_COMPACT_MAX_PX}px)`);
    const onChange = () => {
      if (mql.matches) setIsOpen(false);
    };
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      if (isOpen) sessionStorage.setItem(CHAT_WIDGET_OPEN_KEY, '1');
      else sessionStorage.removeItem(CHAT_WIDGET_OPEN_KEY);
    } catch {
      /* ignore */
    }
  }, [isOpen, isAuthenticated]);

  const openFullPageChat = useCallback(() => {
    setIsOpen(false);
    navigate('/chat');
  }, [navigate]);

  const openChatPopup = useCallback(() => {
    if (showPinOverlay) return;
    if (prefersFullPageChat()) {
      openFullPageChat();
      return;
    }
    setIsOpen(true);
  }, [showPinOverlay, openFullPageChat]);

  const toggleChat = useCallback(() => {
    if (prefersFullPageChat()) {
      navigate('/chat');
      return;
    }
    if (showPinOverlay) return;
    setIsOpen((prev) => !prev);
  }, [showPinOverlay, navigate]);

  const openChat = openChatPopup;

  const openChatWith = useCallback(
    (targetUser: User) => {
      setActiveTarget({ kind: 'direct', user: targetUser });
      if (showPinOverlay) return;
      if (prefersFullPageChat()) {
        setIsOpen(false);
        navigate('/chat');
        return;
      }
      setIsOpen(true);
    },
    [showPinOverlay, navigate]
  );

  const openGroupChat = useCallback(
    (groupId: string, name: string, memberCount: number) => {
      setActiveTarget({ kind: 'group', groupId, name, memberCount });
      if (showPinOverlay) return;
      if (prefersFullPageChat()) {
        setIsOpen(false);
        navigate('/chat');
        return;
      }
      setIsOpen(true);
    },
    [showPinOverlay, navigate]
  );

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const minimizeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const setActiveUser = useCallback((u: User | null) => {
    setActiveTarget(u ? { kind: 'direct', user: u } : null);
  }, []);

  const markAsRead = useCallback(async () => {
    if (!user?.id || !activeTarget) return;
    try {
      if (activeTarget.kind === 'direct') {
        await Api.chat.markConversationRead(activeTarget.user.id);
      } else if (activeTarget.kind === 'group') {
        await Api.chat.markGroupRead(activeTarget.groupId);
      }
      void refreshUnread();
    } catch {
      /* silent */
    }
  }, [user?.id, activeTarget, refreshUnread]);

  const contextValue = useMemo<ChatContextType>(
    () => ({
      isOpen,
      activeTarget,
      activeUser,
      unreadCount,
      toggleChat,
      openChat,
      openChatWith,
      openGroupChat,
      openFullPageChat,
      closeChat,
      minimizeChat,
      setActiveTarget,
      setActiveUser,
      markAsRead,
      refreshUnread,
      muteSettings,
      refreshMuteSettings,
      setMuteAll,
      setConversationMute,
    }),
    [
      isOpen,
      activeTarget,
      activeUser,
      unreadCount,
      toggleChat,
      openChat,
      openChatWith,
      openGroupChat,
      openFullPageChat,
      closeChat,
      minimizeChat,
      setActiveUser,
      markAsRead,
      refreshUnread,
      muteSettings,
      refreshMuteSettings,
      setMuteAll,
      setConversationMute,
    ]
  );

  return <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within a ChatProvider');
  return context;
};
