import React from 'react';
import { cn } from '@/lib/utils';

/** Shared neutral outline styling for every list/table row action icon. */
export const listIconButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 disabled:pointer-events-none transition-colors dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

export type ListIconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  /** Accessible name — used for `title` and `aria-label`. */
  label: string;
  icon: React.ReactNode;
};

/** Compact icon-only control for table and list row actions (neutral, no color variants). */
export function ListIconButton({
  label,
  icon,
  className,
  type = 'button',
  ...props
}: ListIconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      className={cn(listIconButtonClass, className)}
      {...props}
    >
      {icon}
    </button>
  );
}
