import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { inputClass } from '../../constants/designSystem';

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Secondary line under the label (role, department, email, …). */
  description?: string;
  /** Extra text used only for matching (IDs, aliases). */
  searchText?: string;
  disabled?: boolean;
};

export type SearchableSelectProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown in the closed field when nothing is selected. */
  emptyLabel?: string;
  /** Require typing before listing options. Default: true. */
  requireSearch?: boolean;
  /** Minimum characters before options appear (when requireSearch). Default: 1. */
  minChars?: number;
  /** Cap matched rows. Default: 40. */
  maxResults?: number;
  /** Optional clearable empty value (e.g. Unassigned / No manager). */
  clearOption?: { value: string; label: string };
  disabled?: boolean;
  required?: boolean;
  className?: string;
  'aria-label'?: string;
};

function optionHaystack(opt: SearchableSelectOption): string {
  return `${opt.label} ${opt.description ?? ''} ${opt.searchText ?? ''}`.toLowerCase();
}

/**
 * Combobox for large option sets (people, employees, leads).
 * By default lists nothing until the user types at least one character,
 * so opening the control does not dump the full org into the DOM.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  searchPlaceholder,
  emptyLabel,
  requireSearch = true,
  minChars = 1,
  maxResults = 40,
  clearOption,
  disabled = false,
  required = false,
  className = inputClass,
  'aria-label': ariaLabel,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  const selectedIsClear =
    Boolean(clearOption) && clearOption!.value === value && !selected;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const place = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 240),
        zIndex: 9999,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const term = query.trim();
  const canList = !requireSearch || term.length >= minChars;

  const matches = useMemo(() => {
    if (!canList) return [];
    const q = term.toLowerCase();
    const rows = !q
      ? options
      : options.filter((o) => optionHaystack(o).includes(q));
    return rows.filter((o) => !o.disabled).slice(0, maxResults);
  }, [canList, term, options, maxResults]);

  const pick = (next: string) => {
    onChange(next);
    setQuery('');
    setOpen(false);
  };

  const closedLabel = selected
    ? selected.description
      ? `${selected.label} · ${selected.description}`
      : selected.label
    : selectedIsClear
      ? clearOption!.label
      : '';

  const displayValue = open || query ? query : closedLabel;

  const hint =
    requireSearch && open && !canList
      ? `Type at least ${minChars} character${minChars === 1 ? '' : 's'} to search`
      : null;

  return (
    <div ref={rootRef} className="relative">
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          required
          value={value}
          onChange={() => undefined}
        />
      ) : null}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          disabled={disabled}
          autoComplete="off"
          aria-label={ariaLabel}
          placeholder={
            selected || selectedIsClear
              ? searchPlaceholder || placeholder
              : emptyLabel || placeholder
          }
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if ((selected || selectedIsClear) && !query) setQuery('');
          }}
          className={`${className} pl-9 pr-9`}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
        />
        {(query || (clearOption ? value !== clearOption.value && Boolean(value) : Boolean(value))) &&
        !disabled ? (
          <button
            type="button"
            aria-label={query ? 'Clear search' : 'Clear selection'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (query) {
                setQuery('');
                inputRef.current?.focus();
                return;
              }
              if (clearOption) {
                pick(clearOption.value);
              }
              inputRef.current?.focus();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && !disabled ? createPortal(
        <ul
          ref={dropdownRef}
          role="listbox"
          style={dropdownStyle}
          className="max-h-56 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900"
        >
          {hint ? (
            <li className="px-3 py-3 text-sm text-slate-400">{hint}</li>
          ) : (
            <>
              {clearOption ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === clearOption.value}
                    className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                      value === clearOption.value
                        ? 'bg-primary-50/70 dark:bg-primary-950/30'
                        : ''
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(clearOption.value);
                    }}
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {clearOption.label}
                    </span>
                  </button>
                </li>
              ) : null}
              {matches.length === 0 ? (
                <li className="px-3 py-3 text-sm text-slate-400">No matching results</li>
              ) : (
                matches.map((opt) => {
                  const active = opt.value === value;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 ${
                          active ? 'bg-primary-50/70 dark:bg-primary-950/30' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pick(opt.value);
                        }}
                      >
                        <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
                          {opt.label}
                        </span>
                        {opt.description ? (
                          <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {opt.description}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </>
          )}
        </ul>,
        document.body
      ) : null}
    </div>
  );
};
