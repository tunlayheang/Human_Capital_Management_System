import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Layout = 'inline' | 'field';

export type ActiveStatusControlProps = {
  active: boolean;
  /** Controlled form change (immediate). Prefer `onRequestToggle` for async/list actions. */
  onChange?: (next: boolean) => void;
  /** Click handler when the control should open a confirm / async flow. */
  onRequestToggle?: () => void;
  disabled?: boolean;
  loading?: boolean;
  readOnly?: boolean;
  layout?: Layout;
  /** Override the default Active / Inactive label. */
  label?: string;
  description?: string;
  className?: string;
  size?: 'sm' | 'md';
};

/**
 * Shared Active / Inactive control used across rules & config screens.
 * Same visual language for list rows (`inline`) and edit forms (`field`).
 */
export const ActiveStatusControl: React.FC<ActiveStatusControlProps> = ({
  active,
  onChange,
  onRequestToggle,
  disabled = false,
  loading = false,
  readOnly = false,
  layout = 'inline',
  label,
  description,
  className = '',
  size = 'sm',
}) => {
  const interactive = !readOnly && !disabled && !loading && (onRequestToggle != null || onChange != null);
  const statusLabel = label ?? (active ? 'Active' : 'Inactive');

  const handleActivate = () => {
    if (!interactive) return;
    if (onRequestToggle) {
      onRequestToggle();
      return;
    }
    onChange?.(!active);
  };

  const switchSize =
    size === 'md'
      ? { track: 'h-7 w-12', thumb: 'h-6 w-6', on: 'translate-x-5', off: 'translate-x-0.5' }
      : { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-4', off: 'translate-x-0.5' };

  const switchEl = (
    <span
      className={cn(
        'relative inline-flex shrink-0 rounded-full border-2 border-transparent transition-colors',
        switchSize.track,
        active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        interactive ? 'cursor-pointer' : 'cursor-default'
      )}
      aria-hidden
    >
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-3 h-3 animate-spin text-white" />
        </span>
      ) : (
        <span
          className={cn(
            'pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition',
            switchSize.thumb,
            active ? switchSize.on : switchSize.off
          )}
        />
      )}
    </span>
  );

  if (layout === 'field') {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border px-3.5 py-3',
          active
            ? 'border-emerald-200/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
            : 'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40',
          className
        )}
      >
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={statusLabel}
          disabled={!interactive}
          onClick={handleActivate}
          className={cn(
            'mt-0.5 disabled:opacity-50',
            interactive ? '' : 'pointer-events-none'
          )}
        >
          {switchEl}
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm font-semibold',
              active
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-slate-700 dark:text-slate-200'
            )}
          >
            {statusLabel}
          </p>
          {description ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const Wrapper: React.ElementType = interactive ? 'button' : 'span';
  const wrapperProps = interactive
    ? {
        type: 'button' as const,
        role: 'switch' as const,
        'aria-checked': active,
        'aria-label': statusLabel,
        disabled: !interactive,
        onClick: handleActivate,
        title: active ? 'Set inactive' : 'Set active',
      }
    : {
        role: 'status' as const,
        'aria-label': statusLabel,
        title: statusLabel,
      };

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 transition-colors',
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300',
        interactive &&
          'hover:border-emerald-300 hover:bg-emerald-50/80 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/40',
        (!interactive || disabled) && 'opacity-70',
        className
      )}
    >
      {switchEl}
      <span className="text-xs font-semibold tracking-wide">{statusLabel}</span>
    </Wrapper>
  );
};
