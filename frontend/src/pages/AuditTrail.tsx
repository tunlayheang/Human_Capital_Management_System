import React, { useCallback, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { Api } from '../services/api';
import { Card } from '../components/ui/Card';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { PageShell, ListSearchFilterBar } from '../components/ui/page';
import { Button } from '../components/ui/Button';
import { History, RefreshCw } from 'lucide-react';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import { countActiveFilters } from '../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../utils/dateRangeFilter';
import { ListPagination } from '../components/ui/ListPagination';
import { LoadingState } from '../components/common/LoadingState';
import { useClientPagination } from '../utils/useClientPagination';
import {
  EmployeeListIdentityCells,
  employeeListIdentityFromAuditActor,
} from '../components/employee/EmployeeListIdentity';
import { AuditTrailDetailPanel } from '../components/audit/AuditTrailDetailPanel';
import {
  buildAuditEntityFilterOptions,
  canonicalizeAuditEntityType,
  formatAuditActionLabel,
  formatAuditEntityLabel,
} from '../utils/auditTrailDisplay';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportListTable } from '../utils/export/exportListTable';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../utils/listColumnSort';

type AuditActor = {
  id?: string;
  name?: string;
  email?: string;
  phone?: string | null;
  employeeCode?: string | null;
  role?: string;
};

type TrailRow = {
  id: string;
  source?: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  reason?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
  performedBy: string;
  changedBy?: AuditActor | null;
  createdAt?: string;
};

type SortCol = 'id' | 'name' | 'time' | 'entity' | 'action' | 'reason';

const auditTrailThClass =
  'text-left px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-sm font-semibold whitespace-nowrap';

const formatDate = (value?: string) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

