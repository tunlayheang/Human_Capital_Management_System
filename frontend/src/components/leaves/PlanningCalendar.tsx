import React, { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { cn } from '../../utils';
import { ListSearchFilterBar, MonthPeriodNavigator } from '../ui/page';
import { LoadingState } from '../common/LoadingState';
import { LeaveRequest, User } from '../../types';
import { MonthlyFixedRoster } from '../../types/roster';
import { CalendarPlanningEntry } from '../../types/roster';
import {
  approvedLeavesToEntries,
  entriesForDay,
  monthName,
  padDate,
  rosterToEntries,
} from '../../utils/leaveCalendar';
import { pickBestRosterForMonth } from '../../utils/planningRoster';
import {
  chipClassesForLeaveTypeLabel,
  PLANNING_DAY_OFF_CHIP,
  PLANNING_HOLIDAY_CHIP,
  PLANNING_MISSION_CHIP,
} from '../../utils/leaveTypeColors';
import {
  isDayOffLeaveType,
  planningEntryChipLabel,
} from '../../utils/attendanceStatusLabels';
import { isRosterHoliday, isRosterMission } from '../../utils/rosterOffDays';
import { getCambodiaPublicHolidays } from '../../constants/cambodiaPublicHolidays';
import { Lock } from 'lucide-react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGEND_TYPES: Array<{ key: string; label: string }> = [
  { key: 'Annual Leave', label: 'Annual' },
  { key: 'Sick Leave', label: 'Sick' },
  { key: 'Personal Leave', label: 'Personal' },
  { key: 'Maternity Leave', label: 'Maternity' },
  { key: 'Paternity Leave', label: 'Paternity' },
  { key: 'Unpaid Leave', label: 'Unpaid' },
  { key: 'Emergency Leave', label: 'Emergency' },
];

type RosterEmployeeRef = {
  id: string;
  employeeCode?: string;
  name: string;
  department?: string;
};

type Props = {
  loading?: boolean;
  leaves: LeaveRequest[];
  usersMap: Record<string, User>;
  /** Employee list for fixed-roster name lookup (ids match roster entry employeeId). */
  rosterEmployees?: RosterEmployeeRef[];
  fixedRosters: MonthlyFixedRoster[];
};

function resolveEntryDisplayName(
  entry: CalendarPlanningEntry,
  usersMap: Record<string, User>,
  employeeNamesById: Record<string, string>,
  userByEmployeeId: Record<string, User>
): string {
  if (entry.employeeName?.trim()) return entry.employeeName.trim();
  if (!entry.isFixedRoster) {
    return usersMap[entry.userId]?.name?.trim() || entry.userId;
  }
  const fromRoster = employeeNamesById[entry.userId]?.trim();
  if (fromRoster) return fromRoster;
  const fromUser = userByEmployeeId[entry.userId]?.name?.trim();
  if (fromUser) return fromUser;
  return entry.userId;
}

