import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Filter, X } from 'lucide-react';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { selectClass, listFilterIconPillClass } from '../../constants/designSystem';
import {
  orderInclusiveDateRange,
  type DateRangeValue,
} from '../../utils/dateRangeFilter';
import {
  fixedMenuBelowAnchor,
  Z_CHROME_MENU,
} from '../../utils/overlayPortal';
import { DatePickerInput } from './shadcn/date-picker-input';

const Z_BACKDROP = Z_CHROME_MENU;
const Z_PANEL = Z_CHROME_MENU + 1;

export const filterTriggerClassName = listFilterIconPillClass;

type PageFilterMenuProps = {
  /** Number of active filter fields (shows badge on trigger). */
  activeCount?: number;
  /** Clears all filters — shown in panel footer when provided. */
  onClear?: () => void;
  title?: string;
  /** Short summary shown beside the trigger (e.g. "May 2026"). */
  periodSummary?: string;
  /** When true, trigger shows loading state and is not clickable. */
  loading?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
};

type PopoverProps = {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  title: string;
  activeCount: number;
  onClear?: () => void;
  children: React.ReactNode;
  labelId: string;
};

function FilterMenuPopover({
  isOpen,
  onClose,
  anchorRef,
  title,
  activeCount,
  onClear,
  children,
  labelId,
}: PopoverProps) {
  const compact = useCompactLayout();
  const [style, setStyle] = useState({ top: 0, right: 16, width: 360 });

  const updatePosition = useCallback(() => {
    if (compact) return;
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = fixedMenuBelowAnchor(rect, 340);
    // Wide enough for full native date values (mm/dd/yyyy + calendar icon).
    const width = Math.min(400, Math.max(340, below.minWidth));
    const top = below.top;
    // Align panel right edge with the filter trigger; keep 8px viewport margins.
    const right = Math.min(
      Math.max(8, below.right),
      Math.max(8, window.innerWidth - width - 8)
    );
    setStyle({ top, right, width });
  }, [anchorRef, compact]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

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

  const panelBody = (
    <div className="flex flex-col min-h-0 max-h-full">
      <div className="flex items-center justify-between px-4 py-3 hcms-filter-panel-header shrink-0">
        <div>
          <h2 id={labelId} className="text-sm font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
          {activeCount > 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 inline-flex items-center gap-1.5">
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold leading-none text-white"
                aria-hidden
              >
                !
              </span>
              {activeCount} active filter{activeCount === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close filters"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 p-4 space-y-4 bg-white dark:bg-slate-900">{children}</div>

      {onClear ? (
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              onClear();
              onClose();
            }}
            disabled={activeCount === 0}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-40 disabled:pointer-events-none"
          >
            Clear all filters
          </button>
        </div>
      ) : null}
    </div>
  );

  if (compact) {
    return createPortal(
      <>
        <button
          type="button"
          className="fixed inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
          style={{ zIndex: Z_BACKDROP }}
          aria-label="Close filters"
          onClick={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('[data-hcms-date-picker]')) return;
            onClose();
          }}
        />
        <div
          role="dialog"
          aria-labelledby={labelId}
          className="fixed inset-x-0 bottom-0 flex flex-col max-h-[min(85dvh,560px)] rounded-t-2xl hcms-filter-panel shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200 pb-[env(safe-area-inset-bottom)]"
          style={{ zIndex: Z_PANEL }}
        >
          {panelBody}
        </div>
      </>,
      document.body
    );
  }

  return createPortal(
    <>
        <button
          type="button"
          className="fixed inset-0 cursor-default bg-transparent"
          style={{ zIndex: Z_BACKDROP }}
          aria-label="Close filters"
          onClick={(e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('[data-hcms-date-picker]')) return;
            onClose();
          }}
        />
      <div
        role="dialog"
        aria-labelledby={labelId}
        className="fixed flex flex-col rounded-2xl hcms-filter-panel shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 pointer-events-auto"
        style={{
          zIndex: Z_PANEL,
          top: style.top,
          right: style.right,
          width: style.width,
          maxHeight: `min(70vh, calc(100dvh - ${style.top}px - 16px))`,
        }}
      >
        {panelBody}
      </div>
    </>,
    document.body
  );
}

