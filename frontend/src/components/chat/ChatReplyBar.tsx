import React from 'react';
import { X } from 'lucide-react';
import { Message } from '../../types';
import { quotePreviewText } from './chatUtils';

type Props = {
  message: Message;
  senderLabel: string;
  onCancel: () => void;
};

export const ChatReplyBar: React.FC<Props> = ({ message, senderLabel, onCancel }) => (
  <div className="flex items-stretch gap-2.5 px-3 py-2 bg-slate-50 dark:bg-slate-800/90 border-b border-slate-200/80 dark:border-slate-700/80">
    <div className="w-0.5 rounded-full bg-primary-500 dark:bg-primary-400 shrink-0 self-stretch min-h-[2rem]" />
    <div className="flex-1 min-w-0 py-0.5">
      <p className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 truncate leading-tight">
        {senderLabel}
      </p>
      <p className="text-[13px] text-slate-600 dark:text-slate-400 truncate leading-snug mt-0.5">
        {quotePreviewText(message)}
      </p>
    </div>
    <button
      type="button"
      onClick={onCancel}
      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0"
      aria-label="Cancel reply"
    >
      <X className="w-4 h-4 text-slate-500" />
    </button>
  </div>
);
