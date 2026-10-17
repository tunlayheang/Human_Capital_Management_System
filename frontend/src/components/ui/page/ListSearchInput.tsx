import React, { forwardRef } from 'react';
import { Search } from 'lucide-react';
import { listSearchPillClass } from '../../../constants/designSystem';
import { cn } from '../../../utils';

export type ListSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  inputClassName?: string;
};

export const ListSearchInput = forwardRef<HTMLInputElement, ListSearchInputProps>(
  (
    {
      value,
      onChange,
      placeholder = 'Search…',
      ariaLabel,
      className,
      inputClassName,
    },
    ref
  ) => (
    <div className={cn('relative min-w-0 w-full', className)}>
      <Search
        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[1.05rem] h-[1.05rem] text-slate-400 dark:text-slate-500 pointer-events-none"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={cn(listSearchPillClass, inputClassName)}
      />
    </div>
  )
);

ListSearchInput.displayName = 'ListSearchInput';
