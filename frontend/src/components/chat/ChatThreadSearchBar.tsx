import React, { useMemo } from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { Message } from '../../types';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { ListSearchFilterBar } from '../ui/page';
import { listToolbarIconPillClass } from '../../constants/designSystem';

type Props = {
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  messages: Message[];
  onPickImage: (url: string) => void;
  placeholder?: string;
};

export const ChatThreadSearchBar: React.FC<Props> = ({
  open,
  query,
  onQueryChange,
  onClose,
  messages,
  onPickImage,
  placeholder = 'Search in conversation…',
}) => {
  const images = useMemo(
    () =>
      messages
        .filter((m) => !m.isDeleted && !m.deletedAt && m.attachmentType === 'image' && m.attachmentUrl)
        .map((m) => ({ id: m.id, url: resolveMediaUrl(m.attachmentUrl)! })),
    [messages]
  );

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const showMedia = !q;

  return (
    <div className="tg-chat-search-panel shrink-0 border-b border-slate-100 dark:border-slate-800 bg-white/97 dark:bg-slate-900/97 backdrop-blur-sm px-2 py-2 space-y-2">
      <ListSearchFilterBar
        searchValue={query}
        onSearchChange={onQueryChange}
        searchPlaceholder={placeholder}
        trailing={
          <button
            type="button"
            onClick={onClose}
            className={listToolbarIconPillClass}
            aria-label="Close search"
          >
            <X className="w-[1.05rem] h-[1.05rem]" />
          </button>
        }
      />
      {showMedia && images.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1 mb-1 flex items-center gap-1">
            <ImageIcon className="w-3 h-3" />
            Photos
          </p>
          <div className="tg-chat-photo-strip flex gap-1.5 overflow-x-auto pb-1">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => onPickImage(img.url)}
                className="shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-90"
              >
                <img src={img.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
