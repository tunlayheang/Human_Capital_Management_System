import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';
import {
  MonthYearWheel,
  formatMonthYearCaption,
} from '@/components/ui/shadcn/month-year-wheel';

import 'react-day-picker/style.css';

export type CalendarProps = DayPickerProps & {
  /**
   * Click month/year caption to open a clean month+year tumbler
   * (instead of native dropdowns).
   */
  enableMonthYearWheel?: boolean;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  enableMonthYearWheel = true,
  month: controlledMonth,
  onMonthChange,
  startMonth,
  endMonth,
  components,
  hideNavigation: _hideNavigation,
  ...props
}: CalendarProps) {
  const [view, setView] = React.useState<'days' | 'monthYear'>('days');
  const [internalMonth, setInternalMonth] = React.useState<Date>(
    () => startOfMonth(controlledMonth ?? new Date())
  );

  React.useEffect(() => {
    if (controlledMonth) setInternalMonth(startOfMonth(controlledMonth));
  }, [controlledMonth]);

  React.useEffect(() => {
    setView('days');
  }, [enableMonthYearWheel]);

  const displayMonth = startOfMonth(controlledMonth ?? internalMonth);

  const setMonth = (next: Date) => {
    const normalized = startOfMonth(next);
    setInternalMonth(normalized);
    onMonthChange?.(normalized);
  };

  const startBound = startMonth ? startOfMonth(startMonth) : null;
  const endBound = endMonth ? startOfMonth(endMonth) : null;

  const canGoPrev =
    !startBound || monthKey(addMonths(displayMonth, -1)) >= monthKey(startBound);
  const canGoNext =
    !endBound || monthKey(addMonths(displayMonth, 1)) <= monthKey(endBound);

  const startYear = startMonth?.getFullYear() ?? displayMonth.getFullYear() - 100;
  const endYear = endMonth?.getFullYear() ?? displayMonth.getFullYear() + 5;

  const label = formatMonthYearCaption(displayMonth);

  if (enableMonthYearWheel && view === 'monthYear') {
    return (
      <div
        className={cn(
          'hcms-calendar w-[min(100%,19.5rem)] p-3 sm:p-3.5 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white',
          className
        )}
      >
        <button
          type="button"
          onClick={() => setView('days')}
          className="mb-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-white/5"
        >
          {label}
          <ChevronRight className="h-4 w-4 rotate-90 opacity-70" aria-hidden />
        </button>
        <MonthYearWheel
          value={displayMonth}
          startYear={startYear}
          endYear={endYear}
          onChange={setMonth}
        />
      </div>
    );
  }

  const navBtnClass = cn(
    'inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 dark:text-slate-400',
    'hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-white',
    'disabled:opacity-30 disabled:pointer-events-none disabled:hover:bg-transparent'
  );

  return (
    <div
      className={cn(
        'hcms-calendar w-[min(100%,19.5rem)] p-3 sm:p-3.5 rounded-xl bg-white dark:bg-slate-950 text-slate-900 dark:text-white',
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {enableMonthYearWheel ? (
          <button
            type="button"
            onClick={() => setView('monthYear')}
            className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-1 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label={`Choose month and year, currently ${label}`}
          >
            <span className="truncate">{label}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
          </button>
        ) : (
          <span className="px-1 text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            {label}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canGoPrev}
            className={navBtnClass}
            onClick={() => {
              if (!canGoPrev) return;
              setMonth(addMonths(displayMonth, -1));
            }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canGoNext}
            className={navBtnClass}
            onClick={() => {
              if (!canGoNext) return;
              setMonth(addMonths(displayMonth, 1));
            }}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <DayPicker
        showOutsideDays={showOutsideDays}
        weekStartsOn={1}
        month={displayMonth}
        onMonthChange={setMonth}
        startMonth={startMonth}
        endMonth={endMonth}
        hideNavigation
        className="w-full p-0"
        classNames={{
          months: 'relative flex flex-col',
          month: 'space-y-2',
          month_caption: 'hidden',
          caption_label: 'hidden',
          nav: 'hidden',
          button_previous: 'hidden',
          button_next: 'hidden',
          month_grid: 'w-full border-collapse',
          weekdays: 'flex w-full',
          weekday:
            'flex-1 text-center text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 py-1',
          week: 'mt-0.5 flex w-full',
          day: 'relative flex-1 p-0 text-center aspect-square',
          day_button: cn(
            'mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium',
            'text-slate-800 dark:text-white',
            'hover:bg-slate-100 dark:hover:bg-white/10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40'
          ),
          selected:
            '[&>button]:bg-slate-900 [&>button]:text-white [&>button]:hover:bg-slate-900 dark:[&>button]:bg-white dark:[&>button]:text-slate-950 dark:[&>button]:hover:bg-white',
          today: '[&>button]:ring-1 [&>button]:ring-slate-300 dark:[&>button]:ring-white/35',
          outside:
            '[&>button]:text-slate-300 dark:[&>button]:text-slate-600 [&>button]:opacity-80',
          disabled:
            '[&>button]:text-slate-300 dark:[&>button]:text-slate-700 [&>button]:opacity-40',
          hidden: 'invisible',
          ...classNames,
        }}
        components={components}
        {...props}
      />
    </div>
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
