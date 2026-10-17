import React from 'react';
import Lottie from 'lottie-react';
import loadingAnimation from '../../assets/lottie/loading.json';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  className?: string;
  /** Full viewport (auth / first paint). Otherwise fills the parent area. */
  fullScreen?: boolean;
  size?: Size;
  label?: React.ReactNode;
};

const sizeClass: Record<Size, string> = {
  sm: 'h-28 w-28 sm:h-32 sm:w-32',
  md: 'h-40 w-40 sm:h-48 sm:w-48',
  lg: 'h-44 w-44 sm:h-56 sm:w-56',
};

/**
 * Shared Lottie loading surface — no logo / title / progress chrome.
 */
export const LottieLoadingSplash: React.FC<Props> = ({
  className = '',
  fullScreen = false,
  size = 'md',
  label,
}) => {
  return (
    <div
      className={
        fullScreen
          ? `hcms-boot-splash relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-slate-50 dark:bg-slate-950 ${className}`
          : `flex w-full min-h-[min(50vh,28rem)] flex-col items-center justify-center bg-transparent ${className}`
      }
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={typeof label === 'string' ? label : 'Loading'}
    >
      {fullScreen ? (
        <>
          <div className="hcms-boot-splash-orb hcms-boot-splash-orb--a" aria-hidden />
          <div className="hcms-boot-splash-orb hcms-boot-splash-orb--b" aria-hidden />
        </>
      ) : null}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <Lottie
          animationData={loadingAnimation}
          loop
          autoplay
          className={sizeClass[size]}
          aria-hidden
        />
        {label ? (
          <p className="-mt-2 text-sm text-slate-500 dark:text-slate-400">{label}</p>
        ) : null}
      </div>
    </div>
  );
};
