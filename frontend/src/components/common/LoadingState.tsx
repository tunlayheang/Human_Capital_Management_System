import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  ContentSkeleton,
  TableSkeletonRows,
  type ContentSkeletonLayout,
} from './ContentSkeleton';

export type LoadingStateVariant = 'page' | 'panel' | 'section' | 'inline' | 'compact';

export type LoadingStateAppearance = 'skeleton' | 'spinner';

export type LoadingStateProps = {
  label?: React.ReactNode;
  variant?: LoadingStateVariant;
  /** Skeleton shape to render. Falls back to a variant-appropriate default. */
  layout?: ContentSkeletonLayout;
  /**
   * Force a spinner only when explicitly requested (e.g. compact button rows).
   * Content areas default to skeleton.
   */
  appearance?: LoadingStateAppearance;
  rows?: number;
  /** Prepend fake list chrome (search/filter). Defaults on for full-page loads. */
  showChrome?: boolean;
  className?: string;
};

const variantStyles: Record<
  LoadingStateVariant,
  { wrap: string; spinner: string; text: string; row?: boolean }
> = {
  page: {
    wrap: 'flex flex-col items-center justify-center py-24',
    spinner: 'page-spinner',
    text: 'mt-4 text-sm font-medium text-slate-500 dark:text-slate-400',
  },
  panel: {
    wrap: 'flex flex-col items-center justify-center py-12',
    spinner: 'page-spinner',
    text: 'mt-3 text-sm font-medium text-slate-500 dark:text-slate-400',
  },
  section: {
    wrap: 'flex flex-col items-center justify-center py-10',
    spinner: 'page-spinner',
    text: 'mt-3 text-sm font-medium text-slate-500 dark:text-slate-400',
  },
  inline: {
    wrap: 'flex flex-col items-center justify-center py-8',
    spinner: 'w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin',
    text: 'mt-3 text-sm font-medium text-slate-500 dark:text-slate-400',
  },
  compact: {
    wrap: 'inline-flex items-center justify-center gap-2',
    spinner:
      'w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin shrink-0',
    text: 'text-sm font-medium text-slate-500 dark:text-slate-400',
    row: true,
  },
};

/** Variants that own content area get a layout skeleton by default. */
const skeletonLayoutByVariant: Partial<Record<LoadingStateVariant, ContentSkeletonLayout>> = {
  page: 'dashboard',
  panel: 'list',
  section: 'queue',
  inline: 'cards',
};

export const LoadingState: React.FC<LoadingStateProps> = ({
  label,
  variant = 'panel',
  layout,
  appearance,
  rows,
  showChrome,
  className = '',
}) => {
  const { t } = useLanguage();
  const text = label ?? t('common.retrievingData');
  const styles = variantStyles[variant] ?? variantStyles.panel;
  const defaultLayout = layout ?? skeletonLayoutByVariant[variant];
  // Compact stays spinner-friendly; everything else prefers skeleton unless forced.
  const showSkeleton =
    appearance === 'skeleton' ||
    (appearance !== 'spinner' && variant !== 'compact' && Boolean(defaultLayout));
  const chrome =
    showChrome ?? (variant === 'page' && (defaultLayout === 'list' || layout === 'list'));

  if (showSkeleton) {
    return (
      <ContentSkeleton
        layout={defaultLayout ?? 'list'}
        rows={rows}
        showChrome={chrome}
        label={label}
        className={className}
      />
    );
  }

  return (
    <div
      className={`${styles.wrap} ${className}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.spinner} aria-hidden />
      {text ? <p className={styles.text}>{text}</p> : null}
    </div>
  );
};

export function TableLoadingRow({
  colSpan,
  label,
  variant = 'inline',
  appearance,
  rows = 5,
  className = '',
}: {
  colSpan: number;
  label?: React.ReactNode;
  variant?: LoadingStateVariant;
  appearance?: LoadingStateAppearance;
  rows?: number;
  className?: string;
}) {
  if (appearance !== 'spinner') {
    return <TableSkeletonRows colSpan={colSpan} rows={rows} label={label} />;
  }
  return (
    <tr>
      <td colSpan={colSpan} className={className}>
        <LoadingState variant={variant} label={label} appearance="spinner" className="py-4" />
      </td>
    </tr>
  );
}
