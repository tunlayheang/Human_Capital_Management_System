import React from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { SettlementPayStatementModel } from '../../payroll/settlementPayStatement';
import { formatDisplayDate } from '../../offboarding/settlementFormUtils';

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n < 0) return `−$${formatted}`;
  return `$${formatted}`;
}

type Props = {
  statement: SettlementPayStatementModel;
  className?: string;
  defaultOpen?: boolean;
};

export const SettlementPayStatement: React.FC<Props> = ({
  statement,
  className = '',
  defaultOpen = true,
}) => {
  const { verification } = statement;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-lg border-2 border-primary-200 dark:border-primary-800 bg-white dark:bg-slate-900 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Final pay statement
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
          Month {statement.month}
          {statement.lastWorkingDate
            ? ` · Last working day ${formatDisplayDate(statement.lastWorkingDate)}`
            : ''}
        </p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-2">
          {formatUsd(statement.netPayable)}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Net amount to pay separately (Option A) — not via monthly payroll batch
        </p>
      </div>

      <details open={defaultOpen} className="group">
        <summary className="text-xs font-semibold cursor-pointer list-none flex items-center gap-1 select-none text-slate-700 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
          <span className="opacity-60 group-open:rotate-90 transition-transform inline-block" aria-hidden>
            ▸
          </span>
          How this amount is calculated
        </summary>
        <div className="mt-2 space-y-4">
          {statement.sections.map((section) => (
            <div
              key={section.id}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-3 py-2.5"
            >
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{section.title}</p>
              {section.subtitle ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                  {section.subtitle}
                </p>
              ) : null}
              {section.rows.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {section.rows.map((row) => (
                    <li key={row.label} className="text-xs">
                      <div className="flex justify-between gap-3 tabular-nums">
                        <span className="text-slate-700 dark:text-slate-300">{row.label}</span>
                        <span
                          className={
                            row.amount < 0
                              ? 'text-red-700 dark:text-red-300 shrink-0'
                              : 'shrink-0'
                          }
                        >
                          {formatUsd(row.amount)}
                        </span>
                      </div>
                      {row.hint ? (
                        <p className="text-[10px] text-slate-500 mt-0.5">{row.hint}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex justify-between gap-3 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-xs font-semibold tabular-nums">
                <span className="text-slate-800 dark:text-slate-200">{section.subtotalLabel}</span>
                <span>{formatUsd(section.subtotal)}</span>
              </div>
            </div>
          ))}

          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2.5 text-xs space-y-1">
            <p className="font-semibold text-slate-900 dark:text-white">Check (must balance)</p>
            <p className="tabular-nums text-slate-700 dark:text-slate-300">
              Net salary (work) {formatUsd(verification.workNet)}
              {verification.adjustments >= 0 ? ' + ' : ' − '}
              adjustments {formatUsd(Math.abs(verification.adjustments))}
              {' = '}
              <span className="font-semibold">{formatUsd(statement.netPayable)}</span>
            </p>
            {verification.matches ? (
              <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
                Figures reconcile
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                Totals do not match — refresh preview or contact finance
              </p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
};

export default SettlementPayStatement;
