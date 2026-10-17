import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

import type { PayrollAnomalySummary } from '../../types';

export type PayrollPreviewMeta = {
  month: string;
  generatedAt?: string;
  calculationEngine?: string;
  prorationMethod?: string;
  engineRulesSummary?: string;
  anomalyEngine?: string;
  anomalySummary?: PayrollAnomalySummary;
  attendancePeriodStatus?: string;
  attendanceFinalized?: boolean;
  includeAttendance?: boolean;
  period?: {
    payPeriodStart: string;
    payPeriodEnd: string;
    attendanceCutoffDate: string | null;
  };
  globalWarnings?: Array<{ code: string; message: string }>;
  errors?: Array<{ userId: string; employeeId: string; message: string }>;
  eligibleEmployees?: number;
  failedEmployees?: number;
  disclaimer?: string;
};

type Props = {
  meta: PayrollPreviewMeta | null;
  className?: string;
};

function actionableWarnings(meta: PayrollPreviewMeta) {
  return (meta.globalWarnings ?? []).filter((w) => w.code !== 'ZERO_PRORATED_BASE');
}

function PayrollPreviewFinanceInfoContent({ meta }: { meta: PayrollPreviewMeta }) {
  const warnings = actionableWarnings(meta);
  const hasErrors = (meta.errors?.length ?? 0) > 0;
  const hasWarnings = warnings.length > 0;

  if (!hasErrors && !hasWarnings) return null;

  return (
    <div className="space-y-3">
      {hasWarnings && (
        <ul className="space-y-1 text-xs text-amber-950 dark:text-amber-100">
          {warnings.map((w) => (
            <li key={w.code} className="flex gap-2 items-start">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      {hasErrors && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3 py-2">
          <p className="text-xs font-semibold text-red-800 dark:text-red-200 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            {meta.errors!.length} employee(s) failed calculation — do not run payroll until resolved
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-red-700 dark:text-red-300 max-h-24 overflow-y-auto">
            {meta.errors!.slice(0, 8).map((e) => (
              <li key={`${e.userId}-${e.employeeId}`}>
                {e.employeeId}: {e.message}
              </li>
            ))}
            {meta.errors!.length > 8 && (
              <li className="italic">…and {meta.errors!.length - 8} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Attention popover for pre-run calculation errors/warnings. */
export const PayrollPreviewFinanceInfo: React.FC<Props> = ({ meta, className = '' }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);

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
      const width = Math.min(480, window.innerWidth - 16);
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      let top = rect.bottom + 8;
      const estimatedHeight = 420;
      if (top + estimatedHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - estimatedHeight - 8);
      }
      setPanelStyle({
        position: 'fixed',
        top,
        left,
        width,
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

  if (!meta) return null;

  const hasAttention =
    (meta.errors?.length ?? 0) > 0 || actionableWarnings(meta).length > 0;
  if (!hasAttention) return null;

  const panel = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      style={panelStyle}
      className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-white dark:bg-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-900/40 bg-amber-50/90 dark:bg-amber-950/30">
        <h4 id={titleId} className="text-sm font-bold text-amber-950 dark:text-amber-100 pr-6">
          Preview issues
        </h4>
      </div>
      <div className="overflow-y-auto px-4 py-3 max-h-[min(70vh,480px)] bg-amber-50/40 dark:bg-amber-950/20">
        <PayrollPreviewFinanceInfoContent meta={meta} />
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
        aria-label="Preview calculation issues"
        title="Preview calculation issues"
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium leading-none focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50 border-amber-400/90 bg-amber-50 text-amber-700 hover:border-amber-500 hover:text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300 ${className}`}
      >
        !
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
};
