import React from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import type { TrendDirection } from '../../types/personalAnalytics';

const LABEL: Record<TrendDirection, string> = {
  improved: 'Improved',
  stable: 'Stable',
  declined: 'Declined',
  increasing: 'Increasing',
  decreasing: 'Decreasing',
};

const STYLE: Record<TrendDirection, string> = {
  improved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  stable: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  declined: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  increasing: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  decreasing: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
};

export const TrendBadge: React.FC<{ trend: TrendDirection; className?: string }> = ({
  trend,
  className = '',
}) => {
  const Icon =
    trend === 'improved' || trend === 'increasing'
      ? ArrowUp
      : trend === 'declined' || trend === 'decreasing'
        ? ArrowDown
        : ArrowRight;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${STYLE[trend]} ${className}`}
    >
      <Icon className="w-3 h-3" aria-hidden />
      {LABEL[trend]}
    </span>
  );
};
