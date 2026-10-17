import React from 'react';
import { CheckCircle2, User, Users } from 'lucide-react';
import { ContentSkeleton } from '../common/ContentSkeleton';
import { ListSearchFilterBar } from '../ui/page';
import {
  EmployeeListIdentityBlock,
  EmployeeListIdentityCells,
  type EmployeeListIdentityData,
} from '../employee/EmployeeListIdentity';
import { ListPagination } from '../ui/ListPagination';
import { DEFAULT_LIST_PAGE_SIZE, visiblePages } from '../../utils/visiblePages';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../../utils/listColumnSort';
import type { WizardStep } from '../EmployeeWizardStepper';
import {
  WorkflowQueueFilterMenu,
  WorkflowQueueTabs,
  type WorkflowQueueFilterConfig,
} from './WorkflowQueueFilterMenu';

export const WORKFLOW_SELECT_STEP: WizardStep = {
  id: 'select',
  label: 'Selection',
  description: 'Pick who to review from the queue.',
  icon: User,
};

export const WORKFLOW_STEP_SELECT = 0;

export function withSelectStep(steps: WizardStep[]): WizardStep[] {
  return [WORKFLOW_SELECT_STEP, ...steps];
}

export function workflowStepWithSelectOffset(workflowStepIndex: number): number {
  return workflowStepIndex + 1;
}

export function workflowStepWithoutSelectOffset(currentStep: number): number {
  return Math.max(0, currentStep - 1);
}

export type WorkflowSelectColumn<T> = {
  id: string;
  header: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T) => React.ReactNode;
  /** Optional value extractor for table-layout column sorting. */
  sortValue?: (row: T) => string | number;
};

type Props<T> = {
  query: string;
  onQueryChange: (q: string) => void;
  rows: T[];
  loading: boolean;
  selectedKey: string | null;
  selectedIdentity: EmployeeListIdentityData | null;
  getKey: (row: T) => string;
  getIdentity: (row: T) => EmployeeListIdentityData;
  onSelect: (row: T | null) => void;
  searchPlaceholder?: string;
  countLabel: string;
  pickHint?: string;
  continueHint?: string;
  emptyMessage?: string;
  renderTrailing?: (row: T, active: boolean) => React.ReactNode;
  queueFilter?: WorkflowQueueFilterConfig;
  selectedExtra?: React.ReactNode;
  /** Span the full width of the container instead of the default centered, narrow column. */
  fullWidth?: boolean;
  /**
   * 'cards' (default) renders the scrollable card list; 'table' renders a paginated
   * employee-list-style table; 'detail' renders a paginated list of rich cards via `renderCard`.
   */
  layout?: 'cards' | 'table' | 'detail';
  /** Card renderer for the 'detail' layout. The row click/selection is handled by the wrapper. */
  renderCard?: (row: T, active: boolean) => React.ReactNode;
  /** Extra columns for the table layout, placed after the Employee column and before the action cell. */
  columns?: WorkflowSelectColumn<T>[];
  /** Header label for the trailing action column (table layout). Defaults to a visually-hidden "Action". */
  actionHeader?: string;
  /** Rows per page for the table layout. Defaults to the standard list page size. */
  pageSize?: number;
  /** Plural noun for the pagination summary, e.g. "appraisals", "reviews". Defaults to "employees". */
  itemLabel?: string;
  /** Changing this value resets pagination to page 1 (e.g. when the period/phase changes). */
  resetKey?: string;
};

const TABLE_TH_CLASS =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider';
const TABLE_TD_CLASS =
  'px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-900 dark:text-white align-middle';

function alignClass(align: 'left' | 'center' | 'right' | undefined): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

