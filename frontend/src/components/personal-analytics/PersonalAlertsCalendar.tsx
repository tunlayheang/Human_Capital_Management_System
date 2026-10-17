import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Api } from '../../services/api';
import { usePersonalAlerts } from '../../hooks/usePersonalHub';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import type { PersonalHubAlert } from '../../types/personalHub';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import {
  buildSundayFirstMonthGrid,
  SUNDAY_FIRST_WEEKDAY_LABELS,
} from '../../utils/monthCalendarGrid';
import {
  isPersonalAlertOverdue,
  localDateKeyFromIso,
  localTimeFromIso,
  normalizeReminderTime,
  sortPendingPersonalAlerts,
  toAlertAtIso,
} from '../../utils/personalHubAlerts';
import { AlertReminderFlyout } from './AlertReminderFlyout';
import { PaEmpty, PaHint } from './personalAnalyticsUi';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';

const VISIBLE_ALERTS = 5;

type Props = {
  isSelf: boolean;
  defaultReminderTime?: string | null;
};

export function PersonalAlertsCalendar({ isSelf, defaultReminderTime }: Props) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const { alerts, loading, error, reload } = usePersonalAlerts();
  const calendarRef = useRef<HTMLDivElement>(null);
  const todayKey = todayYmdInCompanyTz();
  const [view, setView] = useState(() => {
    const today = todayYmdInCompanyTz();
    const [y, m] = today.split('-').map(Number);
    return { year: y, monthIndex: m - 1 };
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(() => normalizeReminderTime(defaultReminderTime));
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const monthLabel = useMemo(
    () => new Date(view.year, view.monthIndex, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [view.year, view.monthIndex]
  );

  const cells = useMemo(
    () => buildSundayFirstMonthGrid(view.year, view.monthIndex),
    [view.year, view.monthIndex]
  );

  const alertsByDate = useMemo(() => {
    const map = new Map<string, PersonalHubAlert[]>();
    for (const a of alerts) {
      const key = localDateKeyFromIso(a.alertAt);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.alertAt).getTime() - new Date(b.alertAt).getTime());
    }
    return map;
  }, [alerts]);

  const selectedDayAlerts = selectedDate ? alertsByDate.get(selectedDate) ?? [] : [];

  const pendingAlerts = useMemo(
    () => sortPendingPersonalAlerts(alerts, nowMs).slice(0, VISIBLE_ALERTS),
    [alerts, nowMs]
  );

  const pendingCount = useMemo(
    () => alerts.filter((a) => !a.isDone).length,
    [alerts]
  );

  const openDate = (date: string, inMonth: boolean, el?: HTMLElement) => {
    if (!isSelf || !inMonth) return;
    const anchor = el ?? calendarRef.current;
    setSelectedDate(date);
    setTitle('');
    setDetail('');
    setTime(normalizeReminderTime(defaultReminderTime));
    setAnchorRect(anchor ? anchor.getBoundingClientRect() : null);
    setPickerOpen(true);
  };

  const openFromAlert = (alert: PersonalHubAlert, el: HTMLElement) => {
    const date = localDateKeyFromIso(alert.alertAt);
    setSelectedDate(date);
    setTitle('');
    setDetail('');
    setTime(localTimeFromIso(alert.alertAt));
    setAnchorRect(el.getBoundingClientRect());
    setPickerOpen(true);
    const [y, m] = date.split('-').map(Number);
    setView({ year: y, monthIndex: m - 1 });
  };

  const closePicker = () => {
    setPickerOpen(false);
    setSelectedDate(null);
    setAnchorRect(null);
    setTitle('');
    setDetail('');
    setTime(normalizeReminderTime(defaultReminderTime));
  };

  const saveAlert = async () => {
    if (!selectedDate || !title.trim()) return;
    setSaving(true);
    try {
      await Api.personalHub.createAlert({
        title: title.trim(),
        alertAt: toAlertAtIso(selectedDate, time),
        notes: detail.trim() || undefined,
      });
      showToast(t('personalAnalytics.hub.alertSaved'), 'success');
      closePicker();
      await reload({ silent: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (alert: PersonalHubAlert) => {
    const ok = await confirm({
      title: t('personalAnalytics.hub.deleteAlertTitle'),
      description: t('personalAnalytics.hub.deleteAlertConfirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await Api.personalHub.deleteAlert(alert.id);
      await reload({ silent: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      let m = v.monthIndex + delta;
      let y = v.year;
      if (m < 0) {
        m = 11;
        y -= 1;
      } else if (m > 11) {
        m = 0;
        y += 1;
      }
      return { year: y, monthIndex: m };
    });
  };

  if (!isSelf) {
    return <PaEmpty>{t('personalAnalytics.hub.privateOnly')}</PaEmpty>;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <PaEmpty>
        {error}
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-2 text-primary-600 hover:underline text-xs font-medium"
        >
          {t('common.retry')}
        </button>
      </PaEmpty>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('personalAnalytics.hub.alertTapDate')}</p>

        <div
          ref={calendarRef}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
        >
          <div className="flex items-center justify-between gap-1.5 mb-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('common.previous')}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <p className="text-xs font-semibold text-slate-900 dark:text-white tabular-nums">{monthLabel}</p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('common.next')}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
            {SUNDAY_FIRST_WEEKDAY_LABELS.map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell) => {
              if (cell.kind === 'empty') {
                return (
                  <div
                    key={cell.key}
                    className="min-h-[1.75rem] rounded-md text-slate-300 dark:text-slate-600"
                    aria-hidden
                  />
                );
              }
              const dayAlerts = alertsByDate.get(cell.date) ?? [];
              const hasPending = dayAlerts.some((a) => !a.isDone);
              const hasAny = dayAlerts.length > 0;
              const isToday = cell.date === todayKey;
              const isSelected = pickerOpen && selectedDate === cell.date;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={(e) => openDate(cell.date, true, e.currentTarget)}
                  className={`relative min-h-[1.75rem] rounded-md text-[11px] font-medium transition-colors text-slate-800 dark:text-slate-100 hover:bg-primary-50 dark:hover:bg-primary-950/40 cursor-pointer ${
                    isToday ? 'ring-1 ring-primary-500/70' : ''
                  } ${isSelected ? 'bg-primary-100 dark:bg-primary-950/50 ring-1 ring-primary-500' : ''}`}
                >
                  {cell.day}
                  {hasAny ? (
                    <span
                      className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                        hasPending ? 'bg-primary-500' : 'bg-slate-400 dark:bg-slate-500'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {pendingAlerts.length === 0 ? (
          <PaHint>{t('personalAnalytics.hub.noAlerts')}</PaHint>
        ) : (
          <ul className="space-y-1.5 max-h-32 overflow-y-auto pr-0.5">
            {pendingAlerts.map((a) => {
              const overdue = isPersonalAlertOverdue(a, nowMs);
              return (
                <li
                  key={a.id}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] flex items-start gap-1.5 bg-white dark:bg-slate-900 ${
                    overdue
                      ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => openFromAlert(a, e.currentTarget)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{a.title}</p>
                    <p className={`mt-0.5 ${overdue ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                      {formatDateTimeDisplay(a.alertAt)}
                      {overdue ? ` · ${t('personalAnalytics.hub.alertOverdue')}` : ''}
                    </p>
                    {a.notes ? (
                      <p className="text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">{a.notes}</p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(a);
                    }}
                    className="text-slate-400 hover:text-red-500 shrink-0"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {pendingCount > VISIBLE_ALERTS ? (
          <PaHint>
            {t('personalAnalytics.hub.alertsMore', { count: String(pendingCount - VISIBLE_ALERTS) })}
          </PaHint>
        ) : null}
      </div>

      <AlertReminderFlyout
        isOpen={pickerOpen}
        onClose={closePicker}
        anchorRect={anchorRect}
        selectedDate={selectedDate}
        existingAlerts={selectedDayAlerts}
        title={title}
        time={time}
        detail={detail}
        saving={saving}
        onTitleChange={setTitle}
        onTimeChange={setTime}
        onDetailChange={setDetail}
        onSave={saveAlert}
      />
      <ConfirmDialogHost />
    </>
  );
}
