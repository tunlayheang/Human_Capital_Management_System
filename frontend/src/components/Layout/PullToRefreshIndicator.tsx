import React from 'react';
import { Loader2, ArrowDown } from 'lucide-react';
import type { PullToRefreshGestureState } from '../../hooks/useMainPullToRefresh';

type Props = {
  state: PullToRefreshGestureState;
};

/** Compact app-like pull indicator under the sticky header. */
export const PullToRefreshIndicator: React.FC<Props> = ({ state }) => {
  const { pullDistance, armed, refreshing } = state;
  const visible = refreshing || pullDistance > 4;
  if (!visible) return null;

  const height = refreshing ? 40 : Math.max(0, pullDistance);
  const progress = Math.min(1, pullDistance / 72);

  return (
    <div
      className="pointer-events-none sticky top-0 z-20 flex justify-center overflow-hidden transition-[height] duration-150 ease-out"
      style={{ height }}
      aria-hidden={!refreshing}
      aria-live={refreshing ? 'polite' : undefined}
    >
      <div className="flex items-center justify-center gap-1.5 text-teal-700 dark:text-teal-300">
        {refreshing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Refreshing</span>
          </>
        ) : (
          <>
            <ArrowDown
              className={`h-4 w-4 transition-transform duration-150 ${armed ? 'rotate-180' : ''}`}
              style={{ opacity: 0.35 + progress * 0.65 }}
            />
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ opacity: 0.35 + progress * 0.65 }}
            >
              {armed ? 'Release' : 'Pull'}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
