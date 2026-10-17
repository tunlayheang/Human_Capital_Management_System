import React, { useCallback, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

export type SortOrder = 'ASC' | 'DESC';
export type SortIconState = 'none' | 'asc' | 'desc';

/** SVG sort markers — avoids iOS/Android emoji substitution for ↕ ↑ ↓. */
export function SortIcon({ state }: { state: SortIconState }) {
  const iconClass = 'ml-0.5 sm:ml-1 h-3.5 w-3.5 shrink-0';
  if (state === 'asc') {
    return (
      <ChevronUp
        className={`${iconClass} text-primary-600 dark:text-primary-400`}
        aria-hidden
        strokeWidth={2.5}
      />
    );
  }
  if (state === 'desc') {
    return (
      <ChevronDown
        className={`${iconClass} text-primary-600 dark:text-primary-400`}
        aria-hidden
        strokeWidth={2.5}
      />
    );
  }
  return (
    <ChevronsUpDown
      className={`${iconClass} text-slate-400 dark:text-slate-500`}
      aria-hidden
      strokeWidth={2}
    />
  );
}

export function getSortIconState<TCol extends string>(
  sortBy: TCol | null,
  sortOrder: SortOrder,
  col: TCol
): SortIconState {
  if (sortBy !== col) return 'none';
  return sortOrder === 'ASC' ? 'asc' : 'desc';
}

export function compareSortStrings(a: string, b: string, order: SortOrder): number {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return order === 'ASC' ? cmp : -cmp;
}

export function compareSortNumbers(a: number, b: number, order: SortOrder): number {
  const cmp = a - b;
  return order === 'ASC' ? cmp : -cmp;
}

export function compareSortValues(a: string | number, b: string | number, order: SortOrder): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return compareSortNumbers(a, b, order);
  }
  return compareSortStrings(String(a), String(b), order);
}

export function sortRowsByColumn<T, TCol extends string>(
  rows: readonly T[],
  sortBy: TCol | null,
  sortOrder: SortOrder,
  getValue: (row: T, column: TCol) => string | number,
  applyDefaultSort?: (rows: T[]) => T[]
): T[] {
  if (!sortBy) {
    return applyDefaultSort ? applyDefaultSort([...rows]) : [...rows];
  }
  return [...rows].sort((a, b) =>
    compareSortValues(getValue(a, sortBy), getValue(b, sortBy), sortOrder)
  );
}

export function useListColumnSort<TCol extends string>() {
  const [sortBy, setSortBy] = useState<TCol | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const toggleSort = useCallback(
    (col: TCol) => {
      if (sortBy !== col) {
        setSortBy(col);
        setSortOrder('ASC');
        return;
      }
      if (sortOrder === 'ASC') {
        setSortOrder('DESC');
        return;
      }
      setSortBy(null);
      setSortOrder('ASC');
    },
    [sortBy, sortOrder]
  );

  const resetSort = useCallback(() => {
    setSortBy(null);
    setSortOrder('ASC');
  }, []);

  return { sortBy, sortOrder, setSortBy, setSortOrder, toggleSort, resetSort };
}

export const sortableTableThClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider';

type SortableTableHeaderProps<TCol extends string> = {
  label: string;
  column: TCol;
  sortBy: TCol | null;
  sortOrder: SortOrder;
  onToggle: (col: TCol) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
  rowSpan?: number;
  title?: string;
};

export function SortableTableHeader<TCol extends string>({
  label,
  column,
  sortBy,
  sortOrder,
  onToggle,
  className = sortableTableThClass,
  align = 'left',
  rowSpan,
  title,
}: SortableTableHeaderProps<TCol>) {
  return (
    <th
      rowSpan={rowSpan}
      title={title}
      className={`${className} ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}`}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`inline-flex items-center max-w-full font-semibold hover:text-primary-600 dark:hover:text-primary-400 truncate ${
          align === 'center' ? 'justify-center w-full' : align === 'right' ? 'justify-end w-full' : ''
        }`}
      >
        <span className="truncate">{label}</span>
        <SortIcon state={getSortIconState(sortBy, sortOrder, column)} />
      </button>
    </th>
  );
}
