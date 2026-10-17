import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { inputClass } from '../../constants/designSystem';
import type { PersonalHubAlert } from '../../types/personalHub';
import { getOverlayPortalRoot, Z_CHROME_MENU, Z_SHEET } from '../../utils/overlayPortal';
import { format } from 'date-fns';
import { parseDisplayDateInput } from '../../utils/formatDisplayDate';
import { resolveDateFnsDateFormatPattern } from '../../utils/companyLocaleSettings';

const Z_BACKDROP = Z_CHROME_MENU;
const Z_PANEL = Z_CHROME_MENU + 1;

function popoverCoords(rect: DOMRect): { top: number; left: number; width: number; maxHeight: number } {
  const width = Math.min(320, Math.max(280, window.innerWidth - 24));
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));

  const spaceBelow = window.innerHeight - rect.bottom - 16;
  const spaceAbove = rect.top - 16;
  const preferredHeight = 340;

  let top: number;
  let maxHeight: number;
  if (spaceBelow >= 240 || spaceBelow >= spaceAbove) {
    top = rect.bottom + 8;
    maxHeight = Math.min(preferredHeight, spaceBelow);
  } else {
    maxHeight = Math.min(preferredHeight, spaceAbove);
    top = rect.top - 8 - maxHeight;
  }

  return { top, left, width, maxHeight: Math.max(200, maxHeight) };
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  selectedDate: string | null;
  existingAlerts: PersonalHubAlert[];
  title: string;
  time: string;
  detail: string;
  saving: boolean;
  onTitleChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onDetailChange: (v: string) => void;
  onSave: () => void;
};

export function AlertReminderFlyout({
  isOpen,
  onClose,
  anchorRect,
  selectedDate,
  existingAlerts,
  title,
  time,
  detail,
  saving,
  onTitleChange,
  onTimeChange,
  onDetailChange,
  onSave,
}: Props) {
  const { t } = useLanguage();
  const compact = useCompactLayout();
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 340, maxHeight: 380 });

  useLayoutEffect(() => {
    if (!isOpen || compact || !anchorRect) return;
    const rect = anchorRect;
    setCoords(popoverCoords(rect));
    const update = () => setCoords(popoverCoords(rect));
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, anchorRect, compact]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !compact) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen, compact]);

  if (!isOpen) return null;

  const dateLabel = (() => {
    if (!selectedDate) return '';
    const d = parseDisplayDateInput(selectedDate);
    return d ? format(d, `EEE, ${resolveDateFnsDateFormatPattern()}`) : '';
  })();

  const panelBody = (
    <div className="flex flex-col h-full min-h-0 bg-white dark:bg-slate-900">
      <div className="shrink-0 px-4 pt-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        {compact ? (
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 mx-auto mb-3" aria-hidden />
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-950/50">
                <Bell className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" aria-hidden />
              </span>
              {t('personalAnalytics.hub.addAlert')}
            </h2>
            {dateLabel ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 pl-10">{dateLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label={t('common.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3.5">
        {existingAlerts.length > 0 ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              {t('personalAnalytics.hub.existingOnDate')}
            </p>
            {existingAlerts.map((a) => (
              <div key={a.id} className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">{a.title}</span>
                {a.notes ? <span className="text-slate-500"> — {a.notes}</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('personalAnalytics.hub.alertTitle')}
          </span>
          <input
            className={inputClass}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={t('personalAnalytics.hub.alertTitle')}
            autoFocus
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('personalAnalytics.hub.alertTime')}
          </span>
          <input
            type="time"
            className={inputClass}
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('personalAnalytics.hub.alertDetail')}
          </span>
          <textarea
            className={`${inputClass} min-h-[5rem] resize-y`}
            value={detail}
            onChange={(e) => onDetailChange(e.target.value)}
            placeholder={t('personalAnalytics.hub.alertNotes')}
            rows={3}
          />
        </label>
      </div>

      <div
        className={
          compact
            ? 'shrink-0 flex flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900'
            : 'shrink-0 flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900'
        }
      >
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || !title.trim()}
          className={
            compact
              ? 'w-full px-4 py-3 text-sm font-semibold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-colors min-h-[44px] disabled:opacity-50'
              : 'px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors min-h-[32px] disabled:opacity-50'
          }
        >
          {saving ? t('common.saving') : t('personalAnalytics.hub.addAlert')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className={
            compact
              ? 'w-full px-4 py-3 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors min-h-[44px]'
              : 'px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors min-h-[32px]'
          }
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );

  if (compact) {
    // Mount on body so the sheet sits above the chat FAB stacking context.
    return createPortal(
      <>
        <button
          type="button"
          className="fixed inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
          style={{ zIndex: Z_SHEET }}
          aria-label={t('common.close')}
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('personalAnalytics.hub.addAlert')}
          className="fixed inset-x-0 bottom-0 flex flex-col max-h-[min(88dvh,560px)] rounded-t-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200"
          style={{ zIndex: Z_SHEET + 1 }}
        >
          {panelBody}
        </div>
      </>,
      document.body
    );
  }

  const portalRoot = getOverlayPortalRoot();

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-transparent"
        style={{ zIndex: Z_BACKDROP }}
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={t('personalAnalytics.hub.addAlert')}
        className="fixed flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          zIndex: Z_PANEL,
          top: coords.top,
          left: coords.left,
          width: coords.width,
          maxHeight: coords.maxHeight,
        }}
      >
        {panelBody}
      </div>
    </>,
    portalRoot
  );
}
