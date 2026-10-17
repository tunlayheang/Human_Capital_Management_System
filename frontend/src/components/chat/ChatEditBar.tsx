import React from 'react';
import { Pencil, X } from 'lucide-react';

type Props = {
  preview: string;
  onCancel: () => void;
};

export const ChatEditBar: React.FC<Props> = ({ preview, onCancel }) => (
  <div className="flex items-stretch gap-2.5 px-3 py-2 bg-amber-50/90 dark:bg-amber-950/30 border-b border-amber-200/80 dark:border-amber-900/50">
    <div className="w-0.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0 self-stretch min-h-[2rem]" />
    <div className="flex-1 min-w-0 py-0.5">
      <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1 leading-tight">
        <Pencil className="w-3 h-3 shrink-0" aria-hidden />
        Editing message
      </p>
      <p className="text-[13px] text-slate-600 dark:text-slate-400 truncate leading-snug mt-0.5">
        {preview}
      </p>
    </div>
    <button
      type="button"
      onClick={onCancel}
      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-amber-100/80 dark:hover:bg-amber-900/40 shrink-0"
      aria-label="Cancel edit"
    >
      <X className="w-4 h-4 text-slate-500" />
    </button>
  </div>
);
