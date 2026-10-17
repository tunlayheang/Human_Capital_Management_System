import React from 'react';

type ProfileFieldProps = {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
};

export const ProfileField: React.FC<ProfileFieldProps> = ({
  label,
  hint,
  children,
  className = '',
}) => (
  <div className={className}>
    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
    </dt>
    <dd className="mt-0.5">{children}</dd>
    {hint ? (
      <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-500 leading-relaxed">{hint}</p>
    ) : null}
  </div>
);

type ProfileReadOnlyProps = {
  value: string;
  emptyLabel?: string;
  mono?: boolean;
};

export const ProfileReadOnly: React.FC<ProfileReadOnlyProps> = ({
  value,
  emptyLabel = '—',
  mono,
}) => {
  const trimmed = value?.trim();
  return (
    <div
      className={`text-sm min-h-[1.5rem] flex items-center break-words ${
        mono ? 'font-mono text-xs' : ''
      } ${
        trimmed
          ? 'text-slate-900 dark:text-white font-medium'
          : 'text-slate-400 dark:text-slate-500'
      }`}
    >
      {trimmed || emptyLabel}
    </div>
  );
};
