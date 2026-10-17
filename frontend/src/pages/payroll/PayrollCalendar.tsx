import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { getDaysInMonth, startOfMonth, getDay } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/common/LoadingState';
import { Api } from '../../services/api';
import type { PayrollCalendarCycleConfig, PayrollCalendarYear } from '../../types';
import { cn } from '../../utils';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../constants/permissionKeys';
import { Role } from '../../types';
import { useToast } from '../../context/ToastContext';
import { cycleMarkersForDay, dateKey } from './payrollCalendarUtils';
import {
  CYCLE_PAINT_OPTIONS,
  ensureCyclesForYear,
  type CyclePaintField,
  updateCycleDateField,
} from './payrollCalendarCycleUtils';
import { inputClass } from '../../constants/designSystem';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { SectionEditToolbar } from './SectionEditToolbar';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function cellClassForMarkers(
  markers: ReturnType<typeof cycleMarkersForDay>,
  canEdit: boolean
): string {
  const isCutoff = markers.includes('cutoff');
  const isCalc = markers.includes('calc');
  const isApproval = markers.includes('approval');
  const isPayment = markers.includes('payment');

  if (isCutoff) {
    return 'bg-amber-200 text-amber-950 ring-1 ring-amber-400 dark:bg-amber-800/55 dark:text-amber-50 dark:ring-amber-500';
  }
  if (isCalc) {
    return 'bg-primary-200 text-primary-950 ring-1 ring-primary-400 dark:bg-primary-800/55 dark:text-primary-50 dark:ring-primary-500';
  }
  if (isApproval) {
    return 'bg-violet-200 text-violet-950 ring-1 ring-violet-400 dark:bg-violet-800/55 dark:text-violet-50 dark:ring-violet-500';
  }
  if (isPayment) {
    return 'bg-emerald-200 text-emerald-950 ring-1 ring-emerald-400 dark:bg-emerald-800/55 dark:text-emerald-50 dark:ring-emerald-500';
  }
  return cn(
    'text-slate-600 dark:text-slate-400',
    canEdit && 'hover:bg-slate-100 dark:hover:bg-slate-800'
  );
}