export function WorkflowSelectStep<T>({
  query,
  onQueryChange,
  rows,
  loading,
  selectedKey,
  selectedIdentity,
  getKey,
  getIdentity,
  onSelect,
  searchPlaceholder = 'Search by ID, name, or email…',
  countLabel,
  pickHint = 'Tap an employee to select',
  continueHint = 'Selected — tap again to unselect, or use Next to continue',
  emptyMessage = 'No employees match your search.',
  renderTrailing,
  queueFilter,
  selectedExtra,
  fullWidth = false,
  layout = 'cards',
  renderCard,
  columns,
  actionHeader,
  pageSize = DEFAULT_LIST_PAGE_SIZE,
  itemLabel = 'employees',
  resetKey,
}: Props<T>) {
  const isTable = layout === 'table';
  const isPaged = layout === 'table' || layout === 'detail';

  type SortCol = 'employeeId' | 'employeeName' | string;
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();

  React.useEffect(() => {
    if (!isTable) return;
    resetSort();
  }, [isTable, query, queueFilter?.activeTab, resetKey, resetSort]);

  const displayRows = React.useMemo(() => {
    if (!isTable) return rows;
    const getSortValue = (row: T, col: SortCol): string | number => {
      const identity = getIdentity(row);
      if (col === 'employeeId') return identity.employeeId;
      if (col === 'employeeName') return identity.displayName;
      const customCol = columns?.find((c) => c.id === col);
      if (customCol?.sortValue) return customCol.sortValue(row);
      return '';
    };
    return sortRowsByColumn(rows, sortBy, sortOrder, getSortValue);
  }, [isTable, rows, sortBy, sortOrder, columns, getIdentity]);

  const [page, setPage] = React.useState(1);
  const total = displayRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  // Reset to the first page whenever the result set or active filter changes.
  React.useEffect(() => {
    setPage(1);
  }, [query, queueFilter?.activeTab, total, resetKey, sortBy, sortOrder]);

  const pageRows = isPaged ? displayRows.slice((safePage - 1) * pageSize, safePage * pageSize) : displayRows;
  const showingFrom = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const showingTo = total === 0 ? 0 : showingFrom + pageRows.length - 1;
  const pagesWindow = React.useMemo(
    () => visiblePages(safePage, totalPages, 5),
    [safePage, totalPages]
  );

  const showQueueFilterMenu = Boolean(queueFilter);

  const searchAndFilter = (
    <ListSearchFilterBar
      searchValue={query}
      onSearchChange={onQueryChange}
      searchPlaceholder={searchPlaceholder}
      filter={showQueueFilterMenu ? <WorkflowQueueFilterMenu {...queueFilter!} /> : undefined}
    />
  );

  if (layout === 'detail') {
    return (
      <div className={`space-y-4 w-full ${fullWidth ? '' : 'max-w-3xl mx-auto'}`}>
        {searchAndFilter}

        {loading ? (
          <ContentSkeleton layout="list" rows={4} label="Loading employees…" />
        ) : total === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-500">
            {emptyMessage}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {pageRows.map((row) => {
                const key = getKey(row);
                const active = selectedKey === key;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(active ? null : row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(active ? null : row);
                      }
                    }}
                    className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-xl"
                  >
                    {renderCard ? renderCard(row, active) : null}
                  </div>
                );
              })}
            </div>

            <ListPagination
              from={showingFrom}
              to={showingTo}
              total={total}
              itemLabel={itemLabel}
              currentPage={safePage}
              totalPages={totalPages}
              pagesWindow={pagesWindow}
              onPageChange={setPage}
              hideWhenEmpty={false}
              className="rounded-xl border border-slate-200 dark:border-slate-700"
            />
          </>
        )}
      </div>
    );
  }

  if (isTable) {
    return (
      <div className={`space-y-4 w-full ${fullWidth ? '' : 'max-w-3xl mx-auto'}`}>
        {searchAndFilter}

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
          {loading ? (
            <ContentSkeleton layout="list" rows={4} className="p-3" label="Loading employees…" />
          ) : total === 0 ? (
            <p className="p-8 text-sm text-center text-slate-500">{emptyMessage}</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-700/50">
                    <tr>
                      <SortableTableHeader
                        label="ID"
                        column="employeeId"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={TABLE_TH_CLASS}
                      />
                      <SortableTableHeader
                        label="Employee"
                        column="employeeName"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={TABLE_TH_CLASS}
                      />
                      {columns?.map((col) => (
                        <SortableTableHeader
                          key={col.id}
                          label={typeof col.header === 'string' ? col.header : col.id}
                          column={col.id}
                          sortBy={sortBy}
                          sortOrder={sortOrder}
                          onToggle={toggleSort}
                          className={`${TABLE_TH_CLASS} ${alignClass(col.align)} ${col.headerClassName ?? ''}`}
                          align={col.align}
                        />
                      ))}
                      {renderTrailing ? (
                        <th className={`${TABLE_TH_CLASS} text-right`}>
                          {actionHeader ? actionHeader : <span className="sr-only">Action</span>}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                    {pageRows.map((row) => {
                      const key = getKey(row);
                      const active = selectedKey === key;
                      return (
                        <tr
                          key={key}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelect(active ? null : row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelect(active ? null : row);
                            }
                          }}
                          className={`cursor-pointer transition-colors ${
                            active
                              ? 'bg-primary-50 dark:bg-primary-950/40'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/60'
                          }`}
                        >
                          <EmployeeListIdentityCells
                            data={getIdentity(row)}
                            idCellClassName={`${TABLE_TD_CLASS} font-mono text-sm font-medium whitespace-nowrap`}
                            identityCellClassName={TABLE_TD_CLASS}
                            avatarClassName="h-8 w-8 sm:h-9 sm:w-9 md:h-10 md:w-10 shrink-0"
                          />
                          {columns?.map((col) => (
                            <td
                              key={col.id}
                              className={`${TABLE_TD_CLASS} ${alignClass(col.align)} ${col.cellClassName ?? ''}`}
                            >
                              {col.render(row)}
                            </td>
                          ))}
                          {renderTrailing ? (
                            <td className={`${TABLE_TD_CLASS} text-right`} data-stop-row-toggle>
                              <div className="flex justify-end">{renderTrailing(row, active)}</div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="lg:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {pageRows.map((row) => {
                  const key = getKey(row);
                  const active = selectedKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSelect(active ? null : row)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3 text-left transition-all ${
                        active
                          ? 'bg-primary-50 dark:bg-primary-950/40 border-l-4 border-l-primary-500'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-4 border-l-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <EmployeeListIdentityBlock
                          data={getIdentity(row)}
                          compactOnMobile
                          avatarClassName="h-8 w-8 sm:h-9 sm:w-9 shrink-0"
                        />
                      </div>
                      {renderTrailing ? renderTrailing(row, active) : null}
                    </button>
                  );
                })}
              </div>

              <ListPagination
                from={showingFrom}
                to={showingTo}
                total={total}
                itemLabel={itemLabel}
                currentPage={safePage}
                totalPages={totalPages}
                pagesWindow={pagesWindow}
                onPageChange={setPage}
                hideWhenEmpty={false}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-5 w-full ${fullWidth ? '' : 'max-w-3xl mx-auto'}`}>
      {selectedIdentity ? (
        <div className="flex items-center gap-3 rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            <EmployeeListIdentityBlock
              data={selectedIdentity}
              avatarClassName="w-11 h-11 shrink-0 ring-2 ring-primary-200 dark:ring-primary-800"
            />
            {selectedExtra ? <div className="mt-2 flex flex-wrap gap-1.5">{selectedExtra}</div> : null}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300 shrink-0">
            <CheckCircle2 className="w-4 h-4" aria-hidden />
            Selected
          </span>
        </div>
      ) : null}

      {searchAndFilter}

      <div className="flex items-center justify-between text-xs text-slate-500 px-0.5 gap-2">
        <span className="inline-flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" aria-hidden />
          {loading ? 'Loading…' : countLabel}
        </span>
        {!selectedKey ? (
          <span>{pickHint}</span>
        ) : (
          <span className="text-primary-600 dark:text-primary-400 font-medium">{continueHint}</span>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="max-h-[min(28rem,52vh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <ContentSkeleton layout="list" rows={4} className="p-3" label="Loading employees…" />
          ) : rows.length ? (
            rows.map((row) => {
              const key = getKey(row);
              const active = selectedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(active ? null : row)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-all ${
                    active
                      ? 'bg-primary-50 dark:bg-primary-950/40 border-l-4 border-l-primary-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <EmployeeListIdentityBlock
                      data={getIdentity(row)}
                      avatarClassName="w-10 h-10 shrink-0"
                    />
                  </div>
                  {renderTrailing ? (
                    renderTrailing(row, active)
                  ) : active ? (
                    <CheckCircle2 className="w-5 h-5 text-primary-600 dark:text-primary-400 shrink-0" />
                  ) : (
                    <span className="w-5 h-5 rounded-full border-2 border-slate-200 dark:border-slate-600 shrink-0" />
                  )}
                </button>
              );
            })
          ) : (
            <p className="p-8 text-sm text-center text-slate-500">{emptyMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
