import * as React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompanyCalendar } from '@/context/CompanyCalendarContext';
import {
  formatDateOnlyDisplay,
  parseDisplayDateInput,
  maskDdMmYyyyInput,
  DISPLAY_DATE_PLACEHOLDER,
} from '@/utils/formatDisplayDate';
import { toYmd } from '@/utils/dashboardDateRange';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Calendar } from '@/components/ui/shadcn/calendar';
import { Z_TOAST } from '@/utils/overlayPortal';

export type DatePickerInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  /** Prevent selecting dates after company "today" (System Settings timezone). */
  disableFuture?: boolean;
  /** Prevent selecting dates before company "today". */
  disablePast?: boolean;
  /**
   * Digits-only typed dd/mm/yyyy with auto `/`. On by default for all date fields;
   * pass `false` only if a field must accept free-form text.
   */
  restrictToDateDigits?: boolean;
  /**
   * @deprecated Always typeable (dd/mm/yyyy). Kept for call-site compatibility.
   */
  allowTextInput?: boolean;
  /**
   * @deprecated Month/year wheel is always enabled. Kept for call-site compatibility.
   */
  captionDropdown?: boolean;
};

function ymdToDate(ymd: string | undefined | null): Date | undefined {
  if (!ymd) return undefined;
  return parseDisplayDateInput(String(ymd).slice(0, 10)) ?? undefined;
}

function emitChange(
  onChange: React.ChangeEventHandler<HTMLInputElement> | undefined,
  input: HTMLInputElement | null,
  next: string,
  name?: string
) {
  if (!onChange) return;
  const target = (input ?? {
    value: next,
    name: name ?? '',
  }) as HTMLInputElement;
  onChange({
    target: { ...target, value: next, name: name ?? target.name },
    currentTarget: { ...target, value: next, name: name ?? target.name },
  } as React.ChangeEvent<HTMLInputElement>);
}

function withinBounds(ymd: string, min?: string, max?: string): boolean {
  if (min && ymd < min) return false;
  if (max && ymd > max) return false;
  return true;
}

/**
 * Shared HCMS date field: typeable dd/mm/yyyy + clean calendar with month/year wheel.
 * Stored value remains YYYY-MM-DD for forms/APIs. Works with react-hook-form `register`.
 */
