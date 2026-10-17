import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getRulesConfigHelp,
  type RulesConfigHelpContent,
  type RulesConfigHelpId,
} from '../../content/rulesConfigHelpContent';
import { cn } from '../../utils';

type Props = {
  /** Registry id or inline content */
  help: RulesConfigHelpId | RulesConfigHelpContent;
  className?: string;
};

function resolveContent(help: RulesConfigHelpId | RulesConfigHelpContent): RulesConfigHelpContent {
  return typeof help === 'string' ? getRulesConfigHelp(help) : help;
}

export const RulesConfigHelp: React.FC<Props> = ({ help, className = '' }) => {
  const content = resolveContent(help);
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
      const width = Math.min(content.categories?.length ? 480 : 420, window.innerWidth - 16);
      let left = rect.right - width;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      let top = rect.bottom + 8;
      const estimatedHeight = content.categories?.length ? 520 : 420;
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
  }, [open, content.categories?.length]);

  const panel = open ? (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      style={panelStyle}
      className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-900/60">
        <h4 id={titleId} className="text-sm font-bold text-slate-900 dark:text-white pr-6">
          {content.title}
        </h4>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed">
          {content.summary}
        </p>
      </div>
      <div
        className={`overflow-y-auto px-4 py-3 space-y-3 ${
          content.categories?.length ? 'max-h-[min(70vh,520px)]' : 'max-h-[min(65vh,440px)]'
        }`}
      >
        {content.fields && content.fields.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Details
            </p>
            <ul className="space-y-2.5">
              {content.fields.map((field) => (
                <li key={field.name} className="text-xs leading-relaxed border-b border-slate-100 dark:border-slate-700/80 pb-2.5 last:border-0 last:pb-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 block mb-0.5">
                    {field.name}
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">{field.effect}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {content.categories && content.categories.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Category renewal &amp; balance rules
            </p>
            <div className="space-y-2.5">
              {content.categories.map((cat) => (
                <div
                  key={cat.name}
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40 px-3 py-2.5"
                >
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{cat.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.summary}</p>
                  <dl className="mt-2 space-y-1">
                    {cat.items.map((item) => (
                      <div key={item.label} className="text-[11px] leading-snug">
                        <dt className="font-semibold text-slate-500 dark:text-slate-400 inline">
                          {item.label}:{' '}
                        </dt>
                        <dd className="inline text-slate-600 dark:text-slate-300">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {cat.doesNot && cat.doesNot.length > 0 && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                      <span className="font-semibold">Does not:</span>{' '}
                      {cat.doesNot.join('; ')}
                    </p>
                  )}
                  {cat.example && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      <span className="font-semibold">Example:</span> {cat.example}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {content.notes && content.notes.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 mb-1">
              Notes
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs text-amber-900/90 dark:text-amber-100/90">
              {content.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
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
        aria-label={`How ${content.title} works`}
        title={`How ${content.title} works`}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300/80 bg-transparent text-slate-400 text-xs font-medium leading-none hover:text-slate-600 hover:border-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/40 dark:border-slate-600 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:border-slate-500',
          className
        )}
      >
        !
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </>
  );
};

/** Wrapper for bordered rule sections that are not using the Card component. */
export const RulesConfigPanel: React.FC<{
  help: RulesConfigHelpId | RulesConfigHelpContent;
  className?: string;
  children: React.ReactNode;
}> = ({ help, className = '', children }) => (
  <div className={`relative ${className}`}>
    <RulesConfigHelp help={help} className="absolute top-3 right-3 z-10" />
    {children}
  </div>
);
