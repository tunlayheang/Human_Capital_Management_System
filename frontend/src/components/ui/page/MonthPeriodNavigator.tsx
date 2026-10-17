import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthName } from '../../../utils/leaveCalendar';
import { listToolbarIconPillClass } from '../../../constants/designSystem';
import { cn } from '../../../utils';

export type MonthPeriodNavigatorProps = {
  month: number;
  year: number;
  onMonthChange: (month: number, year: number) => void;
  disabled?: boolean;
  /** Shown under the control when set (e.g. "31 days · locked"). */
  daysHint?: string;
  className?: string;
  'aria-label'?: string;
};

function shiftMonth(month: number, year: number, delta: number): { month: number; year: number } {
  let m = month + delta;
  let y = year;
  if (m < 0) {
    m = 11;
    y -= 1;
  } else if (m > 11) {
    m = 0;
    y += 1;
  }
  return { month: m, year: y };
}

/** Always-visible month chevron control (outside filter menus). */
export const MonthPeriodNavigator: React.FC<MonthPeriodNavigatorProps> = ({
  month,
  year,
  onMonthChange,
  disabled = false,
  daysHint,
  className,
  'aria-label': ariaLabel = 'Calendar month',
}) => {
  const periodLabel = `${monthName(month)} ${year}`;

  const navigate = (delta: number) => {
    if (disabled) return;
    const next = shiftMonth(month, year, delta);
    onMonthChange(next.month, next.year);
  };

  return (
    <div className={cn('flex flex-col items-stretch gap-0.5 shrink-0', className)}>
      <div
        className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/90 dark:border-slate-600/75 bg-white dark:bg-slate-800/95 p-0.5 shadow-sm min-w-[11.5rem]"
        role="group"
        aria-label={ariaLabel}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          disabled={disabled}
          className={listToolbarIconPillClass}
          aria-label="Previous month"
        >
          <ChevronLeft className="w-[1.05rem] h-[1.05rem]" />
        </button>
        <div className="flex-1 min-w-0 px-2 text-center">
          <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight truncate">
            {periodLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(1)}
          disabled={disabled}
          className={listToolbarIconPillClass}
          aria-label="Next month"
        >
          <ChevronRight className="w-[1.05rem] h-[1.05rem]" />
        </button>
      </div>
      {daysHint ? (
        <p className="text-[10px] text-center text-slate-500 dark:text-slate-400 leading-tight px-1">
          {daysHint}
        </p>
      ) : null}
    </div>
  );
};
