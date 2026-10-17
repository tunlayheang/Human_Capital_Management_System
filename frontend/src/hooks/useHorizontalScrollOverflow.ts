import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export type HorizontalScrollState = {
  /** Content is wider than the visible strip. */
  hasOverflow: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

const EDGE_EPSILON = 2;

function readScrollState(el: HTMLElement): HorizontalScrollState {
  const { scrollLeft, scrollWidth, clientWidth } = el;
  const hasOverflow = scrollWidth > clientWidth + EDGE_EPSILON;
  return {
    hasOverflow,
    canScrollLeft: hasOverflow && scrollLeft > EDGE_EPSILON,
    canScrollRight: hasOverflow && scrollLeft + clientWidth < scrollWidth - EDGE_EPSILON,
  };
}

export function useHorizontalScrollOverflow<T extends HTMLElement>(
  scrollRef: RefObject<T | null>,
  deps: unknown[] = []
) {
  const [state, setState] = useState<HorizontalScrollState>({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });
  const rafRef = useRef<number | null>(null);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setState({ hasOverflow: false, canScrollLeft: false, canScrollRight: false });
      return;
    }
    const next = readScrollState(el);
    setState((prev) =>
      prev.hasOverflow === next.hasOverflow &&
      prev.canScrollLeft === next.canScrollLeft &&
      prev.canScrollRight === next.canScrollRight
        ? prev
        : next
    );
  }, [scrollRef]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      update();
    });
  }, [update]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const runUpdate = () => scheduleUpdate();

    runUpdate();
    const raf2 = requestAnimationFrame(runUpdate);

    const ro = new ResizeObserver(runUpdate);
    ro.observe(el);
    const parent = el.parentElement;
    if (parent) ro.observe(parent);

    const mo = new MutationObserver(runUpdate);
    mo.observe(el, { childList: true, subtree: true, attributes: true });

    el.addEventListener('scroll', runUpdate, { passive: true });
    el.addEventListener('scrollend', runUpdate);
    window.addEventListener('resize', runUpdate);

    const fontsReady = document.fonts?.ready;
    if (fontsReady) void fontsReady.then(runUpdate);

    return () => {
      cancelAnimationFrame(raf2);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', runUpdate);
      el.removeEventListener('scrollend', runUpdate);
      window.removeEventListener('resize', runUpdate);
    };
  }, [scrollRef, scheduleUpdate, ...deps]);

  const scrollByPage = useCallback(
    (direction: -1 | 1) => {
      const el = scrollRef.current;
      if (!el) return;

      const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const amount = Math.max(el.clientWidth * 0.7, 112);
      const nextLeft = Math.max(0, Math.min(el.scrollLeft + direction * amount, maxLeft));

      el.scrollTo({ left: nextLeft, behavior: 'smooth' });

      if (!('onscrollend' in el)) {
        window.setTimeout(scheduleUpdate, 320);
      }
    },
    [scrollRef, scheduleUpdate]
  );

  const scrollChildIntoView = useCallback(
    (child: HTMLElement | null | undefined, behavior: ScrollBehavior = 'smooth') => {
      const el = scrollRef.current;
      if (!el || !child) return;

      const pad = 36;
      const childLeft = child.offsetLeft;
      const childRight = childLeft + child.offsetWidth;
      const viewLeft = el.scrollLeft;
      const viewRight = viewLeft + el.clientWidth;

      if (childLeft < viewLeft + pad) {
        el.scrollTo({ left: Math.max(0, childLeft - pad), behavior });
      } else if (childRight > viewRight - pad) {
        el.scrollTo({
          left: Math.max(0, childRight - el.clientWidth + pad),
          behavior,
        });
      }

      scheduleUpdate();
    },
    [scrollRef, scheduleUpdate]
  );

  return { ...state, update: scheduleUpdate, scrollByPage, scrollChildIntoView };
}
