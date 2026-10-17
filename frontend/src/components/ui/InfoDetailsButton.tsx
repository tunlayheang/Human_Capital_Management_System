import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils';

export type InfoDetailsRow = {
  label: string;
  value: React.ReactNode;
};

type Props = {
  title: string;
  summary?: string;
  rows?: InfoDetailsRow[];
  /** Optional bullet tips (used instead of or with rows). */
  tips?: string[];
  /** Optional numbered setup / policy steps. */
  steps?: string[];
  /** Optional callout note (warning / relay hint). */
  note?: string;
  ariaLabel?: string;
  className?: string;
};

/**
 * Compact "!" control that reveals sidebar-style details (quick stats / tips)
 * without a separate side card.
 */
export const InfoDetailsButton: React.FC<Props> = ({
  title,
  summary,
  rows,
  tips,
  steps,
  note,
  ariaLabel,
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

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      let top = rect.bottom + 8;
      const estimatedHeight = 280;
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
          {title}
        </h4>
        {summary ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">{summary}</p>
        ) : null}
      </div>
      <div className="px-4 py-3 space-y-3 max-h-[min(50vh,360px)] overflow-y-auto">
        {note ? (
          <p className="text-xs leading-relaxed rounded-lg border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/90 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 px-3 py-2">
            {note}
          </p>
        ) : null}
        {rows && rows.length > 0 ? (
          <dl className="space-y-2.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3">
                <dt className="text-sm text-slate-600 dark:text-slate-400">{row.label}</dt>
                <dd className="text-sm font-medium text-slate-900 dark:text-white text-right">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {steps && steps.length > 0 ? (
          <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-decimal pl-5">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {tips && tips.length > 0 ? (
          <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2 list-disc pl-5">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        ) : null}
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
        aria-label={ariaLabel ?? title}
        title={ariaLabel ?? title}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300/80 bg-transparent text-slate-400 text-xs font-medium leading-none hover:text-slate-600 hover:border-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/40 dark:border-slate-600 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:border-slate-500',
          className
        )}
      >
        !
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
};

export default InfoDetailsButton;
