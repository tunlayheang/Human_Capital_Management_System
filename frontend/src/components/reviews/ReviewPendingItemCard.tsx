import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '../ui/Badge';
import type { RequiredActionItem } from '../../hooks/useRequiredActions';

export function ReviewPendingItemCard({
  item,
  onClick,
  busy,
}: {
  item: RequiredActionItem;
  onClick: () => void;
  busy?: boolean;
}) {
  const primary = item.employeeName || item.title;
  const secondary = item.employeeName ? item.subtitle : item.subtitle || item.title;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-3 sm:p-4 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all group disabled:opacity-60 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">{primary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed break-words">{secondary}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-500 transition-colors shrink-0 mt-0.5" />
      </div>
      {item.urgency === 'high' ? (
        <Badge variant="warning" className="text-[10px]">
          Action
        </Badge>
      ) : null}
    </button>
  );
}
