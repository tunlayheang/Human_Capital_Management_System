import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVisibilityAwareInterval } from '../utils/pageVisibility';
import { Api } from '../services/api';
import {
  AnnouncementsInboxItem,
  ChatAnnouncement,
  ChatInboxItem,
  ChatTarget,
  DirectInboxItem,
  Message,
  User,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { canPostChatAnnouncements, canSendChatMessages } from '../utils/chatAccess';
import { useChat } from '../context/ChatContext';
import { resolveDisplayEmployeeId } from '../components/chat/chatUtils';
import { formatGroupRenameSystemText } from '../components/chat/chatSystemMessage';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const FILE_ACCEPT = `${IMAGE_ACCEPT},application/pdf`;

/** Minimum characters before searching the colleague directory */
const MIN_COLLEAGUE_SEARCH_LEN = 1;

function sortDirectInbox(items: DirectInboxItem[]): DirectInboxItem[] {
  return [...items].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (aTime && bTime && bTime !== aTime) return bTime - aTime;
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;
    return a.partner.name.localeCompare(b.partner.name);
  });
}

function inboxItemLabel(item: ChatInboxItem): string {
  if (item.kind === 'announcements') return 'Announcements';
  return item.kind === 'direct' ? item.partner.name : item.name;
}

function announcementsMatchesQuery(item: AnnouncementsInboxItem, q: string): boolean {
  const hay = ['announcements', 'announcement', item.lastMessage || ''].join(' ').toLowerCase();
  return hay.includes(q);
}

/** Direct + group conversations in one list (pinned first, then recent). */
function sortUnifiedInbox(items: ChatInboxItem[]): ChatInboxItem[] {
  return [...items].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (aTime && bTime && bTime !== aTime) return bTime - aTime;
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;
    return inboxItemLabel(a).localeCompare(inboxItemLabel(b));
  });
}

function groupMatchesQuery(item: ChatInboxItem, q: string): boolean {
  return item.kind === 'group' && item.name.toLowerCase().includes(q);
}

function userMatchesQuery(u: User, q: string): boolean {
  const name = (u.name || '').toLowerCase();
  const position = (u.position || '').toLowerCase();
  const email = (u.email || '').toLowerCase();
  const id = (u.id || '').toLowerCase();
  const employeeId = String(u.employeeId ?? '').toLowerCase();
  const displayId = resolveDisplayEmployeeId(u).toLowerCase();
  return (
    name.includes(q) ||
    position.includes(q) ||
    email.includes(q) ||
    id.includes(q) ||
    employeeId.includes(q) ||
    (displayId && displayId.includes(q))
  );
}

function normalizeUserList(raw: unknown): User[] {
  if (Array.isArray(raw)) return raw as User[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { users?: User[] }).users)) {
    return (raw as { users: User[] }).users;
  }
  return [];
}

