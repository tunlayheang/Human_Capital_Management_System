import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ExternalLink,
  LogOut,
  Megaphone,
  Minus,
  MessageSquare,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  User,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { canSendChatMessages } from '../../utils/chatAccess';
import { useChat } from '../../context/ChatContext';
import { useInboxChat } from '../../hooks/useInboxChat';
import { ChatInboxItem, ChatTarget, Message, Role } from '../../types';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { cn } from '../../utils';
import { buildMessageTimeline, formatListTime } from './chatTimeline';
import { ChatAnnouncementCard } from './ChatAnnouncementCard';
import { ChatAnnouncementSendModal } from './ChatAnnouncementSendModal';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatComposer, type PendingChatAttachment } from './ChatComposer';
import { ChatReplyBar } from './ChatReplyBar';
import { ChatEditBar } from './ChatEditBar';
import { ForwardMessageModal } from './ForwardMessageModal';
import {
  canDeleteMessage,
  canEditMessage,
  formatPresenceLabel,
  isConversationMuted,
  isUserOnline,
  chatAvatarFallbackUrl,
  resolveChatDisplayName,
  resolveDisplayEmployeeId,
} from './chatUtils';
import { useChatSplitPane } from '../../hooks/useCompactLayout';
import { ChatImageLightbox } from './ChatImageLightbox';
import { ChatContactProfileModal } from './ChatContactProfileModal';
import { ChatGroupMembersModal } from './ChatGroupMembersModal';
import { ChatSystemEvent } from './ChatSystemEvent';
import { formatSystemChatText, isSystemChatMessage } from './chatSystemMessage';
import { ChatThreadSearchBar } from './ChatThreadSearchBar';
import { ListSearchBarShell, ListSearchInput } from '../ui/page';
import { LoadingState } from '../common/LoadingState';
import { listToolbarIconPillClass } from '../../constants/designSystem';

export type ChatPanelVariant = 'widget' | 'desktop';

type Props = {
  activeTarget: ChatTarget | null;
  onSelectTarget: (target: ChatTarget | null) => void;
  onMinimize?: () => void;
  onClose?: () => void;
  onOpenFullPage?: () => void;
  enabled: boolean;
  variant?: ChatPanelVariant;
  /** Floating dock: show inbox + thread side-by-side on desktop-sized viewports. */
  dockLayout?: 'auto' | 'split' | 'single';
  /** Scope sub-modals inside the floating dock (not the blurred page overlay). */
  overlayHostRef?: React.RefObject<HTMLElement | null>;
};

function ChatAvatar({ name, url, size = 'w-10 h-10' }: { name: string; url?: string; size?: string }) {
  const fallback = chatAvatarFallbackUrl(name);
  return (
    <img
      src={url || fallback}
      alt={name}
      className={`${size} rounded-full object-cover shrink-0`}
      onError={(e) => {
        const img = e.currentTarget;
        if (img.src !== fallback) img.src = fallback;
      }}
    />
  );
}

