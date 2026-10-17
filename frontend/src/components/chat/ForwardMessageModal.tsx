import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { ChatInboxItem, GroupInboxItem, Message, User } from '../../types';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { chatAvatarFallbackUrl, quotePreviewText } from './chatUtils';
import { AppOverlay } from '../ui/AppOverlay';
import { overlayPanelClass } from '../../utils/overlayPanel';
import { PillSegmentTabs } from '../ui/page/PillSegmentTabs';
import { ListSearchBarShell, ListSearchInput } from '../ui/page';

type Props = {
  message: Message;
  colleagues: User[];
  groups: ChatInboxItem[];
  onClose: () => void;
  onForward: (target: { receiverId?: string; groupId?: string }) => Promise<boolean>;
  overlayHostRef?: React.RefObject<HTMLElement | null>;
};

export const ForwardMessageModal: React.FC<Props> = ({
  message,
  colleagues,
  groups,
  onClose,
  onForward,
  overlayHostRef,
}) => {
  const [tab, setTab] = useState<'people' | 'groups'>('people');
  const [q, setQ] = useState('');
  const [sending, setSending] = useState(false);

  const filteredPeople = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return colleagues.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        (u.position || '').toLowerCase().includes(term)
    );
  }, [colleagues, q]);

  const groupItems = useMemo(
    () => groups.filter((g): g is GroupInboxItem => g.kind === 'group'),
    [groups]
  );

  const filteredGroups = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return groupItems.filter((g) => g.name.toLowerCase().includes(term));
  }, [groupItems, q]);

  const pick = async (target: { receiverId?: string; groupId?: string }) => {
    setSending(true);
    const ok = await onForward(target);
    setSending(false);
    if (ok) onClose();
  };

  return (
    <AppOverlay
      open
      onClose={onClose}
      zIndexClass={overlayHostRef ? 'z-[60]' : 'z-[250]'}
      hostRef={overlayHostRef}
      lockScroll={!overlayHostRef}
    >
      <div
        className={overlayPanelClass(
          'md',
          `rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col ${
            overlayHostRef ? 'max-h-full' : 'max-h-[min(85dvh,80vh)]'
          }`
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hcms-modal-header shrink-0">
          <h3 className="font-semibold text-slate-900 dark:text-white">Forward message</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="hcms-modal-body !px-4 !py-2 border-b border-slate-100 dark:border-slate-800 shrink-0 !overflow-visible">
          <p className="text-sm text-slate-500 line-clamp-2">{quotePreviewText(message)}</p>
        </div>
        <div className="px-3 pt-2 shrink-0">
          <PillSegmentTabs
            value={tab}
            onChange={(id) => setTab(id as 'people' | 'groups')}
            ariaLabel="Forward destination"
            tabs={[
              { id: 'people', label: 'People' },
              { id: 'groups', label: 'Groups' },
            ]}
          />
        </div>
        <div className="px-3 py-2 shrink-0">
          <ListSearchBarShell>
            <ListSearchInput
              value={q}
              onChange={setQ}
              placeholder="Type to search…"
              className="flex-1 min-w-0"
            />
          </ListSearchBarShell>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-1 pb-4 min-h-0">
          {tab === 'people' ? (
            !q.trim() ? (
              <p className="text-center text-sm text-slate-400 py-6">Type a name to find contacts</p>
            ) : filteredPeople.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-6">No contacts</p>
            ) : (
              filteredPeople.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  disabled={sending}
                  onClick={() => void pick({ receiverId: u.id })}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left disabled:opacity-50 min-h-[56px]"
                >
                  <img
                    src={
                      resolveMediaUrl(u.avatarUrl) || chatAvatarFallbackUrl(u.name)
                    }
                    alt=""
                    className="w-11 h-11 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{u.name}</p>
                    <p className="text-xs text-slate-500 truncate">{u.position}</p>
                  </div>
                </button>
              ))
            )
          ) : !q.trim() ? (
            <p className="text-center text-sm text-slate-400 py-6">Type a group name to search</p>
          ) : filteredGroups.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-6">No groups</p>
          ) : (
            filteredGroups.map((g) => (
              <button
                key={g.groupId}
                type="button"
                disabled={sending}
                onClick={() => void pick({ groupId: g.groupId })}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left disabled:opacity-50 min-h-[56px]"
              >
                <div className="w-11 h-11 rounded-full bg-violet-500 text-white flex items-center justify-center text-sm font-bold shrink-0">
                  {g.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{g.name}</p>
                  <p className="text-xs text-slate-500">{g.memberCount} members</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </AppOverlay>
  );
};