export const PageFilterMenu: React.FC<PageFilterMenuProps> = ({
  activeCount = 0,
  onClear,
  title = 'Filters',
  periodSummary,
  loading = false,
  children,
  className = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const count = Math.max(0, activeCount);
  const triggerDisabled = disabled;
  const filterAriaLabel =
    count > 0
      ? `${title}, ${count} active filter${count === 1 ? '' : 's'}`
      : periodSummary
        ? `${title}, ${periodSummary}`
        : title;

  return (
    <div className={`inline-flex shrink-0 ${className}`.trim()}>
      <button
        ref={anchorRef}
        type="button"
        disabled={triggerDisabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? labelId : undefined}
        aria-busy={loading}
        aria-label={filterAriaLabel}
        title={periodSummary ?? title}
        onClick={() => setOpen((v) => !v)}
        className={`${filterTriggerClassName} ${
          triggerDisabled ? 'opacity-60 pointer-events-none' : ''
        } ${
          count > 0
            ? 'border-primary-400/80 dark:border-primary-500/60 bg-primary-50/90 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
            : ''
        }`}
      >
        <Filter
          className={`w-[1.05rem] h-[1.05rem] ${
            count > 0
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
          aria-hidden
        />
        {loading ? <span className="sr-only">Loading filters</span> : null}
      </button>
      <FilterMenuPopover
        isOpen={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        title={title}
        activeCount={count}
        onClear={onClear}
        labelId={labelId}
      >
        {children}
      </FilterMenuPopover>
    </div>
  );
};

type FieldProps = {
  label: string;
  children: React.ReactNode;
  hint?: string;
};

export const FilterMenuField: React.FC<FieldProps> = ({ label, children, hint }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
    {children}
    {hint ? <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span> : null}
  </label>
);

type SelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
};

export const FilterMenuSelect: React.FC<SelectProps> = ({
  label,
  value,
  onChange,
  options,
  hint,
}) => (
  <FilterMenuField label={label} hint={hint}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${selectClass} w-full`}
    >
      {options.map((opt) => (
        <option key={opt.value || '__empty'} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </FilterMenuField>
);

type RadioGroupProps<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  /** When set, the selected non-default option shows an attention mark in the list. */
  defaultValue?: T;
};

type DateRangeProps = {
  from: string;
  to: string;
  onChange: (next: DateRangeValue) => void;
  fromLabel?: string;
  toLabel?: string;
  hint?: string;
  /** When true, dates are shown grayed out and cannot be edited. */
  readOnly?: boolean;
  /**
   * Digits-only typed dd/mm/yyyy with auto `/`. Defaults on (same as DatePickerInput).
   */
  restrictToDateDigits?: boolean;
};

const filterDateInputClass = 'w-full hcms-filter-date-input';

/** Inclusive from/to date pickers (YYYY-MM-DD) with calendar — place first in filter menus. */
export const FilterMenuDateRange: React.FC<DateRangeProps> = ({
  from,
  to,
  onChange,
  fromLabel = 'From',
  toLabel = 'To',
  hint,
  readOnly = false,
  restrictToDateDigits = true,
}) => {
  const applyRange = (nextFrom: string, nextTo: string) => {
    const changed: 'from' | 'to' = nextFrom !== from ? 'from' : 'to';
    onChange(orderInclusiveDateRange(nextFrom, nextTo, changed));
  };

  return (
  <div className="space-y-1.5 pb-1 border-b border-slate-100 dark:border-slate-800">
    <div className="grid grid-cols-1 gap-3">
      <FilterMenuField label={fromLabel}>
        <DatePickerInput
          value={from}
          max={to || undefined}
          readOnly={readOnly}
          disabled={readOnly}
          restrictToDateDigits={restrictToDateDigits}
          onChange={(e) => {
            if (readOnly) return;
            applyRange(e.target.value, to);
          }}
          className={`${filterDateInputClass}${
            readOnly
              ? ' bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-800/80 dark:text-slate-400'
              : ''
          }`}
        />
      </FilterMenuField>
      <FilterMenuField label={toLabel}>
        <DatePickerInput
          value={to}
          min={from || undefined}
          readOnly={readOnly}
          disabled={readOnly}
          restrictToDateDigits={restrictToDateDigits}
          onChange={(e) => {
            if (readOnly) return;
            applyRange(from, e.target.value);
          }}
          className={`${filterDateInputClass}${
            readOnly
              ? ' bg-slate-100 text-slate-500 cursor-not-allowed dark:bg-slate-800/80 dark:text-slate-400'
              : ''
          }`}
        />
      </FilterMenuField>
    </div>
    {hint ? (
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{hint}</p>
    ) : null}
  </div>
  );
};

export function FilterMenuRadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  defaultValue,
}: RadioGroupProps<T>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</legend>
      <ul className="space-y-0.5 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {options.map((opt) => {
          const selected = value === opt.value;
          const showAttention =
            selected && defaultValue != null && value !== defaultValue;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onChange(opt.value)}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors inline-flex items-center gap-1.5 ${
                  selected
                    ? 'bg-primary-100 dark:bg-primary-900/90 text-primary-900 dark:text-primary-100 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {showAttention ? (
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold leading-none text-white"
                    aria-hidden
                  >
                    !
                  </span>
                ) : null}
                <span className="truncate">{opt.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
