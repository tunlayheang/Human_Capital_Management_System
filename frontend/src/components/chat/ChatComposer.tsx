import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Paperclip, Plus, Smile, X } from 'lucide-react';
import { ChatEmojiPicker } from './ChatEmojiPicker';

export type PendingChatAttachment = {
  file: File;
  previewUrl: string | null;
};

function truncateFilename(name: string, max = 18): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = Math.max(4, max - ext.length - 1);
  return `${base.slice(0, keep)}…${ext}`;
}

function attachmentKindLabel(file: File): string {
  if (file.type === 'application/pdf') return 'PDF';
  if (file.type.startsWith('image/')) return 'Photo';
  return 'File';
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAttach: () => void;
  pendingAttachment?: PendingChatAttachment | null;
  onRemoveAttachment?: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Tighter layout for the floating chat dock */
  compact?: boolean;
  showAttach?: boolean;
};

export const ChatComposer: React.FC<Props> = ({
  value,
  onChange,
  onSend,
  onAttach,
  pendingAttachment = null,
  onRemoveAttachment,
  sending = false,
  disabled = false,
  placeholder = 'Write a message...',
  compact = false,
  showAttach = true,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const caretRef = useRef<number | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const canSend = Boolean(value.trim() || pendingAttachment) && !sending && !disabled;

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      const current = valueRef.current;
      // selectionStart/setSelectionRange use UTF-16 units — same as String.length
      // (not [...emoji].length, which breaks surrogate-pair emojis on the 2nd insert).
      const start =
        el?.selectionStart ??
        caretRef.current ??
        current.length;
      const end = el?.selectionEnd ?? start;
      const next = current.slice(0, start) + emoji + current.slice(end);
      const nextCaret = start + emoji.length;
      caretRef.current = nextCaret;
      valueRef.current = next;
      onChange(next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(nextCaret, nextCaret);
        resize();
      });
    },
    [onChange, resize]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSend) onSend();
  };

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-2 ${compact ? 'px-2.5 py-2' : 'px-2 sm:px-3 py-2'}`}
    >
      <div
        className={`flex flex-col min-w-0 border border-slate-200/90 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500/35 transition-shadow duration-150 ${
          compact ? 'rounded-2xl' : 'rounded-[1.35rem]'
        }`}
      >
        {pendingAttachment && (
          <div className={`${compact ? 'px-2 pt-2' : 'px-2.5 pt-2.5'}`}>
            <div className="relative inline-flex max-w-full items-center gap-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/60 px-2.5 py-2 pr-9">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-600 bg-white dark:bg-slate-800 flex items-center justify-center">
                {pendingAttachment.previewUrl ? (
                  <img
                    src={pendingAttachment.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <FileText className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-[10rem] sm:max-w-[14rem]">
                  {truncateFilename(pendingAttachment.file.name)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {attachmentKindLabel(pendingAttachment.file)}
                </p>
              </div>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={onRemoveAttachment}
                  disabled={sending || disabled}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-colors"
                  aria-label="Remove attachment"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className={`relative flex items-end gap-1 min-w-0 ${compact ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}>
          {emojiOpen && (
            <ChatEmojiPicker onSelect={insertEmoji} onClose={() => setEmojiOpen(false)} />
          )}
          {showAttach && (
            <button
              type="button"
              onClick={onAttach}
              disabled={disabled || sending}
              className="p-1.5 shrink-0 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Attach file"
              aria-label="Attach file"
            >
              {pendingAttachment ? (
                <Plus className="w-4 h-4" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            type="button"
            disabled={disabled || sending}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setEmojiOpen((open) => !open)}
            className={`p-1 shrink-0 rounded-md transition-colors ${
              emojiOpen
                ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/15'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
            aria-label={emojiOpen ? 'Close emoji picker' : 'Insert emoji'}
            aria-expanded={emojiOpen}
            aria-haspopup="dialog"
          >
            <Smile className="w-4 h-4" />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              caretRef.current = e.target.selectionStart;
              onChange(e.target.value);
              resize();
            }}
            onSelect={(e) => {
              caretRef.current = e.currentTarget.selectionStart;
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            className="flex-1 min-w-0 max-h-[120px] resize-none bg-transparent text-base text-slate-900 dark:text-white placeholder:text-slate-400 outline-none py-1.5 leading-snug"
          />
          <button
            type="submit"
            disabled={!canSend}
            className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-35 disabled:hover:bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-all duration-150 active:scale-95`}
            title="Send"
            aria-label="Send message"
          >
            <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </form>
  );
};
