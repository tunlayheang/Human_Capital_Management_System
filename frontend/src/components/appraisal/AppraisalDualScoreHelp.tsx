import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatAppraisalScore } from '../../types/appraisal';
import { formatDualScoreFormula, type DualScoreSummary } from './appraisalDualScore';

type Props = {
  componentName: string;
  summary?: DualScoreSummary;
  autoCalculated?: boolean;
  variant?: 'component' | 'overview';
  className?: string;
};

export const AppraisalDualScoreHelp: React.FC<Props> = ({
  componentName,
  summary,
  autoCalculated = false,
  variant = 'component',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        top: Math.min(rect.bottom + 8, window.innerHeight - 280),
        left: Math.min(Math.max(12, rect.left - 180), window.innerWidth - 320),
        width: 300,
        zIndex: 9999,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const panel = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      style={panelStyle}
      className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/60">
        <h4 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white">
          How this score is calculated
        </h4>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{componentName}</p>
      </div>
      <div className="px-4 py-3 space-y-3 text-xs text-slate-600 dark:text-slate-300">
        {variant === 'overview' ? (
          <>
            <p>
              HR routes one or more management evaluators in order. Each evaluator scores manual KPI
              components independently; their scores are averaged together for the management
              perspective.
            </p>
            <p className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-3 py-2 font-mono text-[11px] leading-relaxed">
              Average per component = mean(management evaluator scores, employee self-score when
              submitted)
            </p>
            <p className="text-slate-500">
              Auto KPI components use the engine score for each evaluator. After employee
              self-evaluation, the employee score is included in the combined average.
            </p>
          </>
        ) : summary ? (
          <>
            {summary.isAutoCalculated ? (
              <p>
                Auto KPI components use the same engine score unless evaluators captured different
                snapshots during their reviews.
              </p>
            ) : (
              <p>
                Manual KPI scores are averaged across every management evaluator who scored this
                component, then combined with the employee self-rating when submitted.
              </p>
            )}
            <dl className="space-y-2">
              {summary.evaluatorColumns.map((col) => (
                <div key={col.userId} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{col.label}</dt>
                  <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                    {col.score != null ? formatAppraisalScore(col.score) : '—'}
                  </dd>
                </div>
              ))}
              {!summary.evaluatorColumns.length &&
              summary.hasManagerScore &&
              summary.managerScore != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Management average</dt>
                  <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatAppraisalScore(summary.managerScore)}
                  </dd>
                </div>
              ) : null}
              {summary.isAutoCalculated &&
              summary.autoBaselineScore != null &&
              !summary.evaluatorColumns.length ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Auto score</dt>
                  <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatAppraisalScore(summary.autoBaselineScore)}
                  </dd>
                </div>
              ) : null}
              {summary.hasEmployeeScore && summary.employeeScore != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Employee score</dt>
                  <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatAppraisalScore(summary.employeeScore)}
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
                <dt className="font-medium text-slate-700 dark:text-slate-200">Average shown</dt>
                <dd className="font-bold tabular-nums text-primary-600 dark:text-primary-400">
                  {formatAppraisalScore(summary.averageScore)}
                </dd>
              </div>
            </dl>
            <p className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 px-3 py-2 font-mono text-[11px] leading-relaxed">
              {formatDualScoreFormula(summary)}
            </p>
          </>
        ) : null}
      </div>
      <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
        <button
          type="button"
          onClick={close}
          className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
        >
          Close
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`How ${componentName} average is calculated`}
        title={`How ${componentName} average is calculated`}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300/80 bg-white text-[10px] font-semibold text-slate-400 leading-none hover:text-slate-600 hover:border-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-400/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500 dark:hover:text-slate-300 align-middle ${className}`}
      >
        !
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
};
