import React, { useEffect, useMemo, useState } from 'react';
import {
  getSortIconState,
  SortIcon,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';
import { useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, ChevronDown, ChevronLeft, RotateCcw, Search } from 'lucide-react';
import { Api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { PERM } from '../../constants/permissionKeys';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { InfoDetailsButton } from '../ui/InfoDetailsButton';
import { LoadingState } from '../common/LoadingState';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { DatePickerInput } from '../ui/shadcn/date-picker-input';
import { orderInclusiveStartEnd } from '../../utils/dateRangeFilter';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import { DEFAULT_LIST_PAGE_SIZE } from '../../utils/visiblePages';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportReportRun, formatReportCell } from '../../utils/exportReportCatalog';
import { setReportCatalogTitles } from '../../utils/reportCatalogTitleCache';
import type {
  ReportDefinition,
  ReportFilterField,
  ReportRunResult,
  ReportSummaryCard,
} from '../../types/reportCatalog';

/** Fixed list viewport so every report output panel aligns to the same height. */
const REPORT_LIST_VIEWPORT_CLASS =
  'h-[min(28rem,55vh)] min-h-[16rem] overflow-auto rounded-lg border border-primary-200/80 dark:border-primary-800/50 shadow-sm';

const filterInputClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-base w-full min-w-0 max-w-full';

const filterInputCompactClass =
  'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-base w-full min-w-0 max-w-full';

const filterFieldShellClass = 'block min-w-0 w-full text-xs font-medium text-slate-600 dark:text-slate-400';

function defaultFilters(def: ReportDefinition | undefined): Record<string, string> {
  if (!def) return {};
  const out: Record<string, string> = {};
  for (const f of def.filters) {
    out[f.key] = f.defaultValue ?? '';
  }
  return out;
}

/** Keep From ≤ To when either date changes (past → present/future order). */
function applyReportFilterChange(
  prev: Record<string, string>,
  key: string,
  value: string
): Record<string, string> {
  const next = { ...prev, [key]: value };
  if (key !== 'startDate' && key !== 'endDate') return next;
  const ordered = orderInclusiveStartEnd(
    String(next.startDate || ''),
    String(next.endDate || ''),
    key
  );
  next.startDate = ordered.startDate;
  next.endDate = ordered.endDate;
  return next;
}

function FilterFieldControl({
  field,
  value,
  onChange,
  departments,
  compact = false,
  minDate,
  maxDate,
}: {
  field: ReportFilterField;
  value: string;
  onChange: (v: string) => void;
  departments: Array<{ id: string; name: string }>;
  compact?: boolean;
  minDate?: string;
  maxDate?: string;
}) {
  const inputClass = compact ? filterInputCompactClass : filterInputClass;

  if (field.type === 'department') {
    return (
      <label className={filterFieldShellClass}>
        <span className="truncate block">{field.label}</span>
        <select
          className={inputClass + ' mt-1'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'select' || field.type === 'status') {
    return (
      <label className={filterFieldShellClass}>
        <span className="truncate block">{field.label}</span>
        <select
          className={inputClass + ' mt-1'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options || []).map((o) => (
            <option key={o.value || '__all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === 'date') {
    return (
      <label className={filterFieldShellClass}>
        <span className="truncate block">
          {field.label}
          {field.required ? <span className="text-red-500"> *</span> : null}
        </span>
        <DatePickerInput
          className={compact ? 'mt-1 !rounded-lg !px-2 !py-1.5' : 'mt-1 !rounded-lg !py-2'}
          value={value}
          min={minDate || undefined}
          max={maxDate || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  const inputType = field.type === 'month' ? 'month' : field.type === 'year' ? 'number' : 'text';

  return (
    <label className={filterFieldShellClass}>
      <span className="truncate block">
        {field.label}
        {field.required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        type={inputType}
        className={inputClass + ' mt-1'}
        value={value}
        placeholder={field.placeholder}
        min={field.type === 'year' ? 2000 : undefined}
        max={field.type === 'year' ? 2100 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export const ReportsCatalogView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canExport = hasPermission(PERM.REPORTS_EXPORT);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('report') || '';

  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Collapsed categories; missing key means expanded (default open). */
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  /** Desktop report list rail — mirrors main sidebar open/collapsed. */
  const [listOpen, setListOpen] = useState(true);

  const selected = useMemo(
    () => catalog.find((r) => r.id === selectedId) || null,
    [catalog, selectedId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const [cat, depts] = await Promise.all([
          Api.reports.listCatalog(),
          Api.departments.getAll().catch(() => []),
        ]);
        if (cancelled) return;
        const reports = (cat?.reports || []) as ReportDefinition[];
        setCatalog(reports);
        setReportCatalogTitles(reports);
        const deptList = Array.isArray(depts)
          ? depts.map((d: { id?: string; name?: string }) => ({
              id: String(d.id || ''),
              name: String(d.name || ''),
            }))
          : [];
        setDepartments(deptList.filter((d) => d.id));
        if (!selectedId && reports[0]) {
          setSearchParams({ report: reports[0].id }, { replace: true });
        }
      } catch (e) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Failed to load report catalog', 'error');
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setFilters(defaultFilters(selected));
    setResult(null);
    setError(null);
    // Reset when the selected report id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on id
  }, [selected?.id]);

  /** Auto-load results when the report or filters change (no manual Run). */
  useEffect(() => {
    if (!selected) {
      setRunning(false);
      setResult(null);
      setError(null);
      return;
    }

    const missingRequired = selected.filters.some(
      (f) => f.required && !String(filters[f.key] ?? '').trim()
    );
    if (missingRequired) {
      setRunning(false);
      setResult(null);
      setError(null);
      return;
    }

    const start = String(filters.startDate || '').trim().slice(0, 10);
    const end = String(filters.endDate || '').trim().slice(0, 10);
    if (start && end && start > end) {
      setRunning(false);
      setResult(null);
      setError('From date must be on or before To date');
      return;
    }

    let cancelled = false;
    setRunning(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const payload = await Api.reports.run({ reportId: selected.id, filters });
        if (!cancelled) setResult(payload as ReportRunResult);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Failed to load report';
          setError(msg);
          setResult(null);
          showToast(msg, 'error');
        }
      } finally {
        if (!cancelled) setRunning(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selected, filters, showToast]);

  const grouped = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const filtered = catalog.filter((r) => {
      if (!q) return true;
      return `${r.title} ${r.description} ${r.categoryLabel}`.toLowerCase().includes(q);
    });
    const map = new Map<string, ReportDefinition[]>();
    for (const r of filtered) {
      const key = r.categoryLabel || r.category || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [catalog, listSearch]);

  const selectedCategory = selected
    ? selected.categoryLabel || selected.category || 'Other'
    : '';

  /** Keep the active report's category open so the selection stays visible. */
  useEffect(() => {
    if (!selectedCategory) return;
    setCollapsedCategories((prev) => {
      if (!prev.has(selectedCategory)) return prev;
      const next = new Set(prev);
      next.delete(selectedCategory);
      return next;
    });
  }, [selectedCategory, selectedId]);

  const isCategoryExpanded = (category: string) => {
    if (listSearch.trim()) return true;
    return !collapsedCategories.has(category);
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const selectReport = (id: string) => {
    setSearchParams({ report: id });
  };

  const resetFilters = () => {
    if (selected) setFilters(defaultFilters(selected));
  };

  const onExport = async (format: ExportFileExt) => {
    if (!result || !canExport) return;
    try {
      await exportReportRun(result, format);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed', 'error');
    }
  };

  if (catalogLoading) {
    return <LoadingState layout="table" />;
  }

  const reportList = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-slate-100 dark:border-slate-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            className={filterInputClass + ' pl-8'}
            placeholder="Search reports…"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {grouped.map(([category, items]) => {
          const expanded = isCategoryExpanded(category);
          return (
            <div key={category} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                aria-expanded={expanded}
                className="w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <span className="flex-1 text-left truncate">{category}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {expanded ? (
                <ul className="space-y-0.5 ml-1 pl-2 border-l border-slate-200 dark:border-slate-700">
                  {items.map((r) => {
                    const active = r.id === selectedId;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => selectReport(r.id)}
                          className={
                            'w-full text-left rounded-lg px-2.5 py-2 transition-colors ' +
                            (active
                              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200')
                          }
                        >
                          <span className="block text-sm font-medium leading-snug">{r.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
        {!grouped.length && (
          <p className="text-sm text-slate-500 px-2 py-4">No reports match your search.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[60vh]">
      {/* Mobile report picker */}
      <div className="lg:hidden">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          Report
        </label>
        <select
          className={filterInputClass}
          value={selectedId}
          onChange={(e) => selectReport(e.target.value)}
        >
          {catalog.map((r) => (
            <option key={r.id} value={r.id}>
              {r.categoryLabel}: {r.title}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop list — collapses to an icon rail like the main sidebar */}
      <aside
        className={
          'hidden lg:flex shrink-0 flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden max-h-[75vh] transition-all duration-300 motion-reduce:transition-none ' +
          (listOpen ? 'w-72' : 'w-[4.5rem] min-w-[4.5rem] max-w-[4.5rem]')
        }
      >
        <div
          className={
            'border-b border-slate-100 dark:border-slate-700 flex items-center shrink-0 h-11 ' +
            (listOpen ? 'justify-between px-3' : 'justify-center px-1')
          }
        >
          {listOpen ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-4 w-4 text-primary-600 shrink-0" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  All reports
                </span>
              </div>
              <button
                type="button"
                onClick={() => setListOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
                aria-label="Collapse report list"
                title="Collapse"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setListOpen(true)}
              className="flex items-center justify-center rounded-xl p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-primary-600 transition-colors"
              aria-label="Expand report list"
              title="Expand report list"
            >
              <FileSpreadsheet className="h-5 w-5" />
            </button>
          )}
        </div>
        {listOpen ? reportList : null}
      </aside>

      <div className="flex-1 min-w-0 space-y-2.5">
        {selected ? (
          <>
            <Card
              title={selected.title}
              className="overflow-hidden p-3 sm:p-3.5"
              action={
                <div className="flex items-center gap-1.5">
                  {canExport ? (
                    <ExportFormatMenu
                      variant="button"
                      formats={['pdf', 'csv', 'xlsx']}
                      onExport={onExport}
                      disabled={running || !result?.rows.length}
                    />
                  ) : null}
                  {selected.description ? (
                    <InfoDetailsButton
                      title={selected.title}
                      summary={selected.description}
                      ariaLabel={`About ${selected.title}`}
                    />
                  ) : null}
                </div>
              }
            >
              {selected.filters.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2 min-w-0">
                  {selected.filters.map((field) => (
                    <div
                      key={field.key}
                      className={
                        selected.filters.length <= 2
                          ? 'min-w-[9.5rem] w-44 max-w-full'
                          : 'min-w-[8.5rem] w-40 max-w-full'
                      }
                    >
                      <FilterFieldControl
                        field={field}
                        value={filters[field.key] ?? ''}
                        departments={departments}
                        compact
                        minDate={
                          field.key === 'endDate'
                            ? String(filters.startDate || '').slice(0, 10) || undefined
                            : undefined
                        }
                        maxDate={
                          field.key === 'startDate'
                            ? String(filters.endDate || '').slice(0, 10) || undefined
                            : undefined
                        }
                        onChange={(v) =>
                          setFilters((prev) => applyReportFilterChange(prev, field.key, v))
                        }
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={resetFilters}
                    disabled={running}
                    className="gap-1.5 h-9 px-2 shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No filters required for this report.</p>
              )}
            </Card>

            <div className="stacked-card-shell">
              <div className="stacked-card-layer stacked-card-layer--back" aria-hidden />
              <div className="stacked-card-layer stacked-card-layer--mid" aria-hidden />
              <Card
                title="Report output"
                className="stacked-card-face border-slate-200/90 shadow-[0_10px_28px_-12px_rgba(15,23,42,0.28)] dark:border-slate-600/80 dark:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.55)] p-3 sm:p-3.5"
                action={
                  result ? (
                    <InfoDetailsButton
                      title="Result details"
                      summary={result.meta.note || undefined}
                      ariaLabel="Result details"
                      rows={[
                        {
                          label: 'Rows',
                          value: `${result.meta.rowCount} row${result.meta.rowCount === 1 ? '' : 's'}`,
                        },
                        {
                          label: 'Generated',
                          value: new Date(result.meta.generatedAt).toLocaleString(),
                        },
                        ...Object.entries(result.meta.filtersApplied || {}).map(([label, value]) => ({
                          label,
                          value: value || 'All',
                        })),
                      ]}
                    />
                  ) : null
                }
              >
                {running && <LoadingState layout="table" />}
                {!running && error && (
                  <p className="text-sm text-red-600 dark:text-red-400 py-4 text-center">{error}</p>
                )}
                {!running && !error && !result && (
                  <p className="text-sm text-slate-500 py-6 text-center">
                    Set the required filters to load this report.
                  </p>
                )}
                {!running && result && (
                  <>
                    <div className="flex flex-wrap gap-1.5 mb-2.5 min-w-0">
                      {buildDisplaySummaryCards(result).map((card, i) => (
                        <ReportSummaryStatCard
                          key={card.key || `${card.label}-${i}`}
                          label={card.label}
                          value={formatSummaryCard(card.value, card.format)}
                        />
                      ))}
                    </div>
                    {result.rows.length === 0 ? (
                      <div className={`${REPORT_LIST_VIEWPORT_CLASS} flex items-center justify-center`}>
                        <p className="text-sm text-slate-500 text-center px-4">No rows for these filters.</p>
                      </div>
                    ) : (
                      <ReportResultsTable result={result} />
                    )}
                  </>
                )}
              </Card>
            </div>
          </>
        ) : (
          <Card title="Select a report" className="p-3 sm:p-3.5">
            <p className="text-sm text-slate-500 py-4 text-center">
              Pick a report from the list to view results.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
};

function ReportSummaryStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 px-2 py-1 min-w-0 basis-[calc(33.333%-0.375rem)] sm:basis-auto sm:min-w-[5.5rem] grow">
      <p className="text-[9px] uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate leading-tight">
        {label}
      </p>
      <p className="text-xs sm:text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100 truncate leading-tight">
        {value}
      </p>
    </div>
  );
}

/** Prefer API summary cards; avoid duplicating a Rows chip the API already sends. */
function buildDisplaySummaryCards(result: ReportRunResult): ReportSummaryCard[] {
  const fromApi = result.summary?.cards || [];
  if (fromApi.length) return fromApi.slice(0, 16);
  return [{ key: 'rows', label: 'Rows', value: result.meta.rowCount, format: 'number' }];
}

function ReportResultsTable({ result }: { result: ReportRunResult }) {
  type SortCol = string;
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();

  useEffect(() => {
    resetSort();
  }, [result.reportId, result.meta.generatedAt, resetSort]);

  const sortedRows = useMemo(() => {
    const getSortValue = (row: (typeof result.rows)[number], colKey: SortCol): string | number => {
      const col = result.columns.find((c) => c.key === colKey);
      const raw = row[colKey];
      if (raw == null || raw === '') return '';
      if (
        col?.format === 'number' ||
        col?.format === 'currency' ||
        col?.format === 'percent'
      ) {
        const n = Number(raw);
        return Number.isFinite(n) ? n : String(raw);
      }
      return String(raw);
    };
    return sortRowsByColumn(result.rows, sortBy, sortOrder, getSortValue);
  }, [result.rows, result.columns, sortBy, sortOrder]);

  const indexedRows = useMemo(
    () => sortedRows.map((row, index) => ({ row, index })),
    [sortedRows]
  );
  const {
    pageItems,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    indexedRows,
    DEFAULT_LIST_PAGE_SIZE,
    `${result.reportId}|${result.meta.generatedAt}|${result.meta.rowCount}|${sortBy}|${sortOrder}`
  );

  const reportThClass =
    'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] uppercase tracking-wide font-semibold text-white whitespace-nowrap border-r border-white/25 last:border-r-0';

  return (
    <div className="min-w-0">
      <div className={`${REPORT_LIST_VIEWPORT_CLASS} -mx-0.5`}>
        <table className="min-w-full text-left border-collapse">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-primary-600 dark:bg-primary-700">
              {result.columns.map((col) => (
                <th
                  key={col.key}
                  className={
                    reportThClass +
                    (col.align === 'right'
                      ? ' text-right'
                      : col.align === 'center'
                        ? ' text-center'
                        : ' text-left')
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center max-w-full font-semibold text-white hover:text-white/85 truncate ${
                      col.align === 'center'
                        ? 'justify-center w-full'
                        : col.align === 'right'
                          ? 'justify-end w-full'
                          : ''
                    }`}
                  >
                    <span className="truncate">{col.label}</span>
                    <SortIcon state={getSortIconState(sortBy, sortOrder, col.key)} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.map(({ row, index }) => (
              <tr
                key={index}
                className={
                  index % 2 === 0
                    ? 'bg-primary-50/70 dark:bg-primary-950/30'
                    : 'bg-primary-100/60 dark:bg-primary-900/25'
                }
              >
                {result.columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 whitespace-nowrap border-r border-white/70 dark:border-slate-800/60 last:border-r-0 ' +
                      (col.align === 'right'
                        ? 'text-right tabular-nums'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left')
                    }
                  >
                    {formatReportCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result.summary?.totalsRow ? (
            <tfoot className="sticky bottom-0 z-[1]">
              <tr className="bg-primary-200/80 dark:bg-primary-800/50 border-t-2 border-primary-400/60 dark:border-primary-600">
                {result.columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap ' +
                      (col.align === 'right'
                        ? 'text-right tabular-nums'
                        : col.align === 'center'
                          ? 'text-center'
                          : 'text-left')
                    }
                  >
                    {formatReportCell(col, result.summary!.totalsRow!)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Pagination sits on the Report output card, outside the list viewport */}
      <ListPagination
        from={showingFrom}
        to={showingTo}
        total={totalCount}
        itemLabel="rows"
        currentPage={currentPage}
        totalPages={totalPages}
        pagesWindow={pagesWindow}
        onPageChange={setCurrentPage}
        className="mt-2 rounded-lg border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40"
        hideWhenEmpty={false}
      />
    </div>
  );
}

function formatSummaryCard(
  value: string | number,
  format?: 'text' | 'number' | 'currency' | 'percent'
): string {
  if (format === 'currency' || format === 'number' || format === 'percent') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (format === 'currency') {
      return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    }
    if (format === 'percent') return `${n}%`;
    return n.toLocaleString();
  }
  return String(value);
}

export default ReportsCatalogView;
