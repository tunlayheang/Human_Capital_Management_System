import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { SELECT_OTHER_VALUE } from '../../constants/selectOther';
import {
  isCustomOtherValue,
  isPresetSelectValue,
  presetValuesExcludingOther,
} from '../../utils/selectWithOther';

export type SelectWithOtherOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (stored: string) => void;
  options: SelectWithOtherOption[];
  otherValue?: string;
  otherPlaceholder?: string;
  otherLabel?: string;
  selectClassName?: string;
  inputClassName?: string;
  disabled?: boolean;
  required?: boolean;
  /** Shown on the closed control only — not listed as a choosable dropdown row. */
  emptyOption?: { value: string; label: string };
  selectAriaLabel?: string;
  otherAriaLabel?: string;
  /** Label for the Other row when it is auto-injected (defaults to otherValue). */
  otherOptionLabel?: string;
};

export const SelectWithOther: React.FC<Props> = ({
  value,
  onChange,
  options,
  otherValue = SELECT_OTHER_VALUE,
  otherPlaceholder = 'Type here and press Enter',
  selectClassName = '',
  inputClassName = '',
  disabled = false,
  required = false,
  emptyOption,
  selectAriaLabel,
  otherAriaLabel,
  otherLabel,
  otherOptionLabel,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const listOptions = useMemo(() => {
    if (options.some((o) => o.value === otherValue)) return options;
    return [
      ...options,
      {
        value: otherValue,
        label: otherOptionLabel || otherLabel || otherValue,
      },
    ];
  }, [options, otherValue, otherOptionLabel, otherLabel]);

  const presetList = useMemo(
    () => presetValuesExcludingOther(listOptions.map((o) => o.value), otherValue),
    [listOptions, otherValue]
  );

  const selectClass = selectClassName || inputClassName;
  const inputClass = inputClassName || selectClassName;

  /** Only the bare Other sentinel opens the type-in field. */
  const isTypingMode = String(value).trim() === otherValue;

  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (isTypingMode) setDraft('');
  }, [isTypingMode]);

  useEffect(() => {
    if (isTypingMode) inputRef.current?.focus();
  }, [isTypingMode]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const maxHeight = Math.min(256, window.innerHeight - 16);
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const height = Math.max(96, Math.min(maxHeight, openUpward ? spaceAbove : spaceBelow));
    const top = openUpward
      ? Math.max(8, rect.top - gap - height)
      : Math.min(rect.bottom + gap, Math.max(8, window.innerHeight - height - 8));
    setMenuStyle({
      position: 'fixed',
      top,
      left: rect.left,
      width: rect.width,
      maxHeight: height,
      zIndex: 10000,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition, listOptions.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (emptyOption) return;
    const trimmed = String(value ?? '').trim();
    if (trimmed) return;
    const firstPreset = listOptions.find(
      (o) => o.value && o.value !== otherValue && !o.disabled
    )?.value;
    if (firstPreset) onChange(firstPreset);
  }, [emptyOption, value, listOptions, otherValue, onChange]);

  const commitTyped = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) {
      // Store on the form field only — do not add into the dropdown catalog.
      onChange(trimmed);
      setOpen(false);
      return;
    }
    if (emptyOption) onChange(emptyOption.value);
    else onChange('');
  }, [draft, emptyOption, onChange]);

  const chooseOption = useCallback(
    (optValue: string) => {
      if (optValue === otherValue) {
        onChange(otherValue);
        setDraft('');
        setOpen(false);
        return;
      }
      onChange(optValue);
      setOpen(false);
    },
    [onChange, otherValue]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTyped();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (emptyOption) onChange(emptyOption.value);
      else onChange('');
    }
  };

  const displayLabel = useMemo(() => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return emptyOption?.label ?? 'Select…';
    if (trimmed === otherValue) return otherOptionLabel || otherLabel || otherValue;
    const hit = listOptions.find((o) => o.value === trimmed);
    if (hit) return hit.label;
    return trimmed;
  }, [value, emptyOption, otherValue, otherOptionLabel, otherLabel, listOptions]);

  const showPlaceholder =
    emptyOption && !String(value ?? '').trim();

  if (isTypingMode) {
    const aria = otherAriaLabel ?? otherLabel ?? selectAriaLabel;
    return (
      <div className="relative w-full" ref={rootRef}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={disabled}
          required={required}
          autoComplete="off"
          aria-label={aria}
          placeholder={otherPlaceholder}
          className={`${inputClass} pr-10 w-full`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              if (document.activeElement === inputRef.current) return;
              commitTyped();
            }, 0);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          title="Back to list"
          aria-label="Back to list"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (emptyOption) onChange(emptyOption.value);
            else onChange('');
          }}
        >
          <ChevronDown className="w-4 h-4" aria-hidden />
        </button>
      </div>
    );
  }

  const selectedIsCustom =
    isCustomOtherValue(value, presetList, otherValue) ||
    isPresetSelectValue(value, presetList, otherValue);

  return (
    <div className="relative w-full" ref={rootRef}>
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          required
          value={String(value ?? '')}
          onChange={() => undefined}
        />
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selectAriaLabel ?? otherLabel}
        className={`${selectClass} pr-10 w-full text-left flex items-center min-h-[42px] ${
          showPlaceholder ? 'text-slate-400 dark:text-slate-500' : ''
        }`}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="truncate">{displayLabel}</span>
      </button>
      <ChevronDown
        className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
        aria-hidden
      />

      {open && !disabled
        ? createPortal(
            <ul
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="overflow-auto rounded-xl border border-slate-200/90 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-xl py-1"
            >
              {listOptions.map((opt) => {
                const selected = String(value) === opt.value;
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={opt.disabled || undefined}
                  >
                    <button
                      type="button"
                      disabled={opt.disabled}
                      className={`w-full text-left px-3 py-2 text-sm truncate ${
                        opt.disabled ? 'opacity-45' : ''
                      } ${
                        selected
                          ? 'bg-primary-500 text-white'
                          : 'text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                      onClick={() => {
                        if (!opt.disabled) chooseOption(opt.value);
                      }}
                    >
                      {opt.label}
                    </button>
                  </li>
                );
              })}
              {listOptions.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">No options</li>
              ) : null}
            </ul>,
            document.body
          )
        : null}

      <span className="sr-only">
        {selectedIsCustom ? `Selected: ${displayLabel}` : null}
      </span>
    </div>
  );
};
