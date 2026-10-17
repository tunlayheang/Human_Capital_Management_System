import React from 'react';

export type ListPaginationProps = {
  from: number;
  to: number;
  total: number;
  /** Plural noun after the count, e.g. "employees", "records", "logs". */
  itemLabel: string;
  currentPage: number;
  totalPages: number;
  pagesWindow: number[];
  onPageChange: (page: number) => void;
  /** Optional note below the status line (e.g. lazy-load hint). */
  footerNote?: React.ReactNode;
  className?: string;
  /** When true, render nothing if total is 0. Default true. */
  hideWhenEmpty?: boolean;
};

const navBtnClass =
  'inline-flex items-center justify-center min-w-[2.25rem] px-2.5 py-1.5 rounded-md border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-sm text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-900/55 disabled:opacity-40 disabled:pointer-events-none';

export const ListPagination: React.FC<ListPaginationProps> = ({
  from,
  to,
  total,
  itemLabel,
  currentPage,
  totalPages,
  pagesWindow,
  onPageChange,
  footerNote,
  className = '',
  hideWhenEmpty = true,
}) => {
  if (hideWhenEmpty && total === 0) return null;

  const atFirst = currentPage <= 1 || total === 0;
  const atLast = currentPage >= totalPages || total === 0;

  return (
    <div
      className={`hcms-table-head hcms-list-pagination px-3 sm:px-4 py-3 sm:py-3.5 border-t border-white/40 dark:border-white/10 ${className}`.trim()}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Showing{' '}
            <span className="font-medium">
              {from}–{to}
            </span>{' '}
            of <span className="font-medium">{total}</span> {itemLabel}
          </p>
          {footerNote}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
          <button
            type="button"
            aria-label="First page"
            title="First page"
            onClick={() => onPageChange(1)}
            disabled={atFirst}
            className={navBtnClass}
          >
            «
          </button>
          <button
            type="button"
            aria-label="Previous page"
            title="Previous page"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={atFirst}
            className={navBtnClass}
          >
            ‹
          </button>

          <div className="flex items-center gap-1 px-1 sm:px-2">
            {pagesWindow.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                disabled={total === 0}
                className={`min-w-[2.25rem] px-2 py-1.5 rounded-md text-sm font-medium border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  currentPage === p
                    ? 'bg-primary-50/80 dark:bg-primary-900/35 border-primary-500 text-primary-700 dark:text-primary-300 backdrop-blur-md'
                    : 'hcms-glass-input border-slate-200/90 dark:border-slate-600/75 text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-900/55'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label="Next page"
            title="Next page"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={atLast}
            className={navBtnClass}
          >
            ›
          </button>
          <button
            type="button"
            aria-label="Last page"
            title="Last page"
            onClick={() => onPageChange(totalPages)}
            disabled={atLast}
            className={navBtnClass}
          >
            »
          </button>
        </div>
      </div>
    </div>
  );
};