export const PayrollCalendar: React.FC = () => {
  const { hasPermission, user } = useAuth();
  const { showToast } = useToast();
  const canEdit =
    user?.role === Role.ADMIN ||
    user?.role === Role.HR ||
    hasPermission(PERM.PAYROLL_EDIT) ||
    hasPermission(PERM.PAYROLL_RULES_EDIT);

  const [year, setYear] = useState(new Date().getFullYear());
  const [calendar, setCalendar] = useState<PayrollCalendarYear | null>(null);
  const [savedRunDates, setSavedRunDates] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cycleConfig, setCycleConfig] = useState<PayrollCalendarCycleConfig | null>(null);
  const [savedCycleConfig, setSavedCycleConfig] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('default');
  const [paintField, setPaintField] = useState<CyclePaintField>('attendanceCutoffDate');
  const [autoFreezeOnCutoff, setAutoFreezeOnCutoff] = useState(true);
  const [savedAutoFreezeOnCutoff, setSavedAutoFreezeOnCutoff] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const editable = canEdit && isEditing;
  const [monthLocks, setMonthLocks] = useState<
    Record<string, Array<{ month: string; status: string }>>
  >({});

  const lockedMonthsForGroup = useMemo(() => {
    const rows = monthLocks[selectedGroupId] ?? monthLocks.default ?? [];
    return new Map(rows.map((r) => [r.month, r.status]));
  }, [monthLocks, selectedGroupId]);

  const isMonthLocked = useCallback(
    (monthIndex: number) => {
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      return lockedMonthsForGroup.has(monthKey);
    },
    [lockedMonthsForGroup, year]
  );

  const tabCache = useWorkspaceTabCache<{
    year: number;
    calendar: PayrollCalendarYear | null;
    savedRunDates: string;
    cycleConfig: PayrollCalendarCycleConfig | null;
    savedCycleConfig: string;
    selectedGroupId: string;
    paintField: CyclePaintField;
    autoFreezeOnCutoff: boolean;
    savedAutoFreezeOnCutoff: boolean;
    monthLocks: Record<string, Array<{ month: string; status: string }>>;
  }>({
    slot: 'payroll-calendar-v2',
    cacheKey: String(year),
    getSnapshot: () => ({
      year,
      calendar,
      savedRunDates,
      cycleConfig,
      savedCycleConfig,
      selectedGroupId,
      paintField,
      autoFreezeOnCutoff,
      savedAutoFreezeOnCutoff,
      monthLocks,
    }),
    applySnapshot: (cached) => {
      setYear(cached.year);
      setCalendar(cached.calendar);
      setSavedRunDates(cached.savedRunDates);
      setCycleConfig(cached.cycleConfig);
      setSavedCycleConfig(cached.savedCycleConfig);
      setSelectedGroupId(cached.selectedGroupId);
      setPaintField(cached.paintField);
      setAutoFreezeOnCutoff(cached.autoFreezeOnCutoff);
      setSavedAutoFreezeOnCutoff(cached.savedAutoFreezeOnCutoff);
      setMonthLocks(cached.monthLocks ?? {});
      setIsEditing(false);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.calendar != null,
    persistDeps: [
      year,
      calendar,
      savedRunDates,
      cycleConfig,
      savedCycleConfig,
      selectedGroupId,
      paintField,
      autoFreezeOnCutoff,
      savedAutoFreezeOnCutoff,
      monthLocks,
    ],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const cal = await Api.payroll.getCalendar(year);
      setCalendar(cal);
      setMonthLocks(cal.monthLocks ?? {});
      const groupId = cal.cycleConfig?.groups?.[0]?.id ?? 'default';
      const normalized = cal.cycleConfig
        ? ensureCyclesForYear(cal.cycleConfig, year, groupId)
        : null;
      setCycleConfig(normalized);
      setSavedCycleConfig(JSON.stringify(normalized ?? null));
      setSavedRunDates(JSON.stringify(cal.runDates ?? []));
      const autoFreeze = cal.autoFreezeAttendanceOnCutoff !== false;
      setAutoFreezeOnCutoff(autoFreeze);
      setSavedAutoFreezeOnCutoff(autoFreeze);
      setSelectedGroupId(groupId);
    } catch (e) {
      console.error(e);
      if (!opts?.background) showToast('Failed to load payroll run calendar', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [year, showToast]);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  useEffect(() => {
    if (!cycleConfig) return;
    setCycleConfig((prev) => (prev ? ensureCyclesForYear(prev, year, selectedGroupId) : prev));
  }, [year, selectedGroupId]);

  const isDirty = useMemo(() => {
    if (!calendar) return false;
    const runsChanged = JSON.stringify(calendar.runDates ?? []) !== savedRunDates;
    const cyclesChanged = JSON.stringify(cycleConfig) !== savedCycleConfig;
    const autoFreezeChanged = autoFreezeOnCutoff !== savedAutoFreezeOnCutoff;
    return runsChanged || cyclesChanged || autoFreezeChanged;
  }, [
    calendar,
    savedRunDates,
    cycleConfig,
    savedCycleConfig,
    autoFreezeOnCutoff,
    savedAutoFreezeOnCutoff,
  ]);

  const { ConfirmDialogHost: UnsavedChangesDialogHost, confirmDiscardIfDirty } =
    useUnsavedChangesGuard({
      isDirty: isEditing && isDirty,
    });

  const paintLabel = CYCLE_PAINT_OPTIONS.find((o) => o.field === paintField)?.label ?? 'Date';

  const handleDayClick = (monthIndex: number, dayNum: number) => {
    if (!editable || !cycleConfig) return;
    if (isMonthLocked(monthIndex)) {
      showToast('Payroll for this month is already approved — dates are locked.', 'warning');
      return;
    }
    const key = dateKey(year, monthIndex, dayNum);
    const next = updateCycleDateField(cycleConfig, year, selectedGroupId, monthIndex, paintField, key);
    setCycleConfig(next);

    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const cycle = next.cyclesByGroup[selectedGroupId]?.[monthKey];
    if (calendar && cycle && paintField === 'payrollCalculationDate') {
      const runs = new Set((calendar.runDates ?? []).map((d) => d.slice(0, 10)));
      for (let m = 0; m < 12; m++) {
        const mk = `${year}-${String(m + 1).padStart(2, '0')}`;
        const c = next.cyclesByGroup[selectedGroupId]?.[mk];
        if (c?.payrollCalculationDate) runs.add(c.payrollCalculationDate.slice(0, 10));
      }
      setCalendar({ ...calendar, runDates: [...runs].sort() });
    }
  };

  const persistCalendar = useCallback(
    async (opts?: { autoFreeze?: boolean; successMessage?: string }) => {
      if (!calendar || !cycleConfig) return;
      const autoFreeze = opts?.autoFreeze ?? autoFreezeOnCutoff;
      setSaving(true);
      try {
        const calcDates = Object.values(cycleConfig.cyclesByGroup[selectedGroupId] ?? {})
          .map((c) => c.payrollCalculationDate?.slice(0, 10))
          .filter(Boolean) as string[];

        const saved = await Api.payroll.saveCalendar({
          ...calendar,
          year,
          runDates: calcDates.length ? [...new Set(calcDates)].sort() : calendar.runDates,
          cycleConfig,
          autoFreezeAttendanceOnCutoff: autoFreeze,
        });
        setCalendar(saved);
        setMonthLocks(saved.monthLocks ?? {});
        const groupId = saved.cycleConfig?.groups?.[0]?.id ?? selectedGroupId;
        const normalized = saved.cycleConfig
          ? ensureCyclesForYear(saved.cycleConfig, year, groupId)
          : null;
        setCycleConfig(normalized);
        setSavedCycleConfig(JSON.stringify(normalized ?? null));
        setSavedRunDates(JSON.stringify(saved.runDates ?? []));
        const savedAutoFreeze = saved.autoFreezeAttendanceOnCutoff !== false;
        setAutoFreezeOnCutoff(savedAutoFreeze);
        setSavedAutoFreezeOnCutoff(savedAutoFreeze);
        showToast(opts?.successMessage ?? 'Payroll calendar saved', 'success');
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Save failed', 'error');
        await load({ background: true });
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [autoFreezeOnCutoff, calendar, cycleConfig, load, selectedGroupId, showToast, year]
  );

  const handleSave = async () => {
    if (!isDirty) {
      setIsEditing(false);
      return;
    }
    try {
      await persistCalendar();
      setIsEditing(false);
    } catch {
      /* toast already shown */
    }
  };

  const handleCancelEdit = async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setIsEditing(false);
    await load({ background: true });
  };

  const changeYear = async (nextYear: number) => {
    if (nextYear === year) return;
    if (isEditing && isDirty && !(await confirmDiscardIfDirty())) return;
    setIsEditing(false);
    setYear(nextYear);
  };

  const handleAutoFreezeChange = (next: boolean) => {
    if (!editable || next === autoFreezeOnCutoff || saving) return;
    setAutoFreezeOnCutoff(next);
    void (async () => {
      try {
        await persistCalendar({
          autoFreeze: next,
          successMessage: next
            ? 'Automatic freeze enabled — due cutoff periods lock now'
            : 'Switched to manual freeze only',
        });
      } catch {
        setAutoFreezeOnCutoff(!next);
      }
    })();
  };

  const renderMonth = (monthIndex: number) => {
    const first = new Date(year, monthIndex, 1);
    const daysInMonth = getDaysInMonth(first);
    const startPad = getDay(startOfMonth(first));
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const cycle = cycleConfig?.cyclesByGroup?.[selectedGroupId]?.[monthKey];
    const lockedStatus = lockedMonthsForGroup.get(monthKey);
    const monthLocked = Boolean(lockedStatus);
    const monthEditable = editable && !monthLocked;

    const cells: React.ReactNode[] = [];
    for (let i = 0; i < startPad; i++) {
      cells.push(<div key={`pad-${i}`} className="h-8" aria-hidden />);
    }
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const key = dateKey(year, monthIndex, dayNum);
      const markers = cycleMarkersForDay(key, cycle);
      const titleParts: string[] = [];
      if (monthLocked) titleParts.push(`Payroll approved (${lockedStatus}) — dates locked`);
      if (markers.includes('cutoff')) titleParts.push('Attendance cutoff');
      if (markers.includes('calc')) titleParts.push('Payroll calculation');
      if (markers.includes('approval')) titleParts.push('Payroll approval');
      if (markers.includes('payment')) titleParts.push('Payment');

      cells.push(
        <button
          key={key}
          type="button"
          disabled={!monthEditable}
          title={titleParts.join(' · ') || MONTH_FULL[monthIndex]}
          onClick={() => handleDayClick(monthIndex, dayNum)}
          className={cn(
            'h-8 w-full rounded-md text-xs font-medium leading-none transition-colors relative',
            monthEditable && 'hover:ring-1 hover:ring-primary-400/50',
            !monthEditable && 'cursor-default',
            monthLocked && 'opacity-90',
            cellClassForMarkers(markers, monthEditable)
          )}
        >
          {dayNum}
        </button>
      );
    }

    const summary = cycle
      ? `Cut ${cycle.attendanceCutoffDate?.slice(8)} · Calc ${cycle.payrollCalculationDate?.slice(8)}`
      : '';

    return (
      <div
        key={monthIndex}
        className={cn(
          'rounded-xl border bg-white dark:bg-slate-800/50 overflow-hidden shadow-sm',
          monthLocked
            ? 'border-slate-300 dark:border-slate-600'
            : 'border-slate-200 dark:border-slate-700'
        )}
      >
        <div className="py-2 px-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-center">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {MONTH_FULL[monthIndex]}
          </p>
          {summary && (
            <p className="text-[10px] text-slate-500 tabular-nums mt-0.5">{summary}</p>
          )}
          {monthLocked && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-1">
              Payroll approved — dates locked
            </p>
          )}
        </div>
        <div className="grid grid-cols-7 gap-0.5 px-2 pt-2 pb-0.5">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <span
              key={d}
              className="h-6 flex items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5 px-2 pb-2">{cells}</div>
      </div>
    );
  };

  const yearToolbar = (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900/50">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => void changeYear(year - 1)}
          aria-label="Previous year"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[3rem] text-center text-sm font-bold tabular-nums px-1">{year}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => void changeYear(year + 1)}
          aria-label="Next year"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {cycleConfig && cycleConfig.groups.length > 1 && (
        <select
          className={cn(inputClass, 'h-8 text-sm max-w-[180px]')}
          value={selectedGroupId}
          disabled={!editable}
          onChange={(e) => setSelectedGroupId(e.target.value)}
        >
          {cycleConfig.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      {canEdit ? (
        <SectionEditToolbar
          canEdit={canEdit}
          isEditing={isEditing}
          saving={saving}
          onEdit={() => setIsEditing(true)}
          onCancel={() => void handleCancelEdit()}
          onSave={() => void handleSave()}
          editVariant="primary"
        />
      ) : (
        <span className="text-xs text-amber-700 dark:text-amber-300 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30">
          View only
        </span>
      )}
    </div>
  );

  return (
    <div className="w-full">
      <UnsavedChangesDialogHost />
      <Card className="border-none shadow-sm p-4 sm:p-5 w-full">
        {loading ? (
          <LoadingState variant="panel" layout="dashboard" label="Loading calendar…" />
        ) : !cycleConfig ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">{yearToolbar}</div>
            <p className="text-center text-sm text-slate-500 py-8">
              No cycle configuration — save calendar from payroll settings or contact admin.
            </p>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'mb-4 rounded-lg border border-slate-200 dark:border-slate-700',
                'bg-slate-50/80 dark:bg-slate-900/40 px-3 py-3 sm:px-4 space-y-3'
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-end">
                {yearToolbar}
              </div>
              {editable ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200 shrink-0">
                    Place on calendar:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {CYCLE_PAINT_OPTIONS.map((opt) => (
                      <button
                        key={opt.field}
                        type="button"
                        onClick={() => setPaintField(opt.field)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                          paintField === opt.field
                            ? 'border-primary-400 bg-white text-primary-800 shadow-sm dark:bg-slate-800 dark:text-primary-200 dark:border-primary-600'
                            : 'border-slate-200 dark:border-slate-600 bg-white/80 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500'
                        )}
                      >
                        <span className={cn('h-2.5 w-2.5 rounded-sm', opt.swatch)} aria-hidden />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-500 sm:ml-auto">
                    Active: <strong className="text-slate-700 dark:text-slate-300">{paintLabel}</strong>
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {CYCLE_PAINT_OPTIONS.map((opt) => (
                    <span
                      key={opt.field}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-600 bg-white/80 text-slate-600 dark:bg-slate-800/50 dark:text-slate-400"
                    >
                      <span className={cn('h-2.5 w-2.5 rounded-sm', opt.swatch)} aria-hidden />
                      {opt.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
                <div className="flex items-center gap-2 shrink-0 min-w-0">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Attendance on cutoff day
                  </span>
                </div>
                {editable ? (
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 p-0.5 bg-white dark:bg-slate-900/50">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleAutoFreezeChange(true)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        autoFreezeOnCutoff
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                      )}
                    >
                      Freeze automatically
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleAutoFreezeChange(false)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        !autoFreezeOnCutoff
                          ? 'bg-slate-700 text-white shadow-sm dark:bg-slate-600'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                      )}
                    >
                      Manual only
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {autoFreezeOnCutoff ? 'Automatic freeze' : 'Manual freeze only'}
                  </span>
                )}
              </div>
            </div>
            <div
              className={cn(
                'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3',
                isEditing && 'rounded-xl ring-2 ring-primary-300/70 dark:ring-primary-600/50 p-1'
              )}
            >
              {MONTH_NAMES.map((_, i) => renderMonth(i))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default PayrollCalendar;
