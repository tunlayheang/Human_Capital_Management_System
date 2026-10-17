import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, Loader2, RotateCcw, X } from 'lucide-react';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { useLanguage } from '../../context/LanguageContext';
import { selectClass } from '../../constants/designSystem';
import {
  defaultDashboardRange,
  formatRangeLabel,
  rangeFromPreset,
  saveDashboardRange,
  todayYmd,
  type DashboardDatePreset,
  type DashboardDateRangeValue,
} from '../../utils/dashboardDateRange';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';

const PRESET_IDS: DashboardDatePreset[] = ['ytd', 'last30', 'last90', 'last12m', 'custom'];

const Z_BACKDROP = 1200;
const Z_PANEL = 1201;

const inputClass =
  'h-9 w-full min-w-0 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 text-sm leading-normal text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-500';

/** Inline toolbar select — avoid selectClass py-2.5 + fixed height (clips text on Windows). */
const inlineSelectClass =
  'box-border min-h-9 py-1.5 w-[10.5rem] shrink-0 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 pl-2.5 pr-8 text-sm leading-normal text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-500';

const inlineDateClass =
  'h-9 min-h-9 w-[8.25rem] min-w-0 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 text-sm leading-normal text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary-500/25 focus:border-primary-500';

function shortRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDateOnlyDisplay(startDate);
  return `${formatDateOnlyDisplay(startDate)} – ${formatDateOnlyDisplay(endDate)}`;
}

type ControlsProps = {
  value: DashboardDateRangeValue;
  apply: (next: DashboardDateRangeValue) => void;
  onPresetChange: (preset: DashboardDatePreset) => void;
  onDateChange: (field: 'startDate' | 'endDate', raw: string) => void;
  layout: 'sheet' | 'inline';
  presetLabels: Record<DashboardDatePreset, string>;
  t: (path: string) => string;
};

