import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Direction = 'left' | 'right';

type Props = {
  direction: Direction;
  onClick: () => void;
  /** Pill track (neutral light / blue dark) vs neutral bar */
  variant?: 'pill' | 'neutral';
  className?: string;
  disabled?: boolean;
};

export function HorizontalScrollArrow({
  direction,
  onClick,
  variant = 'pill',
  className = '',
  disabled = false,
}: Props) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
  const label = direction === 'left' ? 'Scroll tabs left' : 'Scroll tabs right';

  const tone =
    variant === 'pill'
      ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/70 focus-visible:ring-primary-500/35 disabled:text-slate-300 disabled:hover:bg-transparent dark:text-white dark:hover:text-white dark:hover:bg-white/15 dark:focus-visible:ring-white/40 dark:disabled:text-white/35 dark:disabled:hover:bg-transparent'
      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700/80 focus-visible:ring-primary-500/40 disabled:text-slate-300 disabled:hover:bg-transparent dark:disabled:text-slate-600';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`shrink-0 inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-default ${tone} ${className}`.trim()}
    >
      <Icon className="w-4 h-4 sm:w-[1.125rem] sm:h-[1.125rem]" aria-hidden />
    </button>
  );
}
