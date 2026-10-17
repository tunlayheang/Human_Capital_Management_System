import { useEffect, useRef, useState, type RefObject } from 'react';
import { isStandaloneDisplay } from '../utils/device';

const PULL_THRESHOLD_PX = 72;
const MAX_PULL_PX = 120;
const RESISTANCE = 0.45;

export type PullToRefreshGestureState = {
  /** Visual pull distance (0–MAX_PULL). */
  pullDistance: number;
  /** Crossing threshold — ready to fire on release. */
  armed: boolean;
  refreshing: boolean;
};

type Options = {
  enabled: boolean;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
};

/**
 * iOS home-screen (standalone) has no Safari pull-to-refresh.
 * Attach to the Layout `<main>` scroll container for app-like pull-down reload.
 */
export function useMainPullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  options: Options
): PullToRefreshGestureState {
  const { enabled, refreshing, onRefresh } = options;
  const [pullDistance, setPullDistance] = useState(0);
  const [armed, setArmed] = useState(false);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const armedRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (el.scrollTop > 2) return;
      // Nested scrollables (chat panes, modals) own the gesture.
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-no-pull-refresh], [role="dialog"], .overscroll-contain')) {
        const nested = target.closest('.overflow-y-auto, .overflow-auto, [data-scroll-container]');
        if (nested && nested !== el) return;
      }
      startYRef.current = e.touches[0]?.clientY ?? 0;
      pullingRef.current = true;
      armedRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || refreshingRef.current) return;
      if (el.scrollTop > 2) {
        pullingRef.current = false;
        setPullDistance(0);
        setArmed(false);
        return;
      }
      const y = e.touches[0]?.clientY ?? 0;
      const delta = y - startYRef.current;
      if (delta <= 0) {
        setPullDistance(0);
        setArmed(false);
        armedRef.current = false;
        return;
      }
      const resisted = Math.min(MAX_PULL_PX, delta * RESISTANCE);
      setPullDistance(resisted);
      const nextArmed = resisted >= PULL_THRESHOLD_PX;
      if (nextArmed !== armedRef.current) {
        armedRef.current = nextArmed;
        setArmed(nextArmed);
        if (nextArmed && typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(8);
          } catch {
            /* ignore */
          }
        }
      }
      // Prevent rubber-band scroll fighting the custom indicator on iOS.
      if (resisted > 8 && e.cancelable) e.preventDefault();
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;
      const shouldRefresh = armedRef.current && !refreshingRef.current;
      armedRef.current = false;
      setArmed(false);
      if (shouldRefresh) {
        setPullDistance(PULL_THRESHOLD_PX * 0.65);
        void Promise.resolve(onRefreshRef.current()).finally(() => {
          setPullDistance(0);
        });
      } else {
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollRef, enabled]);

  useEffect(() => {
    if (!refreshing) setPullDistance(0);
  }, [refreshing]);

  return { pullDistance, armed, refreshing };
}

/** Prefer home-screen + compact phones/tablets (where native Safari PTR is absent). */
export function shouldEnablePullToRefresh(compactChrome: boolean): boolean {
  if (typeof window === 'undefined') return false;
  if (isStandaloneDisplay()) return true;
  return compactChrome;
}
