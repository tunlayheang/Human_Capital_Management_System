import React from 'react';

type Props = {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Optional hint — shown on lg+ between back and actions. */
  hint?: React.ReactNode;
};

/** Two-column wizard footer: back (left) and primary actions (right), compact on mobile. */
export const WizardFooterLayout: React.FC<Props> = ({ left, right, hint }) => (
  <div className="flex w-full min-w-0 flex-row items-center justify-between gap-1.5 xs:gap-2 sm:gap-3">
    <div className="shrink-0 min-w-0">{left}</div>
    {hint ? (
      <p className="hidden lg:block flex-1 min-w-0 px-2 text-xs text-slate-500 text-center truncate">
        {hint}
      </p>
    ) : null}
    <div className="ml-auto min-w-0 flex flex-nowrap items-center justify-end gap-1.5 xs:gap-2 [&>button]:shrink-0 [&>a]:shrink-0">
      {right}
    </div>
  </div>
);
