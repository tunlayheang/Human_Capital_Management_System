import * as React from 'react';
import { cn } from '@/lib/utils';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const ITEM_H = 40;
const VISIBLE = 5;

type MonthYearWheelProps = {
  value: Date;
  onChange: (next: Date) => void;
  startYear: number;
  endYear: number;
  className?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function WheelColumn({
  items,
  selectedIndex,
  onSelect,
  align = 'left',
  'aria-label': ariaLabel,
}: {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  align?: 'left' | 'right';
  'aria-label': string;
}) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const ignoreScroll = React.useRef(false);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    ignoreScroll.current = true;
    el.scrollTop = selectedIndex * ITEM_H;
    const t = window.setTimeout(() => {
      ignoreScroll.current = false;
    }, 80);
    return () => window.clearTimeout(t);
  }, [selectedIndex, items.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || ignoreScroll.current) return;
    const idx = clamp(Math.round(el.scrollTop / ITEM_H), 0, items.length - 1);
    if (idx !== selectedIndex) onSelect(idx);
  };

  const pad = Math.floor(VISIBLE / 2) * ITEM_H;

  return (
    <div className="relative flex-1 min-w-0 h-full" aria-label={ariaLabel}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain snap-y snap-mandatory scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingTop: pad, paddingBottom: pad }}
      >
        {items.map((label, i) => {
          const dist = Math.abs(i - selectedIndex);
          const opacity = dist === 0 ? 1 : dist === 1 ? 0.55 : dist === 2 ? 0.28 : 0.12;
          const scale = dist === 0 ? 1 : dist === 1 ? 0.94 : 0.88;
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              className={cn(
                'w-full h-10 snap-center flex items-center px-3 sm:px-4 text-[15px] sm:text-base transition-[opacity,transform] duration-150',
                align === 'right' ? 'justify-end text-right' : 'justify-start text-left',
                dist === 0
                  ? 'font-semibold text-slate-900 dark:text-white'
                  : 'font-normal text-slate-500 dark:text-slate-400'
              )}
              style={{ opacity, transform: `scale(${scale})` }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** iOS-style month + year tumbler for calendar caption. */
export function MonthYearWheel({
  value,
  onChange,
  startYear,
  endYear,
  className,
}: MonthYearWheelProps) {
  const years = React.useMemo(() => {
    const list: number[] = [];
    const from = Math.min(startYear, endYear);
    const to = Math.max(startYear, endYear);
    for (let y = to; y >= from; y -= 1) list.push(y);
    return list;
  }, [startYear, endYear]);

  const monthIndex = value.getMonth();
  const yearIndex = Math.max(
    0,
    years.findIndex((y) => y === value.getFullYear())
  );

  const commit = (nextMonth: number, nextYear: number) => {
    const day = Math.min(
      value.getDate(),
      new Date(nextYear, nextMonth + 1, 0).getDate()
    );
    onChange(new Date(nextYear, nextMonth, day, 12, 0, 0));
  };

  return (
    <div
      className={cn(
        'relative w-full select-none',
        className
      )}
      style={{ height: ITEM_H * VISIBLE }}
    >
      {/* Selection band */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 top-1/2 z-[1] h-10 -translate-y-1/2 rounded-full bg-slate-200/90 dark:bg-white/15"
      />
      {/* Edge fades */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-12 bg-gradient-to-b from-white via-white/80 to-transparent dark:from-slate-950 dark:via-slate-950/80"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-12 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-slate-950 dark:via-slate-950/80"
      />

      <div className="relative z-0 flex h-full gap-1 px-1">
        <WheelColumn
          aria-label="Month"
          items={[...MONTHS]}
          selectedIndex={monthIndex}
          onSelect={(i) => commit(i, years[yearIndex] ?? value.getFullYear())}
          align="left"
        />
        <WheelColumn
          aria-label="Year"
          items={years.map(String)}
          selectedIndex={yearIndex < 0 ? 0 : yearIndex}
          onSelect={(i) => commit(monthIndex, years[i] ?? value.getFullYear())}
          align="right"
        />
      </div>
    </div>
  );
}

export function formatMonthYearCaption(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
