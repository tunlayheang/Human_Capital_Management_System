import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useHorizontalScrollOverflow } from '../../../hooks/useHorizontalScrollOverflow';
import { HorizontalScrollArrow } from '../HorizontalScrollArrow';

export type PillSegmentTabItem<T extends string = string> = {
  id: T;
  label: ReactNode;
  icon?: ElementType | ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  badge?: number | string;
};

type Props<T extends string> = {
  value: T;
  onChange: (id: T) => void;
  tabs: PillSegmentTabItem<T>[];
  ariaLabel: string;
  className?: string;
  /** Stretch tabs evenly across the container width */
  fullWidth?: boolean;
  size?: 'sm' | 'md';
};

type IndicatorRect = { left: number; top: number; width: number; height: number };

const INDICATOR_CLASS =
  'absolute left-0 top-0 rounded-full glass-pill-active pointer-events-none z-0 will-change-transform';

/** Outer pill track shell (arrows + scroll area). */
export const pillSegmentTabsTrackClass =
  'glass-pill-track inline-flex max-w-full min-w-0 items-center';

/** Inner scrollable tab row — scrollbar hidden; use arrow buttons when overflowing. */
export const pillSegmentTabsScrollClass =
  'relative flex min-w-0 flex-1 items-center overflow-x-auto hcms-scrollbar-hidden gap-0.5 sm:gap-1';

/** @deprecated Use pillSegmentTabsTrackClass + pillSegmentTabsScrollClass */
export const pillSegmentTabsListClass = pillSegmentTabsTrackClass;

export const pillSegmentTabTriggerBaseClass =
  'group relative z-10 inline-flex items-center justify-center gap-1 sm:gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-primary-400/40 dark:focus-visible:ring-offset-slate-900';

export function pillSegmentTabBadgeClass(active: boolean): string {
  return [
    'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors duration-200',
    active
      ? 'bg-white/25 text-white'
      : 'bg-slate-200/90 text-slate-600 dark:bg-slate-700/90 dark:text-slate-200',
  ].join(' ');
}

export function pillSegmentTabTriggerClass(
  active: boolean,
  size: 'sm' | 'md',
  fullWidth: boolean
): string {
  return [
    fullWidth ? 'flex-1 min-w-0' : 'shrink-0 min-w-[8.5rem] sm:min-w-[9.5rem]',
    pillSegmentTabTriggerBaseClass,
    size === 'sm'
      ? 'px-2.5 py-1 text-[11px] min-h-[28px] xs:px-3 xs:py-1.5 xs:text-xs xs:min-h-[32px] xs:min-w-[7rem] sm:min-w-[8rem]'
      : 'px-3 py-1.5 text-xs min-h-[32px] sm:px-4 sm:py-2 sm:text-sm sm:min-h-[36px] md:min-h-[40px]',
    active
      ? 'text-white font-semibold'
      : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100 hover:bg-white/45 dark:hover:bg-white/5',
  ].join(' ');
}

function renderTabIcon(icon?: ElementType | ReactNode, active?: boolean) {
  if (!icon) return null;
  const iconClass = [
    'w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-colors duration-200',
    active
      ? 'text-white'
      : 'text-slate-500 group-hover:text-slate-600 dark:text-slate-400 dark:group-hover:text-slate-200',
  ].join(' ');
  if (React.isValidElement(icon)) {
    return React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
      className: iconClass,
    });
  }
  const Icon = icon as ElementType;
  return <Icon className={iconClass} aria-hidden />;
}

function readIndicatorRect(list: HTMLElement, btn: HTMLElement): IndicatorRect {
  // Prefer layout offsets (stable while scrolling). Fall back to viewport math
  // when offsetParent is unexpected (transformed ancestors, etc.).
  if (btn.offsetParent === list || btn.parentElement === list) {
    return {
      left: Math.round(btn.offsetLeft),
      top: Math.round(btn.offsetTop),
      width: Math.round(btn.offsetWidth),
      height: Math.round(btn.offsetHeight),
    };
  }
  const listRect = list.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  return {
    left: Math.round(btnRect.left - listRect.left + list.scrollLeft),
    top: Math.round(btnRect.top - listRect.top + list.scrollTop),
    width: Math.round(btnRect.width),
    height: Math.round(btnRect.height),
  };
}

