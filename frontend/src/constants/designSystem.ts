/** Shared Tailwind class strings for forms and surfaces. */
export const inputClass =
  'w-full min-w-0 max-w-full box-border px-3 py-2 sm:px-4 sm:py-2.5 border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-slate-900 dark:text-white rounded-lg sm:rounded-xl text-base outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-primary-500/25 focus:border-primary-500/70 focus:bg-white dark:focus:bg-slate-900/85';

/** Outer shell wrapping search + filter controls (white rounded bar). */
export const listSearchBarShellClass = 'hcms-list-search-bar';

/** Pill search field inside {@link listSearchBarShellClass}. */
export const listSearchPillClass = 'hcms-list-search-pill';

/** Circular filter trigger — pair with search inside {@link listSearchBarShellClass}. */
export const listFilterIconPillClass = 'hcms-list-filter-trigger';

/** Circular trailing control in list toolbars (refresh, close, export, etc.). */
export const listToolbarIconPillClass =
  'hcms-list-filter-trigger hcms-list-toolbar-icon';

/** Solid filter / overlay panel — opaque for readable text over page content. */
export const filterMenuPanelClass =
  'rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-xl';

export const filterMenuPanelHeaderClass =
  'border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800';

/** Selected row inside a filter menu list. */
export const filterMenuOptionSelectedClass =
  'bg-primary-100 dark:bg-primary-900/90 text-primary-900 dark:text-primary-100 font-semibold';

/** @deprecated Use {@link listFilterIconPillClass} for list toolbars. */
export const listFilterPillClass =
  'hcms-list-filter-trigger inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full text-sm font-medium';

export const selectClass =
  'min-w-0 max-w-full box-border border border-slate-200/90 dark:border-slate-600/75 rounded-lg sm:rounded-xl px-3 py-2 sm:py-2.5 text-base hcms-glass-input dark:text-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500/70 outline-none';

export const tableShellClass = 'hcms-table-panel';

export const tableHeadClass = 'hcms-table-head';

/** Compact table header cell — less vertical padding for dense lists. */
export const tableThCompactClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap';

/** Compact table body cell. */
export const tableTdCompactClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-900 dark:text-white align-middle';

export const tableTdCompactMutedClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 align-middle';

export const tableTdCompactMonoClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-mono text-slate-700 dark:text-slate-300 align-middle whitespace-nowrap';
