import React from 'react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { inputClass } from '../../constants/designSystem';
import { PillSegmentTabs, type PillSegmentTabItem } from '../ui/page/PillSegmentTabs';
import { DatePickerInput } from '../ui/shadcn/date-picker-input';

export const paSectionClass =
  'surface-card shadow-sm';

export function PaSection({
  title,
  icon,
  action,
  children,
  className = '',
  dense = false,
  fill = false,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
  fill?: boolean;
}) {
  return (
    <section
      className={`${paSectionClass} ${dense ? 'p-3 sm:p-3.5' : 'p-4 sm:p-5'} ${
        fill ? 'h-full flex flex-col min-h-0' : dense ? 'space-y-2.5' : 'space-y-4'
      } ${className}`}
    >
      <div
        className={`shrink-0 flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 ${
          dense ? 'pb-2' : 'pb-3 gap-3'
        }`}
      >
        <div className={`flex items-center min-w-0 ${dense ? 'gap-2' : 'gap-2.5'}`}>
          {icon ? (
            <span
              className={`shrink-0 rounded-lg bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 ${
                dense ? 'p-1.5' : 'p-2 rounded-xl'
              }`}
            >
              {icon}
            </span>
          ) : null}
          <h2 className={`font-semibold text-slate-900 dark:text-white truncate ${dense ? 'text-xs' : 'text-sm'}`}>
            {title}
          </h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div
        className={
          fill ? 'flex-1 min-h-0 flex flex-col gap-2.5 pt-2.5' : dense ? 'space-y-2.5' : 'space-y-4'
        }
      >
        {children}
      </div>
    </section>
  );
}

export function PaStatCard({
  label,
  value,
  sub,
  footer,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  footer?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className={`${paSectionClass} p-4 flex flex-col min-h-[7.5rem]`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${accent ?? 'text-slate-900 dark:text-white'}`}>
        {value}
      </p>
      <div className="mt-auto pt-2 min-h-[1.75rem]">
        {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
        {footer}
      </div>
    </div>
  );
}

export function PaMetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white mt-0.5">{value}</p>
    </div>
  );
}

export function PaField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block space-y-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

export function PaInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.type === 'date') {
    const { type: _type, ...rest } = props;
    return <DatePickerInput className={inputClass} {...rest} />;
  }
  return <input className={inputClass} {...props} />;
}

export function PaTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputClass} min-h-[4.5rem] resize-y`} {...props} />;
}

export function PaFormActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>;
}

const btnBase = 'text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors disabled:opacity-50';

export function PaBtnPrimary({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`${btnBase} bg-primary-600 text-white hover:bg-primary-700 ${className}`} {...props}>
      {children}
    </button>
  );
}

export function PaBtnGhost({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${btnBase} border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function PaEmpty({
  children,
  compact = false,
  className = '',
}: {
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`text-slate-500 dark:text-slate-400 text-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 ${
        compact ? 'text-[11px] py-3.5' : 'text-xs py-6 rounded-xl'
      } ${className}`}
    >
      {children}
    </p>
  );
}

export function PaLoading({ rows = 3 }: { rows?: number }) {
  return <ContentSkeleton layout="list" rows={rows} />;
}

const LIST_MAX_H = {
  sm: 'max-h-32',
  md: 'max-h-44',
  lg: 'max-h-52',
} as const;

export function PaListShell({
  children,
  compact = false,
  maxHeight = 'sm',
  fill = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
  maxHeight?: keyof typeof LIST_MAX_H;
  fill?: boolean;
}) {
  return (
    <ul
      className={`overflow-y-auto pr-0.5 ${compact ? 'space-y-1.5' : 'space-y-2'} ${
        fill ? 'flex-1 min-h-0' : LIST_MAX_H[maxHeight]
      }`}
    >
      {children}
    </ul>
  );
}

export function PaHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center py-2">{children}</p>
  );
}

export function PaListRow({
  children,
  onClick,
  className = '',
  compact = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const interactive = onClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/80' : '';
  return (
    <li
      className={`border border-slate-200 dark:border-slate-700 ${interactive} ${
        compact ? 'rounded-lg px-2.5 py-1.5 text-[11px]' : 'rounded-xl px-3 py-2 text-xs'
      } ${className}`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </li>
  );
}

export function PaInfoStrip({
  icon,
  children,
  compact = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 ${
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs rounded-xl'
      }`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function PaPeriodBar({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-slate-50/80 dark:bg-slate-800/40 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
      {label}
    </div>
  );
}

export function PaSectionTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string; icon: React.ElementType }[];
  ariaLabel: string;
}) {
  const pillTabs: PillSegmentTabItem<T>[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
  }));

  return (
    <PillSegmentTabs
      value={value}
      onChange={onChange}
      tabs={pillTabs}
      ariaLabel={ariaLabel}
    />
  );
}