export const PlanningCalendar: React.FC<Props> = ({
  loading,
  leaves,
  usersMap,
  rosterEmployees = [],
  fixedRosters,
}) => {
  const employeeNamesById = useMemo(() => {
    const m: Record<string, string> = {};
    rosterEmployees.forEach((e) => {
      if (e.id && e.name) m[e.id] = e.name;
      const code = String(e.employeeCode ?? '').trim();
      if (code && e.name) m[code] = e.name;
    });
    return m;
  }, [rosterEmployees]);

  const userByEmployeeId = useMemo(() => {
    const m: Record<string, User> = {};
    Object.values(usersMap).forEach((u) => {
      const eid = String(u.employeeId ?? '').trim();
      if (eid) m[eid] = u;
    });
    return m;
  }, [usersMap]);

  const portalUserIdByEmployeeId = useMemo(() => {
    const m: Record<string, string> = {};
    Object.values(usersMap).forEach((u) => {
      const eid = String(u.employeeId ?? '').trim();
      if (eid && u.id) m[eid] = String(u.id);
    });
    return m;
  }, [usersMap]);

  const { t } = useLanguage();
  const entryDisplayName = (entry: CalendarPlanningEntry) =>
    resolveEntryDisplayName(entry, usersMap, employeeNamesById, userByEmployeeId);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  const month = currentDate.getMonth();
  const year = currentDate.getFullYear();
  const todayIso = padDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const daysInMonth = new Date(year, month + 1, 0, 12, 0, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1, 12, 0, 0).getDay();

  const holidaysByIso = useMemo(() => {
    const map = new Map<string, string>();
    getCambodiaPublicHolidays(year).forEach((h) => {
      map.set(h.date.slice(0, 10), h.nameEn);
    });
    return map;
  }, [year]);

  const approvedEntries = useMemo(() => approvedLeavesToEntries(leaves, month, year), [leaves, month, year]);

  const activeRoster = useMemo(
    () => pickBestRosterForMonth(fixedRosters, year, month),
    [fixedRosters, year, month]
  );

  const rosterEntries = useMemo(() => {
    if (!activeRoster) return [];
    return rosterToEntries(activeRoster, employeeNamesById);
  }, [activeRoster, employeeNamesById]);

  const allEntries = useMemo(() => [...approvedEntries, ...rosterEntries], [approvedEntries, rosterEntries]);

  const entryMatchesSearch = useCallback(
    (entry: CalendarPlanningEntry): boolean => {
      const q = employeeSearch.trim().toLowerCase();
      if (!q) return true;

      const name = entryDisplayName(entry).toLowerCase();
      if (name.includes(q)) return true;

      const u = entry.isFixedRoster
        ? userByEmployeeId[entry.userId] ?? usersMap[entry.userId]
        : usersMap[entry.userId];
      if (String(u?.email ?? '').toLowerCase().includes(q)) return true;
      if (String(u?.position ?? '').toLowerCase().includes(q)) return true;
      if (String(entry.userId ?? '').toLowerCase().includes(q)) return true;

      const rosterEmp = rosterEmployees.find(
        (e) => e.id === entry.userId || String(e.employeeCode ?? '') === entry.userId
      );
      if (String(rosterEmp?.name ?? '').toLowerCase().includes(q)) return true;
      if (String(rosterEmp?.department ?? '').toLowerCase().includes(q)) return true;
      if (String(rosterEmp?.employeeCode ?? '').toLowerCase().includes(q)) return true;

      return false;
    },
    [employeeSearch, usersMap, userByEmployeeId, rosterEmployees, employeeNamesById]
  );

  const filteredEntries = useMemo(() => {
    if (!employeeSearch.trim()) return allEntries;
    return allEntries.filter(entryMatchesSearch);
  }, [allEntries, employeeSearch, entryMatchesSearch]);

  const searchActive = employeeSearch.trim().length > 0;

  const goToMonth = (m: number, y: number) => {
    setCurrentDate(new Date(y, m, 1));
    setExpandedDays(new Set());
  };

  const toggleDayExpanded = (iso: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  const dayCells = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const iso = padDate(year, month, day);
      return { day, iso, entries: entriesForDay(filteredEntries, iso, portalUserIdByEmployeeId) };
    });
  }, [daysInMonth, year, month, filteredEntries, portalUserIdByEmployeeId]);

  const trailingPad = (firstDayOfMonth + daysInMonth) % 7;
  const trailingEmpty = trailingPad === 0 ? 0 : 7 - trailingPad;

  if (loading) {
    return (
      <div className="rounded-xl sm:rounded-2xl border bg-white dark:bg-slate-800 p-4 sm:p-6">
        <LoadingState variant="panel" layout="dashboard" rows={2} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white dark:bg-slate-800 p-4 space-y-4">
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Team Leave Calendar</h3>
          <ListSearchFilterBar
            searchValue={employeeSearch}
            onSearchChange={setEmployeeSearch}
            searchPlaceholder={t('leaves.calendarSearchPlaceholder')}
            className="w-full"
            leading={
              <MonthPeriodNavigator
                month={month}
                year={year}
                onMonthChange={goToMonth}
                aria-label="Calendar month"
              />
            }
          />
        </div>

        {searchActive && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('leaves.calendarSearchActive')}{' '}
            <span className="font-semibold text-slate-900 dark:text-white">
              &ldquo;{employeeSearch.trim()}&rdquo;
            </span>
          </p>
        )}

        <div className="grid grid-cols-7 gap-px bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden">
          {WEEKDAYS.map((wd) => (
            <div
              key={wd}
              className="bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-600 text-center py-2"
            >
              {wd}
            </div>
          ))}
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`pad-start-${i}`} className="min-h-[80px] bg-slate-50 dark:bg-slate-900/80" />
          ))}
          {dayCells.map(({ day, iso, entries }) => {
            const isToday = iso === todayIso;
            const isExpanded = expandedDays.has(iso);
            const holidayName = holidaysByIso.get(iso);
            const maxVisible = isExpanded ? entries.length : 2;
            const visible = entries.slice(0, maxVisible);
            const more = entries.length - Math.min(entries.length, 2);
            const renderEntryChip = (entry: CalendarPlanningEntry) => {
              const name = entryDisplayName(entry);
              const syncLabel = planningEntryChipLabel(entry.type, entry.isFixedRoster, t);
              const chipClass =
                entry.isFixedRoster && isDayOffLeaveType(entry.type)
                  ? `${PLANNING_DAY_OFF_CHIP} hcms-status-tag--sm`
                  : entry.isFixedRoster && isRosterMission(entry.type)
                    ? `${PLANNING_MISSION_CHIP} hcms-status-tag--sm`
                    : entry.isFixedRoster && isRosterHoliday(entry.type)
                      ? `${PLANNING_HOLIDAY_CHIP} hcms-status-tag--sm`
                      : chipClassesForLeaveTypeLabel(entry.type, 0, 'sm');
              return (
                <div
                  key={entry.id}
                  title={`${name}: ${syncLabel}${entry.isFixedRoster ? ' (Fixed roster)' : ' (Approved leave)'}`}
                  className={cn(chipClass, 'max-w-full !text-[10px]')}
                >
                  {entry.isFixedRoster && <Lock className="w-2.5 h-2.5 shrink-0" />}
                  <span className="truncate font-medium">{name}</span>
                </div>
              );
            };
            return (
              <div
                key={iso}
                title={holidayName ? `Public holiday: ${holidayName}` : undefined}
                className={cn(
                  'min-h-[80px] p-1 text-left relative',
                  holidayName
                    ? 'bg-rose-50 dark:bg-rose-950/30'
                    : 'bg-white dark:bg-slate-900',
                  isToday && 'ring-2 ring-primary-500 ring-inset',
                  isExpanded && 'min-h-[120px]'
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      'text-xs font-bold',
                      isToday
                        ? 'text-primary-600 dark:text-primary-400'
                        : holidayName
                          ? 'text-rose-800 dark:text-rose-200'
                          : 'text-slate-700 dark:text-slate-300'
                    )}
                  >
                    {day}
                  </span>
                  {holidayName && (
                    <span
                      className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400 dark:bg-rose-300"
                      aria-hidden
                    />
                  )}
                </div>
                {holidayName && (
                  <p className="mt-0.5 text-[10px] font-medium leading-tight text-rose-700 dark:text-rose-300 truncate">
                    {holidayName}
                  </p>
                )}
                <div
                  className={cn(
                    'mt-1 space-y-0.5',
                    isExpanded && entries.length > 4 && 'max-h-28 overflow-y-auto pr-0.5'
                  )}
                >
                  {visible.map(renderEntryChip)}
                  {!isExpanded && more > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDayExpanded(iso);
                      }}
                      className="text-xs text-primary-600 dark:text-primary-400 font-medium hover:underline w-full text-left"
                    >
                      +{more} more
                    </button>
                  )}
                  {isExpanded && entries.length > 2 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDayExpanded(iso);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 w-full text-left"
                    >
                      Show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {Array.from({ length: trailingEmpty }).map((_, i) => {
            const nextMonth = month === 11 ? 0 : month + 1;
            const nextYear = month === 11 ? year + 1 : year;
            const day = i + 1;
            return (
              <div
                key={`pad-end-${i}`}
                className="min-h-[80px] bg-slate-50 dark:bg-slate-900/80 p-1"
                aria-hidden
              >
                <span className="text-xs font-bold text-slate-400 dark:text-slate-500">{day}</span>
                <span className="sr-only">
                  {monthName(nextMonth)} {nextYear}
                </span>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase">Leave Types</p>
          <div className="flex flex-wrap gap-2">
            {LEGEND_TYPES.map((type, idx) => (
              <span key={type.key} className={chipClassesForLeaveTypeLabel(type.key, idx, 'sm')}>
                {type.label}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={cn(PLANNING_DAY_OFF_CHIP, 'hcms-status-tag--sm')}>
              <Lock className="w-3 h-3 inline mr-1 hcms-status-tag__icon hcms-status-tag__icon--sm" /> Day off (roster)
            </span>
            <span className={cn(PLANNING_MISSION_CHIP, 'hcms-status-tag--sm')}>
              <Lock className="w-3 h-3 inline mr-1 hcms-status-tag__icon hcms-status-tag__icon--sm" /> Mission (roster)
            </span>
            <span className={chipClassesForLeaveTypeLabel('Annual Leave', 0, 'sm')}>
              <Lock className="w-3 h-3 inline mr-1 hcms-status-tag__icon hcms-status-tag__icon--sm" /> On leave (roster)
            </span>
            <span className={cn(PLANNING_HOLIDAY_CHIP, 'hcms-status-tag--sm')}>
              Public holiday
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
