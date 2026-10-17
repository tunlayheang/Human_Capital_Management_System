import React from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PeriodSelectOption = {
  id: string;
  name: string;
};

type Props = {
  options: PeriodSelectOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** Refresh button, loading spinner, etc. */
  trailing?: React.ReactNode;
  emptyLabel?: string;
};

export const PeriodSelectToolbar: React.FC<Props> = ({
  options,
  value,
  onChange,
  label = 'Period',
  ariaLabel = 'Period',
  id = 'period-select',
  className,
  trailing,
  emptyLabel = 'Select period',
}) => {
  const selected = options.find((o) => o.id === value);
  const displayName = selected?.name?.trim() || emptyLabel;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-[12rem] flex-1 sm:flex-none sm:min-w-[14rem]">
        <div
          className="pointer-events-none flex items-center gap-2.5 rounded-xl border border-primary-200/80 dark:border-primary-800/60 bg-white dark:bg-slate-900/80 px-2.5 py-2 shadow-sm shadow-primary-500/5 ring-1 ring-primary-500/10"
          aria-hidden
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400">
            <Calendar className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 pr-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none">
              {label}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white leading-tight">
              {displayName}
            </p>
          </div>
          <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <select
          id={id}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          disabled={options.length === 0}
        >
          {options.length === 0 ? (
            <option value="">{emptyLabel}</option>
          ) : (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))
          )}
        </select>
      </div>
      {trailing ? <div className="flex items-center gap-2 shrink-0">{trailing}</div> : null}
    </div>
  );
};