export function useInboxChat(
  activeTarget: ChatTarget | null,
  enabled: boolean,
  groupCreateMode = false
) {
  const { user: currentUser, hasPermission } = useAuth();
  const { showToast } = useToast();
  const { refreshUnread, refreshMuteSettings } = useChat();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [inbox, setInbox] = useState<{
    direct: DirectInboxItem[];
    groups: ChatInboxItem[];
    announcements: AnnouncementsInboxItem | null;
    all: ChatInboxItem[];
  }>({ direct: [], groups: [], all: [], announcements: null });
  const [announcements, setAnnouncements] = useState<ChatAnnouncement[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<{ members: User[] } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshUnreadRef = useRef(refreshUnread);
  refreshUnreadRef.current = refreshUnread;

  const partnerId =
    activeTarget?.kind === 'direct' ? activeTarget.user.id : null;
  const groupId = activeTarget?.kind === 'group' ? activeTarget.groupId : null;
  const isAnnouncements = activeTarget?.kind === 'announcements';

  const canPostAnnouncements = useMemo(
    () => canPostChatAnnouncements(currentUser?.role, hasPermission),
    [currentUser?.role, hasPermission]
  );

  const canSendChat = useMemo(
    () => canSendChatMessages(hasPermission, currentUser?.role),
    [hasPermission, currentUser?.role]
  );

  const loadColleagues = useCallback(async () => {
    if (!currentUser) return;
    try {
      let users: unknown;
      try {
        users = await Api.chat.getColleagues();
      } catch {
        users = await Api.users.getAll();
      }
      const others = normalizeUserList(users).filter((u) => {
        if (!u.id || u.id === currentUser.id) return false;
        if (u.isActive === false) return false;
        const portal = String(u.status || 'ACTIVE').trim().toUpperCase();
        if (portal === 'INACTIVE' || portal === 'FROZEN' || portal === 'DISABLED') return false;
        if (u.accountType === 'system') return true;
        const empStatus = String(u.employee?.status ?? '')
          .trim()
          .toLowerCase();
        // Colleagues API already filters; fallback /users must hide Draft and non-Active.
        if (empStatus) return empStatus === 'active';
        return u.accountType === 'system';
      });
      setAllUsers(others);
    } catch (e) {
      console.error('Failed to load users for chat', e);
      setAllUsers([]);
    }
  }, [currentUser]);

  const loadInbox = useCallback(async () => {
    if (!currentUser) return;
    setLoadingInbox(true);
    try {
      try {
        const inboxData = await Api.chat.getInbox();
        setInbox({
          direct: inboxData?.direct || [],
          groups: inboxData?.groups || [],
          announcements: inboxData?.announcements ?? null,
          all: inboxData?.all || [],
        });
      } catch (e) {
        console.error('Failed to load chat inbox', e);
        setInbox({ direct: [], groups: [], all: [], announcements: null });
      }
    } finally {
      setLoadingInbox(false);
    }
  }, [currentUser]);

  const loadMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!currentUser || !activeTarget) return;
      if (!opts?.silent) {
        setLoadingMessages(true);
        setMessagesError(null);
      }
      try {
        if (activeTarget.kind === 'announcements') {
          const rows = await Api.chat.getAnnouncements();
          const list = Array.isArray(rows) ? (rows as ChatAnnouncement[]) : [];
          setAnnouncements(list);
          setMessages([]);
          setGroupDetail(null);
          await Api.chat.markAnnouncementsRead();
          setMessagesError(null);
          void refreshUnreadRef.current();
          void loadInbox();
          return;
        }
        setAnnouncements([]);
        let data: Message[] = [];
        if (activeTarget.kind === 'direct') {
          const raw = await Api.chat.getMessages(currentUser.id, activeTarget.user.id);
          data = Array.isArray(raw) ? raw : [];
          setMessages(data);
          await Api.chat.markConversationRead(activeTarget.user.id);
          setGroupDetail(null);
        } else {
          const raw = await Api.chat.getGroupMessages(activeTarget.groupId);
          data = Array.isArray(raw) ? raw : [];
          setMessages(data);
          await Api.chat.markGroupRead(activeTarget.groupId);
          const detail = await Api.chat.getGroupDetail(activeTarget.groupId);
          setGroupDetail({ members: detail?.members || [] });
        }
        setMessagesError(null);
        void refreshUnreadRef.current();
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : 'Could not load messages';
        if (!opts?.silent) {
          setMessagesError(msg);
          setMessages([]);
        }
      } finally {
        if (!opts?.silent) setLoadingMessages(false);
      }
    },
    [activeTarget, currentUser]
  );

  useEffect(() => {
    if (!enabled) return;
    void loadInbox();
    return createVisibilityAwareInterval(() => void loadInbox(), 20_000);
  }, [enabled, loadInbox]);

  const searchQuery = searchTerm.trim().toLowerCase();
  const isSearchingColleagues = searchQuery.length >= MIN_COLLEAGUE_SEARCH_LEN;

  /** Load colleague directory only when user searches (forward modal still loads on open) */
  useEffect(() => {
    if (!enabled || !isSearchingColleagues) return;
    void loadColleagues();
  }, [enabled, isSearchingColleagues, loadColleagues]);

  useEffect(() => {
    if (!enabled || (!partnerId && !groupId && !isAnnouncements)) {
      setMessages([]);
      setAnnouncements([]);
      setGroupDetail(null);
      setReplyTo(null);
      setMessagesError(null);
      setLoadingMessages(false);
      return;
    }
    setReplyTo(null);
    void loadMessages();
    return createVisibilityAwareInterval(
      () => void loadMessages({ silent: true }),
      8_000
    );
  }, [enabled, partnerId, groupId, isAnnouncements, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Colleagues matching search — pick members for a new group. */
  const groupCreateMatches = useMemo((): User[] => {
    if (!groupCreateMode || !isSearchingColleagues) return [];
    return allUsers
      .filter((u) => userMatchesQuery(u, searchQuery))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groupCreateMode, isSearchingColleagues, allUsers, searchQuery]);

  const listItems = useMemo((): ChatInboxItem[] => {
    if (groupCreateMode) return [];

    const groups = (inbox.groups as ChatInboxItem[]).filter((item) => {
      if (item.kind !== 'group') return false;
      if (!searchQuery) return true;
      return groupMatchesQuery(item, searchQuery);
    });

    const ann = inbox.announcements;
    const includeAnn =
      ann && (!searchQuery || announcementsMatchesQuery(ann, searchQuery));

    if (!isSearchingColleagues) {
      const merged = sortUnifiedInbox([...inbox.direct, ...groups]);
      return includeAnn ? [ann!, ...merged] : merged;
    }

    const seen = new Set<string>();
    const mergedDirect: DirectInboxItem[] = [];

    for (const item of inbox.direct) {
      if (item.kind !== 'direct') continue;
      if (!userMatchesQuery(item.partner, searchQuery)) continue;
      seen.add(item.partnerId);
      mergedDirect.push(item);
    }

    for (const u of allUsers) {
      if (seen.has(u.id)) continue;
      if (!userMatchesQuery(u, searchQuery)) continue;
      seen.add(u.id);
      mergedDirect.push({
        kind: 'direct',
        partnerId: u.id,
        partner: u,
        unreadCount: 0,
      });
    }

    const merged = sortUnifiedInbox([...mergedDirect, ...groups]);
    return includeAnn ? [ann!, ...merged] : merged;
  }, [
    groupCreateMode,
    inbox.direct,
    inbox.groups,
    inbox.announcements,
    searchQuery,
    isSearchingColleagues,
    allUsers,
  ]);

  const inboxCounts = useMemo(
    () => ({
      total:
        inbox.direct.length +
        inbox.groups.length +
        (inbox.announcements ? 1 : 0),
      direct: inbox.direct.length,
      groups: inbox.groups.length,
      unread:
        inbox.direct.reduce((n, i) => n + (i.unreadCount || 0), 0) +
        inbox.groups.reduce((n, i) => n + (i.unreadCount || 0), 0) +
        (inbox.announcements?.unreadCount || 0),
    }),
    [inbox.direct, inbox.groups, inbox.announcements]
  );

  const postAnnouncement = useCallback(
    async (content: string, title?: string, dashboardExpiresAt?: string | null) => {
      if (!canPostAnnouncements || !content.trim()) return false;
      try {
        const row = (await Api.chat.postAnnouncement({
          title: title?.trim() || undefined,
          content: content.trim(),
          dashboardExpiresAt: dashboardExpiresAt || null,
        })) as ChatAnnouncement;
        if (row?.id) {
          setAnnouncements((prev) => [...prev, row]);
          void loadInbox();
          void refreshUnreadRef.current();
          return true;
        }
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: string }).message)
            : 'Could not post announcement';
        showToast(msg, 'error');
      }
      return false;
    },
    [canPostAnnouncements, loadInbox]
  );

  const sendText = useCallback(
    async (content: string): Promise<{ ok: boolean; error?: string }> => {
      if (!canSendChat || !activeTarget || !content.trim()) {
        return { ok: false, error: 'Cannot send message' };
      }
      try {
        let sent: Message | null = null;
        const replyId = replyTo?.id;
        if (activeTarget.kind === 'direct') {
          sent = await Api.chat.sendMessage(activeTarget.user.id, content.trim(), undefined, replyId);
        } else if (activeTarget.kind === 'group') {
          sent = await Api.chat.sendGroupMessage(activeTarget.groupId, content.trim(), undefined, replyId);
        }
        if (sent?.id) {
          setMessages((prev) => [...prev, sent!]);
          setReplyTo(null);
          void loadInbox();
          return { ok: true };
        }
        return { ok: false, error: 'Message was not saved' };
      } catch (e: unknown) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : 'Could not send message';
        return { ok: false, error: msg };
      }
    },
    [activeTarget, canSendChat, loadInbox, replyTo?.id]
  );

  const sendFile = useCallback(
    async (file: File, caption = '') => {
      if (!canSendChat || !activeTarget || activeTarget.kind === 'announcements') return false;
      const isPdf = file.type === 'application/pdf';
      const isImage = file.type.startsWith('image/');
      if (!isPdf && !isImage) {
        showToast('Only photos and PDF files are allowed.', 'warning');
        return false;
      }
      try {
        let sent: Message | null = null;
        const replyId = replyTo?.id;
        const content = caption.trim();
        if (activeTarget.kind === 'direct') {
          sent = await Api.chat.sendMessage(activeTarget.user.id, content, file, replyId);
        } else {
          sent = await Api.chat.sendGroupMessage(activeTarget.groupId, content, file, replyId);
        }
        if (sent) {
          setMessages((prev) => [...prev, sent!]);
          setReplyTo(null);
          void loadInbox();
          return true;
        }
      } catch (e) {
        console.error(e);
        showToast('Could not upload file. Use a photo or PDF under 8MB.', 'error');
      }
      return false;
    },
    [activeTarget, canSendChat, loadInbox, replyTo?.id]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const updated = await Api.chat.deleteMessage(messageId);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
        void loadInbox();
        return true;
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: string }).message)
            : 'Could not delete message';
        showToast(msg, 'error');
        return false;
      }
    },
    [loadInbox]
  );

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        const updated = await Api.chat.editMessage(messageId, content.trim());
        setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
        void loadInbox();
        return true;
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: string }).message)
            : 'Could not edit message';
        showToast(msg, 'error');
        return false;
      }
    },
    [loadInbox]
  );

  const setPinned = useCallback(
    async (target: ChatTarget, pinned: boolean) => {
      try {
        if (target.kind === 'direct') {
          await Api.chat.setDirectPin(target.user.id, pinned);
        } else if (target.kind === 'group') {
          await Api.chat.setGroupPin(target.groupId, pinned);
        }
        await loadInbox();
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    },
    [loadInbox]
  );

  const refreshPartnerPresence = useCallback(async (partnerId: string) => {
    try {
      const profile = await Api.chat.getContactProfile(partnerId);
      setInbox((prev) => ({
        ...prev,
        direct: prev.direct.map((d) =>
          d.partnerId === partnerId
            ? { ...d, partner: { ...d.partner, ...profile } as User }
            : d
        ),
      }));
      return profile as User;
    } catch {
      return null;
    }
  }, []);

  const forwardMessage = useCallback(
    async (messageId: string, target: { receiverId?: string; groupId?: string }) => {
      try {
        await Api.chat.forwardMessage(messageId, target);
        void loadInbox();
        void refreshMuteSettings();
        return true;
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: string }).message)
            : 'Could not forward message';
        showToast(msg, 'error');
        return false;
      }
    },
    [loadInbox, refreshMuteSettings]
  );

  const renameGroup = useCallback(
    async (groupId: string, name: string) => {
      const result = (await Api.chat.updateGroupName(groupId, name)) as {
        id: string;
        name: string;
        changed?: boolean;
        systemMessage?: Message;
      };
      if (result.changed && result.systemMessage) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === result.systemMessage!.id)) return prev;
          return [...prev, result.systemMessage!];
        });
      }
      const stubT = (k: string) => {
        if (k === 'chat.you') return 'You';
        if (k === 'chat.someone') return 'Someone';
        return undefined;
      };
      const preview =
        result.changed && result.systemMessage
          ? formatGroupRenameSystemText(result.systemMessage, stubT, currentUser?.id)
          : undefined;
      const at = result.systemMessage?.createdAt;
      setInbox((prev) => {
        const patchGroup = (item: ChatInboxItem): ChatInboxItem => {
          if (item.kind !== 'group' || item.groupId !== groupId) return item;
          return {
            ...item,
            name: result.name,
            ...(preview && at
              ? { lastMessage: preview, lastMessageAt: at }
              : {}),
          };
        };
        return {
          ...prev,
          groups: prev.groups.map(patchGroup),
          all: prev.all.map(patchGroup),
        };
      });
      void loadInbox();
      return result;
    },
    [currentUser?.id, loadInbox]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      try {
        await Api.chat.leaveGroup(groupId);
        setInbox((prev) => {
          const drop = (item: ChatInboxItem) =>
            !(item.kind === 'group' && item.groupId === groupId);
          return {
            ...prev,
            groups: prev.groups.filter(drop),
            all: prev.all.filter(drop),
          };
        });
        setMessages([]);
        setGroupDetail(null);
        void loadInbox();
        void refreshMuteSettings();
        return true;
      } catch (e: unknown) {
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as { message: string }).message)
            : 'Could not leave this chat';
        showToast(msg, 'error');
        return false;
      }
    },
    [loadInbox, refreshMuteSettings, showToast]
  );

  return {
    currentUser,
    listItems,
    announcements,
    canPostAnnouncements,
    canSendChat,
    postAnnouncement,
    messages,
    searchTerm,
    setSearchTerm,
    loadingInbox,
    loadingMessages,
    messagesError,
    reloadMessages: () => loadMessages(),
    messagesEndRef,
    fileInputRef,
    fileAccept: FILE_ACCEPT,
    sendText,
    sendFile,
    deleteMessage,
    editMessage,
    forwardMessage,
    setPinned,
    refreshPartnerPresence,
    replyTo,
    setReplyTo,
    reloadInbox: loadInbox,
    loadColleagues,
    groupDetail,
    inbox,
    allUsers,
    isSearchingColleagues,
    groupCreateMatches,
    inboxCounts,
    allUsersCount: allUsers.length,
    renameGroup,
    leaveGroup,
  };
}
