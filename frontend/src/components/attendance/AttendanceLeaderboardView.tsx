import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { Crown, Medal, Trophy } from 'lucide-react';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import { Card } from '../ui/Card';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import { isFilterActive } from '../../utils/filterActiveCount';
import { EmployeeAvatar } from '../employee/EmployeeAvatar';
import { AttendanceLeaderboardDetailModal } from './AttendanceLeaderboardDetailModal';
import { useLanguage } from '../../context/LanguageContext';
import { LoadingState } from '../common/LoadingState';
import { Api } from '../../services/api';
import { Department } from '../../types';
import {
  userAvatarUrl,
  userDisplayName,
  userDisplayPosition,
  userNameParts,
} from '../../utils/userProfile';
import {
  applyLeaderboardView,
  buildAttendanceLeaderboard,
  defaultLeaderboardDateRange,
  formatLeaderboardAvgClockIn,
  normalizeLeaderboardDateRange,
  type AttendanceLeaderboardRow,
} from '../../utils/attendanceLeaderboard';
import { ListPagination } from '../ui/ListPagination';
import { useClientPagination } from '../../utils/useClientPagination';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { exportListTable } from '../../utils/export/exportListTable';
import {
  getSortIconState,
  SortIcon,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';

const PODIUM_ORDER: Array<{ place: 1 | 2 | 3; rank: number }> = [
  { place: 2, rank: 2 },
  { place: 1, rank: 1 },
  { place: 3, rank: 3 },
];

const PODIUM_STYLES: Record<
  1 | 2 | 3,
  {
    pedestal: string;
    ring: string;
    badge: string;
    label: string;
  }
> = {
  1: {
    pedestal:
      'h-28 sm:h-32 bg-gradient-to-t from-amber-500/90 via-yellow-500/80 to-yellow-400/60 border-amber-400/40 shadow-[0_-8px_32px_rgba(234,179,8,0.35)]',
    ring: 'ring-4 ring-yellow-400/50 dark:ring-yellow-500/40',
    badge: 'bg-gradient-to-br from-yellow-300 to-amber-500 text-amber-950',
    label: '1st',
  },
  2: {
    pedestal:
      'h-20 sm:h-24 bg-gradient-to-t from-slate-400/80 via-slate-300/70 to-slate-200/50 border-slate-300/40 shadow-[0_-6px_24px_rgba(148,163,184,0.25)]',
    ring: 'ring-4 ring-slate-300/50 dark:ring-slate-500/40',
    badge: 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800',
    label: '2nd',
  },
  3: {
    pedestal:
      'h-14 sm:h-16 bg-gradient-to-t from-amber-800/80 via-amber-700/70 to-amber-600/50 border-amber-700/40 shadow-[0_-4px_20px_rgba(180,83,9,0.25)]',
    ring: 'ring-4 ring-amber-600/40 dark:ring-amber-700/40',
    badge: 'bg-gradient-to-br from-amber-600 to-amber-800 text-amber-50',
    label: '3rd',
  },
};

type PodiumSlotProps = {
  row: AttendanceLeaderboardRow | null;
  place: 1 | 2 | 3;
  onSelect: (row: AttendanceLeaderboardRow) => void;
  t: (key: string) => string | undefined;
};

const PodiumSlot: React.FC<PodiumSlotProps> = ({ row, place, onSelect, t }) => {
  const { language } = useLanguage();
  const style = PODIUM_STYLES[place];
  const u = row?.user;

  if (!row || !u) {
    return (
      <div className="flex flex-col items-center flex-1 min-w-0 max-w-[11rem]">
        <div
          className={`w-full rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col items-center justify-center px-3 py-6 mb-2 min-h-[10rem] ${place === 1 ? 'sm:min-h-[11rem]' : ''}`}
        >
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold opacity-40 ${style.badge}`}
          >
            {place}
          </div>
          <p className="text-xs text-slate-400 mt-3 text-center">
            {t('attendance.leaderboardPodiumEmpty') || 'No employee'}
          </p>
        </div>
        <div className={`w-full rounded-t-xl border border-b-0 border-slate-200/60 dark:border-slate-600/60 ${style.pedestal}`} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className={`group flex flex-col items-center flex-1 min-w-0 max-w-[11rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl ${
        place === 1 ? 'sm:-mt-2' : ''
      }`}
    >
      <div
        className={`relative w-full surface-card px-3 pt-4 pb-3 mb-2 transition-all group-hover:shadow-lg group-hover:-translate-y-0.5 ${
          place === 1
            ? 'border-yellow-300/60 dark:border-yellow-600/40 shadow-md shadow-yellow-500/10'
            : place === 2
              ? 'border-slate-200 dark:border-slate-600'
              : 'border-amber-700/30 dark:border-amber-800/40'
        }`}
      >
        <span
          className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-sm ${style.badge}`}
        >
          {style.label}
        </span>
        {place === 1 && (
          <Crown className="absolute top-2 right-2 w-5 h-5 text-yellow-500 drop-shadow-sm" aria-hidden />
        )}
        <div className="flex flex-col items-center text-center mt-1">
          <div className={`relative ${style.ring} rounded-full`}>
            <EmployeeAvatar
              avatarUrl={userAvatarUrl(u)}
              {...userNameParts(u)}
              className={`${place === 1 ? 'w-16 h-16 sm:w-20 sm:h-20' : 'w-14 h-14 sm:w-16 sm:h-16'} border-4 border-white dark:border-slate-800`}
              alt={userDisplayName(u, language)}
            />
            {place === 2 && (
              <Medal className="absolute -bottom-1 -right-1 w-5 h-5 text-slate-400" aria-hidden />
            )}
            {place === 3 && (
              <Medal className="absolute -bottom-1 -right-1 w-5 h-5 text-amber-600" aria-hidden />
            )}
          </div>
          <p className="font-bold text-slate-900 dark:text-white text-sm sm:text-base mt-2 line-clamp-2 leading-tight font-khmer">
            {userDisplayName(u, language)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate w-full mt-0.5">
            {row.departmentName}
          </p>
          <div className="mt-2 flex items-baseline gap-1">
            <Trophy className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden />
            <span className="text-2xl sm:text-3xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
              {row.points}
            </span>
            <span className="text-[10px] font-medium text-slate-400 uppercase">
              {t('attendance.leaderboardPts') || 'pts'}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {t('attendance.leaderboardOnTime') || 'On time'}: {row.presentDays} ·{' '}
            {t('attendance.leaderboardLate') || 'Late'}: {row.lateDays}
          </p>
          {row.isTied && (
            <span className="mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
              {t('attendance.leaderboardSameScoreBadge') || 'Same score'}
            </span>
          )}
        </div>
      </div>
      <div
        className={`w-full rounded-t-xl border border-b-0 border-slate-200/40 dark:border-slate-600/40 ${style.pedestal}`}
        aria-hidden
      />
    </button>
  );
};

type RankRowProps = {
  row: AttendanceLeaderboardRow;
  onSelect: (row: AttendanceLeaderboardRow) => void;
  t: (key: string) => string | undefined;
};

const RankRow: React.FC<RankRowProps> = ({ row, onSelect, t }) => {
  const { language } = useLanguage();
  const u = row.user;
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="w-full grid grid-cols-[2.5rem_1fr_auto] sm:grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,1fr)_5rem_5rem_5.5rem] gap-x-3 sm:gap-x-4 gap-y-1 items-center px-3 sm:px-4 py-3 text-left rounded-xl border border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/80 hover:border-slate-200 dark:hover:border-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 tabular-nums">
        {row.rank}
      </span>
      <div className="col-span-2 sm:col-span-1 flex items-center gap-3 min-w-0">
        <EmployeeAvatar
          avatarUrl={userAvatarUrl(u)}
          {...userNameParts(u)}
          className="w-10 h-10 shrink-0 border-2 border-white dark:border-slate-700"
          alt={userDisplayName(u, language)}
        />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900 dark:text-white truncate text-sm font-khmer">
            {userDisplayName(u, language)}
          </p>
          <p className="text-xs text-slate-500 truncate">{userDisplayPosition(u, language)}</p>
        </div>
      </div>
      <span className="hidden sm:block text-xs text-slate-500 truncate">{row.departmentName}</span>
      <span className="hidden sm:block text-xs text-slate-600 dark:text-slate-400 tabular-nums text-center">
        {row.presentDays}
      </span>
      <span className="hidden sm:block text-xs text-slate-600 dark:text-slate-400 tabular-nums text-center">
        {row.lateDays}
      </span>
      <div className="flex flex-col items-end justify-center">
        <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400 tabular-nums">
          {row.points}
        </span>
        <span className="text-[10px] text-slate-400 sm:hidden">
          {t('attendance.leaderboardOnTime') || 'On time'} {row.presentDays}
        </span>
      </div>
      {row.isTied && (
        <span className="col-span-full sm:col-span-6 text-[10px] text-amber-700 dark:text-amber-300 pl-12 sm:pl-14">
          {t('attendance.leaderboardSameScoreBadge') || 'Same score'}
          {row.clockStats.avgClockInMinutes != null &&
            ` · ${t('attendance.leaderboardAvgClockIn') || 'Avg check-in'}: ${formatLeaderboardAvgClockIn(row.clockStats.avgClockInMinutes)}`}
        </span>
      )}
    </button>
  );
};

export const AttendanceLeaderboardView: React.FC = () => {
  const { t, language } = useLanguage();
  const [dateFrom, setDateFrom] = useState(() => defaultLeaderboardDateRange().from);
  const [dateTo, setDateTo] = useState(() => defaultLeaderboardDateRange().to);
  const [rows, setRows] = useState<AttendanceLeaderboardRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<AttendanceLeaderboardRow | null>(null);

  const range = useMemo(
    () => normalizeLeaderboardDateRange(dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const setRange = useCallback((from: string, to: string) => {
    const n = normalizeLeaderboardDateRange(from, to);
    setDateFrom(n.from);
    setDateTo(n.to);
  }, []);

  const tabCache = useWorkspaceTabCache<{
    rows: AttendanceLeaderboardRow[];
    departments: Department[];
    dateFrom: string;
    dateTo: string;
    departmentFilter: string;
  }>({
    slot: 'attendance-leaderboard-v1',
    getSnapshot: () => ({
      rows,
      departments,
      dateFrom,
      dateTo,
      departmentFilter,
    }),
    applySnapshot: (cached) => {
      setRows(cached.rows);
      setDepartments(cached.departments);
      setDateFrom(cached.dateFrom);
      setDateTo(cached.dateTo);
      setDepartmentFilter(cached.departmentFilter);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.rows.length > 0,
    persistDeps: [rows, departments, dateFrom, dateTo, departmentFilter],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const [recs, usrs, depts] = await Promise.all([
        Api.attendance.getAll({
          historyRange: { from: range.from, to: range.to },
          refresh: true,
        }),
        Api.users.getAll(),
        Api.departments.getAll(),
      ]);
      const list = Array.isArray(usrs) ? usrs : [];
      const records = Array.isArray(recs) ? recs : [];
      const deptList = Array.isArray(depts) ? depts : [];
      setDepartments(deptList);
      const deptNames: Record<string, string> = {};
      deptList.forEach((d: Department) => {
        if (d?.id) deptNames[String(d.id)] = String(d.name ?? d.id);
      });
      setRows(buildAttendanceLeaderboard(list, records, range, deptNames));
    } catch {
      if (!opts?.background) setRows([]);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [range.from, range.to]);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  const displayedRows = useMemo(
    () => applyLeaderboardView(rows, { departmentId: departmentFilter }),
    [rows, departmentFilter]
  );

  const podiumRows = useMemo(() => {
    const byRank = new Map<number, AttendanceLeaderboardRow>();
    displayedRows.forEach((r) => {
      if (r.rank >= 1 && r.rank <= 3) byRank.set(r.rank, r);
    });
    return byRank;
  }, [displayedRows]);

  const restRows = useMemo(
    () => displayedRows.filter((r) => r.rank > 3),
    [displayedRows]
  );

  type LeaderboardSortCol = 'rank' | 'employee' | 'department' | 'presentDays' | 'lateDays' | 'points';
  const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<LeaderboardSortCol>();

  useEffect(() => {
    resetSort();
  }, [departmentFilter, range.from, range.to, resetSort]);

  const sortedRestRows = useMemo(() => {
    const getSortValue = (row: AttendanceLeaderboardRow, col: LeaderboardSortCol): string | number => {
      switch (col) {
        case 'rank':
          return row.rank;
        case 'employee':
          return userDisplayName(row.user, language);
        case 'department':
          return row.departmentName;
        case 'presentDays':
          return row.presentDays;
        case 'lateDays':
          return row.lateDays;
        case 'points':
          return row.points;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: AttendanceLeaderboardRow[]) =>
      rows.sort((a, b) => a.rank - b.rank);
    return sortRowsByColumn(restRows, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [restRows, sortBy, sortOrder, language]);

  const {
    pageItems: pagedRestRows,
    currentPage,
    setCurrentPage,
    totalCount: restCount,
    totalPages,
    showingFrom,
    showingTo,
    pagesWindow,
  } = useClientPagination(
    sortedRestRows,
    undefined,
    `${departmentFilter}|${range.from}|${range.to}|${rows.length}|${sortBy}|${sortOrder}`
  );

  const leader = displayedRows[0] ?? null;

  const departmentOptions = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r) => {
      const id = String(r.user.departmentId || r.departmentId || '').trim();
      if (id) ids.add(id);
    });
    return departments
      .filter((d) => ids.has(String(d.id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  }, [departments, rows]);

  const defaultRange = useMemo(() => defaultLeaderboardDateRange(), []);

  const leaderboardFilterActiveCount = useMemo(() => {
    let count = 0;
    if (isFilterActive(departmentFilter, 'all')) count += 1;
    if (range.from !== defaultRange.from || range.to !== defaultRange.to) count += 1;
    return count;
  }, [departmentFilter, range.from, range.to, defaultRange.from, defaultRange.to]);

  const clearLeaderboardFilters = useCallback(() => {
    setDepartmentFilter('all');
    setRange(defaultRange.from, defaultRange.to);
  }, [defaultRange.from, defaultRange.to, setRange]);

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Attendance_Leaderboard',
        reportTitle: t('attendance.leaderboardTitle') || 'Attendance Leaderboard',
        sheetName: 'Leaderboard',
        rows: displayedRows,
        metadata: [
          { label: 'Rows', value: displayedRows.length },
          { label: 'Period', value: `${range.from} to ${range.to}` },
          {
            label: 'Department',
            value:
              departmentFilter === 'all'
                ? t('attendance.leaderboardAllDepartments') || 'All departments'
                : departmentOptions.find((department) => department.id === departmentFilter)?.name || departmentFilter,
          },
        ],
        columns: [
          { header: 'Rank', value: (row) => row.rank, width: 10 },
          { header: 'Employee ID', value: (row) => row.user.employeeId ?? row.user.id, width: 16 },
          { header: 'Employee Name', value: (row) => userDisplayName(row.user, language), width: 24 },
          { header: 'Department', value: (row) => row.departmentName, width: 20 },
          { header: 'Position', value: (row) => userDisplayPosition(row.user, language), width: 20 },
          { header: 'Points', value: (row) => row.points, width: 12 },
          { header: 'Present Days', value: (row) => row.presentDays, width: 12 },
          { header: 'Late Days', value: (row) => row.lateDays, width: 12 },
          { header: 'Absent Days', value: (row) => row.absentDays, width: 12 },
          { header: 'Leave/Off Days', value: (row) => row.leaveOrOffDays, width: 14 },
          { header: 'Avg Clock In', value: (row) => formatLeaderboardAvgClockIn(row.clockStats.avgClockInMinutes), width: 14 },
          { header: 'Complete Clock Days', value: (row) => row.clockStats.completeClockDays, width: 16 },
          { header: 'Tie Group Size', value: (row) => row.tieGroupSize ?? '', width: 12 },
        ],
      });
    },
    [departmentFilter, departmentOptions, displayedRows, language, range.from, range.to, t]
  );

  const periodLabel = useMemo(() => {
    const a = formatDateOnlyDisplay(range.from, '');
    const b = formatDateOnlyDisplay(range.to, '');
    if (!a || !b) return `${range.from} – ${range.to}`;
    return `${a} – ${b}`;
  }, [range.from, range.to]);

  return (
    <Card
      title={t('attendance.leaderboardTitle') || 'Leaderboard (Top Early Birds)'}
      icon={<Trophy className="w-5 h-5 text-yellow-500" />}
      className="border-slate-200 dark:border-slate-700 shadow-sm"
      help="attendance.leaderboard"
      action={
        <div className="flex items-center gap-2">
          <ExportFormatMenu
            formats={['csv', 'xlsx']}
            disabled={loading || displayedRows.length === 0}
            onExport={handleExport}
          />
          <PageFilterMenu
            activeCount={leaderboardFilterActiveCount}
            onClear={clearLeaderboardFilters}
            className="shrink-0"
          >
            <FilterMenuDateRange
              from={range.from}
              to={range.to}
              onChange={({ from, to }) => setRange(from, to)}
              fromLabel={t('attendance.leaderboardDateFrom') || 'From'}
              toLabel={t('attendance.leaderboardDateTo') || 'To'}
            />
            <FilterMenuSelect
              label={t('attendance.leaderboardDepartment') || 'Department'}
              value={departmentFilter}
              onChange={setDepartmentFilter}
              options={[
                {
                  value: 'all',
                  label: t('attendance.leaderboardAllDepartments') || 'All departments',
                },
                ...departmentOptions.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </PageFilterMenu>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-5 -mt-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-700/80 px-3 py-1.5 text-slate-600 dark:text-slate-300">
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {t('attendance.leaderboardPeriod') || 'Period'}:
          </span>
          {periodLabel}
        </span>
        <span className="inline-flex items-center rounded-full bg-primary-50 dark:bg-primary-900/25 px-3 py-1.5 text-primary-700 dark:text-primary-300 font-medium">
          {displayedRows.length} {t('attendance.leaderboardRanked') || 'ranked'}
        </span>
        {leader && !loading && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 dark:bg-yellow-900/20 px-3 py-1.5 text-amber-800 dark:text-amber-200 font-medium">
            <Crown className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('attendance.leaderboardCurrentLeader') || 'Leader'}:{' '}
            <span className="font-semibold font-khmer">{userDisplayName(leader.user, language)}</span>
            <span className="text-amber-600/80 dark:text-amber-300/80">({leader.points} pts)</span>
          </span>
        )}
      </div>

      {loading ? (
        <LoadingState variant="panel" layout="list" rows={6} label={t('common.loading') || 'Loading…'} />
      ) : displayedRows.length === 0 ? (
        <p className="text-sm text-slate-500 py-12 text-center">
          {t('attendance.leaderboardEmpty') || 'No employees to show.'}
        </p>
      ) : (
        <div className="space-y-8">
          <section aria-label={t('attendance.leaderboardTop3') || 'Top 3'}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-500" />
              {t('attendance.leaderboardTop3') || 'Top 3 — Podium'}
            </h4>
            <div className="rounded-2xl bg-gradient-to-b from-slate-100/80 via-slate-50/40 to-transparent dark:from-slate-800/60 dark:via-slate-900/20 dark:to-transparent border border-slate-200/60 dark:border-slate-700/60 px-3 sm:px-6 pt-6 pb-4">
              <div className="flex items-end justify-center gap-2 sm:gap-4 max-w-2xl mx-auto">
                {PODIUM_ORDER.map(({ place, rank }) => (
                  <PodiumSlot
                    key={place}
                    place={place}
                    row={podiumRows.get(rank) ?? null}
                    onSelect={setDetailRow}
                    t={t}
                  />
                ))}
              </div>
            </div>
          </section>

          {restRows.length > 0 && (
            <section aria-label={t('attendance.leaderboardAllRanks') || 'All rankings'}>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
                {t('attendance.leaderboardAllRanks') || 'Rank 4 and below'}
              </h4>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="hidden sm:grid grid-cols-[3rem_minmax(0,1.4fr)_minmax(0,1fr)_5rem_5rem_5.5rem] gap-x-4 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {(
                    [
                      { col: 'rank' as const, label: '#', align: 'left' as const },
                      {
                        col: 'employee' as const,
                        label: t('attendance.leaderboardColEmployee') || 'Employee',
                        align: 'left' as const,
                      },
                      {
                        col: 'department' as const,
                        label: t('attendance.leaderboardDepartment') || 'Department',
                        align: 'left' as const,
                      },
                      {
                        col: 'presentDays' as const,
                        label: t('attendance.leaderboardOnTime') || 'On time',
                        align: 'center' as const,
                      },
                      {
                        col: 'lateDays' as const,
                        label: t('attendance.leaderboardLate') || 'Late',
                        align: 'center' as const,
                      },
                      {
                        col: 'points' as const,
                        label: t('attendance.totalPoints') || 'Points',
                        align: 'right' as const,
                      },
                    ] as const
                  ).map(({ col, label, align }) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => toggleSort(col)}
                      className={`inline-flex items-center font-bold hover:text-primary-600 dark:hover:text-primary-400 ${
                        align === 'center'
                          ? 'justify-center'
                          : align === 'right'
                            ? 'justify-end'
                            : ''
                      }`}
                    >
                      <span>{label}</span>
                      <SortIcon state={getSortIconState(sortBy, sortOrder, col)} />
                    </button>
                  ))}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700/80">
                  {pagedRestRows.map((row) => (
                    <RankRow key={row.user.id} row={row} onSelect={setDetailRow} t={t} />
                  ))}
                </div>
                <ListPagination
                  from={showingFrom}
                  to={showingTo}
                  total={restCount}
                  itemLabel="employees"
                  currentPage={currentPage}
                  totalPages={totalPages}
                  pagesWindow={pagesWindow}
                  onPageChange={setCurrentPage}
                />
              </div>
            </section>
          )}

          {displayedRows.length <= 3 && restRows.length === 0 && displayedRows.length > 0 && (
            <p className="text-center text-xs text-slate-400 pb-2">
              {t('attendance.leaderboardOnlyTop3') || 'Only top 3 in this filter — adjust department or dates to see more.'}
            </p>
          )}
        </div>
      )}

      <AttendanceLeaderboardDetailModal
        row={detailRow}
        allRows={displayedRows}
        periodLabel={periodLabel}
        onClose={() => setDetailRow(null)}
      />
    </Card>
  );
};
