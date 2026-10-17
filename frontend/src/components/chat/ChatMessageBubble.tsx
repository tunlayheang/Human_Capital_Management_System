import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, CornerUpLeft, FileText, Forward, Pencil, Trash2 } from 'lucide-react';
import { Message } from '../../types';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { formatBubbleTime } from './chatTimeline';
import { quotePreviewText } from './chatUtils';

type Props = {
  msg: Message;
  isMe: boolean;
  isLastInCluster: boolean;
  showTail: boolean;
  /** First bubble in a group thread cluster — show sender label inside */
  senderName?: string;
  canDelete: boolean;
  canEdit: boolean;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onImageClick?: (url: string) => void;
  highlightQuery?: string;
};

export const ChatMessageBubble: React.FC<Props> = ({
  msg,
  isMe,
  isLastInCluster,
  showTail,
  senderName,
  canDelete,
  canEdit,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onImageClick,
  highlightQuery,
}) => {
  const url = resolveMediaUrl(msg.attachmentUrl);
  const time = formatBubbleTime(msg.createdAt);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deleted = msg.isDeleted || Boolean(msg.deletedAt);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const tailClass = showTail
    ? isMe
      ? 'tg-bubble-tail-out'
      : 'tg-bubble-tail-in'
    : '';

  return (
    <div
      className={`group relative w-fit max-w-[min(420px,88vw)] sm:max-w-[min(480px,78%)] ${isMe ? 'self-end' : 'self-start'}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div
        className={`tg-message-bubble relative text-[14px] leading-[1.45] ${tailClass} ${
          isMe ? 'tg-bubble-out' : 'tg-bubble-in'
        } ${deleted ? 'opacity-80' : ''}`}
      >
        {senderName && !isMe && (
          <p className="tg-bubble-sender mb-1 pr-12">{senderName}</p>
        )}

        {msg.forwardedLabel && !deleted && (
          <p className="tg-bubble-forwarded mb-1.5 flex items-center gap-1 pr-10">
            <Forward className="w-3 h-3 shrink-0 opacity-70" />
            <span className="truncate">{msg.forwardedLabel}</span>
          </p>
        )}

        {msg.replyTo && !deleted && (
          <div className={`tg-bubble-reply mb-1.5 ${isMe ? 'tg-bubble-reply--out' : 'tg-bubble-reply--in'}`}>
            <p className="tg-bubble-reply-name truncate">
              {msg.replyTo.senderName || 'User'}
            </p>
            <p className="tg-bubble-reply-text line-clamp-1">{quotePreviewText(msg.replyTo)}</p>
          </div>
        )}

        {deleted ? (
          <p className="tg-bubble-deleted italic pr-14">This message was deleted</p>
        ) : (
          <>
            {msg.attachmentType === 'image' && url && (
              <button
                type="button"
                onClick={() => onImageClick?.(url)}
                className="block mb-1.5 -mx-0.5 text-left w-full cursor-zoom-in rounded-md overflow-hidden"
              >
                <img src={url} alt="" className="max-w-full rounded-md max-h-52 sm:max-h-64 object-cover" />
              </button>
            )}
            {(msg.attachmentType === 'pdf' || msg.attachmentType === 'file') && url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="tg-bubble-attachment flex items-center gap-2 mb-1.5 text-xs font-medium"
              >
                <FileText className="w-4 h-4 shrink-0" />
                Attachment
              </a>
            )}
            {msg.content ? (
              <div className="flex flex-wrap items-end gap-x-2 gap-y-0.5 min-w-[3.5rem]">
                <p className="break-words whitespace-pre-wrap flex-1 min-w-[2rem]">
                  {highlightQuery && highlightQuery.trim() ? (
                    <HighlightText text={msg.content} query={highlightQuery} />
                  ) : (
                    msg.content
                  )}
                </p>
                <BubbleMeta
                  time={time}
                  isMe={isMe}
                  isLastInCluster={isLastInCluster}
                  isRead={Boolean(msg.isRead)}
                  deleted={false}
                  edited={Boolean(msg.editedAt)}
                />
              </div>
            ) : (
              <div className="flex justify-end min-w-[3.5rem]">
                <BubbleMeta
                  time={time}
                  isMe={isMe}
                  isLastInCluster={isLastInCluster}
                  isRead={Boolean(msg.isRead)}
                  deleted={false}
                  edited={Boolean(msg.editedAt)}
                />
              </div>
            )}
          </>
        )}

        {deleted && (
          <div className="absolute bottom-1.5 right-2.5">
            <BubbleMeta time={time} isMe={isMe} isLastInCluster={false} isRead={false} deleted />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-8 sm:-left-7' : '-right-8 sm:-right-7'} p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 hover:bg-slate-200/70 dark:hover:bg-slate-700/80 transition-opacity`}
        aria-label="Message actions"
      >
        <span className="text-slate-400 text-base leading-none">⋯</span>
      </button>

      {menuOpen && (
        <div
          ref={menuRef}
          className={`absolute z-40 min-w-[148px] py-1 rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 ${
            isMe ? 'right-0 top-full mt-1' : 'left-0 top-full mt-1'
          }`}
        >
          {!deleted && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onReply();
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]"
              >
                <CornerUpLeft className="w-4 h-4 text-primary-500" />
                Reply
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onForward();
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]"
              >
                <Forward className="w-4 h-4 text-primary-500" />
                Forward
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]"
                >
                  <Pencil className="w-4 h-4 text-primary-500" />
                  Edit
                </button>
              ) : null}
            </>
          )}
          {canDelete && !deleted && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};

function BubbleMeta({
  time,
  isMe,
  isLastInCluster,
  isRead,
  deleted,
  edited = false,
}: {
  time: string;
  isMe: boolean;
  isLastInCluster: boolean;
  isRead: boolean;
  deleted: boolean;
  edited?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 shrink-0 select-none pb-px ${
        deleted ? 'tg-bubble-meta' : isMe ? 'tg-bubble-meta tg-bubble-meta--out' : 'tg-bubble-meta'
      }`}
    >
      {edited ? <span className="text-[10px] italic opacity-80">edited</span> : null}
      <span className="tabular-nums">{time}</span>
      {isMe && isLastInCluster && !deleted && (
        <span className="inline-flex ml-0.5" aria-hidden>
          {isRead ? (
            <CheckCheck className="w-3.5 h-3.5" strokeWidth={2.25} />
          ) : (
            <Check className="w-3.5 h-3.5 opacity-80" strokeWidth={2.25} />
          )}
        </span>
      )}
    </span>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200/90 dark:bg-amber-500/35 rounded px-0.5 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}
