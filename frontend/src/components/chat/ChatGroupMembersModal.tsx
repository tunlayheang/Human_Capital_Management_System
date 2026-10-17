import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Users, X } from 'lucide-react';
import { User } from '../../types';
import { Api } from '../../services/api';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { chatAvatarFallbackUrl, formatPresenceLabel, isUserOnline } from './chatUtils';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { AppOverlay } from '../ui/AppOverlay';
import { overlayPanelClass } from '../../utils/overlayPanel';
import { userDisplayName } from '../../utils/userProfile';
import { formatAccessRoleLabel } from '../../utils/accessRole';
import { ContentSkeleton } from '../common/ContentSkeleton';

type Props = {
  groupId: string;
  groupName: string;
  memberCount?: number;
  initialMembers?: User[];
  onClose: () => void;
  onViewMember?: (userId: string) => void;
  onRenamed?: (newName: string) => void | Promise<void>;
  overlayHostRef?: React.RefObject<HTMLElement | null>;
};

function MemberAvatar({ name, url }: { name: string; url?: string }) {
  return (
    <img
      src={
        url || chatAvatarFallbackUrl(name)
      }
      alt=""
      className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-white dark:ring-slate-900"
    />
  );
}

function roleBadgeClass(role?: string): string {
  const r = String(role || '').toUpperCase();
  if (r === 'ADMIN') return 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300';
  if (r === 'HR') return 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300';
  if (r === 'MANAGER') return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  if (r === 'EMPLOYEE' || r === 'STAFF') {
    return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
}

export const ChatGroupMembersModal: React.FC<Props> = ({
  groupId,
  groupName,
  memberCount,
  initialMembers,
  onClose,
  onViewMember,
  onRenamed,
  overlayHostRef,
}) => {
  const { t, language } = useLanguage();
  const { user: currentUser } = useAuth();
  const [members, setMembers] = useState<User[]>(initialMembers ?? []);
  const [loading, setLoading] = useState(!initialMembers?.length);
  const [displayName, setDisplayName] = useState(groupName);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(groupName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(groupName);
    if (!editingName) setDraftName(groupName);
  }, [groupName, editingName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Api.chat
      .getGroupDetail(groupId)
      .then((detail) => {
        if (cancelled) return;
        const list = (detail?.members as User[]) ?? [];
        setMembers(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled && initialMembers?.length) setMembers(initialMembers);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, initialMembers]);

  const sorted = useMemo(() => {
    const me = currentUser?.id;
    return [...members].sort((a, b) => {
      if (a.id === me) return -1;
      if (b.id === me) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [members, currentUser?.id]);

  const count = memberCount ?? members.length;
  const canRename = Boolean(onRenamed);

  const startEdit = () => {
    setDraftName(displayName);
    setNameError(null);
    setEditingName(true);
  };

  const cancelEdit = () => {
    setDraftName(displayName);
    setNameError(null);
    setEditingName(false);
  };

  const saveName = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setNameError(t('chat.groupNameRequired') || 'Group name is required');
      return;
    }
    if (trimmed === displayName.trim()) {
      setEditingName(false);
      return;
    }
    if (!onRenamed) return;
    setSavingName(true);
    setNameError(null);
    try {
      await onRenamed(trimmed);
      setDisplayName(trimmed);
      setEditingName(false);
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: string }).message)
          : t('chat.renameGroupFailed') || 'Could not rename group';
      setNameError(msg);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <AppOverlay
      open
      onClose={onClose}
      zIndexClass={overlayHostRef ? 'z-[60]' : 'z-[280]'}
      hostRef={overlayHostRef}
      lockScroll={!overlayHostRef}
    >
      <div
        className={overlayPanelClass(
          'lg',
          `rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200/60 dark:border-slate-700/80 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 ${
            overlayHostRef ? 'max-h-full' : 'max-h-[min(88vh,36rem)]'
          }`
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-group-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sheet handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-0 shrink-0" aria-hidden>
          <span className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Top bar — only close */}
        <div className="hcms-modal-header !px-4 !pt-2 sm:!pt-3 !pb-1 shrink-0 border-b-0 bg-transparent">
          <p
            id="chat-group-modal-title"
            className="text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            {t('chat.groupInfo') || 'Group info'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Group identity card */}
        <div className="px-4 pb-4 shrink-0">
          <div className="rounded-2xl bg-gradient-to-br from-violet-50 via-white to-sky-50/80 dark:from-violet-950/40 dark:via-slate-900 dark:to-slate-900 border border-slate-100 dark:border-slate-800 p-4">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-primary flex items-center justify-center text-white shadow-md shadow-violet-500/25 shrink-0">
                <Users className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                {editingName ? (
                  <div className="space-y-2">
                    <label className="sr-only" htmlFor="group-name-edit">
                      {t('chat.editGroupName') || 'Edit group name'}
                    </label>
                    <input
                      id="group-name-edit"
                      type="text"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={120}
                      className="w-full px-3 py-2 text-base font-semibold rounded-xl border-0 ring-2 ring-primary/40 focus:ring-primary bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm outline-none transition-shadow"
                      autoFocus
                      disabled={savingName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveName();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    {nameError && (
                      <p className="text-xs text-red-500 dark:text-red-400">{nameError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveName()}
                        disabled={savingName}
                        className="inline-flex items-center justify-center gap-1.5 flex-1 min-h-[40px] px-3 rounded-xl text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors"
                      >
                        {savingName ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        {t('chat.saveGroupName') || 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={savingName}
                        className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors"
                      >
                        {t('common.cancel') || 'Cancel'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white truncate leading-tight">
                        {displayName}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {count}{' '}
                        {count === 1
                          ? t('chat.memberSingular') || 'member'
                          : t('chat.members') || 'members'}
                      </p>
                    </div>
                    {canRename && (
                      <button
                        type="button"
                        onClick={startEdit}
                        className="shrink-0 p-2 rounded-xl text-primary bg-primary/10 hover:bg-primary/20 dark:bg-primary/15 transition-colors"
                        aria-label={t('chat.editGroupName') || 'Edit group name'}
                        title={t('chat.editGroupName') || 'Edit group name'}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {canRename && !editingName && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200/60 dark:border-slate-700/60 pt-3">
                {t('chat.renameGroupHint') ||
                  'Renaming the group posts a message in the chat so everyone can see who changed it.'}
              </p>
            )}
          </div>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 custom-scrollbar border-t border-slate-100 dark:border-slate-800">
          <p className="sticky top-0 z-[1] px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-50 dark:border-slate-800/80">
            {t('chat.membersList') || 'Members'}
          </p>
          {loading ? (
            <div className="p-2">
              <ContentSkeleton layout="list" rows={4} label={t('chat.loading') || 'Loading…'} />
            </div>
          ) : sorted.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">
              {t('chat.noMembers') || 'No members found.'}
            </p>
          ) : (
            <ul className="p-2 space-y-1 pb-4">
              {sorted.map((member) => {
                const online = isUserOnline(member);
                const isMe = member.id === currentUser?.id;
                const roleLabel =
                  member.position || formatAccessRoleLabel(member.role) || '';
                const memberLabel = userDisplayName(member, language);
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (onViewMember && !isMe) onViewMember(member.id);
                      }}
                      disabled={isMe || !onViewMember}
                      className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
                        isMe
                          ? 'bg-primary/10 dark:bg-primary/10 ring-1 ring-primary/15 cursor-default'
                          : onViewMember
                            ? 'hover:bg-slate-50 dark:hover:bg-slate-800/80 active:scale-[0.99]'
                            : ''
                      }`}
                    >
                      <div className="relative shrink-0">
                        <MemberAvatar
                          name={memberLabel}
                          url={resolveMediaUrl(member.avatarUrl)}
                        />
                        {online && (
                          <span
                            className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900"
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate font-khmer">
                          {memberLabel}
                          {isMe && (
                            <span className="ml-1.5 text-xs font-medium text-primary">
                              ({t('chat.you') || 'You'})
                            </span>
                          )}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {roleLabel ? (
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${roleBadgeClass(
                                member.role
                              )}`}
                            >
                              {roleLabel}
                            </span>
                          ) : (
                            <span
                              className={`text-xs truncate ${
                                online
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              {formatPresenceLabel(member, t)}
                            </span>
                          )}
                          {online && roleLabel && (
                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              · {t('chat.online') || 'Online'}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AppOverlay>
  );
};
