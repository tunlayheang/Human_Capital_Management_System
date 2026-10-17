import React from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'success' | 'warning' | 'neutral';

const iconStyles: Record<Variant, string> = {
  primary: 'glass-inset text-primary-600 dark:text-primary-400',
  success: 'glass-inset text-emerald-600 dark:text-emerald-400',
  warning: 'glass-inset text-amber-600 dark:text-amber-400',
  neutral: 'glass-inset text-slate-600 dark:text-slate-400',
};

type Props = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: LucideIcon;
  variant?: Variant;
  onClick?: () => void;
  active?: boolean;
};

export const StatCard: React.FC<Props> = ({
  label,
  value,
  hint,
  icon: Icon,
  variant = 'primary',
  onClick,
  active = false,
}) => {
  const interactive = Boolean(onClick);
  const className = [
    'surface-card p-3 sm:p-4 md:p-5 w-full min-w-0 text-left transition relative z-10',
    interactive &&
      'cursor-pointer hover:shadow-md hover:border-primary-300/80 dark:hover:border-primary-600/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 pointer-events-auto',
    active && 'ring-2 ring-primary-500 dark:ring-primary-400 shadow-md border-primary-400/60 dark:border-primary-500/50',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <div className="flex items-center justify-between gap-2 sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight line-clamp-2">
          {label}
        </p>
        <p className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white mt-0.5 sm:mt-1 tabular-nums">
          {value}
        </p>
        {hint && <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 line-clamp-2">{hint}</p>}
      </div>
      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${iconStyles[variant]}`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </div>
    </div>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className} aria-pressed={active}>
        {inner}
      </button>
    );
  }

  return <div className={className}>{inner}</div>;
};
