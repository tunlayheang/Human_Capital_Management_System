import React, { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, X } from 'lucide-react';
import { AppOverlay } from '../ui/AppOverlay';
import { PageHeader } from '../ui/page/PageHeader';
import { useLanguage } from '../../context/LanguageContext';

export type ActionInboxModalBack = {
  label?: string;
  onClick: () => void;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  backTo?: ActionInboxModalBack;
  title: string;
  subtitle?: string;
  iconComponent?: LucideIcon;
  actions?: React.ReactNode;
  badges?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  disableClose?: boolean;
};

export const ActionInboxModalShell: React.FC<Props> = ({
  isOpen,
  onClose,
  backTo,
  title,
  subtitle,
  iconComponent,
  actions,
  badges,
  toolbar,
  children,
  disableClose = false,
}) => {
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen || disableClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, disableClose]);

  if (!isOpen) return null;

  const backLabel =
    backTo?.label || t('common.back') || t('approvals.backToQueues') || 'Back';

  return (
    <AppOverlay
      open={isOpen}
      onClose={disableClose ? undefined : onClose}
      align="top"
      backdrop="dim"
      zIndexClass="z-[210]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hcms-modal-dialog hcms-modal-dialog--action-inbox flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200/95 bg-slate-50 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.48)] ring-1 ring-slate-900/5 dark:border-slate-700 dark:bg-slate-950 dark:ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/95 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/95 sm:px-4">
          {backTo ? (
            <button
              type="button"
              onClick={backTo.onClick}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-primary-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-primary-300"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{backLabel}</span>
            </button>
          ) : (
            <span className="w-2" aria-hidden />
          )}
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={disableClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={t('common.close') || 'Close'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="hcms-modal-body min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4">
          <div className="mx-auto w-full max-w-5xl space-y-5 pb-2">
            <PageHeader
              title={title}
              subtitle={subtitle}
              iconComponent={iconComponent}
              actions={actions}
              badges={badges}
              toolbar={toolbar}
            />
            {children}
          </div>
        </div>
      </div>
    </AppOverlay>
  );
};

export default ActionInboxModalShell;
