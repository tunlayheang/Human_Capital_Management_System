import React, { useCallback, useEffect, useId, useRef, useState, type ElementType } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, CircleAlert } from 'lucide-react';
import { format } from 'date-fns';
import { enUS, km as kmLocale } from 'date-fns/locale';
import { useLanguage } from '../../../context/LanguageContext';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  /** Icon in the date eyebrow when `icon` is not passed (Lucide or other ElementType) */
  iconComponent?: ElementType;
  actions?: React.ReactNode;
  /** Status pills on the right (e.g. Attendance day / location badges) */
  badges?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
  /** Custom eyebrow row; pass `null` or set `hideEyebrow` to omit */
  eyebrow?: React.ReactNode | null;
  hideEyebrow?: boolean;
  /** Slim header when global app chrome already shows page title */
  variant?: 'hero' | 'compact';
  /**
   * Soft notice affordance (top-left). Message opens in a small popover on click.
   * Use for secondary status like payroll freeze — visible, not a full banner.
   */
  notice?: string | null;
};

function HeaderNotice({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

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
      const width = Math.min(360, window.innerWidth - 16);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      let top = rect.bottom + 8;
      const estimatedHeight = 140;
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

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={titleId}
          style={panelStyle}
          className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-white dark:bg-slate-800 shadow-lg shadow-amber-900/5 dark:shadow-black/40 px-3.5 py-3"
        >
          <p id={titleId} className="text-xs sm:text-sm leading-relaxed text-amber-950 dark:text-amber-100">
            {message}
          </p>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Payroll freeze notice"
        title="Payroll freeze notice"
        className={cn(
          'inline-flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full',
          'border border-amber-300/70 dark:border-amber-700/60',
          'bg-amber-50/90 dark:bg-amber-950/50',
          'text-amber-700 dark:text-amber-300',
          'shadow-sm shadow-amber-900/5',
          'hover:bg-amber-100/95 dark:hover:bg-amber-900/55',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50',
          'transition-colors'
        )}
      >
        <CircleAlert className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
      </button>
      {panel}
    </>
  );
}

/**
 * Unified page hero — Attendance-style gradient card with date eyebrow, title, and actions.
 */
export const PageHeader: React.FC<Props> = ({
  title,
  subtitle,
  icon,
  iconComponent: IconComponent,
  actions,
  badges,
  toolbar,
  className = '',
  eyebrow,
  hideEyebrow = false,
  variant = 'hero',
  notice,
}) => {
  const { language } = useLanguage();
  const dateFnsLocale = language === 'km' ? kmLocale : enUS;
  const todayLabel = format(new Date(), 'EEEE, dd/MM/yyyy', { locale: dateFnsLocale });

  const EyebrowIcon = IconComponent ?? Calendar;
  const eyebrowIconNode = icon ? (
    <span className="inline-flex shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
  ) : (
    <EyebrowIcon className="w-3.5 h-3.5 shrink-0" aria-hidden />
  );

  const eyebrowContent =
    eyebrow === null || hideEyebrow
      ? null
      : eyebrow !== undefined
        ? eyebrow
        : (
            <div className="flex items-center gap-1.5 sm:gap-2 text-slate-500 dark:text-slate-400 text-[10px] xs:text-xs font-semibold uppercase tracking-[0.1em] sm:tracking-[0.12em] mb-1.5 sm:mb-2">
              {eyebrowIconNode}
              <span>{todayLabel}</span>
            </div>
          );

  const rightSlot =
    badges || actions ? (
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 sm:justify-end shrink-0">
        {badges}
        {actions}
      </div>
    ) : null;

  if (variant === 'compact') {
    return (
      <header className={className}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 py-0.5 sm:py-1">
          <div className="min-w-0 flex-1">
            {subtitle ? (
              <p className="text-xs sm:text-sm text-muted-foreground leading-snug">{subtitle}</p>
            ) : null}
          </div>
          {rightSlot}
        </div>
        {toolbar ? <div className="pt-2 sm:pt-3 border-t border-border">{toolbar}</div> : null}
      </header>
    );
  }

  return (
    <header className={className}>
      <section className="glass-card relative overflow-hidden text-foreground">
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary-500/20 dark:from-primary-500/25 via-transparent to-transparent pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/20"
          aria-hidden
        />
        <div
          className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-primary-400/80 via-primary-400/60 to-violet-500/80"
          aria-hidden
        />
        <div className="relative px-3 xs:px-4 sm:px-6 lg:px-8 py-3 xs:py-3.5 sm:py-4 md:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            {eyebrowContent}
            <div className="flex items-start gap-2 min-w-0">
              {notice ? <HeaderNotice message={notice} /> : null}
              <h1 className="text-lg xs:text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white break-words min-w-0">
                {title}
              </h1>
            </div>
            {subtitle ? (
              <p className="text-slate-600 dark:text-slate-400 text-xs sm:text-sm mt-0.5 sm:mt-1 leading-snug">
                {subtitle}
              </p>
            ) : null}
          </div>
          {rightSlot}
        </div>
        {toolbar ? (
          <div className="relative border-t border-white/40 dark:border-white/10 px-3 xs:px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 md:py-4">
            {toolbar}
          </div>
        ) : null}
      </section>
    </header>
  );
};
