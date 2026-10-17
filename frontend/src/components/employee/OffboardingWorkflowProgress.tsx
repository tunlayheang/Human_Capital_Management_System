import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

export type OffboardingWorkflowStep = {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
  hint?: string;
};

type Props = {
  steps: OffboardingWorkflowStep[];
  className?: string;
  variant?: 'chips' | 'pipeline';
  /** Max-width utility for the pipeline track. Defaults to a compact 2-step width. */
  widthClassName?: string;
  ariaLabel?: string;
};

export const OffboardingWorkflowProgress: React.FC<Props> = ({
  steps,
  className = '',
  variant = 'chips',
  widthClassName = 'max-w-md',
  ariaLabel = 'Workflow progress',
}) => {
  if (!steps.length) return null;

  if (variant === 'pipeline') {
    return (
      <ol
        className={`flex items-center gap-0 w-full ${widthClassName} ${className}`}
        aria-label={ariaLabel}
      >
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={step.id} className={`flex items-center ${isLast ? '' : 'flex-1 min-w-0'}`}>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                    step.done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : step.current
                        ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-400 ring-4 ring-primary-100 dark:ring-primary-900/30'
                        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-300'
                  }`}
                  title={step.hint}
                >
                  {step.done ? (
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
                  ) : (
                    <span className="text-[10px] font-bold">{i + 1}</span>
                  )}
                </span>
                <span
                  className={`text-[10px] font-semibold text-center leading-tight max-w-[5.5rem] ${
                    step.done
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : step.current
                        ? 'text-primary-700 dark:text-primary-300'
                        : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {!isLast ? (
                <div
                  className={`flex-1 h-0.5 mx-2 mb-4 rounded-full transition-colors ${
                    step.done ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol
      className={`flex flex-wrap items-center gap-2 text-[11px] ${className}`}
      aria-label={ariaLabel}
    >
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-slate-300 dark:text-slate-600">→</span> : null}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
              step.done
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                : step.current
                  ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-950/40 text-primary-800 dark:text-primary-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
            title={step.hint}
          >
            {step.done ? (
              <CheckCircle2 className="w-3 h-3" aria-hidden />
            ) : step.current ? (
              <Circle className="w-3 h-3 fill-primary-200 dark:fill-primary-800" aria-hidden />
            ) : (
              <Circle className="w-3 h-3" aria-hidden />
            )}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
};

export function buildOffboardingSteps(params: {
  settlementStatus?: string;
  t?: (key: string) => string;
}): OffboardingWorkflowStep[] {
  const st = String(params.settlementStatus ?? '').toUpperCase();
  const tr = params.t ?? ((s: string) => s);
  const settlementSaved = st === 'DRAFT' || Boolean(st && st !== 'REJECTED');
  const paymentDone = st === 'PAID' || st === 'LOCKED';
  const paymentAwaiting = st === 'PENDING_PAYROLL_OFFBOARD';

  const paymentLabel =
    st === 'LOCKED'
      ? tr('offboarding.hub.paymentNoPay')
      : paymentAwaiting
        ? tr('offboarding.hub.paymentAwaiting')
        : st === 'PAID'
          ? tr('offboarding.hub.paymentPaid')
          : tr('offboarding.hub.paymentPending');

  return [
    {
      id: 'settlement',
      label: settlementSaved
        ? tr('offboarding.hub.stepSettlementDone')
        : tr('offboarding.hub.stepSettlement'),
      done: settlementSaved,
      current: !settlementSaved,
    },
    {
      id: 'payment',
      label: paymentLabel,
      done: paymentDone,
      current: paymentAwaiting || (settlementSaved && !paymentDone),
    },
  ];
}

export default OffboardingWorkflowProgress;
