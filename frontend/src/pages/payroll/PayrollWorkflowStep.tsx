import React, { useEffect, useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../utils';

export type PayrollWorkflowStepStatus = 'upcoming' | 'current' | 'done';

type Props = {
  step: number;
  title: string;
  description?: string;
  status: PayrollWorkflowStepStatus;
  action?: React.ReactNode;
  children?: React.ReactNode;
  isLast?: boolean;
  /** When set, overrides the default open/closed state derived from status. */
  defaultOpen?: boolean;
};

function stepIndicatorClass(status: PayrollWorkflowStepStatus): string {
  if (status === 'done') {
    return 'bg-emerald-500 text-white ring-4 ring-emerald-500/15';
  }
  if (status === 'current') {
    return 'bg-primary-600 text-white ring-4 ring-primary-500/20';
  }
  return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
}

export const PayrollWorkflowStep: React.FC<Props> = ({
  step,
  title,
  description,
  status,
  action,
  children,
  isLast = false,
  defaultOpen,
}) => {
  const muted = status === 'upcoming';
  const panelId = useId();
  const hasBody = Boolean(children);
  const [open, setOpen] = useState(() =>
    defaultOpen != null ? defaultOpen : status !== 'upcoming'
  );

  // Keep the active step expanded when workflow advances.
  useEffect(() => {
    if (status === 'current') setOpen(true);
  }, [status]);

  return (
    <section
      className={cn(
        !isLast && 'border-b border-slate-100 dark:border-slate-800',
        muted && 'opacity-80'
      )}
      aria-current={status === 'current' ? 'step' : undefined}
    >
      <div
        className={cn(
          'px-5 py-3.5 flex flex-row items-start sm:items-center justify-between gap-3',
          status === 'current'
            ? 'bg-primary-50/40 dark:bg-primary-950/15'
            : 'bg-slate-50/50 dark:bg-slate-900/25'
        )}
      >
        <button
          type="button"
          className={cn(
            'flex items-start gap-3 min-w-0 flex-1 text-left rounded-lg -mx-1 px-1 py-0.5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/35',
            hasBody ? 'cursor-pointer' : 'cursor-default'
          )}
          aria-expanded={hasBody ? open : undefined}
          aria-controls={hasBody ? panelId : undefined}
          disabled={!hasBody}
          onClick={() => {
            if (hasBody) setOpen((v) => !v);
          }}
        >
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              stepIndicatorClass(status)
            )}
          >
            {status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
              {hasBody ? (
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                    open ? 'rotate-0' : '-rotate-90'
                  )}
                  aria-hidden
                />
              ) : null}
            </div>
            {description ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                {description}
              </p>
            ) : null}
          </div>
        </button>
        {action ? (
          <div
            className="flex flex-wrap items-center justify-end gap-2 shrink-0 mt-0.5 sm:mt-0 sm:ml-4"
            onClick={(e) => e.stopPropagation()}
          >
            {action}
          </div>
        ) : null}
      </div>
      {hasBody ? (
        <div
          id={panelId}
          hidden={!open}
          className={cn(!open && 'hidden')}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
