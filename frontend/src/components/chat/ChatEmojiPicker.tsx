import React, { useEffect, useRef, useState } from 'react';
import { CHAT_EMOJI_CATEGORIES } from './chatEmojis';

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export const ChatEmojiPicker: React.FC<Props> = ({ onSelect, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState(CHAT_EMOJI_CATEGORIES[0].id);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const category =
    CHAT_EMOJI_CATEGORIES.find((c) => c.id === activeCategory) ?? CHAT_EMOJI_CATEGORIES[0];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      className="tg-emoji-picker absolute bottom-full left-0 z-50 mb-2 w-[min(100%,18rem)] sm:w-[19rem] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 overflow-hidden"
    >
      <div className="flex gap-0.5 px-2 pt-2 pb-1 border-b border-slate-100 dark:border-slate-700 overflow-x-auto scrollbar-none">
        {CHAT_EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide rounded-md transition-colors ${
              activeCategory === cat.id
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div
        className="grid grid-cols-8 gap-0.5 p-2 max-h-[10.5rem] overflow-y-auto custom-scrollbar"
        role="listbox"
        aria-label={category.label}
      >
        {category.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="option"
            aria-label={emoji}
            className="flex items-center justify-center w-8 h-8 text-xl rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 active:scale-95 transition-transform"
            // Keep focus/caret in the composer so multiple emojis can be inserted.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};
