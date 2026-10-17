import React from 'react';

type Props = {
  children: React.ReactNode;
  required?: boolean;
  className?: string;
};

/** Standard wizard field label with optional required asterisk. */
export const FieldLabel: React.FC<Props> = ({
  children,
  required = false,
  className = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5',
}) => (
  <label className={className}>
    {children}
    {required && (
      <span className="text-red-500 ml-0.5" aria-hidden>
        *
      </span>
    )}
  </label>
);