export const ChatMessengerPanel: React.FC<Props> = ({
  activeTarget,
  onSelectTarget,
  onMinimize,
  onClose,
  onOpenFullPage,
  enabled,
  variant = 'widget',
  dockLayout = 'auto',
  overlayHostRef,
}) => {
  /** &lt; lg for full-page chat; &lt; md for floating widget */
  const singlePaneFromHook = useChatSplitPane(variant);
  const singlePane =
    variant === 'widget'
      ? true
      : dockLayout === 'split'
        ? false
        : dockLayout === 'single'
          ? true
          : singlePaneFromHook;
  const isWidget = variant === 'widget';
  const widgetListView = isWidget && !activeTarget;
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const { user, hasPermission } = useAuth();
  const isAdmin =
    user?.role === Role.ADMIN || user?.role === Role.HR || user?.role === Role.MANAGER;
  const { muteSettings, setMuteAll, setConversationMute } = useChat();
  const canSendChatLocal = canSendChatMessages(hasPermission, user?.role);

  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [groupPickIds, setGroupPickIds] = useState<Set<string>>(new Set());
  const [groupCreateActive, setGroupCreateActive] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementExpiryOpen, setAnnouncementExpiryOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingChatAttachment | null>(null);

  const clearPendingAttachment = useCallback(() => {
    setPendingAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const isGroupCreateMode = canSendChatLocal && groupCreateActive;

  const {
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
    reloadMessages,
    messagesEndRef,
    fileInputRef,
    fileAccept,
    sendText,
    sendFile,
    deleteMessage,
    editMessage,
    forwardMessage,
    replyTo,
    setReplyTo,
    reloadInbox,
    groupDetail,
    inbox,
    allUsers,
    inboxCounts,
    allUsersCount,
    isSearchingColleagues,
    loadColleagues,
    setPinned,
    refreshPartnerPresence,
    groupCreateMatches,
    renameGroup,
    leaveGroup,
  } = useInboxChat(activeTarget, enabled, isGroupCreateMode);

  useEffect(() => {
    clearPendingAttachment();
    setEditingMessage(null);
    setNewMessage('');
  }, [activeTarget, clearPendingAttachment]);

  useEffect(() => {
    return () => {
      if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
    };
  }, [pendingAttachment?.previewUrl]);

  const handleRenameGroup = async (newName: string) => {
    if (activeTarget?.kind !== 'group') return;
    const result = await renameGroup(activeTarget.groupId, newName);
    if (result?.name) {
      onSelectTarget({
        kind: 'group',
        groupId: activeTarget.groupId,
        name: result.name,
        memberCount: activeTarget.memberCount,
      });
    }
  };

  const handleLeaveGroup = async () => {
    if (activeTarget?.kind !== 'group') return;
    const ok = await confirm({
      title: t('chat.leaveChatTitle') || 'Leave chat?',
      description:
        t('chat.leaveChatConfirm') ||
        'You will no longer receive messages from this group. You can be invited back later.',
      variant: 'danger',
      confirmLabel: t('chat.leaveChat') || 'Leave chat',
    });
    if (!ok) return;
    setHeaderMenuOpen(false);
    const left = await leaveGroup(activeTarget.groupId);
    if (left) {
      onSelectTarget(null);
      showToast(t('chat.leftChat') || 'You left the chat', 'success');
    }
  };

  const groupPickUsers = useMemo(
    () => groupCreateMatches.filter((u) => groupPickIds.has(u.id)),
    [groupCreateMatches, groupPickIds]
  );

  useEffect(() => {
    if (!isGroupCreateMode) setGroupPickIds(new Set());
  }, [isGroupCreateMode]);

  const startGroupCreate = () => {
    setGroupCreateActive(true);
    setGroupPickIds(new Set());
    setSearchTerm('');
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const exitGroupCreate = () => {
    setGroupCreateActive(false);
    setGroupPickIds(new Set());
    setSearchTerm('');
  };

  const toggleGroupPick = (userId: string) => {
    setGroupPickIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const defaultGroupName = (members: { name: string }[]) => {
    const short = members.map((m) => m.name.trim().split(/\s+/)[0] || m.name).filter(Boolean);
    if (short.length === 0) return t('chat.newGroupDefault') || 'New group';
    if (short.length === 1) return short[0];
    if (short.length === 2) return `${short[0]} & ${short[1]}`;
    return `${short[0]}, ${short[1]} +${short.length - 2}`;
  };

  const handleCreateGroupFromSearch = async () => {
    if (groupPickIds.size === 0 || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const name = defaultGroupName(groupPickUsers);
      await Api.chat.createGroup(name, [...groupPickIds]);
      showToast(t('chat.groupCreated') || 'Group chat created', 'success');
      setGroupPickIds(new Set());
      setSearchTerm('');
      setGroupCreateActive(false);
      await reloadInbox();
    } catch (err) {
      console.error(err);
      showToast(t('chat.createGroupFailed') || 'Could not create group. Please try again.', 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  const conversationMuted = isConversationMuted(muteSettings, activeTarget);

  useEffect(() => {
    if (forwardMsg) void loadColleagues();
  }, [forwardMsg, loadColleagues]);

  useEffect(() => {
    if (enabled && isAdmin) void loadColleagues();
  }, [enabled, isAdmin, loadColleagues]);

  useEffect(() => {
    if (enabled && isGroupCreateMode) void loadColleagues();
  }, [enabled, isGroupCreateMode, loadColleagues]);

  const showSidebar = !singlePane || !activeTarget;
  const showThread = !singlePane || Boolean(activeTarget);

  const isPinned = useMemo(() => {
    if (!activeTarget || activeTarget.kind === 'announcements') return false;
    if (activeTarget.kind === 'direct') {
      return listItems.some(
        (i) => i.kind === 'direct' && i.partnerId === activeTarget.user.id && i.pinned
      );
    }
    return listItems.some(
      (i) => i.kind === 'group' && i.groupId === activeTarget.groupId && i.pinned
    );
  }, [activeTarget, listItems]);

  const directPartnerId =
    activeTarget?.kind === 'direct' ? activeTarget.user.id : undefined;

  const directPartner = useMemo(() => {
    if (activeTarget?.kind !== 'direct') return null;
    const partnerId = activeTarget.user.id;
    const fromList = listItems.find(
      (i) => i.kind === 'direct' && i.partnerId === partnerId
    );
    const base =
      fromList?.kind === 'direct'
        ? { ...fromList.partner, id: fromList.partnerId || fromList.partner.id }
        : { ...activeTarget.user, id: partnerId || activeTarget.user.id };
    return {
      ...base,
      name: resolveChatDisplayName(base),
    };
  }, [activeTarget, listItems]);

  useEffect(() => {
    if (!directPartnerId) return;
    void refreshPartnerPresence(directPartnerId);
    const id = setInterval(() => void refreshPartnerPresence(directPartnerId), 30_000);
    return () => clearInterval(id);
  }, [directPartnerId, refreshPartnerPresence]);

  useEffect(() => {
    setShowGroupMembers(false);
  }, [activeTarget?.kind === 'group' ? activeTarget.groupId : null]);

  const displayMessages = useMemo(() => {
    const q = threadSearchQuery.trim().toLowerCase();
    if (!threadSearchOpen || !q) return messages;
    return messages.filter((m) => {
      if (m.isDeleted || m.deletedAt) return false;
      if (isSystemChatMessage(m)) {
        return formatSystemChatText(m, t, currentUser?.id).toLowerCase().includes(q);
      }
      return (m.content || '').toLowerCase().includes(q);
    });
  }, [messages, threadSearchOpen, threadSearchQuery, t, currentUser?.id]);

  const timeline = useMemo(() => {
    if (!currentUser) return [];
    return buildMessageTimeline(displayMessages, currentUser.id, (senderId) =>
      groupDetail?.members.find((m) => m.id === senderId)?.name
    );
  }, [displayMessages, currentUser, groupDetail?.members]);

  const handleSend = async () => {
    if (sending) return;

    if (editingMessage) {
      const text = newMessage.trim();
      if (!text) return;
      setSending(true);
      const ok = await editMessage(editingMessage.id, text);
      if (ok) {
        setEditingMessage(null);
        setNewMessage('');
      }
      setSending(false);
      return;
    }

    const hasText = Boolean(newMessage.trim());
    const hasAttachment = Boolean(pendingAttachment);
    if (!hasText && !hasAttachment) return;

    if (activeTarget?.kind === 'announcements') {
      setAnnouncementExpiryOpen(true);
      return;
    }

    setSending(true);
    let ok = false;
    if (hasAttachment && pendingAttachment) {
      const sent = await sendFile(pendingAttachment.file, newMessage);
      ok = sent;
      if (ok) {
        clearPendingAttachment();
        setNewMessage('');
      } else {
        showToast(t('chat.uploadFailed') || 'Could not upload file. Use a photo or PDF under 8MB.', 'error');
      }
    } else {
      const result = await sendText(newMessage);
      ok = result.ok;
      if (ok) {
        setNewMessage('');
      } else if (result.error) {
        showToast(result.error, 'error');
      }
    }
    setSending(false);
  };

  const handleConfirmAnnouncement = async (dashboardExpiresAt: string) => {
    if (sending) return;
    setSending(true);
    const ok = await postAnnouncement(newMessage, announcementTitle, dashboardExpiresAt);
    if (ok) {
      setNewMessage('');
      setAnnouncementTitle('');
      setAnnouncementExpiryOpen(false);
    }
    setSending(false);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isPdf = file.type === 'application/pdf';
    const isImage = file.type.startsWith('image/');
    if (!isPdf && !isImage) {
      showToast(t('chat.attachmentsOnly') || 'Only photos and PDF files are allowed.', 'warning');
      return;
    }

    setPendingAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      };
    });
  };

  const selectItem = (item: ChatInboxItem) => {
    if (item.kind === 'announcements') {
      onSelectTarget({ kind: 'announcements' });
      return;
    }
    if (item.kind === 'direct') {
      const partner = {
        ...item.partner,
        id: item.partnerId || item.partner.id,
        name: resolveChatDisplayName(item.partner),
      };
      onSelectTarget({ kind: 'direct', user: partner });
    } else {
      onSelectTarget({
        kind: 'group',
        groupId: item.groupId,
        name: item.name,
        memberCount: item.memberCount,
      });
    }
  };

  const replySenderLabel = (msg: Message) => {
    if (!currentUser) return 'User';
    if (msg.senderId === currentUser.id) return t('chat.you') || 'You';
    return (
      groupDetail?.members.find((m) => m.id === msg.senderId)?.name ||
      (activeTarget?.kind === 'direct' ? activeTarget.user.name : 'User')
    );
  };

  const sidebar = (
    <aside
      className={`tg-chat-sidebar flex flex-col min-h-0 min-w-0 shrink-0 overflow-hidden border-r border-slate-200/80 dark:border-slate-800 ${
        showSidebar ? 'flex' : 'hidden'
      } ${
        isWidget
          ? 'flex-1 w-full max-w-full min-h-0 border-r-0'
          : singlePane
            ? 'flex-1 w-full max-w-full min-h-0'
            : 'w-full min-w-0 sm:w-64 md:w-72 lg:w-[min(22rem,28vw)] xl:w-80'
      }`}
    >
      <div
        className={`shrink-0 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 ${
          isWidget ? 'px-3 py-2.5 bg-slate-50/90 dark:bg-slate-900/90' : 'px-2 sm:px-3 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur'
        }`}
      >
        {onClose && !isWidget && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        )}
        <ListSearchBarShell className="flex-1 min-w-0">
          <ListSearchInput
            ref={searchInputRef}
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder={
              isGroupCreateMode
                ? t('chat.searchGroupMembersHint') || 'Search names to add to a new group…'
                : isWidget
                  ? t('chat.searchWidgetHint') || 'Search name or group…'
                  : t('chat.searchUnifiedHint') ||
                    'Search people, groups, email, or display ID…'
            }
            className="flex-1 min-w-0"
          />
          {canSendChat && !isGroupCreateMode ? (
            <button
              type="button"
              onClick={startGroupCreate}
              className={listToolbarIconPillClass}
              aria-label={t('chat.createGroup') || 'Create group'}
              title={t('chat.createGroup') || 'Create group'}
            >
              <UserPlus className="w-[1.05rem] h-[1.05rem]" />
            </button>
          ) : null}
          {isGroupCreateMode ? (
            <button
              type="button"
              onClick={exitGroupCreate}
              className={listToolbarIconPillClass}
              aria-label={t('chat.cancelCreateGroup') || 'Cancel'}
            >
              <X className="w-[1.05rem] h-[1.05rem]" />
            </button>
          ) : null}
        </ListSearchBarShell>
        {onMinimize && !singlePane && (
          <button
            type="button"
            onClick={onMinimize}
            className="p-2 min-w-[44px] min-h-[44px] hidden md:flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Minus className="w-5 h-5 text-slate-500" />
          </button>
        )}
      </div>

      {!isGroupCreateMode && (
        <div className={`shrink-0 min-w-0 ${isWidget ? 'px-3 py-2' : 'px-3 py-1.5'}`}>
          <p
            className={`font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide ${
              isWidget ? 'text-[10px]' : 'text-xs'
            }`}
          >
            {(t('chat.inboxTitle') || 'Messages').replace(
              '{n}',
              String(isSearchingColleagues ? listItems.length : inboxCounts.total)
            )}
          </p>
        </div>
      )}

      {isGroupCreateMode && (
        <p className="shrink-0 px-3 pb-1 text-[11px] text-slate-500 dark:text-slate-400">
          {t('chat.selectMembersHint') || 'Tap names to select, then create the group.'}
        </p>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 min-w-0 custom-scrollbar overscroll-contain">
        {isGroupCreateMode ? (
          !isSearchingColleagues ? (
            <div className="p-6 text-center max-w-xs mx-auto space-y-3">
              <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
                <UserPlus className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('chat.createGroupStartTitle') || 'Create a new group'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {t('chat.createGroupStartHint') ||
                  'Use the search bar above to find colleagues by name, then tap to add them.'}
              </p>
            </div>
          ) : loadingInbox && groupCreateMatches.length === 0 ? (
            <LoadingState variant="panel" layout="list" label={t('chat.loading') || 'Loading…'} />
          ) : groupCreateMatches.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400 max-w-xs mx-auto">
              <p>{t('chat.noSearchResults') || 'No matches for your search.'}</p>
            </div>
          ) : (
            groupCreateMatches.map((u) => {
              const picked = groupPickIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleGroupPick(u.id)}
                  className={`w-full text-left px-2 sm:px-3 py-2 flex gap-2.5 items-center min-w-0 transition-colors duration-150 rounded-lg mx-1 my-0.5 ${
                    picked
                      ? 'bg-primary/10 ring-1 ring-primary/30'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]'
                  }`}
                >
                  <ChatAvatar name={u.name} url={resolveMediaUrl(u.avatarUrl)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {u.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{u.position || u.email}</p>
                  </div>
                  <span
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      picked
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                    aria-hidden
                  >
                    {picked ? <Check className="w-3.5 h-3.5" /> : null}
                  </span>
                </button>
              );
            })
          )
        ) : loadingInbox && listItems.length === 0 ? (
          <LoadingState variant="panel" layout="list" label={t('chat.loading') || 'Loading…'} />
        ) : listItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400 space-y-1.5 max-w-xs mx-auto">
            <p>
              {isSearchingColleagues
                ? loadingInbox
                  ? t('chat.loading') || 'Loading…'
                  : t('chat.noSearchResults') || 'No matches for your search.'
                : t('chat.inboxEmptyHint') ||
                  'Recent chats appear here. Search by name, email, or display ID to message someone new.'}
            </p>
          </div>
        ) : (
          listItems.map((item) => {
            const active =
              activeTarget?.kind === 'announcements' && item.kind === 'announcements'
                ? true
                : activeTarget?.kind === 'direct' && item.kind === 'direct'
                  ? activeTarget.user.id === item.partnerId
                  : activeTarget?.kind === 'group' && item.kind === 'group'
                    ? activeTarget.groupId === item.groupId
                    : false;
            const title =
              item.kind === 'announcements'
                ? t('chat.announcements.inboxTitle') || 'Announcements'
                : item.kind === 'direct'
                  ? resolveChatDisplayName(item.partner)
                  : item.name;
            const partnerDisplayId =
              item.kind === 'direct' ? resolveDisplayEmployeeId(item.partner) : '';
            const preview =
              item.lastMessage ||
              (item.kind === 'announcements'
                ? t('chat.announcements.inboxSubtitle') || 'Company-wide updates'
                : item.kind === 'direct'
                  ? isSearchingColleagues && !item.lastMessage
                    ? [
                        item.partner.position,
                        partnerDisplayId &&
                          `${t('chat.displayId') || 'Display ID'}: ${partnerDisplayId}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || item.partner.email
                    : item.partner.position
                  : `${item.memberCount} members`);
            const avatarUrl = item.kind === 'direct' ? resolveMediaUrl(item.partner.avatarUrl) : undefined;
            const itemMuted =
              item.kind === 'announcements'
                ? false
                : muteSettings?.muteAll ||
                  (item.kind === 'direct'
                    ? muteSettings?.mutedDirect.includes(item.partnerId)
                    : muteSettings?.mutedGroups.includes(item.groupId));

            return (
              <button
                key={
                  item.kind === 'announcements'
                    ? 'announcements'
                    : item.kind === 'direct'
                      ? item.partnerId
                      : item.groupId
                }
                type="button"
                onClick={() => selectItem(item)}
                className={`w-full min-w-0 text-left flex gap-3 transition-all duration-150 ease-out rounded-xl ${
                  isWidget ? 'px-3 py-3 min-h-[64px] mx-0 my-0 border-b border-slate-100/80 dark:border-slate-800/60 last:border-b-0' : 'px-2 sm:px-3 py-2 min-h-[56px] rounded-lg mx-1 my-0.5'
                } ${
                  active
                    ? 'tg-chat-list-active'
                    : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05] active:scale-[0.99]'
                }`}
              >
                {item.kind === 'announcements' ? (
                  <div
                    className={`rounded-full bg-amber-500 flex items-center justify-center text-white shrink-0 ${
                      isWidget ? 'w-11 h-11' : 'w-10 h-10'
                    }`}
                  >
                    <Megaphone className="w-5 h-5" />
                  </div>
                ) : item.kind === 'group' ? (
                  <div
                    className={`rounded-full bg-violet-500 flex items-center justify-center text-white shrink-0 ${
                      isWidget ? 'w-11 h-11' : 'w-10 h-10'
                    }`}
                  >
                    <Users className="w-5 h-5" />
                  </div>
                ) : (
                  <ChatAvatar
                    name={title}
                    url={avatarUrl}
                    size={isWidget ? 'w-11 h-11' : 'w-10 h-10'}
                  />
                )}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex justify-between gap-2 items-baseline">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1">
                      {'pinned' in item && item.pinned && (
                        <Pin className="w-3 h-3 text-primary shrink-0 fill-primary" aria-hidden />
                      )}
                      {title}
                      {itemMuted && <BellOff className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />}
                    </p>
                    <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                      {formatListTime(item.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 items-center mt-0.5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{preview}</p>
                    {item.unreadCount > 0 && (
                      <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {isGroupCreateMode && groupPickIds.size > 0 && (
        <div className="shrink-0 p-2 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
          <button
            type="button"
            disabled={creatingGroup}
            onClick={() => void handleCreateGroupFromSearch()}
            className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
          >
            <UserPlus className="w-4 h-4 shrink-0" />
            {creatingGroup
              ? t('chat.creatingGroup') || 'Creating…'
              : (t('chat.createGroupWithCount') || 'Create group ({n})').replace(
                  '{n}',
                  String(groupPickIds.size)
                )}
          </button>
        </div>
      )}
    </aside>
  );

  const emptyThread = (
    <div
      className={`flex-1 flex-col min-w-0 items-center justify-center tg-chat-wallpaper text-center px-6 ${
        !singlePane && !activeTarget ? 'flex' : 'hidden'
      }`}
    >
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
        <Search className="w-6 h-6 text-primary/60" />
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t('chat.selectConversation') || 'Select a chat'}
      </p>
      <p className="text-sm text-slate-500 mt-2 max-w-sm">
        {allUsersCount > 0
          ? 'Choose a colleague or group from the list to start messaging.'
          : t('chat.noColleagues') || 'No colleagues available.'}
      </p>
    </div>
  );

  const thread = activeTarget ? (
    <section
      className={`flex flex-col min-w-0 min-h-0 bg-white dark:bg-slate-900 ${
        showThread ? 'flex flex-1 w-full' : 'hidden'
      }`}
    >
      <header className="tg-chat-thread-header relative shrink-0 px-2 sm:px-3 py-2 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 z-10">
        <button
          type="button"
          onClick={() => onSelectTarget(null)}
          className={`p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-primary ${
            singlePane ? 'flex' : 'hidden'
          }`}
          aria-label={t('chat.backToList') || 'Back to conversations'}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        {activeTarget.kind === 'direct' && directPartner ? (
          <>
            <button
              type="button"
              onClick={() => setProfileUserId(directPartner.id)}
              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('chat.viewProfile') || 'View profile'}
            >
              <ChatAvatar
                name={directPartner.name}
                url={resolveMediaUrl(directPartner.avatarUrl)}
                size="w-10 h-10"
              />
            </button>
            <button
              type="button"
              onClick={() => setProfileUserId(directPartner.id)}
              className="flex-1 min-w-0 text-left"
            >
              <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                {directPartner.name}
              </p>
              <p
                className={`text-xs truncate flex items-center gap-1 ${
                  conversationMuted
                    ? 'text-slate-500'
                    : isUserOnline(directPartner)
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500'
                }`}
              >
                {!conversationMuted && isUserOnline(directPartner) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                )}
                {conversationMuted
                  ? t('chat.muted') || 'Muted'
                  : formatPresenceLabel(directPartner, t)}
              </p>
            </button>
          </>
        ) : activeTarget.kind === 'group' ? (
          <>
            <button
              type="button"
              onClick={() => setShowGroupMembers(true)}
              className="shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t('chat.viewMembers') || 'View members'}
            >
              <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center text-white">
                <Users className="w-5 h-5" />
              </div>
            </button>
            <button
              type="button"
              onClick={() => setShowGroupMembers(true)}
              className="flex-1 min-w-0 text-left"
            >
              <p className="font-semibold text-sm truncate text-slate-900 dark:text-white">
                {activeTarget.name}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {conversationMuted
                  ? t('chat.muted') || 'Muted'
                  : `${activeTarget.memberCount} ${t('chat.members') || 'members'}`}
              </p>
            </button>
          </>
        ) : activeTarget.kind === 'announcements' ? (
          <>
            <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-white shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate text-slate-900 dark:text-white">
                {t('chat.announcements.inboxTitle') || 'Announcements'}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {t('chat.announcements.threadSubtitle') || 'Company-wide updates for all staff'}
              </p>
            </div>
          </>
        ) : null}
        <div className="flex items-center shrink-0 gap-0.5 ml-auto">
          {activeTarget.kind !== 'announcements' && !isWidget && (
            <button
              type="button"
              onClick={() => {
                setThreadSearchOpen((v) => !v);
                if (threadSearchOpen) setThreadSearchQuery('');
              }}
              className={cn(
                listToolbarIconPillClass,
                threadSearchOpen && 'bg-slate-50 dark:bg-slate-700/90'
              )}
              aria-label={t('chat.searchInChat') || 'Search in chat'}
            >
              <Search className="w-[1.05rem] h-[1.05rem]" />
            </button>
          )}
          {isWidget && onOpenFullPage && (
            <button
              type="button"
              onClick={onOpenFullPage}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              title={t('chat.openFullPage') || 'Full screen'}
              aria-label={t('chat.openFullPage') || 'Open full screen chat'}
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          {isWidget && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              aria-label={t('chat.closeWidget') || 'Close chat'}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        {activeTarget.kind !== 'announcements' && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setHeaderMenuOpen((v) => !v)}
            className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Chat options"
          >
            <MoreVertical className="w-5 h-5 text-slate-500" />
          </button>
          {headerMenuOpen && (
            <>
              <button
                type="button"
                className="absolute inset-0 z-20"
                aria-label="Close menu"
                onClick={() => setHeaderMenuOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-30 min-w-[220px] py-1 rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
                {activeTarget.kind === 'direct' && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileUserId(activeTarget.user.id);
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left min-h-[44px]"
                  >
                    <User className="w-4 h-4 text-primary" />
                    {t('chat.viewProfile') || 'View profile'}
                  </button>
                )}
                {activeTarget.kind === 'group' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowGroupMembers(true);
                      setHeaderMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left min-h-[44px]"
                  >
                    <Users className="w-4 h-4 text-primary" />
                    {t('chat.viewMembers') || 'View members'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void setPinned(activeTarget, !isPinned);
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left min-h-[44px]"
                >
                  {isPinned ? (
                    <>
                      <PinOff className="w-4 h-4 text-slate-500" />
                      {t('chat.unpinChat') || 'Unpin chat'}
                    </>
                  ) : (
                    <>
                      <Pin className="w-4 h-4 text-primary" />
                      {t('chat.pinChat') || 'Pin chat'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setConversationMute(activeTarget, !conversationMuted);
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left min-h-[44px]"
                >
                  {conversationMuted ? (
                    <>
                      <Bell className="w-4 h-4 text-primary" />
                      {t('chat.unmuteChat') || 'Unmute notifications'}
                    </>
                  ) : (
                    <>
                      <BellOff className="w-4 h-4 text-slate-500" />
                      {t('chat.muteChat') || 'Mute notifications'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void setMuteAll(!muteSettings?.muteAll);
                    setHeaderMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-left min-h-[44px]"
                >
                  {muteSettings?.muteAll ? (
                    <>
                      <Volume2 className="w-4 h-4 text-primary" />
                      {t('chat.unmuteAll') || 'Unmute all chats'}
                    </>
                  ) : (
                    <>
                      <VolumeX className="w-4 h-4 text-slate-500" />
                      {t('chat.muteAll') || 'Mute all chats'}
                    </>
                  )}
                </button>
                {activeTarget.kind === 'group' && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleLeaveGroup();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-3 text-sm hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-left min-h-[44px]"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('chat.leaveChat') || 'Leave chat'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        )}
        </div>
      </header>

      {activeTarget.kind !== 'announcements' && (
      <ChatThreadSearchBar
        open={threadSearchOpen}
        query={threadSearchQuery}
        onQueryChange={setThreadSearchQuery}
        onClose={() => {
          setThreadSearchOpen(false);
          setThreadSearchQuery('');
        }}
        messages={messages}
        onPickImage={setLightboxUrl}
        placeholder={t('chat.searchInChat') || 'Search in conversation…'}
      />
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 min-w-0 tg-chat-wallpaper custom-scrollbar overscroll-contain px-2 sm:px-4 py-3">
        {activeTarget.kind === 'announcements' ? (
          loadingMessages && announcements.length === 0 && !messagesError ? (
            <LoadingState variant="panel" layout="chat" label={t('chat.loading') || 'Loading…'} />
          ) : announcements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center max-w-sm mx-auto gap-2">
              <Megaphone className="w-10 h-10 text-amber-500/80" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {t('chat.announcements.empty') || 'No announcements yet'}
              </p>
              <p className="text-xs text-slate-500">
                {canPostAnnouncements
                  ? t('chat.announcements.emptyManagement') ||
                    'Post an update below for everyone in the company.'
                  : t('chat.announcements.emptyEmployee') ||
                    'Management posts company updates here.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl mx-auto w-full pb-2">
              {announcements.map((ann) => (
                <ChatAnnouncementCard
                  key={ann.id}
                  item={ann}
                  isMe={ann.senderId === currentUser?.id}
                  t={t}
                />
              ))}
            </div>
          )
        ) : loadingMessages && messages.length === 0 && !messagesError ? (
          <LoadingState variant="panel" layout="chat" label={t('chat.loading') || 'Loading messages…'} />
        ) : messagesError && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
            <p className="text-sm text-red-500 dark:text-red-400">{messagesError}</p>
            <button
              type="button"
              onClick={() => void reloadMessages()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t('chat.retry') || 'Try again'}
            </button>
          </div>
        ) : threadSearchOpen && threadSearchQuery.trim() && displayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-sm text-slate-500">{t('chat.noSearchResults') || 'No matches'}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {t('chat.noMessages') || 'No messages yet'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t('chat.startConversation') || 'Send a message to start the conversation.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto w-full pb-2">
            {timeline.map((item) => {
              if (item.type === 'date') {
                return (
                  <div key={item.key} className="flex justify-center py-3">
                    <span className="tg-chat-date-pill">{item.label}</span>
                  </div>
                );
              }
              if (item.type === 'system') {
                return (
                  <ChatSystemEvent
                    key={item.key}
                    msg={item.message}
                    currentUserId={currentUser?.id}
                    t={t}
                  />
                );
              }
              return (
                <div
                  key={item.key}
                  className={`flex flex-col gap-1 ${item.isMe ? 'items-end' : 'items-start'}`}
                >
                  {item.messages.map((msg, idx) => (
                    <ChatMessageBubble
                      key={msg.id}
                      msg={msg}
                      isMe={item.isMe}
                      senderName={
                        !item.isMe && item.senderName && idx === 0 ? item.senderName : undefined
                      }
                      isLastInCluster={idx === item.messages.length - 1}
                      showTail={idx === item.messages.length - 1}
                      canDelete={Boolean(currentUser && canDeleteMessage(msg, currentUser.id))}
                      canEdit={Boolean(currentUser && canEditMessage(msg, currentUser.id))}
                      onReply={() => setReplyTo(msg)}
                      onForward={() => setForwardMsg(msg)}
                      onEdit={() => {
                        setReplyTo(null);
                        clearPendingAttachment();
                        setEditingMessage(msg);
                        setNewMessage(msg.content || '');
                      }}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: t('chat.confirmDeleteTitle') || 'Delete message?',
                          description: t('chat.confirmDelete') || 'Delete this message?',
                          variant: 'danger',
                          confirmLabel: 'Delete',
                        });
                        if (ok) void deleteMessage(msg.id);
                      }}
                      onImageClick={setLightboxUrl}
                      highlightQuery={threadSearchOpen ? threadSearchQuery : undefined}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {((activeTarget.kind === 'announcements' && canPostAnnouncements) ||
        (activeTarget.kind !== 'announcements' && canSendChatLocal)) && (
      <footer className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-[#f4f4f5] dark:bg-slate-900/95 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {replyTo && activeTarget.kind !== 'announcements' && !editingMessage && (
          <ChatReplyBar
            message={replyTo}
            senderLabel={replySenderLabel(replyTo)}
            onCancel={() => setReplyTo(null)}
          />
        )}
        {editingMessage && activeTarget.kind !== 'announcements' && (
          <ChatEditBar
            preview={editingMessage.content || '…'}
            onCancel={() => {
              setEditingMessage(null);
              setNewMessage('');
            }}
          />
        )}
        {activeTarget.kind === 'announcements' && canPostAnnouncements && (
          <div className="px-3 pt-2">
            <input
              type="text"
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
              placeholder={t('chat.announcements.titlePlaceholder') || 'Title (optional)'}
              className="w-full px-3 py-2 text-base rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
        <input ref={fileInputRef} type="file" accept={fileAccept} className="hidden" onChange={onFileChange} />
        <ChatComposer
          value={newMessage}
          onChange={setNewMessage}
          onSend={handleSend}
          onAttach={() => fileInputRef.current?.click()}
          pendingAttachment={pendingAttachment}
          onRemoveAttachment={clearPendingAttachment}
          showAttach={activeTarget.kind !== 'announcements' && !editingMessage}
          sending={sending}
          compact={isWidget}
          placeholder={
            activeTarget.kind === 'announcements'
              ? t('chat.announcements.composePlaceholder') || 'Write a company announcement…'
              : isWidget
                ? t('chat.typeMessageShort') || 'Message…'
                : t('chat.typeMessage') || 'Write a message...'
          }
        />
      </footer>
      )}

      {activeTarget.kind === 'announcements' && canPostAnnouncements && (
        <ChatAnnouncementSendModal
          open={announcementExpiryOpen}
          title={announcementTitle}
          content={newMessage}
          sending={sending}
          onClose={() => {
            if (!sending) setAnnouncementExpiryOpen(false);
          }}
          onConfirm={(expiry) => void handleConfirmAnnouncement(expiry)}
          t={t}
        />
      )}
    </section>
  ) : (
    emptyThread
  );

  const widgetListChrome = widgetListView ? (
    <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3.5 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
            <MessageSquare className="w-4 h-4" aria-hidden />
          </span>
          <h2 className="text-base font-bold truncate">{t('chat.widgetTitle') || 'Messages'}</h2>
        </div>
        <p className="text-xs text-white/85 mt-1 pl-10 truncate">
          {t('chat.widgetPickChat') || 'Tap a person or group to chat'}
        </p>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {onOpenFullPage && (
          <button
            type="button"
            onClick={onOpenFullPage}
            className="p-2 rounded-lg hover:bg-white/15 transition-colors"
            title={t('chat.openFullPage') || 'Full screen'}
            aria-label={t('chat.openFullPage') || 'Open full screen chat'}
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/15 transition-colors"
            aria-label={t('chat.closeWidget') || 'Close chat'}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <ConfirmDialogHost />
      <div className="tg-chat-messenger-root flex flex-col flex-1 h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden bg-white dark:bg-[#17212b]">
        {widgetListChrome}
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {sidebar}
          {thread}
        </div>
      </div>
      {forwardMsg && (
        <ForwardMessageModal
          message={forwardMsg}
          colleagues={allUsers}
          groups={inbox.groups}
          onClose={() => setForwardMsg(null)}
          onForward={(target) => forwardMessage(forwardMsg.id, target)}
          overlayHostRef={overlayHostRef}
        />
      )}
      {lightboxUrl && (
        <ChatImageLightbox
          url={lightboxUrl}
          onClose={() => setLightboxUrl(null)}
          overlayHostRef={overlayHostRef}
        />
      )}
      {profileUserId && (
        <ChatContactProfileModal
          userId={profileUserId}
          fallback={
            activeTarget?.kind === 'direct' && activeTarget.user.id === profileUserId
              ? directPartner ?? activeTarget.user
              : groupDetail?.members.find((m) => m.id === profileUserId)
          }
          onClose={() => setProfileUserId(null)}
          overlayHostRef={overlayHostRef}
        />
      )}
      {showGroupMembers && activeTarget?.kind === 'group' && (
        <ChatGroupMembersModal
          groupId={activeTarget.groupId}
          groupName={activeTarget.name}
          memberCount={activeTarget.memberCount}
          initialMembers={groupDetail?.members}
          onRenamed={handleRenameGroup}
          onClose={() => setShowGroupMembers(false)}
          onViewMember={(userId) => {
            setShowGroupMembers(false);
            setProfileUserId(userId);
          }}
          overlayHostRef={overlayHostRef}
        />
      )}
    </>
  );
};
