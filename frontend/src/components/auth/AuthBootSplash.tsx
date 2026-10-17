import React from 'react';
import { LottieLoadingSplash } from '../common/LottieLoadingSplash';

type Props = {
  className?: string;
  /** Optional status text under the animation (no branding). */
  label?: string;
};

/**
 * Full-screen Lottie boot splash — blank viewport only (no app chrome).
 * Used for HTML→React handoff, auth hydrate, login restore, and out-of-layout routes.
 * Never use inside Layout content; that stays on PageLoader skeletons.
 */
export const AuthBootSplash: React.FC<Props> = ({ className = '', label }) => (
  <LottieLoadingSplash fullScreen size="lg" className={className} label={label} />
);
