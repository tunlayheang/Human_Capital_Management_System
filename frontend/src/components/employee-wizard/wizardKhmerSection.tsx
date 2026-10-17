import React from 'react';
import { cn } from '../../utils';

/** Tighter field grid for Khmer subsections — matches the compact card body. */
export function WizardKhmerFieldGrid({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3', className)}>
      {children}
    </div>
  );
}

/**
 * Khmer fields block under English fields.
 * Accent bar only — no header icons / title chrome.
 */
export function WizardKhmerSubsection({
  children,
  className = '',
  /** @deprecated Kept for call-site compatibility; header chrome was removed. */
  titleKey: _titleKey,
  /** @deprecated Kept for call-site compatibility; header chrome was removed. */
  descriptionKey: _descriptionKey,
}: {
  children: React.ReactNode;
  titleKey?: string;
  descriptionKey?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700/80',
        'bg-white dark:bg-slate-900/50 shadow-sm',
        'md:col-span-2',
        className
      )}
    >
      <div
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary-400 via-primary-500 to-primary-600"
        aria-hidden
      />
      <div className="khmer-subsection-fields px-4 py-3.5 pl-5 font-khmer">{children}</div>
    </div>
  );
}
