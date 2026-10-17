import React from 'react';
import { ListSearchInput } from './ListSearchInput';
import { ListSearchBarShell } from './ListSearchBarShell';
import { cn } from '../../../utils';

export type ListSearchFilterBarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** PageFilterMenu or other filter controls */
  filter?: React.ReactNode;
  /** Controls before the search field (import, etc.) */
  leading?: React.ReactNode;
  /** Extra controls after the filter (export, refresh, etc.) */
  trailing?: React.ReactNode;
  /** Hide the search field when a page only needs filters */
  hideSearch?: boolean;
  /** When search is hidden, align filter controls to the end of the row */
  filterAlign?: 'start' | 'end';
  className?: string;
  searchClassName?: string;
};

export const ListSearchFilterBar: React.FC<ListSearchFilterBarProps> = ({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Search…',
  searchAriaLabel,
  filter,
  leading,
  trailing,
  hideSearch = false,
  filterAlign = 'start',
  className,
  searchClassName,
}) => {
  const hasControls = Boolean(filter || trailing);

  return (
    <ListSearchBarShell
      className={cn(
        hideSearch && filterAlign === 'end' && 'justify-end',
        className
      )}
    >
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}

      {!hideSearch ? (
        <ListSearchInput
          value={searchValue}
          onChange={(value) => onSearchChange?.(value)}
          placeholder={searchPlaceholder}
          ariaLabel={searchAriaLabel}
          className="flex-1 min-w-0 w-auto"
          inputClassName={searchClassName}
        />
      ) : null}

      {hasControls ? (
        <div className="flex flex-row items-center gap-2.5 shrink-0 ml-0.5">
          {filter}
          {trailing}
        </div>
      ) : null}
    </ListSearchBarShell>
  );
};
