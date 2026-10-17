import React from 'react';
import { ArrowRight, CheckCircle2, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { cn } from '@/lib/utils';

type QueueCardVariant = 'default' | 'dashboard';

function softAccentClasses(accent: string): { bg: string; text: string } {
  if (accent.includes('amber')) {
    return { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-600 dark:text-amber-400' };
  }
  if (accent.includes('teal')) {
    return { bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-600 dark:text-teal-400' };
  }
  if (accent.includes('emerald')) {
    return { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400' };
  }
  if (accent.includes('indigo')) {
    return { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-600 dark:text-indigo-400' };
  }
  if (accent.includes('violet')) {
    return { bg: 'bg-violet-50 dark:bg-violet-950/40', text: 'text-violet-600 dark:text-violet-400' };
  }
  if (accent.includes('rose')) {
    return { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-600 dark:text-rose-400' };
  }
  return { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' };
}

export function ApprovalQueueLinkCard({
  icon: Icon,
  title,
  description,
  count,
  actionCount = 0,
  onClick,
  accent,
  alwaysShow = true,
  variant = 'default',
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  count: number;
  actionCount?: number;
  onClick: () => void;
  accent: string;
  alwaysShow?: boolean;
  variant?: QueueCardVariant;
}) {
  if (!alwaysShow && count <= 0) return null;

  const needsAction = actionCount > 0;
  const hasItems = count > 0;
  const softAccent = softAccentClasses(accent);

  if (variant === 'dashboard') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-4 sm:py-3',
          needsAction
            ? 'bg-amber-50/80 hover:bg-amber-50 dark:bg-amber-950/25 dark:hover:bg-amber-950/40'
            : hasItems
              ? 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              : 'text-slate-500 hover:bg-slate-50/80 dark:text-slate-400 dark:hover:bg-slate-800/40'
        )}
      >
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            softAccent.bg,
            softAccent.text
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm font-medium',
              hasItems || needsAction
                ? 'text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            )}
          >
            {title}
          </p>
          {hasItems && description ? (
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {needsAction ? (
            <Badge variant="warning" className="min-w-[1.5rem] justify-center tabular-nums px-2">
              {actionCount}
            </Badge>
          ) : hasItems ? (
            <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {count}
            </span>
          ) : (
            <CheckCircle2
              className="h-4 w-4 text-slate-300 dark:text-slate-600"
              aria-label="Up to date"
            />
          )}
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 transition-colors',
              needsAction
                ? 'text-amber-600 group-hover:text-amber-700 dark:text-amber-400'
                : 'text-slate-300 group-hover:text-primary-500 dark:text-slate-600'
            )}
            aria-hidden
          />
        </div>
      </button>
    );
  }

  const badgeVariant =
    actionCount > 0 ? 'warning' : count > 0 ? 'neutral' : ('neutral' as const);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-slate-200/80 bg-white p-4 text-left transition-all hover:border-primary-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-primary-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${accent}`}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <Badge variant={badgeVariant} className="min-w-[1.75rem] justify-center tabular-nums">
            {count}
          </Badge>
          <ArrowRight className="h-4 w-4 text-slate-400 transition-colors group-hover:text-primary-500" />
        </div>
      </div>
    </button>
  );
}