function sameRect(a: IndicatorRect | null, b: IndicatorRect): boolean {
  return (
    !!a &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

function useSlidingIndicator(activeId: string, tabCount: number) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<IndicatorRect | null>(null);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    const btn = tabRefs.current.get(activeId);
    if (!list || !btn) return;
    const next = readIndicatorRect(list, btn);
    if (next.width <= 0 || next.height <= 0) return;
    setIndicator((prev) => (sameRect(prev, next) ? prev : next));
  }, [activeId]);

  const measureSoon = useCallback(() => {
    measure();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      measure();
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        measure();
      });
    });
  }, [measure]);

  useLayoutEffect(() => {
    measureSoon();
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [measureSoon, tabCount]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const ro = new ResizeObserver(() => measureSoon());
    ro.observe(list);
    for (const btn of tabRefs.current.values()) {
      ro.observe(btn);
    }

    const onScrollEnd = () => measure();
    window.addEventListener('resize', measureSoon);
    // Remeasure after scroll settles — not on every scroll frame (avoids mid-glitch).
    list.addEventListener('scrollend', onScrollEnd);
    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(measureSoon);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measureSoon);
      list.removeEventListener('scrollend', onScrollEnd);
    };
  }, [measure, measureSoon, activeId, tabCount]);

  const setTabRef = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node) tabRefs.current.set(id, node);
      else tabRefs.current.delete(id);
    },
    []
  );

  const getActiveTab = useCallback(
    () => tabRefs.current.get(activeId),
    [activeId]
  );

  return { listRef, setTabRef, indicator, measure: measureSoon, getActiveTab };
}

export function PillSegmentTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
  className = '',
  fullWidth = false,
  size = 'md',
}: Props<T>) {
  const reduceMotion = useReducedMotion();
  const visible = tabs.filter((tab) => !tab.hidden);
  const { listRef, setTabRef, indicator, measure, getActiveTab } = useSlidingIndicator(
    value,
    visible.length
  );
  const { canScrollLeft, canScrollRight, scrollByPage, scrollChildIntoView, update } =
    useHorizontalScrollOverflow(listRef, [visible.length, value]);

  // Only snap the active tab into view when selection changes — not when the
  // user pans with the scroll arrows (those must be free to leave the active chip off-screen).
  useLayoutEffect(() => {
    scrollChildIntoView(getActiveTab(), reduceMotion ? 'auto' : 'smooth');
    requestAnimationFrame(() => {
      update();
      measure();
    });
  }, [value, reduceMotion, getActiveTab, scrollChildIntoView, update, measure]);

  if (visible.length <= 1) return null;

  const indicatorTransition = reduceMotion
    ? 'none'
    : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1)';

  return (
    <div
      className={`${pillSegmentTabsTrackClass} ${fullWidth ? 'flex w-full' : 'w-fit max-w-full'} ${className}`.trim()}
    >
      {canScrollLeft ? (
        <HorizontalScrollArrow direction="left" onClick={() => scrollByPage(-1)} variant="pill" />
      ) : null}

      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className={`${pillSegmentTabsScrollClass} ${fullWidth ? '[&>button]:flex-1 [&>button]:min-w-0' : ''}`.trim()}
      >
        {indicator && indicator.width > 0 ? (
          <span
            aria-hidden
            className={INDICATOR_CLASS}
            style={{
              width: indicator.width,
              height: indicator.height,
              transform: `translate(${indicator.left}px, ${indicator.top}px)`,
              transition: indicatorTransition,
            }}
          />
        ) : null}

        {visible.map((tab) => {
          const active = value === tab.id;
          return (
            <button
              key={tab.id}
              ref={setTabRef(tab.id)}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => {
                onChange(tab.id);
                requestAnimationFrame(() => {
                  measure();
                  scrollChildIntoView(getActiveTab(), reduceMotion ? 'auto' : 'smooth');
                });
              }}
              className={`${pillSegmentTabTriggerClass(active, size, fullWidth)} disabled:opacity-50 disabled:pointer-events-none`}
            >
              {renderTabIcon(tab.icon, active)}
              <span>{tab.label}</span>
              {tab.badge != null && String(tab.badge).length > 0 ? (
                <span className={pillSegmentTabBadgeClass(active)}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {canScrollRight ? (
        <HorizontalScrollArrow direction="right" onClick={() => scrollByPage(1)} variant="pill" />
      ) : null}
    </div>
  );
}
