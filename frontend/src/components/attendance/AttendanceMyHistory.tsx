import React, { useMemo, useState } from 'react';
import { List, MapPin, Map as MapIcon, RefreshCw } from 'lucide-react';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { ListSearchFilterBar, ListToolbarIconButton, listToolbarGlyphClass } from '../ui/page';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  isDateRangeActive,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import { StatusLabel } from '../ui/StatusLabel';
import { useLanguage } from '../../context/LanguageContext';
import type { AttendanceRecord } from '../../types';
import { AttendanceStatus } from '../../types';
import { formatTime } from '../../utils';
import { attendanceStatusLabel } from '../../utils/attendanceStatusLabels';
import { mapsLink } from '../../utils/attendanceGeo';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import { TableLoadingRow } from '../common/LoadingState';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../../utils/listColumnSort';
import { addDaysToDateKey, dateKeyInTimeZone } from '../../utils/attendanceWeek';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';

type Props = {
  records: AttendanceRecord[];
  loading: boolean;
  onRefresh: () => void;
};

type SortCol = 'date' | 'checkIn' | 'checkOut' | 'location' | 'status';

const historyThClass =
  'px-4 sm:px-6 py-3 font-semibold uppercase tracking-wider text-xs';

export const AttendanceMyHistory: React.FC<Props> = ({ records, loading, onRefresh }) => {
  const { t } = useLanguage();
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<SortCol>();
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'all'>('all');
  const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');

  const filteredRecords = useMemo(() => {
    const today = dateKeyInTimeZone(new Date());
    const weekStr = addDaysToDateKey(today, -7);

    return records.filter((rec) => {
      if (isDateRangeActive(dateRange)) {
        if (!recordMatchesDateRange(rec.date, dateRange)) return false;
      } else {
        if (dateFilter === 'today' && rec.date !== today) return false;
        if (dateFilter === 'week' && rec.date < weekStr) return false;
      }
      if (statusFilter !== 'all' && rec.status !== statusFilter) return false;
      return true;
    });
  }, [records, dateFilter, dateRange, statusFilter]);

  const sortedRecords = useMemo(() => {
    const getSortValue = (rec: AttendanceRecord, col: SortCol): string | number => {
      switch (col) {
        case 'date':
          return rec.date;
        case 'checkIn':
          return rec.clockIn ?? '';
        case 'checkOut':
          return rec.clockOut ?? '';
        case 'location':
          return rec.locationIn ? '1' : '0';
        case 'status':
          return attendanceStatusLabel(rec.status, t);
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: AttendanceRecord[]) =>
      rows.sort((a, b) =>
        (b.date + (b.clockIn || '')).localeCompare(a.date + (a.clockIn || ''))
      );
    return sortRowsByColumn(filteredRecords, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [filteredRecords, sortBy, sortOrder, t]);

  const filterActiveCount = useMemo(
    () =>
      countActiveFilters([
        { value: isDateRangeActive(dateRange) ? 'custom' : dateFilter, defaultValue: 'all' },
        { value: statusFilter, defaultValue: 'all' },
      ]) + countDateRangeFilters(dateRange),
    [dateFilter, dateRange, statusFilter]
  );

  const {
    pageItems: pagedRecords,
    currentPage,
    setCurrentPage,
    totalCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sortedRecords,
    undefined,
    `${dateFilter}|${dateRange.from}|${dateRange.to}|${statusFilter}|${sortBy}|${sortOrder}`
  );

  const openMap = (loc?: { lat: number; lng: number }) => {
    if (!loc) return;
    window.open(mapsLink(loc.lat, loc.lng), '_blank');
  };

  const handleExport = async (format: ExportFileExt) => {
    await exportListTable(format, {
      module: 'Attendance_History',
      reportTitle: t('attendance.history') || 'Attendance History',
      sheetName: 'Attendance History',
      rows: filteredRecords,
      metadata: [
        { label: 'Rows', value: filteredRecords.length },
        { label: 'Date range', value: isDateRangeActive(dateRange) ? 'Custom range' : dateFilter },
        { label: 'Date from', value: dateRange.from || 'Any' },
        { label: 'Date to', value: dateRange.to || 'Any' },
        { label: 'Status', value: statusFilter === 'all' ? 'All statuses' : statusFilter },
      ],
      columns: [
        { header: 'Date', value: (row) => row.date, width: 14 },
        { header: 'Clock In', value: (row) => (row.clockIn ? formatTime(row.clockIn) : '—'), width: 12 },
        { header: 'Clock Out', value: (row) => (row.clockOut ? formatTime(row.clockOut) : '—'), width: 12 },
        { header: 'Status', value: (row) => attendanceStatusLabel(row.status, t), width: 16 },
        { header: 'Worked On Day Off', value: (row) => (row.workedOnDayOff ? 'Yes' : 'No'), width: 16 },
        { header: 'Location Latitude', value: (row) => row.locationIn?.lat ?? '', width: 16 },
        { header: 'Location Longitude', value: (row) => row.locationIn?.lng ?? '', width: 16 },
      ],
    });
  };

  return (
    <Card
      title={t('attendance.history') || t('attendance.record') || 'Attendance history'}
      icon={<List className="w-5 h-5 text-primary-600 dark:text-primary-400" />}
      className="overflow-hidden border-slate-200/80 dark:border-slate-700/80 shadow-lg shadow-slate-200/40 dark:shadow-black/20 rounded-2xl"
    >
      <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
        <ListSearchFilterBar
          hideSearch
          filterAlign="end"
          leading={
            <ExportFormatMenu
              formats={['csv', 'xlsx']}
              disabled={loading || filteredRecords.length === 0}
              onExport={handleExport}
            />
          }
          filter={
        <PageFilterMenu
          activeCount={filterActiveCount}
          onClear={() => {
            setDateFilter('all');
            setDateRange(EMPTY_DATE_RANGE);
            setStatusFilter('all');
            resetSort();
          }}
        >
          <FilterMenuDateRange
            from={dateRange.from}
            to={dateRange.to}
            onChange={setDateRange}
            hint="Custom range overrides the presets below."
          />
          <FilterMenuSelect
            label="Date range"
            value={dateFilter}
            onChange={(v) => setDateFilter(v as typeof dateFilter)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'Last 7 days' },
              { value: 'all', label: 'All records' },
            ]}
          />
          <FilterMenuSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: AttendanceStatus.PRESENT, label: 'Present' },
              { value: AttendanceStatus.LATE, label: 'Late' },
              { value: AttendanceStatus.ABSENT, label: 'Absent' },
              { value: AttendanceStatus.DAY_OFF, label: 'Day off' },
              { value: AttendanceStatus.PH, label: 'Public Holiday' },
              { value: AttendanceStatus.MISSION, label: 'Mission' },
              { value: AttendanceStatus.ON_LEAVE, label: 'On leave' },
            ]}
          />
        </PageFilterMenu>
          }
          trailing={
        <ListToolbarIconButton
          onClick={onRefresh}
          icon={<RefreshCw className={listToolbarGlyphClass} />}
          title={t('common.refresh') || 'Refresh'}
          aria-label={t('common.refresh') || 'Refresh'}
        />
          }
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <SortableTableHeader
                label={t('attendance.date') || 'Date'}
                column="date"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={historyThClass}
              />
              <SortableTableHeader
                label={t('attendance.checkIn') || 'Check in'}
                column="checkIn"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={historyThClass}
              />
              <SortableTableHeader
                label={t('attendance.checkOut') || 'Check out'}
                column="checkOut"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={`${historyThClass} hidden md:table-cell`}
              />
              <SortableTableHeader
                label={t('attendance.location') || 'Location'}
                column="location"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={`${historyThClass} hidden lg:table-cell`}
              />
              <SortableTableHeader
                label={t('common.status') || 'Status'}
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onToggle={toggleSort}
                className={historyThClass}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <TableLoadingRow colSpan={5} label={t('common.loading') || 'Loading…'} />
            ) : totalCount === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  {t('attendance.noRecords') || 'No attendance records yet.'}
                </td>
              </tr>
            ) : (
              pagedRecords.map((rec) => (
                <tr
                  key={rec.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-4 sm:px-6 py-3.5 font-medium text-slate-700 dark:text-slate-300">
                    {rec.date}
                  </td>
                  <td className="px-4 sm:px-6 py-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {rec.clockIn ? formatTime(rec.clockIn) : '—'}
                  </td>
                  <td className="hidden md:table-cell px-6 py-3.5 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {rec.clockOut ? formatTime(rec.clockOut) : '—'}
                  </td>
                  <td className="hidden lg:table-cell px-6 py-3.5">
                    {rec.locationIn ? (
                      <button
                        type="button"
                        onClick={() => openMap(rec.locationIn)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 px-2.5 py-1 rounded-lg border border-primary-100 dark:border-primary-800/60 bg-primary-50/80 dark:bg-primary-900/20 transition-colors"
                      >
                        <MapIcon className="w-3.5 h-3.5" />
                        {t('common.viewMap') || 'View map'}
                      </button>
                    ) : (
                      <span className="text-slate-400 text-xs inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {t('common.noData') || '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 sm:px-6 py-3.5">
                    <div className="space-y-1">
                      <StatusLabel
                        status={rec.status}
                        context="attendance"
                        label={attendanceStatusLabel(rec.status, t)}
                        size="sm"
                      />
                      {rec.workedOnDayOff || (rec.status === AttendanceStatus.DAY_OFF && rec.clockIn) ? (
                        <span
                          className="inline-block text-[10px] font-medium text-amber-800 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-950/50 px-1.5 py-0.5 rounded"
                          title={t('attendance.dayOffWorkedHint')}
                        >
                          {t('attendance.dayOffWorkedShortNotice')}
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {!loading && (
        <ListPagination
          from={showingFrom}
          to={showingTo}
          total={totalCount}
          itemLabel="records"
          currentPage={currentPage}
          totalPages={totalPages}
          pagesWindow={pagesWindow}
          onPageChange={setCurrentPage}
        />
      )}
    </Card>
  );
};
