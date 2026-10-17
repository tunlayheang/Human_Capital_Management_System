import React from 'react';

/** Section card matching Employee profile detail layout. */
export const ProfileSectionCard: React.FC<{
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  /** Flatter panel without header chrome (e.g. nested content). */
  bare?: boolean;
  className?: string;
}> = ({ title, description, icon: Icon, children, bare = false, className = '' }) => {
  if (bare) {
    return <section className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4 ${className}`}>{children}</section>;
  }

  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 shadow-sm overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
        <Icon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          {description ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
};
