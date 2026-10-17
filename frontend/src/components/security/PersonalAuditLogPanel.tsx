import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { Api } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ListSearchFilterBar } from '../ui/page';
import { LoadingState } from '../common/LoadingState';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import {
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../../utils/listColumnSort';

type PersonalAuditRow = {
  id: string;
  action: string;
  entityType?: string;
  reason?: string | null;
  createdAt?: string;
  ipAddress?: string | null;
  deviceLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

const ACTION_FILTER_KEYS = [
  '',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'OTP_SUCCESS',
  'OTP_FAILURE',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'PIN_UPDATED',
] as const;

type SortCol = 'time' | 'action' | 'category' | 'device' | 'ip' | 'reason';

const personalAuditThClass =
  'text-left px-2 py-1.5 sm:px-3 sm:py-2 font-semibold text-[10px] uppercase tracking-wide text-slate-500';

function toDisplayDate(value?: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function actionLabel(t: (path: string) => string, action: string): string {
  const key = `accountSettings.activity.actions.${action}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return action.replace(/_/g, ' ');
}

function categoryLabel(t: (path: string) => string, entityType?: string): string {
  if (entityType === 'auth_login') return t('accountSettings.activity.categories.auth_login');
  return t('accountSettings.activity.categories.other');
}

export const PersonalAuditLogPanel: React.FC = () => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PersonalAuditRow[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  const [search, setSearch] = useState('');
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await Api.auth.getMyAuditLog({ limit: 300 })) as PersonalAuditRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: actionFilter, defaultValue: '' }]) +
      countDateRangeFilters(dateRange),
    [actionFilter, dateRange]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (actionFilter && row.action !== actionFilter) return false;
      if (!recordMatchesDateRange(row.createdAt, dateRange)) return false;
      if (!q) return true;
      const haystack = `${row.action} ${row.reason || ''} ${row.deviceLabel || ''} ${row.ipAddress || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, actionFilter, dateRange, search]);

  const sortedRows = useMemo(() => {
    const getSortValue = (row: PersonalAuditRow, col: SortCol): string | number => {
      switch (col) {
        case 'time':
          return row.createdAt ? new Date(row.createdAt).getTime() : 0;
        case 'action':
          return actionLabel(t, row.action);
        case 'category':
          return categoryLabel(t, row.entityType);
        case 'device':
          return String(row.deviceLabel || row.metadata?.deviceLabel || '');
        case 'ip':
          return String(row.ipAddress || row.metadata?.ipAddress || '');
        case 'reason':
          return row.reason ?? '';
        default:
          return '';
      }
    };
    return sortRowsByColumn(filtered, sortBy, sortOrder, getSortValue);
  }, [filtered, sortBy, sortOrder, t]);

  const {
    pageItems: pagedRows,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sortedRows,
    undefined,
    `${search}|${actionFilter}|${dateRange.from}|${dateRange.to}|${sortBy}|${sortOrder}`
  );

  const actionOptions = useMemo(
    () =>
      ACTION_FILTER_KEYS.map((value) => ({
        value,
        label: value
          ? actionLabel(t, value)
          : t('accountSettings.activity.actions.all'),
      })),
    [t]
  );

  return (
    <div className="space-y-4 w-full min-w-0">
      <Card
        title={t('accountSettings.tabs.activity')}
        icon={<Activity className="w-5 h-5 text-primary-600" />}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            icon={<RefreshCw className="w-4 h-4" />}
            iconOnly
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          />
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('accountSettings.activity.intro')}</p>
        <ListSearchFilterBar
          className="mt-4"
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('accountSettings.activity.searchPlaceholder')}
          filter={
            <PageFilterMenu
              activeCount={filterActiveCount}
              onClear={() => {
                setActionFilter('');
                setDateRange(EMPTY_DATE_RANGE);
                resetSort();
              }}
            >
              <FilterMenuDateRange
                from={dateRange.from}
                to={dateRange.to}
                onChange={setDateRange}
                fromLabel={t('dashboard.periodFrom')}
                toLabel={t('dashboard.periodTo')}
              />
              <FilterMenuSelect
                label={t('accountSettings.activity.columns.action')}
                value={actionFilter}
                onChange={setActionFilter}
                options={actionOptions}
              />
            </PageFilterMenu>
          }
        />
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <LoadingState
            variant="panel"
            layout="table"
            rows={5}
            label={t('accountSettings.activity.loading')}
            className="p-2 sm:p-3"
          />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-sm text-slate-500 text-center">{t('accountSettings.activity.empty')}</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr>
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.time')}
                    column="time"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={personalAuditThClass}
                  />
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.action')}
                    column="action"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={personalAuditThClass}
                  />
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.category')}
                    column="category"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={`${personalAuditThClass} hidden md:table-cell`}
                  />
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.device')}
                    column="device"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={`${personalAuditThClass} hidden lg:table-cell`}
                  />
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.ip')}
                    column="ip"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={`${personalAuditThClass} hidden sm:table-cell`}
                  />
                  <SortableTableHeader
                    label={t('accountSettings.activity.columns.reason')}
                    column="reason"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={personalAuditThClass}
                  />
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap tabular-nums text-xs sm:text-sm">
                      {toDisplayDate(row.createdAt)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap font-medium text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                      {actionLabel(t, row.action)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 hidden md:table-cell text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      {categoryLabel(t, row.entityType)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 hidden lg:table-cell text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                      {String(row.deviceLabel || row.metadata?.deviceLabel || '—')}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 hidden sm:table-cell font-mono text-[10px] sm:text-xs text-slate-600 dark:text-slate-400">
                      {String(row.ipAddress || row.metadata?.ipAddress || '—')}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-[14rem] truncate">
                      {row.reason || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <ListPagination
            from={showingFrom}
            to={showingTo}
            total={totalCount}
            itemLabel={t('accountSettings.tabs.activity').toLowerCase()}
            currentPage={currentPage}
            totalPages={totalPages}
            pagesWindow={pagesWindow}
            onPageChange={setCurrentPage}
          />
        )}
      </Card>
    </div>
  );
};

export default PersonalAuditLogPanel;
