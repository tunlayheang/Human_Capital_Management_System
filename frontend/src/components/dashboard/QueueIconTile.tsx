import React from 'react';
import { cn } from '@/lib/utils';

function iconColorClass(accent: string): string {
  if (accent.includes('amber')) return 'text-amber-600 dark:text-amber-400';
  if (accent.includes('teal')) return 'text-teal-600 dark:text-teal-400';
  if (accent.includes('emerald')) return 'text-emerald-600 dark:text-emerald-400';
  if (accent.includes('indigo')) return 'text-indigo-600 dark:text-indigo-400';
  if (accent.includes('violet')) return 'text-violet-600 dark:text-violet-400';
  if (accent.includes('rose')) return 'text-rose-600 dark:text-rose-400';
  return 'text-slate-500 dark:text-slate-400';
}

type Props = {
  icon: React.ElementType;
  label: string;
  count: number;
  actionCount?: number;
  accent: string;
  onClick: () => void;
};

/** Dashboard queue shortcut — icon only with optional count badge. */
export function QueueIconTile({
  icon: Icon,
  label,
  count,
  actionCount = 0,
  accent,
  onClick,
}: Props) {
  const needsAction = actionCount > 0;
  const hasItems = count > 0;
  const badgeValue = needsAction ? actionCount : hasItems ? count : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={
        badgeValue > 0 ? `${label}, ${badgeValue} pending` : `${label}, up to date`
      }
      className={cn(
        'group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
        'hover:bg-slate-100 dark:hover:bg-slate-800/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
        !hasItems && !needsAction && 'opacity-45 hover:opacity-80'
      )}
    >
      <Icon
        className={cn(
          'h-[1.35rem] w-[1.35rem] transition-transform group-hover:scale-105',
          iconColorClass(accent)
        )}
        aria-hidden
      />

      {badgeValue > 0 ? (
        <span
          className={cn(
            'absolute -top-1 -right-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-none tabular-nums text-white',
            needsAction ? 'bg-amber-500 shadow-sm' : 'bg-slate-500 dark:bg-slate-400'
          )}
        >
          {badgeValue > 99 ? '99+' : badgeValue}
        </span>
      ) : null}
    </button>
  );
}

export default QueueIconTile;
