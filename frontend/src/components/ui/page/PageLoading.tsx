import React from 'react';
import { LoadingState, type LoadingStateAppearance } from '../../common/LoadingState';
import type { ContentSkeletonLayout } from '../../common/ContentSkeleton';

type Props = {
  label?: string;
  layout?: ContentSkeletonLayout;
  appearance?: LoadingStateAppearance;
  rows?: number;
  className?: string;
};

/** Full-page content loading inside Layout — skeleton by default (not Lottie). */
export const PageLoading: React.FC<Props> = ({
  label,
  layout = 'dashboard',
  appearance,
  rows,
  className = '',
}) => (
  <LoadingState
    variant="page"
    label={label}
    layout={layout}
    appearance={appearance === 'spinner' ? 'spinner' : 'skeleton'}
    rows={rows}
    className={className}
  />
);