const PeriodControls: React.FC<ControlsProps> = ({
  value,
  apply,
  onPresetChange,
  onDateChange,
  layout,
  presetLabels,
  t,
}) => {
  const showDates = value.preset === 'custom';
  const selectEl = (
    <select
      value={value.preset}
      onChange={(e) => onPresetChange(e.target.value as DashboardDatePreset)}
      className={layout === 'sheet' ? `${selectClass} w-full` : inlineSelectClass}
      aria-label={t('dashboard.aria.periodPreset')}
    >
      {PRESET_IDS.map((id) => (
        <option key={id} value={id}>
          {presetLabels[id]}
        </option>
      ))}
    </select>
  );

  if (layout === 'sheet') {
    return (
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            {t('dashboard.periodLabel')}
          </span>
          {selectEl}
        </label>
        {showDates ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('dashboard.periodFrom')}
              </span>
              <DatePickerInput
                value={value.startDate}
                max={value.endDate || todayYmd()}
                onChange={(e) => onDateChange('startDate', e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('dashboard.periodTo')}
              </span>
              <DatePickerInput
                value={value.endDate}
                min={value.startDate}
                max={todayYmd()}
                disableFuture
                onChange={(e) => onDateChange('endDate', e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => apply(defaultDashboardRange())}
          className="w-full h-9 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {t('dashboard.resetYtd')}
        </button>
      </div>
    );
  }

  return (
    <>
      {selectEl}
      {showDates ? (
        <div className="flex items-center gap-1 shrink-0">
          <DatePickerInput
            aria-label={t('dashboard.aria.fromDate')}
            value={value.startDate}
            max={value.endDate || todayYmd()}
            onChange={(e) => onDateChange('startDate', e.target.value)}
            className={inlineDateClass}
          />
          <span className="text-slate-400 text-xs" aria-hidden>
            –
          </span>
          <DatePickerInput
            aria-label={t('dashboard.aria.toDate')}
            value={value.endDate}
            min={value.startDate}
            max={todayYmd()}
            disableFuture
            onChange={(e) => onDateChange('endDate', e.target.value)}
            className={inlineDateClass}
          />
        </div>
      ) : (
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[12rem] hidden lg:inline" title={formatRangeLabel(value.startDate, value.endDate)}>
          {formatRangeLabel(value.startDate, value.endDate)}
        </span>
      )}
      <button
        type="button"
        onClick={() => apply(defaultDashboardRange())}
        title={t('dashboard.resetYtd')}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{t('dashboard.resetYtd')}</span>
      </button>
    </>
  );
};

type SheetProps = {
  open: boolean;
  onClose: () => void;
  labelId: string;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
};

const PeriodSheet: React.FC<SheetProps> = ({ open, onClose, labelId, title, closeLabel, children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 cursor-default bg-black/40"
        style={{ zIndex: Z_BACKDROP }}
        aria-label={title}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby={labelId}
        className="fixed inset-x-0 bottom-0 flex flex-col max-h-[min(70dvh,420px)] rounded-t-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        style={{ zIndex: Z_PANEL }}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-700/80 shrink-0">
          <h2 id={labelId} className="text-sm font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={closeLabel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>,
    document.body
  );
};

type Props = {
  value: DashboardDateRangeValue;
  onChange: (next: DashboardDateRangeValue) => void;
  periodLabel?: string;
  loading?: boolean;
};

export const DashboardDateFilter: React.FC<Props> = ({
  value,
  onChange,
  periodLabel,
  loading = false,
}) => {
  const { t } = useLanguage();
  const compact = useCompactLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const labelId = useId();
  const displayPeriod = periodLabel || formatRangeLabel(value.startDate, value.endDate);

  const presetLabels = useMemo(
    (): Record<DashboardDatePreset, string> => ({
      ytd: t('dashboard.datePresets.ytd'),
      last30: t('dashboard.datePresets.last30'),
      last90: t('dashboard.datePresets.last90'),
      last12m: t('dashboard.datePresets.last12m'),
      custom: t('dashboard.datePresets.custom'),
    }),
    [t]
  );

  const summary =
    value.preset !== 'custom'
      ? presetLabels[value.preset] ?? displayPeriod
      : shortRangeLabel(value.startDate, value.endDate);

  const apply = useCallback(
    (next: DashboardDateRangeValue) => {
      saveDashboardRange(next);
      onChange(next);
    },
    [onChange]
  );

  const onPresetChange = (preset: DashboardDatePreset) => {
    if (preset === 'custom') {
      apply({ ...value, preset: 'custom' });
      return;
    }
    apply({ preset, ...rangeFromPreset(preset) });
    if (compact) setSheetOpen(false);
  };

  const onDateChange = (field: 'startDate' | 'endDate', raw: string) => {
    const ordered = orderInclusiveStartEnd(
      field === 'startDate' ? raw : value.startDate,
      field === 'endDate' ? raw : value.endDate,
      field
    );
    apply({ ...value, preset: 'custom', ...ordered });
  };

  const controls = (
    <PeriodControls
      value={value}
      apply={apply}
      onPresetChange={onPresetChange}
      onDateChange={onDateChange}
      layout={compact ? 'sheet' : 'inline'}
      presetLabels={presetLabels}
      t={t}
    />
  );

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-haspopup="dialog"
          aria-controls={sheetOpen ? labelId : undefined}
          className="flex w-full h-9 items-center gap-2 rounded-lg border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900/40 px-2.5 text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
        >
          <Calendar className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800 dark:text-slate-100">
            {summary}
          </span>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-500" aria-label={t('dashboard.periodUpdating')} />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          )}
        </button>
        <PeriodSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          labelId={labelId}
          title={t('dashboard.reportPeriod')}
          closeLabel={t('common.close')}
        >
          {controls}
        </PeriodSheet>
      </>
    );
  }

  return (
    <section
      className="flex flex-nowrap items-center gap-2 rounded-lg border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900/40 px-3 py-2 min-h-[2.75rem]"
      aria-label={t('dashboard.reportPeriodFilter')}
    >
      <Calendar className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" aria-hidden />
      <span className="text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap shrink-0">
        {t('dashboard.reportPeriod')}
      </span>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-500" aria-label={t('dashboard.periodUpdating')} />
      ) : null}
      <div className="flex flex-nowrap items-center gap-2 min-w-0 ml-auto">{controls}</div>
    </section>
  );
};
