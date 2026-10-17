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
import { Activity, RefreshCw } from 'lucide-react';
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

type LoginAuditRow = {
  id: string;
  action: string;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  changedBy?: AuditActor | null;
};

const toDisplayDate = (value?: string) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const inferDeviceFromUserAgent = (value: unknown): string | null => {
  const ua = String(value || '').trim();
  if (!ua) return null;
  const os = /windows nt/i.test(ua)
    ? 'Windows'
    : /android/i.test(ua)
      ? 'Android'
      : /(iphone|ipad|ipod|ios)/i.test(ua)
        ? 'iOS'
        : /mac os x|macintosh/i.test(ua)
          ? 'macOS'
          : /linux/i.test(ua)
            ? 'Linux'
            : null;
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\/|opera/i.test(ua)
      ? 'Opera'
      : /chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\/|opera/i.test(ua)
        ? 'Chrome'
        : /firefox\//i.test(ua)
          ? 'Firefox'
          : /safari\//i.test(ua) && !/chrome\//i.test(ua)
            ? 'Safari'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || null;
};

function parseAuditMetadata(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

type SortCol = 'id' | 'name' | 'time' | 'action' | 'device' | 'ip' | 'reason';

const auditLogThClass =
  'text-left px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-sm font-semibold whitespace-nowrap';

const resolveDeviceLabel = (meta: Record<string, unknown>): string => {
  const fromMetadata = String(meta.deviceLabel || meta.deviceName || meta.device || '').trim();
  if (fromMetadata) return fromMetadata;
  const fromUserAgent = inferDeviceFromUserAgent(meta.userAgent);
  if (fromUserAgent) return fromUserAgent;
  const os = String(meta.os || '').trim();
  const browser = String(meta.browser || '').trim();
  const deviceType = String(meta.deviceType || '').trim();
  if (browser && os) {
    return deviceType ? `${browser} on ${os} (${deviceType})` : `${browser} on ${os}`;
  }
  const fromId = String(meta.deviceId || '').trim();
  if (fromId) return `Device ${fromId.slice(0, 8)}…`;
  return 'Unknown device';
};

export const AuditLogs: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LoginAuditRow[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);

  const auditFilterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: actionFilter, defaultValue: '' }]) +
      countDateRangeFilters(dateRange),
    [actionFilter, dateRange]
  );
  const [search, setSearch] = useState('');
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();

  const tabCache = useWorkspaceTabCache<{
    rows: LoginAuditRow[];
    actionFilter: string;
    dateRange: typeof EMPTY_DATE_RANGE;
    search: string;
  }>({
    slot: 'audit-logs-v1',
    cacheKey: 'logs',
    getSnapshot: () => ({ rows, actionFilter, dateRange, search }),
    applySnapshot: (cached) => {
      setRows(cached.rows);
      setActionFilter(cached.actionFilter);
      setDateRange(cached.dateRange);
      setSearch(cached.search);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.rows.length > 0,
    persistDeps: [rows, actionFilter, dateRange, search],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const data = (await Api.system.getAuditLoginBehavior({ limit: 400 })) as LoginAuditRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load login behavior logs', error);
      if (!opts?.background) setRows([]);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, []);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (actionFilter && row.action !== actionFilter) return false;
      if (!recordMatchesDateRange(row.createdAt, dateRange)) return false;
      if (!q) return true;
      const actor = row.changedBy;
      const actorText = [
        actor?.employeeCode,
        actor?.name,
        actor?.email,
        actor?.phone,
        row.entityId,
      ]
        .filter(Boolean)
        .join(' ');
      const reason = row.reason || '';
      return `${actorText} ${reason}`.toLowerCase().includes(q);
    });
  }, [rows, actionFilter, dateRange, search]);

  const sortedRows = useMemo(() => {
    const getSortValue = (row: LoginAuditRow, col: SortCol): string | number => {
      const meta = parseAuditMetadata(row.metadata);
      const actor = row.changedBy;
      switch (col) {
        case 'id':
          return actor?.employeeCode ?? row.entityId ?? '';
        case 'name':
          return actor?.name ?? '';
        case 'time':
          return row.createdAt ? new Date(row.createdAt).getTime() : 0;
        case 'action':
          return row.action;
        case 'device':
          return resolveDeviceLabel(meta);
        case 'ip':
          return String(meta.ipAddress || meta.ip || '');
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
    `${search}|${actionFilter}|${dateRange.from}|${dateRange.to}|${sortBy}|${sortOrder}`
  );

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Audit_Logs',
        reportTitle: 'Audit Logs',
        sheetName: 'Audit Logs',
        rows: filtered,
        metadata: [
          { label: 'Rows', value: filtered.length },
          { label: 'Search', value: search || 'All logs' },
          { label: 'Action', value: actionFilter || 'All actions' },
          { label: 'Date from', value: dateRange.from || 'Any' },
          { label: 'Date to', value: dateRange.to || 'Any' },
        ],
        columns: [
          { header: 'Employee Code', value: (row) => row.changedBy?.employeeCode ?? '', width: 16 },
          { header: 'User Name', value: (row) => row.changedBy?.name ?? '', width: 24 },
          { header: 'User Email', value: (row) => row.changedBy?.email ?? '', width: 28 },
          { header: 'User Phone', value: (row) => row.changedBy?.phone ?? '', width: 16 },
          { header: 'Created At', value: (row) => toDisplayDate(row.createdAt), width: 18 },
          { header: 'Action', value: (row) => row.action, width: 18 },
          { header: 'Device', value: (row) => resolveDeviceLabel(parseAuditMetadata(row.metadata)), width: 24 },
          { header: 'IP Address', value: (row) => String(parseAuditMetadata(row.metadata).ipAddress || parseAuditMetadata(row.metadata).ip || ''), width: 18 },
          { header: 'Reason', value: (row) => row.reason ?? '', width: 28 },
          { header: 'Entity ID', value: (row) => row.entityId ?? '', width: 18 },
        ],
      });
    },
    [actionFilter, dateRange.from, dateRange.to, filtered, search]
  );

  return (
    <PageShell className="space-y-6">
      <Card
        title="Audit Logs"
        icon={<Activity className="w-5 h-5 text-primary-600" />}
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
          Track user account login behavior: success/failure, OTP verification, device and IP context.
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
          searchPlaceholder="Search by user/reason"
          filter={
            <PageFilterMenu
              activeCount={auditFilterActiveCount}
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
                fromLabel="Date from"
                toLabel="Date to"
              />
              <FilterMenuSelect
                label="Action"
                value={actionFilter}
                onChange={setActionFilter}
                options={[
                  { value: '', label: 'All actions' },
                  { value: 'LOGIN_SUCCESS', label: 'LOGIN_SUCCESS' },
                  { value: 'LOGIN_FAILURE', label: 'LOGIN_FAILURE' },
                  { value: 'OTP_SUCCESS', label: 'OTP_SUCCESS' },
                  { value: 'OTP_FAILURE', label: 'OTP_FAILURE' },
                ]}
              />
            </PageFilterMenu>
          }
        />
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <LoadingState variant="panel" layout="table" label="Loading login behavior logs…" />
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No login logs found.</div>
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
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="User"
                    column="name"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="Time"
                    column="time"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="Action"
                    column="action"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="Device"
                    column="device"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="IP"
                    column="ip"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                  <SortableTableHeader
                    label="Reason"
                    column="reason"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={auditLogThClass}
                  />
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const meta = parseAuditMetadata(row.metadata);
                  return (
                    <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                      <EmployeeListIdentityCells
                        data={employeeListIdentityFromAuditActor(row.changedBy, row.entityId ?? undefined)}
                        hideAvatar
                        idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap align-top text-xs sm:text-sm"
                        identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 min-w-0 align-top"
                      />
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap text-xs sm:text-sm">{toDisplayDate(row.createdAt)}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 whitespace-nowrap font-semibold text-xs sm:text-sm">{row.action}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">{resolveDeviceLabel(meta)}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">{String(meta.ipAddress || '—')}</td>
                      <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm">{row.reason || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && (
          <ListPagination
            from={showingFrom}
            to={showingTo}
            total={totalCount}
            itemLabel="logs"
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

export default AuditLogs;
