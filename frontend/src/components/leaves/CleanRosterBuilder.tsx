import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { ListSearchFilterBar, MonthPeriodNavigator } from '../ui/page';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../../utils/dateRangeFilter';
import { useToast } from '../../context/ToastContext';
import { LeaveType } from '../../types';
import { MonthlyFixedRoster, MonthlyRosterEntry } from '../../types/roster';
import {
  buildRosterPaintableTypes,
  buildRosterPaintTypesWithHoliday,
  buildRosterViewOnlyLeaveTypes,
  findRosterPaintType,
  isRosterPaintableType,
  type RosterTypeId,
} from '../../utils/rosterPaintTypes';
import { getCambodiaPublicHolidays } from '../../constants/cambodiaPublicHolidays';
import { isRosterStaffingOnDay } from '../../utils/rosterOffDays';
import { monthName } from '../../utils/leaveCalendar';
import { useLanguage } from '../../context/LanguageContext';
import {
  localizedLabelUsesKhmerFont,
  resolveLocalizedLabel,
} from '../../utils/localizedEntityLabel';
import { cn } from '../../utils';
import { exportRoster } from '../../utils/rosterExport';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../ui/ExportFormatMenu';
import { useRosterGridHistory } from '../../hooks/useRosterGridHistory';
import {
  applyMonFriWeekendOffPattern,
  applyPublicHolidaysToGrid,
  buildEntriesFromGrid,
  countRosterPayrollWorkDays,
  buildRosterGrid,
  mergeRosterEmployees,
  rosterEmployeeIdsKey,
  type RosterEmployee,
  type RosterGrid,
} from '../../utils/rosterGrid';
import {
  Save,
  Undo,
  Copy,
  Check,
  Info,
  FileText,
} from 'lucide-react';