export const DatePickerInput = React.forwardRef<HTMLInputElement, DatePickerInputProps>(
  (
    {
      className,
      disableFuture,
      disablePast,
      restrictToDateDigits = true,
      allowTextInput: _allowTextInput,
      captionDropdown: _captionDropdown,
      min,
      max,
      value,
      defaultValue,
      onChange,
      onBlur,
      disabled,
      readOnly,
      name,
      id,
      placeholder,
      required,
      ...props
    },
    ref
  ) => {
    const { todayYmd } = useCompanyCalendar();
    const hiddenRef = React.useRef<HTMLInputElement | null>(null);
    const textRef = React.useRef<HTMLInputElement | null>(null);
    const [open, setOpen] = React.useState(false);
    const isControlled = value !== undefined;
    const [displayYmd, setDisplayYmd] = React.useState(() =>
      String(value ?? defaultValue ?? '').slice(0, 10)
    );

    React.useImperativeHandle(ref, () => hiddenRef.current as HTMLInputElement);

    React.useEffect(() => {
      if (isControlled) setDisplayYmd(String(value ?? '').slice(0, 10));
    }, [isControlled, value]);

    const ymd = isControlled ? String(value ?? '').slice(0, 10) : displayYmd;

    let resolvedMin = min != null ? String(min).slice(0, 10) : undefined;
    let resolvedMax = max != null ? String(max).slice(0, 10) : undefined;
    if (disablePast) {
      resolvedMin =
        resolvedMin && resolvedMin > todayYmd ? resolvedMin : todayYmd;
    }
    if (disableFuture) {
      resolvedMax =
        resolvedMax && resolvedMax < todayYmd ? resolvedMax : todayYmd;
    }

    const selected = ymdToDate(ymd);
    const minDate = ymdToDate(resolvedMin);
    const maxDate = ymdToDate(resolvedMax);
    const locked = Boolean(disabled || readOnly);

    const [month, setMonth] = React.useState<Date>(
      () => selected ?? maxDate ?? minDate ?? new Date()
    );
    React.useEffect(() => {
      if (selected) setMonth(selected);
    }, [ymd]);

    const [textValue, setTextValue] = React.useState(() =>
      ymd ? formatDateOnlyDisplay(ymd) : ''
    );
    React.useEffect(() => {
      setTextValue(ymd ? formatDateOnlyDisplay(ymd) : '');
    }, [ymd]);

    const commit = (next: string) => {
      setDisplayYmd(next);
      const el = hiddenRef.current;
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(el, next);
      }
      emitChange(onChange, el, next, name);
    };

    const tryCommitTyped = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        commit('');
        return;
      }
      const parsed = parseDisplayDateInput(trimmed);
      if (!parsed) {
        setTextValue(ymd ? formatDateOnlyDisplay(ymd) : '');
        return;
      }
      const next = toYmd(parsed);
      if (!withinBounds(next, resolvedMin, resolvedMax)) {
        setTextValue(ymd ? formatDateOnlyDisplay(ymd) : '');
        return;
      }
      commit(next);
      setMonth(parsed);
    };

    const fieldClass = cn(
      'flex w-full min-w-0 max-w-full items-center justify-between gap-2 box-border text-left tabular-nums',
      'px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl border text-base outline-none transition-all',
      'border-slate-200/90 dark:border-slate-600/75 hcms-glass-input',
      'text-slate-900 dark:text-white',
      'focus-within:ring-2 focus-within:ring-primary-500/25 focus-within:border-primary-500/70',
      'disabled:cursor-not-allowed disabled:opacity-60',
      className
    );

    const startMonth = React.useMemo(() => {
      if (minDate) return new Date(minDate.getFullYear(), minDate.getMonth(), 1);
      // Broad history for DOB / historical filters; still clipped by min when set
      return new Date(1920, 0, 1);
    }, [minDate]);

    const endMonth = React.useMemo(() => {
      if (maxDate) return new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
      const year = Number(todayYmd.slice(0, 4));
      const y = Number.isFinite(year) ? year : new Date().getFullYear();
      return new Date(y + 5, 11, 1);
    }, [maxDate, todayYmd]);

    const displayPlaceholder = placeholder || DISPLAY_DATE_PLACEHOLDER;

    return (
      <div className="relative w-full min-w-0 max-w-full" data-hcms-date-picker="">
        <input
          {...props}
          ref={hiddenRef}
          id={id}
          name={name}
          type="text"
          inputMode="none"
          autoComplete="off"
          required={required}
          disabled={disabled}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          {...(isControlled
            ? { value: ymd, onChange: () => undefined }
            : { defaultValue: String(defaultValue ?? '') })}
          onBlur={onBlur}
        />
        <Popover
          open={locked ? false : open}
          onOpenChange={(next) => {
            if (locked) return;
            setOpen(next);
          }}
        >
          <div
            className={cn(
              fieldClass,
              'pr-1.5 sm:pr-2',
              !ymd && !textValue && 'text-slate-400 dark:text-slate-500'
            )}
          >
            <input
              ref={textRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              disabled={locked}
              placeholder={displayPlaceholder}
              value={textValue}
              aria-label={displayPlaceholder}
              className="min-w-0 flex-1 bg-transparent border-0 p-0 text-base text-inherit outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
              onChange={(e) => {
                const next = restrictToDateDigits
                  ? maskDdMmYyyyInput(e.target.value)
                  : e.target.value;
                setTextValue(next);
                if (restrictToDateDigits && next.length === 10) {
                  tryCommitTyped(next);
                }
              }}
              onPaste={
                restrictToDateDigits
                  ? (e) => {
                      e.preventDefault();
                      const pasted = e.clipboardData.getData('text');
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? textValue.length;
                      const end = el.selectionEnd ?? textValue.length;
                      const merged =
                        textValue.slice(0, start) + pasted + textValue.slice(end);
                      const next = maskDdMmYyyyInput(merged);
                      setTextValue(next);
                      if (next.length === 10) tryCommitTyped(next);
                    }
                  : undefined
              }
              onBlur={(e) => {
                const raw = restrictToDateDigits
                  ? maskDdMmYyyyInput(e.target.value)
                  : e.target.value;
                tryCommitTyped(raw);
                onBlur?.({
                  target: hiddenRef.current,
                  currentTarget: hiddenRef.current,
                } as React.FocusEvent<HTMLInputElement>);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  tryCommitTyped(textValue);
                  setOpen(false);
                }
              }}
            />
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={locked}
                aria-label="Open calendar"
                className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <CalendarIcon className="h-4 w-4 opacity-70" aria-hidden />
              </button>
            </PopoverTrigger>
          </div>
          <PopoverContent
            align="start"
            sideOffset={6}
            className="w-auto p-0 border-0 bg-transparent shadow-none"
            style={{ zIndex: Z_TOAST + 20 }}
            data-hcms-date-picker=""
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-950 shadow-xl">
              <Calendar
                mode="single"
                selected={selected}
                month={month}
                onMonthChange={setMonth}
                enableMonthYearWheel
                startMonth={startMonth}
                endMonth={endMonth}
                onSelect={(day) => {
                  if (!day) {
                    commit('');
                    return;
                  }
                  commit(toYmd(day));
                  setOpen(false);
                  onBlur?.({
                    target: hiddenRef.current,
                    currentTarget: hiddenRef.current,
                  } as React.FocusEvent<HTMLInputElement>);
                }}
                disabled={[
                  ...(minDate ? [{ before: minDate }] : []),
                  ...(maxDate ? [{ after: maxDate }] : []),
                ]}
              />
              {ymd ? (
                <div className="border-t border-slate-100 dark:border-white/10 px-2 py-1.5">
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                    onClick={() => {
                      commit('');
                      setOpen(false);
                    }}
                  >
                    Clear date
                  </button>
                </div>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }
);
DatePickerInput.displayName = 'DatePickerInput';
