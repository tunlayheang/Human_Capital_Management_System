import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Api } from '../../services/api';
import { formatAppraisalScore } from '../../types/appraisal';
import type { KpiAutoMetric } from '../../types/appraisal';

type PreviewData = {
  score: number;
  breakdown: Record<string, number>;
};

type Props = {
  userId: string;
  periodId: string;
  metric: Exclude<KpiAutoMetric, null>;
  componentName: string;
  periodLabel?: string;
};

function metricTitle(metric: Exclude<KpiAutoMetric, null>): string {
  return metric === 'ATTENDANCE' ? 'Attendance KPI engine' : 'Task completion KPI engine';
}

function metricSummary(metric: Exclude<KpiAutoMetric, null>): string {
  if (metric === 'ATTENDANCE') {
    return 'Starts at 100 for the appraisal period, then subtracts points from configured attendance deduction rules (late, absence, early leave, unpaid leave).';
  }
  return 'Uses tasks assigned to this employee during the appraisal period: on-time completion rate minus 5 points per overdue open task.';
}

function breakdownRows(metric: Exclude<KpiAutoMetric, null>, breakdown: Record<string, number>) {
  if (metric === 'ATTENDANCE') {
    return [
      { label: 'Present days', value: breakdown.presentDays ?? 0 },
      { label: 'Late days', value: breakdown.lateDays ?? 0 },
      { label: 'Absent days', value: breakdown.absentDays ?? 0 },
      { label: 'Early leave days', value: breakdown.earlyLeaveDays ?? 0 },
      { label: 'Unpaid leave days', value: breakdown.unpaidLeaveDays ?? 0 },
    ];
  }
  return [
    { label: 'Tasks assigned', value: breakdown.assigned ?? 0 },
    { label: 'Completed', value: breakdown.completed ?? 0 },
    { label: 'Completed on time', value: breakdown.completedOnTime ?? 0 },
    { label: 'Overdue (open)', value: breakdown.overdue ?? 0 },
  ];
}

function formulaNote(metric: Exclude<KpiAutoMetric, null>, breakdown: Record<string, number>): string {
  if (metric === 'ATTENDANCE') {
    return 'Score = 100 − deductions from Payroll → Rules → KPI settings → Attendance deduction rules (range or per-occurrence).';
  }
  const assigned = breakdown.assigned ?? 0;
  const onTime = breakdown.completedOnTime ?? 0;
  const overdue = breakdown.overdue ?? 0;
  if (assigned === 0) {
    return 'No tasks in period → default score 100.';
  }
  const rate = ((onTime / assigned) * 100).toFixed(1);
  return `Score ≈ (${onTime} ÷ ${assigned}) × 100 − (${overdue} × 5) = ${rate}% − ${overdue * 5} → clamped 0–100.`;
}

export const AutomaticKpiCalculationHelp: React.FC<Props> = ({
  userId,
  periodId,
  metric,
  componentName,
  periodLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void Api.appraisal
      .previewAutomatic(userId, periodId, metric)
      .then((res) => setPreview(res as PreviewData))
      .catch((e: unknown) => {
        setPreview(null);
        setError(e instanceof Error ? e.message : 'Could not load calculation');
      })
      .finally(() => setLoading(false));
  }, [open, userId, periodId, metric]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);

  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const width = Math.min(400, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      let top = rect.bottom + 8;
      const estimatedHeight = 360;
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - estimatedHeight - 8);
      }
      setPanelStyle({ position: 'fixed', top, left, width, zIndex: 9999 });
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
          {metricTitle(metric)}
        </h4>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
          {componentName}
          {periodLabel ? ` · ${periodLabel}` : ''}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{metricSummary(metric)}</p>
      </div>
      <div className="px-4 py-3 space-y-3 max-h-[min(60vh,380px)] overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Calculating…
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && preview && (
          <>
            <div className="rounded-lg bg-primary-50 dark:bg-primary-950/30 border border-primary-100 dark:border-primary-900/50 px-3 py-2">
              <p className="text-[10px] font-bold uppercase text-primary-700 dark:text-primary-300">
                Engine score
              </p>
              <p className="text-2xl font-bold text-primary-700 dark:text-primary-200">
                {formatAppraisalScore(preview.score)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Period inputs
              </p>
              <dl className="space-y-1.5">
                {breakdownRows(metric, preview.breakdown).map((row) => (
                  <div key={row.label} className="flex justify-between text-xs">
                    <dt className="text-slate-600 dark:text-slate-400">{row.label}</dt>
                    <dd className="font-semibold text-slate-900 dark:text-white tabular-nums">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-2">
              {formulaNote(metric, preview.breakdown)}
            </p>
          </>
        )}
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
        aria-label={`How ${componentName} is calculated`}
        title={`How ${componentName} is calculated`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300/80 bg-white text-[10px] font-semibold text-slate-400 leading-none hover:text-slate-600 hover:border-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-400/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500 dark:hover:text-slate-300 ml-1 align-middle"
      >
        !
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
};