type Props = {
  employees: RosterEmployee[];
  /** Active leave types from Leave Type Configuration — drives paint palette. */
  leaveTypes?: LeaveType[];
  initialRoster?: MonthlyFixedRoster | null;
  onSave: (payload: {
    month: number;
    year: number;
    name: string;
    entries: MonthlyRosterEntry[];
  }) => void | Promise<boolean>;
  onCancel: () => void;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function cloneGrid(g: RosterGrid): RosterGrid {
  return JSON.parse(JSON.stringify(g));
}

function coveragePctClass(pct: number): string {
  if (pct >= 80) return 'text-emerald-700 bg-emerald-50';
  if (pct >= 60) return 'text-amber-700 bg-amber-50';
  return 'text-red-700 bg-red-50';
}

export const CleanRosterBuilder: React.FC<Props> = ({
  employees: employeesProp,
  leaveTypes = [],
  initialRoster,
  onSave,
  onCancel,
}) => {
  const { language } = useLanguage();
  const { showToast } = useToast();
  const rosterEmployees = useMemo(
    () => mergeRosterEmployees(employeesProp, initialRoster ?? null),
    [employeesProp, initialRoster]
  );
  const deptOptions = useMemo(() => {
    const names = new Set<string>();
    for (const emp of rosterEmployees) {
      const dept = String(emp.department ?? '').trim();
      if (dept) names.add(dept);
    }
    return ['All', ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [rosterEmployees]);
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(initialRoster?.month ?? now.getMonth());
  const [selectedYear, setSelectedYear] = useState(initialRoster?.year ?? now.getFullYear());
  const defaultRosterName = () => {
    const m = monthName(initialRoster?.month ?? now.getMonth());
    const y = initialRoster?.year ?? now.getFullYear();
    return initialRoster?.name ?? `${m} ${y} Roster`;
  };
  const [rosterName, setRosterName] = useState(defaultRosterName);
  const isEditMode = Boolean(initialRoster?.id);
  const [selectedType, setSelectedType] = useState<RosterTypeId>('working');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('All');

  const [dayRange, setDayRange] = useState(EMPTY_DATE_RANGE);
  const rosterFilterActiveCount = useMemo(
    () =>
      countActiveFilters([{ value: deptFilter, defaultValue: 'All' }]) +
      countDateRangeFilters(dayRange),
    [deptFilter, dayRange]
  );
  const [saving, setSaving] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ empId: string; day: number } | null>(null);
  const [didDrag, setDidDrag] = useState(false);

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const visibleDayNumbers = useMemo(() => {
    const prefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    const all = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    if (!dayRange.from && !dayRange.to) return all;
    return all.filter((d) =>
      recordMatchesDateRange(`${prefix}-${String(d).padStart(2, '0')}`, dayRange)
    );
  }, [daysInMonth, selectedMonth, selectedYear, dayRange]);

  const filteredEmployees = useMemo(() => {
    return rosterEmployees.filter((e) => {
      if (deptFilter !== 'All' && e.department !== deptFilter) return false;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, deptFilter, rosterEmployees]);

  const employeeIdsKey = useMemo(() => rosterEmployeeIdsKey(rosterEmployees), [rosterEmployees]);

  const paintableTypes = useMemo(() => buildRosterPaintableTypes(), []);
  const viewOnlyLeaveTypes = useMemo(
    () => buildRosterViewOnlyLeaveTypes(leaveTypes),
    [leaveTypes]
  );
  const paintTypesWithHoliday = useMemo(
    () => buildRosterPaintTypesWithHoliday(leaveTypes),
    [leaveTypes]
  );
  const leaveTypesKey = useMemo(
    () =>
      leaveTypes
        .filter((lt) => lt.isActive !== false)
        .map((lt) => lt.id)
        .sort()
        .join('|'),
    [leaveTypes]
  );

  const initialGrid = useMemo(
    () =>
      buildRosterGrid(
        rosterEmployees,
        daysInMonth,
        selectedMonth,
        selectedYear,
        initialRoster ?? null,
        leaveTypes
      ),
    [
      rosterEmployees,
      daysInMonth,
      selectedMonth,
      selectedYear,
      initialRoster?.id,
      initialRoster?.updatedAt,
      leaveTypesKey,
    ]
  );

  const { rosterData, pushHistory, undo, canUndo, resetHistory } =
    useRosterGridHistory(initialGrid);

  const selectedTypeMeta = findRosterPaintType(paintTypesWithHoliday, selectedType);

  useEffect(() => {
    if (!isRosterPaintableType(selectedType, paintTypesWithHoliday)) {
      setSelectedType('working');
    }
  }, [paintTypesWithHoliday, selectedType]);

  useEffect(() => {
    resetHistory(
      buildRosterGrid(
        rosterEmployees,
        daysInMonth,
        selectedMonth,
        selectedYear,
        initialRoster ?? null,
        leaveTypes
      )
    );
    setSelectedCells(new Set());
  }, [
    selectedMonth,
    selectedYear,
    daysInMonth,
    employeeIdsKey,
    leaveTypesKey,
    initialRoster?.id,
    initialRoster?.updatedAt,
    resetHistory,
  ]);

  const handleRosterExport = useCallback(
    async (format: ExportFileExt) => {
      const entries = buildEntriesFromGrid(
        rosterData,
        rosterEmployees,
        daysInMonth,
        paintTypesWithHoliday,
        initialRoster?.entries ?? []
      );
      const roster: MonthlyFixedRoster = {
        id: initialRoster?.id ?? 'draft',
        month: selectedMonth,
        year: selectedYear,
        name: rosterName || 'Draft Roster',
        entries,
        createdAt: initialRoster?.createdAt ?? '',
        updatedAt: new Date().toISOString(),
      };
      const ok = await exportRoster(format, roster, rosterData, rosterEmployees, leaveTypes);
      if (format === 'pdf' && !ok) {
        showToast('Please allow popups to export PDF', 'warning');
      }
    },
    [
      rosterData,
      rosterEmployees,
      daysInMonth,
      paintTypesWithHoliday,
      initialRoster,
      selectedMonth,
      selectedYear,
      rosterName,
      leaveTypes,
      showToast,
    ]
  );

  const applyPatternToEmployees = useCallback(
    (
      employees: typeof rosterEmployees,
      label: string,
      mutate: (grid: RosterGrid) => void
    ) => {
      if (!employees.length) {
        showToast('No employees in scope — clear filters or reload the employee list', 'warning');
        return;
      }
      const next = cloneGrid(rosterData);
      mutate(next);
      pushHistory(next);
      showToast(label, 'success');
    },
    [rosterData, pushHistory, showToast]
  );

  /** Keep roster title aligned with the selected period (create only). */
  useEffect(() => {
    if (isEditMode) return;
    setRosterName(`${monthName(selectedMonth)} ${selectedYear} Roster`);
  }, [selectedMonth, selectedYear, isEditMode]);

  const cellKey = (empId: string, day: number) => `${empId}:${day}`;

  const applyTypeToCells = (cells: Set<string>, type: RosterTypeId) => {
    const next = cloneGrid(rosterData);
    cells.forEach((key) => {
      const [empId, dayStr] = key.split(':');
      const day = Number(dayStr);
      if (next[empId]) next[empId][day] = type;
    });
    pushHistory(next);
  };

  const handleCellClick = (empId: string, day: number) => {
    const next = cloneGrid(rosterData);
    next[empId][day] = selectedType;
    pushHistory(next);
  };

  const handleMouseDown = (empId: string, day: number) => {
    setDidDrag(false);
    setIsSelecting(true);
    setSelectionStart({ empId, day });
    setSelectedCells(new Set([cellKey(empId, day)]));
  };

  const handleMouseEnter = (empId: string, day: number) => {
    if (!isSelecting || !selectionStart) return;
    if (empId !== selectionStart.empId || day !== selectionStart.day) setDidDrag(true);
    const empIds = filteredEmployees.map((e) => e.id);
    const i0 = empIds.indexOf(selectionStart.empId);
    const i1 = empIds.indexOf(empId);
    const d0 = selectionStart.day;
    const d1 = day;
    if (i0 < 0 || i1 < 0) return;
    const minI = Math.min(i0, i1);
    const maxI = Math.max(i0, i1);
    const minD = Math.min(d0, d1);
    const maxD = Math.max(d0, d1);
    const set = new Set<string>();
    for (let i = minI; i <= maxI; i++) {
      for (let d = minD; d <= maxD; d++) set.add(cellKey(empIds[i], d));
    }
    setSelectedCells(set);
  };

  const endSelection = () => {
    if (isSelecting && didDrag && selectedCells.size > 0) {
      applyTypeToCells(selectedCells, selectedType);
    }
    setIsSelecting(false);
    setSelectionStart(null);
    if (didDrag) setSelectedCells(new Set());
    setDidDrag(false);
  };

  const copyWeekdayPattern = () => {
    applyPatternToEmployees(rosterEmployees, 'Weekday pattern applied (Mon–Fri work, weekends off)', (grid) => {
      applyMonFriWeekendOffPattern(grid, rosterEmployees, selectedMonth, selectedYear, daysInMonth);
    });
  };

  const undoWithFeedback = () => {
    if (!canUndo) return;
    undo();
    showToast('Undone', 'success');
  };

  const undoRef = useRef(undoWithFeedback);
  undoRef.current = undoWithFeedback;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const coverageForDay = (day: number) => {
    const total = filteredEmployees.length;
    let working = 0;
    filteredEmployees.forEach((e) => {
      const tid = rosterData[e.id]?.[day] ?? 'working';
      if (isRosterStaffingOnDay(tid)) working++;
    });
    const pct = total ? Math.round((working / total) * 100) : 0;
    const off = total - working;
    return { working, total, pct, off };
  };

  const holidaysByDay = useMemo(() => {
    const prefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    const map = new Map<number, string>();
    for (const h of getCambodiaPublicHolidays(selectedYear)) {
      if (!h.date.startsWith(prefix)) continue;
      const day = Number(h.date.slice(8, 10));
      if (day >= 1 && day <= daysInMonth) map.set(day, h.nameEn);
    }
    return map;
  }, [selectedMonth, selectedYear, daysInMonth]);

  const holidayForDay = (day: number) => {
    const name = holidaysByDay.get(day);
    return name ? { day, name } : undefined;
  };

  const handleSave = async () => {
    const name = rosterName.trim();
    if (!name) {
      showToast('Please enter a roster name before saving', 'warning');
      return;
    }
    if (rosterEmployees.length === 0) {
      showToast('No employees loaded — refresh the page or check employee list', 'error');
      return;
    }
    setSaving(true);
    try {
      const entries = buildEntriesFromGrid(
        rosterData,
        rosterEmployees,
        daysInMonth,
        paintTypesWithHoliday,
        initialRoster?.entries ?? []
      );
      const saveMonth = isEditMode ? (initialRoster?.month ?? selectedMonth) : selectedMonth;
      const saveYear = isEditMode ? (initialRoster?.year ?? selectedYear) : selectedYear;
      const ok = await onSave({
        month: saveMonth,
        year: saveYear,
        name,
        entries,
      });
      if (ok === false) return;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save roster', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[460px] sm:min-h-[520px] rounded-none sm:rounded-xl overflow-hidden border-0 sm:border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Sidebar — paint palette */}
        <aside className="w-full lg:w-[15.5rem] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 max-h-[40vh] lg:max-h-none">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-900 dark:text-white">Paint type</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
              Paint <strong>Working</strong>, <strong>Day Off</strong>, <strong>Public Holiday</strong>, or{' '}
              <strong>Mission</strong> for staffing. Configured leave types below are view-only — use Leave
              requests for those.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            <ul className="space-y-1">
              {paintableTypes.map((t) => {
                const active = selectedType === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedType(t.id as RosterTypeId)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl border text-sm transition-all flex items-center gap-2.5 ${
                        active
                          ? 'border-primary-400 bg-primary-50/90 dark:bg-primary-950/50 shadow-sm'
                          : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold border shrink-0 ${t.color}`}
                      >
                        {t.code}
                      </span>
                      <span
                        className={cn(
                          'flex-1 min-w-0 font-medium text-slate-800 dark:text-slate-200 truncate',
                          localizedLabelUsesKhmerFont(t.name, t.nameKh, language) && 'font-khmer'
                        )}
                      >
                        {resolveLocalizedLabel(t.name, t.nameKh, language)}
                      </span>
                      {active ? <Check className="w-4 h-4 text-primary-600 shrink-0" aria-hidden /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            {viewOnlyLeaveTypes.length > 0 ? (
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1">
                  <FileText className="w-3 h-3" aria-hidden />
                  Leave types (view only)
                </p>
                <ul className="space-y-1" aria-label="Leave types shown for reference only">
                  {viewOnlyLeaveTypes.map((t) => (
                    <li key={t.id}>
                      <div
                        className="w-full text-left px-2.5 py-2 rounded-xl border border-transparent bg-slate-50/80 dark:bg-slate-800/40 text-sm flex items-center gap-2.5 opacity-80 cursor-default"
                        title="Use Leave requests for actual leave. Paint Day Off on the grid for staffing."
                      >
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold border shrink-0 ${t.color}`}
                        >
                          {t.code}
                        </span>
                        <span
                          className={cn(
                            'flex-1 min-w-0 font-medium text-slate-600 dark:text-slate-400 truncate',
                            localizedLabelUsesKhmerFont(t.name, t.nameKh, language) && 'font-khmer'
                          )}
                        >
                          {resolveLocalizedLabel(t.name, t.nameKh, language)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
              Calendar remarks
            </p>
            <div className="flex flex-wrap gap-1.5 px-1 mb-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium',
                  'border-red-200 bg-red-50 text-red-800 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200'
                )}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${findRosterPaintType(paintTypesWithHoliday, 'holiday')?.swatch ?? 'bg-red-600'}`}
                />
                Public Holiday
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium',
                  'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300'
                )}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${findRosterPaintType(paintTypesWithHoliday, 'dayoff')?.swatch ?? 'bg-slate-500'}`}
                />
                Day Off
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium',
                  'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-200'
                )}
              >
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${findRosterPaintType(paintTypesWithHoliday, 'mission')?.swatch ?? 'bg-sky-600'}`}
                />
                Mission
              </span>
            </div>
            <p className="px-1 text-[10px] leading-relaxed text-slate-400">
              National holidays pre-fill as Public Holiday; PH marks the day but staff still count as
              scheduled unless you paint Day Off.
            </p>
          </div>

          <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/20">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Shortcuts</p>
            <div className="space-y-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-9"
                onClick={copyWeekdayPattern}
              >
                <Copy className="w-3.5 h-3.5 mr-2 opacity-70" /> Weekday pattern
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-9"
                onClick={undoWithFeedback}
                disabled={!canUndo}
                title={canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo'}
              >
                <Undo className="w-3.5 h-3.5 mr-2 opacity-70" /> Undo
              </Button>
            </div>
          </div>
        </aside>

        {/* Main workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {/* Roster header: name, period, save */}
            <div className="flex flex-col gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-col gap-1 min-w-0 flex-1 sm:max-w-md">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Roster name
                </span>
                <input
                  value={rosterName}
                  onChange={(e) => setRosterName(e.target.value)}
                  placeholder="e.g. May 2026 Roster"
                  required
                  aria-invalid={!rosterName.trim()}
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-medium bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none ${
                    rosterName.trim()
                      ? 'border-slate-200 dark:border-slate-600'
                      : 'border-amber-400 dark:border-amber-600'
                  }`}
                />
              </label>
              <div className="flex items-center gap-2 shrink-0 sm:pb-0.5">
                <ExportFormatMenu variant="button" onExport={handleRosterExport} formats={['csv', 'xlsx']} />
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || !rosterName.trim()}
                  onClick={handleSave}
                  className="bg-primary-600 hover:bg-primary-700 text-white min-w-[7rem]"
                >
                  <Save className="w-4 h-4 mr-1" />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            <div className="px-4 py-3 space-y-3 bg-slate-50/80 dark:bg-slate-900/50">
              {/* Filters */}
              <ListSearchFilterBar
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search by employee name…"
                className="w-full"
                leading={
                  <MonthPeriodNavigator
                    month={selectedMonth}
                    year={selectedYear}
                    onMonthChange={(m, y) => {
                      setSelectedMonth(m);
                      setSelectedYear(y);
                    }}
                    disabled={isEditMode}
                    daysHint={
                      isEditMode
                        ? `${daysInMonth} days · locked`
                        : `${daysInMonth} days`
                    }
                  />
                }
                filter={
                  <PageFilterMenu
                    title="Filters"
                    activeCount={rosterFilterActiveCount}
                    onClear={() => {
                      setDeptFilter('All');
                      setDayRange(EMPTY_DATE_RANGE);
                    }}
                  >
                    <FilterMenuDateRange
                      from={dayRange.from}
                      to={dayRange.to}
                      onChange={setDayRange}
                      fromLabel="Days from"
                      toLabel="Days to"
                      hint="Limits visible day columns in the current month."
                    />
                    <FilterMenuSelect
                      label="Department"
                      value={deptFilter}
                      onChange={setDeptFilter}
                      options={deptOptions.map((d) => ({
                        value: d,
                        label: d === 'All' ? 'All departments' : d,
                      }))}
                    />
                  </PageFilterMenu>
                }
              />

              {/* Bulk fill */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0 sm:w-24 sm:pt-2">
                  Fill grid
                </span>
                <div className="flex-1 min-w-0 rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full ${
                        selectedCells.size > 0
                          ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {selectedCells.size === 0
                        ? 'No cells selected'
                        : `${selectedCells.size} cell${selectedCells.size === 1 ? '' : 's'} selected`}
                    </span>
                    {selectedTypeMeta ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${selectedTypeMeta.swatch}`} />
                        Active: <strong className="text-slate-700 dark:text-slate-200">{selectedTypeMeta.name}</strong>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!selectedCells.size}
                      onClick={() => applyTypeToCells(selectedCells, selectedType)}
                      className="bg-primary-600 hover:bg-primary-700 text-white"
                    >
                      Apply to selection
                    </Button>
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-500 hover:text-primary-600 disabled:opacity-40 px-2 py-1.5 dark:text-slate-400 dark:hover:text-primary-400"
                      disabled={!selectedCells.size}
                      onClick={() => applyTypeToCells(selectedCells, 'working')}
                    >
                      Clear selection → Working
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg bg-primary-50/60 dark:bg-primary-950/20 border border-primary-100 dark:border-primary-900/40 px-3 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                <Info className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400 mt-0.5" />
                <p>
                  <span className="font-medium text-slate-700 dark:text-slate-300">Click</span> a cell to paint with
                  the active type.{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">Drag</span> to select multiple
                  cells.
                </p>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 min-h-0 flex flex-col relative">
            <div className="flex-1 overflow-auto" onMouseUp={endSelection} onMouseLeave={endSelection}>
              <table className="border-collapse w-max min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800">
                    <th className="sticky top-0 left-0 z-50 bg-slate-100 dark:bg-slate-800 border-b border-r border-slate-200 dark:border-slate-700 px-3 py-2 text-left text-xs font-bold text-slate-600 dark:text-slate-300 min-w-[140px] shadow-[0_1px_0_0_rgba(148,163,184,0.35)]">
                      Employee
                    </th>
                    {visibleDayNumbers.map((day) => {
                      const dow = new Date(selectedYear, selectedMonth, day, 12, 0, 0).getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      const hol = holidayForDay(day);
                      const dayBg = hol
                        ? 'bg-red-50 dark:bg-red-950/40'
                        : isWeekend
                          ? 'bg-blue-50/80 dark:bg-blue-950/30'
                          : 'bg-slate-100 dark:bg-slate-800';
                      return (
                        <th
                          key={day}
                          title={hol ? hol.name : undefined}
                          className={`sticky top-0 z-40 border-b border-slate-200 dark:border-slate-700 p-0 min-w-[42px] shadow-[0_1px_0_0_rgba(148,163,184,0.35)] ${dayBg}`}
                        >
                          <div className="w-full py-1.5 px-0.5">
                            <span
                              className={`block text-sm font-bold leading-none ${
                                hol ? 'text-red-700' : isWeekend ? 'text-blue-700 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'
                              }`}
                            >
                              {day}
                            </span>
                            <span className="block text-[9px] font-medium text-slate-500 mt-0.5">{WEEKDAYS[dow]}</span>
                            {hol && <span className="block text-[8px] font-bold text-red-600 uppercase">PH</span>}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp, rowIdx) => (
                    <tr
                      key={emp.id}
                      className={rowIdx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/80 dark:bg-slate-900/60'}
                    >
                      <td className="sticky left-0 z-20 border-r border-b border-slate-200 dark:border-slate-700 px-3 py-1.5 bg-inherit">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs block truncate max-w-[130px]">
                          {emp.name}
                        </span>
                        <span className="text-[10px] text-slate-500 block">{emp.department}</span>
                        <span className="text-[10px] font-medium text-primary-700 dark:text-primary-300">
                          {countRosterPayrollWorkDays(
                            rosterData,
                            emp.id,
                            daysInMonth,
                            paintTypesWithHoliday
                          )}{' '}
                          work days
                        </span>
                      </td>
                      {visibleDayNumbers.map((day) => {
                        const tid = rosterData[emp.id]?.[day] || 'working';
                        const rt = findRosterPaintType(paintTypesWithHoliday, tid);
                        const sel = selectedCells.has(cellKey(emp.id, day));
                        const isWeekend = [0, 6].includes(
                          new Date(selectedYear, selectedMonth, day, 12, 0, 0).getDay()
                        );
                        return (
                          <td
                            key={day}
                            className={`border-b border-slate-200/80 dark:border-slate-700/80 p-0.5 ${
                              isWeekend && tid === 'working' ? 'bg-blue-50/30 dark:bg-blue-950/20' : ''
                            }`}
                          >
                            <button
                              type="button"
                              className={`w-full min-w-[38px] h-9 rounded-md border-2 font-bold text-xs flex items-center justify-center transition-all select-none ${rt?.color || ''} ${
                                sel
                                  ? 'ring-2 ring-primary-500 ring-offset-1 scale-[1.02] z-10 relative'
                                  : 'hover:brightness-95 hover:scale-[1.03]'
                              }`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleMouseDown(emp.id, day);
                              }}
                              onMouseEnter={() => handleMouseEnter(emp.id, day)}
                              onClick={() => {
                                if (!didDrag) handleCellClick(emp.id, day);
                              }}
                            >
                              {rt?.code}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-20">
                  <tr>
                    <td className="sticky left-0 z-30 bg-slate-200 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400">
                      Coverage
                    </td>
                    {visibleDayNumbers.map((day) => {
                      const cov = coverageForDay(day);
                      return (
                        <td
                          key={day}
                          className={`border-t-2 border-slate-300 dark:border-slate-600 text-center py-1 px-0.5 text-[9px] leading-tight font-semibold ${coveragePctClass(cov.pct)}`}
                        >
                          <span className="block">{cov.pct}%</span>
                          <span className="block font-normal opacity-80">{cov.off} off</span>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="sticky left-0 z-30 bg-slate-100 dark:bg-slate-800/90 border-t border-slate-300 dark:border-slate-600 px-3 py-1.5 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400">
                      Working
                    </td>
                    {visibleDayNumbers.map((day) => {
                      const cov = coverageForDay(day);
                      return (
                        <td
                          key={day}
                          className="border-t border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/80 text-center py-1 px-0.5 text-[10px] leading-tight font-semibold tabular-nums text-slate-700 dark:text-slate-200"
                          title={`${cov.working} of ${cov.total} staff working`}
                        >
                          {cov.working}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>

            {filteredEmployees.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80">
                <p className="text-slate-500 flex items-center gap-2">
                  <Info className="w-4 h-4" /> No employees match your filters
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};