export const AuditTrail: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TrailRow[]>([]);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();
  const trailFilterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: entityFilter, defaultValue: '' }]) +
      countDateRangeFilters(dateRange),
    [entityFilter, dateRange]
  );

  const tabCache = useWorkspaceTabCache<{
    rows: TrailRow[];
    search: string;
    entityFilter: string;
    dateRange: typeof EMPTY_DATE_RANGE;
  }>({
    slot: 'audit-trail-v1',
    cacheKey: 'trail',
    getSnapshot: () => ({ rows, search, entityFilter, dateRange }),
    applySnapshot: (cached) => {
      setRows(cached.rows);
      setSearch(cached.search);
      setEntityFilter(cached.entityFilter);
      setDateRange(cached.dateRange);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.rows.length > 0,
    persistDeps: [rows, search, entityFilter, dateRange],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const data = (await Api.system.getAuditTrail({ limit: 500 })) as TrailRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load audit trail', error);
      if (!opts?.background) setRows([]);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  const entityOptions = useMemo(
    () => buildAuditEntityFilterOptions(rows.map((r) => r.entityType).filter(Boolean)),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (entityFilter && canonicalizeAuditEntityType(row.entityType) !== entityFilter) {
        return false;
      }
      if (!recordMatchesDateRange(row.createdAt, dateRange)) return false;
      if (!q) return true;
      const actor = row.changedBy;
      const actorText = [
        actor?.employeeCode,
        actor?.name,
        actor?.email,
        actor?.phone,
        row.performedBy,
      ]
        .filter(Boolean)
        .join(' ');
      const entityLabel = formatAuditEntityLabel(row.entityType);
      const oldVal = row.oldValue && typeof row.oldValue === 'object' ? JSON.stringify(row.oldValue) : '';
      const newVal = row.newValue && typeof row.newValue === 'object' ? JSON.stringify(row.newValue) : '';
      const target = `${entityLabel} ${row.entityType} ${row.entityId || ''} ${row.action} ${row.reason || ''} ${actorText} ${oldVal} ${newVal}`;
      return target.toLowerCase().includes(q);
    });
  }, [rows, entityFilter, dateRange, search]);

  const sortedRows = useMemo(() => {
    const getSortValue = (row: TrailRow, col: SortCol): string | number => {
      const actor = row.changedBy;
      switch (col) {
        case 'id':
          return actor?.employeeCode ?? row.performedBy ?? '';
        case 'name':
          return actor?.name ?? row.performedBy ?? '';
        case 'time':
          return row.createdAt ? new Date(row.createdAt).getTime() : 0;
        case 'entity':
          return `${formatAuditEntityLabel(row.entityType)} ${row.entityId ?? ''}`.trim();
        case 'action':
          return formatAuditActionLabel(row.action);
        case 'reason':
          return row.reason ?? '';
        default:
          return '';
      }
    };
    return sortRowsByColumn(filtered, sortBy, sortOrder, getSortValue);
  }, [filtered, sortBy, sortOrder]);

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
    `${search}|${entityFilter}|${dateRange.from}|${dateRange.to}|${sortBy}|${sortOrder}`
  );

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Audit_Trail',
        reportTitle: 'Audit Trail',
        sheetName: 'Audit Trail',
        rows: filtered,
        metadata: [
          { label: 'Rows', value: filtered.length },
          { label: 'Search', value: search || 'All records' },
          { label: 'Entity type', value: entityFilter || 'All entities' },
          { label: 'Date from', value: dateRange.from || 'Any' },
          { label: 'Date to', value: dateRange.to || 'Any' },
        ],
        columns: [
          { header: 'Actor Employee Code', value: (row) => row.changedBy?.employeeCode ?? '', width: 16 },
          { header: 'Actor Name', value: (row) => row.changedBy?.name ?? row.performedBy, width: 24 },
          { header: 'Actor Email', value: (row) => row.changedBy?.email ?? '', width: 28 },
          { header: 'Actor Phone', value: (row) => row.changedBy?.phone ?? '', width: 16 },
          { header: 'Created At', value: (row) => formatDate(row.createdAt), width: 18 },
          { header: 'Entity Type', value: (row) => formatAuditEntityLabel(row.entityType), width: 18 },
          { header: 'Entity ID', value: (row) => row.entityId ?? '', width: 18 },
          { header: 'Action', value: (row) => formatAuditActionLabel(row.action), width: 18 },
          { header: 'Reason', value: (row) => row.reason ?? '', width: 28 },
          { header: 'Performed By', value: (row) => row.performedBy, width: 20 },
        ],
      });
    },
    [dateRange.from, dateRange.to, entityFilter, filtered, search]
  );

  return (
    <PageShell className="space-y-6">
      <Card
        title="Audit Trail"
        icon={<History className="w-5 h-5 text-primary-600" />}
        action={
          <Button
            variant="outline"
            onClick={() => void load()}
            icon={<RefreshCw className="w-4 h-4" />}
            iconOnly
            title="Refresh"
            aria-label="Refresh"
          />
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Unified audit history for profile updates, field corrections, employee movements, payroll
          rules, exchange rate, settings, KPI appraisals, and payroll workflow actions. Every action
          shows Field / Before / After when values changed.
        </p>
        <ListSearchFilterBar
          className="mt-4"
          leading={
            <ExportFormatMenu
              formats={['csv', 'xlsx']}
              disabled={loading || filtered.length === 0}
              onExport={handleExport}
            />
          }
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search action/entity/user"
          filter={
            <PageFilterMenu
              activeCount={trailFilterActiveCount}
              onClear={() => {
                setEntityFilter('');
                setDateRange(EMPTY_DATE_RANGE);
                resetSort();
              }}
            >
              <FilterMenuDateRange
                from={dateRange.from}
                to={dateRange.to}
                onChange={setDateRange}
                fromLabel="Date from"
                toLabel="Date to"
              />
              <FilterMenuSelect
                label="Entity type"
                value={entityFilter}
                onChange={setEntityFilter}
                options={[
                  { value: '', label: 'All entities' },
                  ...entityOptions,
                ]}
              />
            </PageFilterMenu>
          }
        />
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <LoadingState variant="panel" layout="table" label="Loading audit trail…" />
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No audit events found.</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr>
                  <SortableTableHeader
                    label="ID"
                    column="id"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <SortableTableHeader
                    label="Actor"
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <SortableTableHeader
                    label="Time"
                    column="time"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <SortableTableHeader
                    label="Entity"
                    column="entity"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <SortableTableHeader
                    label="Action"
                    column="action"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <SortableTableHeader
                    label="Reason"
                    column="reason"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditTrailThClass}
                  />
                  <th className={auditTrailThClass}>Details</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                    <EmployeeListIdentityCells
                      data={employeeListIdentityFromAuditActor(row.changedBy, row.performedBy)}
                      hideAvatar
                      idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap align-top text-xs sm:text-sm"
                      identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 min-w-0 align-top"
                    />
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm">{formatDate(row.createdAt)}</td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm">
                      <div className="font-medium">{formatAuditEntityLabel(row.entityType)}</div>
                      <div className="text-[10px] sm:text-xs text-slate-500">{row.entityId || formatAuditEntityLabel(row.entityType)}</div>
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap font-semibold text-xs sm:text-sm">
                      {formatAuditActionLabel(row.action)}
                    </td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">{row.reason || '—'}</td>
                    <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">
                      <AuditTrailDetailPanel row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && (
          <ListPagination
            from={showingFrom}
            to={showingTo}
            total={totalCount}
            itemLabel="entries"
            currentPage={currentPage}
            totalPages={totalPages}
            pagesWindow={pagesWindow}
            onPageChange={setCurrentPage}
          />
        )}
      </Card>
    </PageShell>
  );
};

export default AuditTrail;
