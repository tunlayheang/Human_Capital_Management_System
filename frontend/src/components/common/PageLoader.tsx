import React from 'react';
import { LoadingState, type LoadingStateAppearance } from './LoadingState';
import type { ContentSkeletonLayout } from './ContentSkeleton';

type Props = {
  label?: React.ReactNode;
  /**
   * Skeleton shape. Defaults to `dashboard` so route/auth gates inside the app
   * chrome never collapse to a bare spinner / Lottie.
   */
  layout?: ContentSkeletonLayout;
  rows?: number;
  /**
   * Force a spinner only for rare cases. Prefer omitting this prop inside Layout.
   */
  appearance?: LoadingStateAppearance;
  className?: string;
};

/**
 * In-layout loader for route gates and Suspense fallbacks.
 * Uses content skeletons — Lottie is reserved for pre-layout boot (AuthBootSplash / HTML).
 */
export const PageLoader: React.FC<Props> = ({
  label,
  layout = 'dashboard',
  rows,
  appearance,
  className = '',
}) => {
  if (appearance === 'spinner') {
    return (
      <div
        className={`flex items-center justify-center w-full h-full min-h-[200px] ${className}`}
      >
        <LoadingState variant="page" label={label} appearance="spinner" />
      </div>
    );
  }

  return (
    <LoadingState
      variant="page"
      label={label}
      layout={layout}
      rows={rows}
      appearance="skeleton"
      className={className}
    />
  );
};
