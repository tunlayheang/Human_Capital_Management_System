import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { formatDateOnlyDisplay } from '../../utils/formatDisplayDate';
import {
  Users,
  DollarSign,
  TrendingUp,
  Calendar,
  Calculator,
  RefreshCw,
  ArrowRight,
  FileText,
  History,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { ResponsiveRowActions } from '../../components/ui/ResponsiveRowActions';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { Modal } from '../../components/ui/Modal';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { canAccessFullPayrollModule } from '../../utils/payrollAccess';
import { PERM } from '../../constants/permissionKeys';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useLanguage } from '../../context/LanguageContext';
import { localeForLanguage } from '../../utils/localizedLabels';
import type {
  PayrollRun,
  PayrollSchedule,
  CreatePayrollRunPayload,
  Payslip,
  User,
} from '../../types';
import {
  formatRunStatusLabel,
  sortRunsNewestFirst,
  normalizePayslip,
  isFinalizedPayrollStatus,
  isInactivePayrollRunStatus,
  normalizePayrollRunStatus,
} from './payrollUtils';
import { PayrollAttendanceFinalizeCard } from './PayrollAttendanceFinalizeCard';
import { ApproverApprovalField } from '../../components/workflow/ApproverApprovalField';
import type { WorkflowApproverCandidate } from '../../components/workflow/ApproverSelectPanel';
import type { PayrollAttendancePeriod } from '../../types';
import { upcomingPayrollRunAlerts } from './payrollCalendarUtils';
import {
  DEFAULT_PAYROLL_GROUP,
  buildMonthlyCycleForMonth,
  periodBoundsFromCutoffs,
  previousMonthKey,
  salaryMonthForDate,
  syncGroupCyclePeriodBounds,
} from './payrollCalendarCycleUtils';
import { inputClass, selectClass } from '../../constants/designSystem';
import { DatePickerInput } from '../../components/ui/shadcn/date-picker-input';
import { NumericField } from '../../components/ui/NumericField';
import { PayrollItemsTable } from './PayrollItemsTable';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import { UnderlineTabs } from '../../components/ui/page';
import { PayrollReviewToolbar } from './PayrollReviewToolbar';
import { PayrollWorkflowStep, type PayrollWorkflowStepStatus } from './PayrollWorkflowStep';
import { buildPayrollItemRow } from './payrollItemRows';
import {
  collectDepartmentOptions,
  DEFAULT_PAYROLL_REVIEW_FILTERS,
  filterPayrollReviewItems,
  rowMatchesChangedFilter,
  type PayrollReviewFilterState,
} from './payrollReviewFilters';
import {
  buildPayrollEmployeeProfilesForItems,
  getPayrollEmployeeProfile,
  type PayrollEmployeeProfile,
} from './payrollEmployeeDisplay';
import {
  PayrollPreviewFinanceInfo,
  type PayrollPreviewMeta,
} from './PayrollPreviewFinanceBanner';
import {
  FilterMenuDateRange,
  FilterMenuField,
  FilterMenuRadioGroup,
  FilterMenuSelect,
  PageFilterMenu,
} from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import {
  createWorkspaceShellCache,
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { LoadingState } from '../../components/common/LoadingState';
import { formatPayrollMoney } from '../../utils/payrollCurrencyDisplay';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import {
  SortableTableHeader,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';

const PAYROLL_DASH_CACHE_SLOT = 'payroll-dashboard-v1';

type PayrollDashboardTabCache = {
  year: number;
  month: number;
  previewItems: Payslip[];
  previewTotals: {
    totalEmployees: number;
    totalGross: number;
    totalNetPay: number;
  } | null;
  previewMeta: PayrollPreviewMeta | null;
  employeeProfiles: Record<string, PayrollEmployeeProfile>;
  attendancePeriod: PayrollAttendancePeriod | null;
  reviewFilters: PayrollReviewFilterState;
};

type PayrollShellCache = {
  runs: PayrollRun[];
  schedule: PayrollSchedule | null;
  calendarRunDates: string[];
  frozenAttendancePeriods: Array<{
    id: string;
    month: string;
    status: string;
    payPeriodStart?: string | null;
    payPeriodEnd?: string | null;
    attendanceCutoffDate?: string | null;
    finalizedAt?: string | null;
    payrollGroupId?: string | null;
  }>;
};

type LockedPeriodListRow = {
  kind: 'locked_period';
  id: string;
  month: string;
  status: 'LOCKED';
  payPeriodStart?: string | null;
  payPeriodEnd?: string | null;
  attendanceCutoffDate?: string | null;
  finalizedAt?: string | null;
};

type PayrollListRow =
  | { kind: 'run'; run: PayrollRun }
  | LockedPeriodListRow;

const payrollShellCache = createWorkspaceShellCache<PayrollShellCache>();

type PayrollDirectoryCache = {
  users: User[];
  employees: Awaited<ReturnType<typeof Api.employees.getAll>>;
};

const payrollDirectoryCache = createWorkspaceShellCache<PayrollDirectoryCache>();

type PayrollListSortCol = 'period' | 'employees' | 'net' | 'status';

type PayrollListStatusFilter =
  | 'all'
  | 'needs_action'
  | 'pending_approval'
  | 'approved'
  | 'locked_pending';

function payrollListRowMonthKey(row: PayrollListRow): string {
  return row.kind === 'run' ? String(row.run.month).slice(0, 7) : row.month;
}

/** Rows that still need HR action (not yet approved / paid). */
function payrollListRowNeedsAction(row: PayrollListRow): boolean {
  if (row.kind === 'locked_period') return true;
  const status = normalizePayrollRunStatus(String(row.run.status));
  if (isFinalizedPayrollStatus(status)) return false;
  return true;
}

function payrollListRowMatchesStatusFilter(
  row: PayrollListRow,
  filter: PayrollListStatusFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs_action') return payrollListRowNeedsAction(row);
  if (filter === 'locked_pending') return row.kind === 'locked_period';
  if (row.kind === 'locked_period') return false;
  const status = normalizePayrollRunStatus(String(row.run.status));
  if (filter === 'pending_approval') {
    return status === 'PENDING_APPROVAL' || status === 'UNDER_REVIEW' || status === 'DRAFT';
  }
  if (filter === 'approved') return isFinalizedPayrollStatus(status);
  return true;
}

function getPayrollListRowSortValue(row: PayrollListRow, column: PayrollListSortCol): string | number {
  switch (column) {
    case 'period':
      return row.kind === 'run' ? String(row.run.month).slice(0, 7) : row.month;
    case 'employees':
      return row.kind === 'run' ? Number(row.run.totalEmployees ?? 0) : -1;
    case 'net':
      return row.kind === 'run' ? Number(row.run.totalNetPay ?? 0) : -1;
    case 'status':
      return row.kind === 'run'
        ? normalizePayrollRunStatus(String(row.run.status))
        : 'LOCKED';
    default:
      return '';
  }
}

const payrollRunsThClass =
  'py-2.5 px-3 font-semibold text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';

const MONTH_KEYS = [
  'common.months.january',
  'common.months.february',
  'common.months.march',
  'common.months.april',
  'common.months.may',
  'common.months.june',
  'common.months.july',
  'common.months.august',
  'common.months.september',
  'common.months.october',
  'common.months.november',
  'common.months.december',
] as const;

function CompactMetric({
  label,
  value,
  icon,
  iconClass,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconClass: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200/80 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 px-3 py-2.5 flex items-center gap-2.5 min-w-0">
      <div className={`p-1.5 rounded-md shrink-0 ${iconClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate">
          {label}
        </p>
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{value}</p>
      </div>
    </div>
  );
}

export const PayrollDashboard: React.FC = () => {
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, user } = useAuth();
  const { t, language } = useLanguage();
  const { currency } = usePreferredCurrency();
  const dateLocale = localeForLanguage(language);
  const now = new Date();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [schedule, setSchedule] = useState<PayrollSchedule | null>(null);
  const [calendarRunDates, setCalendarRunDates] = useState<string[]>([]);
  const [frozenAttendancePeriods, setFrozenAttendancePeriods] = useState<
    PayrollShellCache['frozenAttendancePeriods']
  >([]);
  const [cycleByMonth, setCycleByMonth] = useState<
    Record<string, { periodStart: string; periodEnd: string; attendanceCutoffDate: string }>
  >({});
  const [loading, setLoading] = useState(() => !payrollShellCache.has());
  const [previewItems, setPreviewItems] = useState<Payslip[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTotals, setPreviewTotals] = useState<{
    totalEmployees: number;
    totalGross: number;
    totalNetPay: number;
  } | null>(null);
  const [previewMeta, setPreviewMeta] = useState<PayrollPreviewMeta | null>(null);
  const [attendancePreviewItems, setAttendancePreviewItems] = useState<Payslip[]>([]);
  const [attendancePreviewLoading, setAttendancePreviewLoading] = useState(false);
  const [attendancePreviewTotals, setAttendancePreviewTotals] = useState<{
    totalEmployees: number;
    totalGross: number;
    totalNetPay: number;
  } | null>(null);
  const [attendancePreviewMeta, setAttendancePreviewMeta] = useState<PayrollPreviewMeta | null>(null);
  const [employeeProfiles, setEmployeeProfiles] = useState<
    Record<string, PayrollEmployeeProfile>
  >({});
  /** Monthly sales keyed by HR employee code (ROC…) for commission rules. */
  const [salesByEmployeeId, setSalesByEmployeeId] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [approverUserIds, setApproverUserIds] = useState<string[]>([]);
  const [approverCandidates, setApproverCandidates] = useState<WorkflowApproverCandidate[]>([]);
  const [reviewFilters, setReviewFilters] = useState<PayrollReviewFilterState>(
    DEFAULT_PAYROLL_REVIEW_FILTERS
  );
  const previewRequestSeqRef = useRef(0);
  const attendancePreviewSeqRef = useRef(0);
  const previewLoadingOwnerSeqRef = useRef(0);
  const attendancePreviewLoadingOwnerSeqRef = useRef(0);
  const runsRef = useRef<PayrollRun[]>([]);
  const directoryRef = useRef<{
    users: User[];
    employees: Awaited<ReturnType<typeof Api.employees.getAll>>;
  } | null>(null);

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [listStatusFilter, setListStatusFilter] =
    useState<PayrollListStatusFilter>('all');
  const [runDate, setRunDate] = useState(now.toISOString().split('T')[0]);
  const [payDate, setPayDate] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
  );
  const [attendancePeriod, setAttendancePeriod] = useState<PayrollAttendancePeriod | null>(null);

  /** In-page Overview sections — use `section=` so it never collides with workspace `tab=` labels. */
  const OVERVIEW_SECTIONS = ['cycle', 'runs'] as const;
  const [overviewSection, setOverviewSection] = useUrlSyncedTab<(typeof OVERVIEW_SECTIONS)[number]>({
    values: OVERVIEW_SECTIONS,
    defaultValue: 'cycle',
    param: 'section',
  });

  useEffect(() => {
    const state = location.state as
      | { year?: number; month?: number; openCreateRun?: boolean }
      | null
      | undefined;
    if (!state) return;
    if (state.year && state.year >= 2000 && state.year <= 2100) setYear(state.year);
    if (state.month && state.month >= 1 && state.month <= 12) setMonth(state.month);
    if (state.openCreateRun) setModalOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  /** Drop leftover Overview in-page tab params so they never collide with workspace labels. */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab !== 'preview' && tab !== 'sales') return;
    params.delete('tab');
    const next = params.toString();
    navigate(
      { pathname: location.pathname, search: next ? `?${next}` : '' },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const loadDirectory = useCallback(async () => {
    if (directoryRef.current) return directoryRef.current;
    const shell = payrollDirectoryCache.get();
    if (shell) {
      directoryRef.current = shell;
      return shell;
    }
    const [usersRes, employeesRes] = await Promise.all([
      Api.users.getAll().catch(() => [] as User[]),
      Api.employees.getAll({ page: 1, limit: 500, status: 'active', assigned_id_only: '1', include_compensation: '1' }).catch(() => ({ employees: [] })),
    ]);
    const bundle = { users: usersRes as User[], employees: employeesRes };
    directoryRef.current = bundle;
    payrollDirectoryCache.set(bundle);
    return bundle;
  }, []);

  const tabCache = useWorkspaceTabCache<PayrollDashboardTabCache>({
    slot: PAYROLL_DASH_CACHE_SLOT,
    getSnapshot: () => ({
      year,
      month,
      previewItems,
      previewTotals,
      previewMeta,
      employeeProfiles,
      attendancePeriod,
      reviewFilters,
    }),
    applySnapshot: (cached) => {
      setYear(cached.year);
      setMonth(cached.month);
      setPreviewItems(cached.previewItems);
      setPreviewTotals(cached.previewTotals);
      setPreviewMeta(cached.previewMeta);
      setEmployeeProfiles(cached.employeeProfiles);
      setAttendancePeriod(cached.attendancePeriod);
      setReviewFilters(cached.reviewFilters ?? DEFAULT_PAYROLL_REVIEW_FILTERS);
      setPreviewLoading(false);
    },
    shouldPersist: (cached) => cached.previewItems.length > 0,
    persistDeps: [
      year,
      month,
      previewItems,
      previewTotals,
      previewMeta,
      employeeProfiles,
      attendancePeriod,
      reviewFilters,
    ],
  });

  const applyCalendarCycles = useCallback((cal: {
    year: number;
    cycleConfig?: import('../../types').PayrollCalendarCycleConfig;
    attendanceCutoffDates?: string[];
  }) => {
    const group =
      cal.cycleConfig?.groups?.find((g) => g.id === 'default') ?? DEFAULT_PAYROLL_GROUP;
    const rawCycles = cal.cycleConfig?.cyclesByGroup?.default ?? {};
    const withCutoffs = { ...rawCycles };
    for (let m = 0; m < 12; m++) {
      const monthKey = `${cal.year}-${String(m + 1).padStart(2, '0')}`;
      if (withCutoffs[monthKey]?.attendanceCutoffDate) continue;
      const legacyCutoff = cal.attendanceCutoffDates?.[m]?.slice(0, 10);
      withCutoffs[monthKey] = {
        ...(withCutoffs[monthKey] ?? buildMonthlyCycleForMonth(cal.year, m, group)),
        month: monthKey,
        attendanceCutoffDate:
          legacyCutoff ??
          withCutoffs[monthKey]?.attendanceCutoffDate ??
          buildMonthlyCycleForMonth(cal.year, m, group).attendanceCutoffDate,
      };
    }
    const synced = syncGroupCyclePeriodBounds(cal.year, group, withCutoffs);
    const next: Record<
      string,
      { periodStart: string; periodEnd: string; attendanceCutoffDate: string }
    > = {};
    for (const [key, cycle] of Object.entries(synced)) {
      next[key] = {
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        attendanceCutoffDate: cycle.attendanceCutoffDate,
      };
    }
    setCycleByMonth(next);
  }, []);

  const fetchData = useCallback(async (opts?: WorkspaceLoadOptions) => {
    const shell = payrollShellCache.get();
    if (shell) {
      runsRef.current = shell.runs;
      setRuns(shell.runs);
      setSchedule(shell.schedule);
      setCalendarRunDates(shell.calendarRunDates);
      setFrozenAttendancePeriods(shell.frozenAttendancePeriods ?? []);
      setLoading(false);
      if (!opts?.background) return;
    } else if (!opts?.background) {
      setLoading(true);
    }

    try {
      const [runsRes, scheduleRes, cal, frozenPeriodsRes] = await Promise.all([
        Api.payroll.getRuns(),
        Api.payroll.getSchedules(),
        Api.payroll.getCalendar(now.getFullYear()),
        Api.payroll.listHistoricalAttendancePeriods(200).catch(() => []),
        directoryRef.current ? Promise.resolve(directoryRef.current) : loadDirectory(),
      ]);
      const runsList = Array.isArray(runsRes) ? runsRes : [];
      const frozenList = Array.isArray(frozenPeriodsRes)
        ? frozenPeriodsRes.map((row: Record<string, unknown>) => ({
            id: String(row.id ?? ''),
            month: String(row.month ?? '').slice(0, 7),
            status: String(row.status ?? ''),
            payPeriodStart: (row.payPeriodStart as string | null | undefined) ?? null,
            payPeriodEnd: (row.payPeriodEnd as string | null | undefined) ?? null,
            attendanceCutoffDate:
              (row.attendanceCutoffDate as string | null | undefined) ?? null,
            finalizedAt: (row.finalizedAt as string | null | undefined) ?? null,
            payrollGroupId: (row.payrollGroupId as string | null | undefined) ?? null,
          }))
        : [];
      runsRef.current = runsList;
      setRuns(runsList);
      setSchedule(scheduleRes);
      setCalendarRunDates(cal.runDates ?? []);
      setFrozenAttendancePeriods(frozenList);
      applyCalendarCycles(cal);
      payrollShellCache.set({
        runs: runsList,
        schedule: scheduleRes,
        calendarRunDates: cal.runDates ?? [],
        frozenAttendancePeriods: frozenList,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [loadDirectory, applyCalendarCycles]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cal = await Api.payroll.getCalendar(year);
        if (!cancelled) applyCalendarCycles(cal);
      } catch {
        if (!cancelled) {
          const group = DEFAULT_PAYROLL_GROUP;
          const synced = syncGroupCyclePeriodBounds(year, group, {});
          const next: Record<
            string,
            { periodStart: string; periodEnd: string; attendanceCutoffDate: string }
          > = {};
          for (const [key, cycle] of Object.entries(synced)) {
            next[key] = {
              periodStart: cycle.periodStart,
              periodEnd: cycle.periodEnd,
              attendanceCutoffDate: cycle.attendanceCutoffDate,
            };
          }
          setCycleByMonth(next);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, applyCalendarCycles]);

  const fetchPreview = useCallback(async (opts?: { background?: boolean; includeAttendance?: boolean }) => {
    const includeAttendance = opts?.includeAttendance === true;
    const seqRef = includeAttendance ? attendancePreviewSeqRef : previewRequestSeqRef;
    const seq = ++seqRef.current;
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    const setLoading = includeAttendance ? setAttendancePreviewLoading : setPreviewLoading;
    const loadingOwnerRef = includeAttendance
      ? attendancePreviewLoadingOwnerSeqRef
      : previewLoadingOwnerSeqRef;
    const clearPreview = () => {
      if (includeAttendance) {
        setAttendancePreviewItems([]);
        setAttendancePreviewTotals(null);
        setAttendancePreviewMeta(null);
      } else {
        setPreviewItems([]);
        setPreviewTotals(null);
        setPreviewMeta(null);
        setSalesByEmployeeId({});
      }
    };

    if (!opts?.background) {
      loadingOwnerRef.current = seq;
      setLoading(true);
      clearPreview();
    }

    const applyBundle = (payload: {
      items: Payslip[];
      totalEmployees: number;
      totalGross: number;
      totalNetPay: number;
      meta: PayrollPreviewMeta;
      attendancePeriod?: PayrollAttendancePeriod | null;
    }) => {
      if (seq !== seqRef.current) return;
      if (includeAttendance) {
        setAttendancePreviewItems(payload.items);
        setAttendancePreviewTotals({
          totalEmployees: payload.totalEmployees,
          totalGross: payload.totalGross,
          totalNetPay: payload.totalNetPay,
        });
        setAttendancePreviewMeta(payload.meta);
      } else {
        setPreviewItems(payload.items);
        setPreviewTotals({
          totalEmployees: payload.totalEmployees,
          totalGross: payload.totalGross,
          totalNetPay: payload.totalNetPay,
        });
        setPreviewMeta(payload.meta);
      }
      if (payload.attendancePeriod) {
        setAttendancePeriod(payload.attendancePeriod);
      }
    };

    try {
      const frozenRun =
        runsRef.current.find((r) => String(r.month).slice(0, 7) === monthStr) ?? null;
      if (frozenRun && isFinalizedPayrollStatus(frozenRun.status)) {
        const [itemsRes, directory, attPeriod, salesRes] = await Promise.all([
          Api.payroll.getRunItems(frozenRun.id),
          directoryRef.current ? Promise.resolve(directoryRef.current) : loadDirectory(),
          Api.payroll.getAttendancePeriod(monthStr).catch(() => null),
          Api.payroll.getMonthlySales(monthStr).catch(() => ({ month: monthStr, items: [] })),
        ]);
        if (seq !== seqRef.current) return;

        const items = Array.isArray(itemsRes)
          ? itemsRes.map((row) =>
              normalizePayslip(row as Payslip, {
                monthPrefix: monthStr,
                runStatus: frozenRun.status,
                frozen: true,
              })
            )
          : [];
        const salesMap: Record<string, number> = {};
        for (const row of salesRes.items ?? []) {
          if (row.employeeId) salesMap[row.employeeId] = Number(row.salesAmount) || 0;
        }
        setSalesByEmployeeId(salesMap);
        setEmployeeProfiles(
          buildPayrollEmployeeProfilesForItems(items, directory.users, directory.employees)
        );
        const frozenMeta: PayrollPreviewMeta = {
          month: monthStr,
          attendancePeriodStatus: attPeriod?.status ?? 'OPEN',
          attendanceFinalized:
            attPeriod?.status === 'FINALIZED' || attPeriod?.status === 'LOCKED',
          includeAttendance: true,
          period: attPeriod
            ? {
                payPeriodStart: attPeriod.payPeriodStart,
                payPeriodEnd: attPeriod.payPeriodEnd,
                attendanceCutoffDate: attPeriod.attendanceCutoffDate ?? null,
              }
            : {
                payPeriodStart: (() => {
                  const prevKey = previousMonthKey(monthStr);
                  const prevCutoff = `${prevKey}-25`;
                  const thisCutoff = `${monthStr}-25`;
                  return periodBoundsFromCutoffs(prevCutoff, thisCutoff).periodStart;
                })(),
                payPeriodEnd: (() => {
                  const prevKey = previousMonthKey(monthStr);
                  const prevCutoff = `${prevKey}-25`;
                  const thisCutoff = `${monthStr}-25`;
                  return periodBoundsFromCutoffs(prevCutoff, thisCutoff).periodEnd;
                })(),
                attendanceCutoffDate: null,
              },
          disclaimer:
            'Showing approved payroll run snapshot for this period. Use the run detail page for official figures.',
        };
        const bundle = {
          items,
          totalEmployees: frozenRun.totalEmployees ?? items.length,
          totalGross: frozenRun.totalGross ?? 0,
          totalNetPay: frozenRun.totalNetPay ?? 0,
          meta: frozenMeta,
          attendancePeriod: attPeriod,
        };
        applyBundle(bundle);
        return;
      }

      const [previewRes, directory, salesRes] = await Promise.all([
        Api.payroll.getPreview({ year, month, includeAttendance }),
        directoryRef.current ? Promise.resolve(directoryRef.current) : loadDirectory(),
        Api.payroll.getMonthlySales(monthStr).catch(() => ({ month: monthStr, items: [] })),
      ]);
      if (seq !== seqRef.current) return;

      const items = Array.isArray(previewRes.items)
        ? previewRes.items.map((row) => normalizePayslip(row as Payslip, { monthPrefix: monthStr }))
        : [];

      const salesMap: Record<string, number> = {};
      for (const row of salesRes.items ?? []) {
        if (row.employeeId) salesMap[row.employeeId] = Number(row.salesAmount) || 0;
      }
      setSalesByEmployeeId(salesMap);
      setEmployeeProfiles(
        buildPayrollEmployeeProfilesForItems(items, directory.users, directory.employees)
      );
      applyBundle({
        items,
        totalEmployees: previewRes.totalEmployees ?? items.length,
        totalGross: previewRes.totalGross ?? 0,
        totalNetPay: previewRes.totalNetPay ?? 0,
        meta: {
          month: monthStr,
          generatedAt: previewRes.generatedAt,
          calculationEngine: previewRes.calculationEngine,
          prorationMethod: previewRes.prorationMethod,
          engineRulesSummary: previewRes.engineRulesSummary,
          attendancePeriodStatus: previewRes.attendancePeriodStatus,
          attendanceFinalized: previewRes.attendanceFinalized,
          includeAttendance: previewRes.includeAttendance ?? includeAttendance,
          period: previewRes.period,
          globalWarnings: previewRes.globalWarnings ?? [],
          errors: previewRes.errors,
          eligibleEmployees:
            previewRes.eligibleEmployees ??
            items.length + (previewRes.errors?.length ?? 0),
          failedEmployees:
            previewRes.failedEmployees ?? (previewRes.errors?.length ?? 0),
          disclaimer: previewRes.disclaimer,
        },
        attendancePeriod:
          previewRes.attendancePeriodStatus && previewRes.period
            ? {
                month: monthStr,
                status: previewRes.attendancePeriodStatus as PayrollAttendancePeriod['status'],
                payPeriodStart: previewRes.period.payPeriodStart,
                payPeriodEnd: previewRes.period.payPeriodEnd,
                attendanceCutoffDate: previewRes.period.attendanceCutoffDate ?? null,
              }
            : null,
      });
    } catch (e) {
      if (seq !== seqRef.current) return;
      console.error(e);
      if (!opts?.background) {
        clearPreview();
        const status = (e as { status?: number })?.status;
        const message = e instanceof Error ? e.message : 'Could not load payroll preview';
        showToast(
          status === 503 || /not reachable/i.test(message)
            ? 'HR API is not running. From the project root run npm run dev and open http://localhost:3000.'
            : message || 'Could not load payroll preview',
          'error'
        );
      }
    } finally {
      if (loadingOwnerRef.current === seq) {
        setLoading(false);
        loadingOwnerRef.current = 0;
      }
    }
  }, [year, month, showToast, loadDirectory]);

  useEffect(() => {
    void fetchData({ background: payrollShellCache.has() });
  }, [fetchData]);

  const previewMonthKey = useMemo(
    () => `${year}-${String(month).padStart(2, '0')}`,
    [year, month]
  );

  const runsByMonthKey = useMemo(() => {
    const map = new Map<string, PayrollRun>();
    for (const run of runs) {
      const key = String(run.month).slice(0, 7);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, run);
        continue;
      }
      const existingInactive = isInactivePayrollRunStatus(String(existing.status));
      const nextInactive = isInactivePayrollRunStatus(String(run.status));
      // Prefer an active (or finalized) run over a cancelled/rejected/reversed one.
      if (existingInactive && !nextInactive) {
        map.set(key, run);
        continue;
      }
      if (!existingInactive && nextInactive) continue;
      const existingAt = new Date(existing.calculatedAt || existing.createdAt).getTime();
      const nextAt = new Date(run.calculatedAt || run.createdAt).getTime();
      if (nextAt >= existingAt) map.set(key, run);
    }
    return map;
  }, [runs]);

  const runForPreviewMonth = useMemo(
    () => runsByMonthKey.get(previewMonthKey) ?? null,
    [runsByMonthKey, previewMonthKey]
  );

  const monthRunStatusLabel = useCallback(
    (monthKey: string): string | null => {
      const run = runsByMonthKey.get(monthKey);
      if (!run) return null;
      return formatRunStatusLabel(run.status, t);
    },
    [runsByMonthKey, t]
  );

  const previewMonthFinalized = useMemo(
    () => (runForPreviewMonth ? isFinalizedPayrollStatus(runForPreviewMonth.status) : false),
    [runForPreviewMonth]
  );

  const previewMatchesSelection = previewMeta?.month === previewMonthKey;
  const attendancePreviewMatchesSelection = attendancePreviewMeta?.month === previewMonthKey;

  const periodForFinalizeCard = useMemo((): PayrollAttendancePeriod | null => {
    if (
      attendancePeriod &&
      String(attendancePeriod.month).slice(0, 7) === previewMonthKey
    ) {
      return attendancePeriod;
    }
    return null;
  }, [attendancePeriod, previewMonthKey]);

  const attendanceFinalizedForWorkflow = useMemo(() => {
    if (!previewMatchesSelection) return false;
    const status = periodForFinalizeCard?.status;
    return status === 'FINALIZED' || status === 'LOCKED';
  }, [previewMatchesSelection, periodForFinalizeCard?.status]);

  useEffect(() => {
    if (!canAccessFullPayrollModule(hasPermission, user?.role)) return;
    const monthStr = previewMonthKey;
    let cancelled = false;
    void Api.payroll
      .getAttendancePeriod(monthStr)
      .then((row) => {
        if (!cancelled) setAttendancePeriod(row);
      })
      .catch(() => {
        if (!cancelled) setAttendancePeriod(null);
      });
    return () => {
      cancelled = true;
    };
  }, [previewMonthKey, hasPermission, user?.role]);

  const previewMonthHasOpenRun = useMemo(() => {
    if (!runForPreviewMonth || previewMonthFinalized) return false;
    const s = normalizePayrollRunStatus(String(runForPreviewMonth.status));
    // Cancelled / rejected / reversed must not block calculating again.
    return s !== 'REJECTED' && s !== 'REVERSED' && s !== 'CANCELLED';
  }, [runForPreviewMonth, previewMonthFinalized]);

  const previewMonthCanRunAgain = useMemo(() => {
    if (!runForPreviewMonth || previewMonthFinalized || previewMonthHasOpenRun) return false;
    return isInactivePayrollRunStatus(String(runForPreviewMonth.status));
  }, [runForPreviewMonth, previewMonthFinalized, previewMonthHasOpenRun]);

  const previewGate = canAccessFullPayrollModule(hasPermission, user?.role);

  useWorkspaceTabMountLoad(
    (opts) => fetchPreview({ background: opts.background, includeAttendance: false }),
    [year, month, fetchPreview],
    tabCache,
    previewGate
  );

  const handleAttendancePeriodChange = useCallback(
    (period: PayrollAttendancePeriod) => {
      setAttendancePeriod(period);
      const monthKey = String(period.month ?? '').slice(0, 7);
      const finalized = period.status === 'FINALIZED' || period.status === 'LOCKED';
      setFrozenAttendancePeriods((prev) => {
        const without = prev.filter((p) => String(p.month).slice(0, 7) !== monthKey);
        if (!finalized || !monthKey) return without;
        return [
          {
            id: String(period.id ?? `att-locked-${monthKey}`),
            month: monthKey,
            status: String(period.status),
            payPeriodStart: period.payPeriodStart ?? null,
            payPeriodEnd: period.payPeriodEnd ?? null,
            attendanceCutoffDate: period.attendanceCutoffDate ?? null,
            finalizedAt: period.finalizedAt ?? null,
            payrollGroupId: null,
          },
          ...without,
        ];
      });
      if (finalized) {
        void fetchPreview({ includeAttendance: true });
      } else {
        setAttendancePreviewItems([]);
        setAttendancePreviewTotals(null);
        setAttendancePreviewMeta(null);
      }
    },
    [fetchPreview]
  );

  useEffect(() => {
    if (!attendanceFinalizedForWorkflow) return;
    // First load for this month must show skeleton; only background-refresh when
    // we already have a matching attendance preview.
    void fetchPreview({
      includeAttendance: true,
      background: attendancePreviewMatchesSelection,
    });
  }, [
    attendanceFinalizedForWorkflow,
    attendancePreviewMatchesSelection,
    previewMonthKey,
    fetchPreview,
  ]);

  useEffect(() => {
    setPayDate(new Date(year, month, 0).toISOString().split('T')[0]);
  }, [year, month]);

  const sortedRuns = useMemo(() => sortRunsNewestFirst(runs), [runs]);
  const lastRun = sortedRuns[0];

  /** Payroll list = calculated runs + attendance-frozen months that were never calculated. */
  const payrollListRows = useMemo((): PayrollListRow[] => {
    const monthsWithAnyRun = new Set(
      runs.map((run) => String(run.month).slice(0, 7)).filter(Boolean)
    );
    const monthsWithActiveRun = new Set(
      [...runsByMonthKey.entries()]
        .filter(([, run]) => !isInactivePayrollRunStatus(String(run.status)))
        .map(([month]) => month)
    );

    const lockedRows: LockedPeriodListRow[] = [];
    const seenMonths = new Set<string>();
    for (const period of frozenAttendancePeriods) {
      const monthKey = String(period.month ?? '').slice(0, 7);
      if (!monthKey || seenMonths.has(monthKey)) continue;
      const st = String(period.status ?? '').toUpperCase();
      if (st !== 'FINALIZED' && st !== 'LOCKED') continue;
      // Only surface periods with no calculated payroll yet (or only cancelled/rejected).
      if (monthsWithActiveRun.has(monthKey)) continue;
      if (monthsWithAnyRun.has(monthKey) && !monthsWithActiveRun.has(monthKey)) {
        // Inactive run(s) already appear in the list with Run again — skip duplicate.
        continue;
      }
      seenMonths.add(monthKey);
      const cycle = cycleByMonth[monthKey];
      lockedRows.push({
        kind: 'locked_period',
        id: period.id || `att-locked-${monthKey}`,
        month: monthKey,
        status: 'LOCKED',
        payPeriodStart: period.payPeriodStart || cycle?.periodStart || null,
        payPeriodEnd: period.payPeriodEnd || cycle?.periodEnd || null,
        attendanceCutoffDate:
          period.attendanceCutoffDate || cycle?.attendanceCutoffDate || null,
        finalizedAt: period.finalizedAt ?? null,
      });
    }

    const runRows: PayrollListRow[] = sortedRuns.map((run) => ({ kind: 'run', run }));
    const merged = [...runRows, ...lockedRows];
    merged.sort((a, b) => {
      const monthA = a.kind === 'run' ? String(a.run.month).slice(0, 7) : a.month;
      const monthB = b.kind === 'run' ? String(b.run.month).slice(0, 7) : b.month;
      if (monthA !== monthB) return monthB.localeCompare(monthA);
      if (a.kind !== b.kind) return a.kind === 'run' ? -1 : 1;
      if (a.kind === 'run' && b.kind === 'run') {
        const atA = new Date(a.run.calculatedAt || a.run.createdAt).getTime();
        const atB = new Date(b.run.calculatedAt || b.run.createdAt).getTime();
        return atB - atA;
      }
      return 0;
    });
    return merged;
  }, [sortedRuns, runs, runsByMonthKey, frozenAttendancePeriods, cycleByMonth]);

  /** Payroll list is scoped to one calendar year for easier browsing. */
  const yearScopedPayrollListRows = useMemo(() => {
    const prefix = `${year}-`;
    return payrollListRows.filter((row) => payrollListRowMonthKey(row).startsWith(prefix));
  }, [payrollListRows, year]);

  const filteredPayrollListRows = useMemo(
    () =>
      yearScopedPayrollListRows.filter((row) =>
        payrollListRowMatchesStatusFilter(row, listStatusFilter)
      ),
    [yearScopedPayrollListRows, listStatusFilter]
  );

  const payrollListActionNeededCount = useMemo(
    () => yearScopedPayrollListRows.filter(payrollListRowNeedsAction).length,
    [yearScopedPayrollListRows]
  );

  const payrollListPendingApprovalCount = useMemo(
    () =>
      yearScopedPayrollListRows.filter((row) => {
        if (row.kind !== 'run') return false;
        const status = normalizePayrollRunStatus(String(row.run.status));
        return (
          status === 'PENDING_APPROVAL' ||
          status === 'UNDER_REVIEW' ||
          status === 'DRAFT'
        );
      }).length,
    [yearScopedPayrollListRows]
  );

  const { sortBy, sortOrder, toggleSort } = useListColumnSort<PayrollListSortCol>();

  const sortedPayrollListRows = useMemo(
    () =>
      sortRowsByColumn(
        filteredPayrollListRows,
        sortBy,
        sortOrder,
        getPayrollListRowSortValue,
        (rows) => rows
      ),
    [filteredPayrollListRows, sortBy, sortOrder]
  );

  const listFilterActiveCount = countActiveFilters([
    listStatusFilter !== 'all',
  ]);

  const listFilterMenu = (
    <PageFilterMenu
      title={t('payroll.runsListFilters') || 'Payroll list filters'}
      activeCount={listFilterActiveCount}
      onClear={() => setListStatusFilter('all')}
    >
      <FilterMenuField label={t('common.year') || 'Year'}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 px-2"
            aria-label={t('payroll.previousYear') || 'Previous year'}
            onClick={() => setYear((y) => Math.max(2000, y - 1))}
          >
            ‹
          </Button>
          <NumericField
            kind="integer"
            filterOptions={{ maxLength: 4 }}
            value={year}
            onValueChange={(v) => {
              const next = Number(v) || year;
              if (next >= 2000 && next <= 2100) setYear(next);
            }}
            className={`${inputClass} text-center`}
            aria-label={t('common.year') || 'Year'}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 px-2"
            aria-label={t('payroll.nextYear') || 'Next year'}
            onClick={() => setYear((y) => Math.min(2100, y + 1))}
          >
            ›
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {t('payroll.runsListYearHint') ||
            'Showing one year at a time so monthly payrolls stay easy to scan.'}
        </p>
      </FilterMenuField>
      <FilterMenuRadioGroup
        label={t('common.status') || 'Status'}
        value={listStatusFilter}
        defaultValue="all"
        onChange={setListStatusFilter}
        options={[
          { value: 'all', label: t('common.all') || 'All' },
          {
            value: 'needs_action',
            label: t('payroll.runsListFilterNeedsAction') || 'Needs action',
          },
          {
            value: 'pending_approval',
            label: t('payroll.runsListFilterPending') || 'Not approved yet',
          },
          {
            value: 'approved',
            label: t('payroll.runsListFilterApproved') || 'Approved & paid',
          },
          {
            value: 'locked_pending',
            label: t('payroll.runsListFilterLocked') || 'Locked — not calculated',
          },
        ]}
      />
    </PageFilterMenu>
  );

  const previewPeriodLabel = useMemo(() => {
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' });
  }, [year, month, dateLocale]);

  const previewPeriodFrom = useMemo(() => {
    if (previewMatchesSelection && previewMeta?.period?.payPeriodStart) {
      return previewMeta.period.payPeriodStart.slice(0, 10);
    }
    if (
      attendancePeriod &&
      String(attendancePeriod.month).slice(0, 7) === previewMonthKey &&
      attendancePeriod.payPeriodStart
    ) {
      return attendancePeriod.payPeriodStart.slice(0, 10);
    }
    const cycle = cycleByMonth[previewMonthKey];
    if (cycle?.periodStart) return cycle.periodStart.slice(0, 10);
    const prevKey = previousMonthKey(previewMonthKey);
    const prevCutoff =
      cycleByMonth[prevKey]?.attendanceCutoffDate ??
      `${prevKey}-25`;
    const thisCutoff =
      cycleByMonth[previewMonthKey]?.attendanceCutoffDate ??
      `${previewMonthKey}-25`;
    return periodBoundsFromCutoffs(prevCutoff, thisCutoff).periodStart;
  }, [
    previewMatchesSelection,
    previewMeta,
    attendancePeriod,
    previewMonthKey,
    cycleByMonth,
  ]);
  const previewPeriodTo = useMemo(() => {
    if (previewMatchesSelection && previewMeta?.period?.payPeriodEnd) {
      return previewMeta.period.payPeriodEnd.slice(0, 10);
    }
    if (
      attendancePeriod &&
      String(attendancePeriod.month).slice(0, 7) === previewMonthKey &&
      attendancePeriod.payPeriodEnd
    ) {
      return attendancePeriod.payPeriodEnd.slice(0, 10);
    }
    const cycle = cycleByMonth[previewMonthKey];
    if (cycle?.periodEnd) return cycle.periodEnd.slice(0, 10);
    const prevKey = previousMonthKey(previewMonthKey);
    const prevCutoff =
      cycleByMonth[prevKey]?.attendanceCutoffDate ??
      `${prevKey}-25`;
    const thisCutoff =
      cycleByMonth[previewMonthKey]?.attendanceCutoffDate ??
      `${previewMonthKey}-25`;
    return periodBoundsFromCutoffs(prevCutoff, thisCutoff).periodEnd;
  }, [
    previewMatchesSelection,
    previewMeta,
    attendancePeriod,
    previewMonthKey,
    cycleByMonth,
  ]);

  const previewPeriodFilterCount = useMemo(
    () =>
      countActiveFilters([
        {
          value: `${year}-${String(month).padStart(2, '0')}`,
          defaultValue: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        },
      ]),
    [year, month]
  );

  const setPreviewPeriod = useCallback((nextYear: number, nextMonth: number) => {
    setPreviewItems([]);
    setPreviewTotals(null);
    setPreviewMeta(null);
    setAttendancePreviewItems([]);
    setAttendancePreviewTotals(null);
    setAttendancePreviewMeta(null);
    setAttendancePeriod(null);
    setReviewFilters(DEFAULT_PAYROLL_REVIEW_FILTERS);
    setYear(nextYear);
    setMonth(nextMonth);
  }, []);

  const applyPreviewPeriodRange = useCallback(
    ({ from, to }: { from: string; to: string }) => {
      const anchor = from || to;
      if (!anchor) return;
      const mapped = salaryMonthForDate(
        anchor,
        year,
        Object.fromEntries(
          Object.entries(cycleByMonth).map(([k, v]) => [
            k,
            {
              month: k,
              periodStart: v.periodStart,
              periodEnd: v.periodEnd,
              attendanceCutoffDate: v.attendanceCutoffDate,
              payrollCalculationDate: v.attendanceCutoffDate,
              payrollApprovalDate: v.attendanceCutoffDate,
              paymentDate: v.attendanceCutoffDate,
            },
          ])
        )
      );
      setPreviewPeriod(mapped.year, mapped.month);
    },
    [setPreviewPeriod, year, cycleByMonth]
  );

  const clearPreviewPeriod = useCallback(() => {
    setPreviewPeriod(now.getFullYear(), now.getMonth() + 1);
  }, [setPreviewPeriod]);

  const runAlerts = useMemo(() => upcomingPayrollRunAlerts(calendarRunDates), [calendarRunDates]);

  const stats = useMemo(() => {
    const todayKey = format(now, 'yyyy-MM-dd');
    const nextScheduled = [...calendarRunDates].sort().find((d) => d.slice(0, 10) >= todayKey);
    const nextRun = nextScheduled
      ? formatDateOnlyDisplay(nextScheduled.slice(0, 10))
      : schedule?.runDayOfMonth
        ? t('payroll.nextRunApprox', { day: schedule.runDayOfMonth })
        : t('payroll.nextRunNotScheduled');
    const finalizedTotals =
      previewMatchesSelection && previewMonthFinalized ? runForPreviewMonth : null;
    const activeMeta =
      attendanceFinalizedForWorkflow && attendancePreviewMatchesSelection
        ? attendancePreviewMeta
        : previewMeta;
    const activeTotals =
      attendanceFinalizedForWorkflow && attendancePreviewMatchesSelection
        ? attendancePreviewTotals
        : previewTotals;
    const usePreviewTotals = previewMatchesSelection && activeTotals;
    const calculatedEmployees = activeTotals?.totalEmployees ?? 0;
    const eligibleEmployees =
      activeMeta?.eligibleEmployees ??
      calculatedEmployees + (activeMeta?.errors?.length ?? 0);
    return {
      totalEmployees: usePreviewTotals
        ? eligibleEmployees
        : finalizedTotals?.totalEmployees ?? 0,
      grossPayroll: usePreviewTotals
        ? activeTotals.totalGross
        : finalizedTotals?.totalGross ?? 0,
      netDisbursement: usePreviewTotals
        ? activeTotals.totalNetPay
        : finalizedTotals?.totalNetPay ?? 0,
      nextRun,
    };
  }, [
    previewTotals,
    previewMatchesSelection,
    previewMonthFinalized,
    runForPreviewMonth,
    schedule,
    now,
    calendarRunDates,
    dateLocale,
    t,
    attendancePreviewTotals,
    attendancePreviewMatchesSelection,
    attendanceFinalizedForWorkflow,
    attendancePreviewMeta,
    previewMeta,
  ]);

  // Step 1 metrics: estimate before finalize; attendance-based figures after finalize.
  const payOutcomesPending = useMemo(() => {
    if (!previewMatchesSelection) return true;
    if (previewMonthFinalized) return false;
    if (!attendanceFinalizedForWorkflow) return !previewTotals;
    return !attendancePreviewMatchesSelection || !attendancePreviewTotals;
  }, [
    previewMatchesSelection,
    previewMonthFinalized,
    attendanceFinalizedForWorkflow,
    previewTotals,
    attendancePreviewMatchesSelection,
    attendancePreviewTotals,
  ]);

  const handleCreateRun = async () => {
    const activePreviewMeta =
      attendanceFinalizedForWorkflow && attendancePreviewMatchesSelection
        ? attendancePreviewMeta
        : previewMeta;
    if (previewMatchesSelection && (activePreviewMeta?.errors?.length ?? 0) > 0) {
      showToast(
        'Resolve payroll calculation errors in the preview before running payroll.',
        'error'
      );
      return;
    }
    setCreating(true);
    try {
      const monthStr = `${year}-${String(month).padStart(2, '0')}`;
      const attOk =
        attendancePeriod?.status === 'FINALIZED' || attendancePeriod?.status === 'LOCKED';
      if (!attOk) {
        const canFreeze = attendancePeriod?.canFreezeAttendance === true;
        if (!canFreeze) {
          const cutoff = attendancePeriod?.attendanceCutoffDate;
          showToast(
            cutoff
              ? `Attendance is not frozen yet. Wait until the cutoff date (${cutoff}) or let the daily job freeze it automatically.`
              : 'Attendance is not frozen yet. Wait until the payroll calendar cutoff date.',
            'error'
          );
          return;
        }
        const proceed = await confirm({
          title: 'Finalize attendance first?',
          description:
            'Attendance is not finalized for this month. Finalize now and continue with payroll?',
          variant: 'success',
          confirmLabel: 'Finalize and continue',
        });
        if (!proceed) return;
      }
      if (!approverUserIds.length) {
        showToast(
          t('payroll.approversRequired') || 'Select at least one approver before running payroll.',
          'error'
        );
        return;
      }
      const payload: CreatePayrollRunPayload = {
        year,
        month,
        runDate,
        payDate,
        autoFinalizeAttendance: !attOk,
        requireAttendanceFinalized: true,
        assignedApproverUserIds: approverUserIds,
      };
      const result = await Api.payroll.createRun(payload);
      const runId = result?.id ? String(result.id) : null;
      showToast(
        result?.recalculated
          ? 'Payroll recalculated. Opening the run for review and approval.'
          : t('payroll.runSuccess'),
        'success'
      );
      setModalOpen(false);
      await fetchData();
      if (runId) {
        navigate(`/payroll/runs/${runId}`);
        return;
      }
      await fetchPreview();
    } catch (e: unknown) {
      const err = e as Error & { status?: number; data?: Record<string, unknown> };
      const message = err.message || t('payroll.runFailed');
      if (err.status === 409 && err.data?.code === 'PAYROLL_RUN_EXISTS' && err.data?.runId) {
        showToast(message, 'error');
        setModalOpen(false);
        navigate(`/payroll/runs/${String(err.data.runId)}`);
        return;
      }
      showToast(message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const previewRowsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildPayrollItemRow>>();
    for (const item of previewItems) {
      const profile = getPayrollEmployeeProfile(
        item.userId,
        employeeProfiles,
        item.employeeId,
        item.breakdown?.reviewSnapshot
      );
      map.set(item.id, buildPayrollItemRow(item, profile));
    }
    return map;
  }, [previewItems, employeeProfiles]);

  const previewItemsFiltered = useMemo(
    () => filterPayrollReviewItems(previewItems, previewRowsById, reviewFilters),
    [previewItems, previewRowsById, reviewFilters]
  );

  const previewDepartmentOptions = useMemo(
    () => collectDepartmentOptions([...previewRowsById.values()]),
    [previewRowsById]
  );

  const previewChangedCount = useMemo(
    () =>
      [...previewRowsById.values()].filter((row) => rowMatchesChangedFilter(row, true)).length,
    [previewRowsById]
  );

  const previewFiltersActive =
    reviewFilters.changedOnly ||
    Boolean(reviewFilters.departmentId) ||
    Boolean(reviewFilters.search.trim());

  const periodRangeLabel = useMemo(() => {
    if (!previewMatchesSelection || !previewMeta?.period) return null;
    const { payPeriodStart, payPeriodEnd, attendanceCutoffDate } = previewMeta.period;
    const range = `${payPeriodStart} → ${payPeriodEnd}`;
    return attendanceCutoffDate ? `${range} · Cutoff ${attendanceCutoffDate}` : range;
  }, [previewMatchesSelection, previewMeta?.period]);

  const workflowStepStatus = useMemo((): Record<1 | 2 | 3, PayrollWorkflowStepStatus> => {
    const prepareDone = attendanceFinalizedForWorkflow && previewMatchesSelection;
    if (previewMonthFinalized) {
      return { 1: 'done', 2: 'done', 3: 'done' };
    }
    if (previewMonthHasOpenRun) {
      return {
        1: 'done',
        2: prepareDone ? 'done' : 'current',
        3: 'current',
      };
    }
    return {
      1: previewMatchesSelection ? 'done' : 'current',
      2: previewMatchesSelection ? (prepareDone ? 'done' : 'current') : 'upcoming',
      3: prepareDone ? 'current' : 'upcoming',
    };
  }, [
    previewMonthFinalized,
    previewMonthHasOpenRun,
    previewMatchesSelection,
    attendanceFinalizedForWorkflow,
  ]);

  const attendancePreviewRowsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildPayrollItemRow>>();
    for (const item of attendancePreviewItems) {
      const profile = getPayrollEmployeeProfile(
        item.userId,
        employeeProfiles,
        item.employeeId,
        item.breakdown?.reviewSnapshot
      );
      map.set(item.id, buildPayrollItemRow(item, profile));
    }
    return map;
  }, [attendancePreviewItems, employeeProfiles]);

  const attendancePreviewItemsFiltered = useMemo(
    () =>
      filterPayrollReviewItems(attendancePreviewItems, attendancePreviewRowsById, reviewFilters),
    [attendancePreviewItems, attendancePreviewRowsById, reviewFilters]
  );

  const handleSavePreviewSales = useCallback(
    async (item: Payslip, salesAmount: number) => {
      const employeeId = String(item.employeeId ?? '').trim();
      if (!employeeId) {
        showToast('Missing employee id for sales entry', 'error');
        return;
      }
      const monthStr = previewMonthKey;
      try {
        await Api.payroll.upsertMonthlySales({
          month: monthStr,
          items: [{ employeeId, salesAmount }],
        });
        setSalesByEmployeeId((prev) => ({ ...prev, [employeeId]: salesAmount }));
        showToast('Sales saved — refreshing commission preview…', 'success');
        // Refresh the lane currently on screen (estimate vs post-attendance).
        void fetchPreview({
          background: true,
          includeAttendance: attendanceFinalizedForWorkflow,
        });
      } catch (e) {
        showToast((e as Error)?.message || 'Failed to save sales', 'error');
      }
    },
    [previewMonthKey, showToast, fetchPreview, attendanceFinalizedForWorkflow]
  );

  const renderPreviewTable = (
    items: Payslip[],
    itemsFiltered: Payslip[],
    loading: boolean,
    meta: PayrollPreviewMeta | null,
    matchesSelection: boolean,
    pendingFinalization: boolean,
    loadingMessage: string,
    emptyMessage: string
  ) => {
    const failedCount = meta?.failedEmployees ?? meta?.errors?.length ?? 0;
    const eligibleCount =
      meta?.eligibleEmployees ?? items.length + (meta?.errors?.length ?? 0);
    const resolvedEmptyMessage =
      failedCount > 0 && items.length === 0
        ? eligibleCount > 0
          ? `Payroll preview failed for ${failedCount} of ${eligibleCount} eligible employee(s). Review the errors below before running payroll.`
          : `Payroll preview failed for ${failedCount} employee(s). Review the errors below before running payroll.`
        : emptyMessage;

    const showLoading = loading || !matchesSelection;

    return (
    <>
      {runForPreviewMonth &&
      matchesSelection &&
      previewMonthKey === String(runForPreviewMonth.month).slice(0, 7) ? (
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {t('payroll.runCalculatedForPeriod') || 'Payroll run calculated for this period'}
              </p>
              <StatusLabel
                status={normalizePayrollRunStatus(runForPreviewMonth.status)}
                context="payroll"
                label={formatRunStatusLabel(runForPreviewMonth.status, t)}
                size="sm"
              />
              {runForPreviewMonth.calculatedAt ? (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t('payroll.periodCalculated', {
                    date: (() => {
                      try {
                        return formatDateOnlyDisplay(runForPreviewMonth.calculatedAt!);
                      } catch {
                        return runForPreviewMonth.calculatedAt;
                      }
                    })(),
                  })}
                </span>
              ) : null}
            </div>
            <Link to={`/payroll/runs/${runForPreviewMonth.id}`}>
              <Button variant="outline" size="sm" type="button">
                <FileText className="w-4 h-4 mr-1.5" />
                {t('payroll.viewCalculatedRun') || 'View run'}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
      {items.length > 0 && matchesSelection && !showLoading ? (
        <PayrollReviewToolbar
          filters={reviewFilters}
          onChange={(next) => setReviewFilters((prev) => ({ ...prev, ...next }))}
          departmentOptions={previewDepartmentOptions}
          changedCount={previewChangedCount}
        />
      ) : null}
      {showLoading ? (
        <LoadingState variant="panel" layout="table" rows={8} label={loadingMessage} />
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center text-slate-500 space-y-2">
          <p>{resolvedEmptyMessage}</p>
          {meta?.globalWarnings?.length ? (
            <p className="text-xs text-amber-800 dark:text-amber-200 max-w-lg mx-auto leading-relaxed">
              {meta.globalWarnings.map((w) => w.message).join(' ')}
            </p>
          ) : null}
          {meta?.errors?.length ? (
            <div className="max-w-lg mx-auto text-left rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-3 py-2">
              <p className="text-xs font-semibold text-red-800 dark:text-red-200 mb-1">
                {meta.errors.length} employee(s) failed payroll calculation
              </p>
              <ul className="space-y-0.5 text-[11px] text-red-700 dark:text-red-300 max-h-32 overflow-y-auto">
                {meta.errors.slice(0, 6).map((e) => (
                  <li key={`${e.userId}-${e.employeeId}`}>
                    {e.employeeId}: {e.message}
                  </li>
                ))}
                {meta.errors.length > 6 ? (
                  <li className="italic">…and {meta.errors.length - 6} more (see finance info panel)</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : itemsFiltered.length === 0 && previewFiltersActive ? (
        <p className="px-5 py-10 text-center text-slate-500">
          No employees match the current review filters for this period.
        </p>
      ) : (
        <PayrollItemsTable
          variant="preview"
          items={itemsFiltered}
          employeeProfiles={employeeProfiles}
          viewMode={reviewFilters.viewMode}
          pendingFinalization={pendingFinalization}
          salesByEmployeeId={salesByEmployeeId}
          onSaveSales={
            hasPermission(PERM.PAYROLL_PROCESS)
              ? (item, salesAmount) => {
                  void handleSavePreviewSales(item, salesAmount);
                }
              : undefined
          }
          readOnly={!hasPermission(PERM.PAYROLL_PROCESS)}
        />
      )}
      {meta && matchesSelection && !showLoading ? (
        <div className="px-5 pb-4">
          <PayrollPreviewFinanceInfo meta={meta} />
        </div>
      ) : null}
    </>
  );
  };

  const periodFilterMenu = (
    <PageFilterMenu
      title="Payroll period"
      periodSummary={previewPeriodLabel}
      activeCount={previewPeriodFilterCount}
      loading={previewLoading || !previewMatchesSelection}
      onClear={clearPreviewPeriod}
    >
      <FilterMenuDateRange
        from={previewPeriodFrom}
        to={previewPeriodTo}
        onChange={applyPreviewPeriodRange}
        fromLabel="Period from"
        toLabel="Period to"
        readOnly
        hint="Period from/to follow the cutoff window for the selected salary month (day after previous cutoff → this month's cutoff). Change Year/Month below to update the window."
      />
      <FilterMenuField label={t('common.year')}>
        <NumericField
          kind="integer"
          filterOptions={{ maxLength: 4 }}
          value={year}
          onValueChange={(v) => {
            const y = Number(v) || year;
            if (y !== year) setPreviewPeriod(y, month);
          }}
          className={inputClass}
          aria-label="Preview year"
        />
      </FilterMenuField>
      <FilterMenuSelect
        label={t('payroll.month')}
        value={String(month)}
        onChange={(v) => {
          const m = Number(v);
          if (m >= 1 && m <= 12) setPreviewPeriod(year, m);
        }}
        options={MONTH_KEYS.map((key, i) => {
          const monthNum = i + 1;
          const monthKey = `${year}-${String(monthNum).padStart(2, '0')}`;
          const runLabel = monthRunStatusLabel(monthKey);
          return {
            value: String(monthNum),
            label: runLabel ? `${t(key)} · ${runLabel}` : t(key),
          };
        })}
      />
    </PageFilterMenu>
  );

  return (
    <div className="space-y-5">
      <ConfirmDialogHost />

      <UnderlineTabs
        ariaLabel="Payroll overview sections"
        value={overviewSection}
        onChange={setOverviewSection}
        size="sm"
        tabs={[
          { id: 'cycle', label: t('payroll.overviewTabCycle') || 'Payroll cycle', icon: Calculator },
          {
            id: 'runs',
            label: t('payroll.runsListTitle') || 'Payroll list',
            icon: History,
            badge:
              payrollListActionNeededCount > 0 ? payrollListActionNeededCount : undefined,
          },
        ]}
      />

      {overviewSection === 'cycle' ? (
      <Card className="border-none shadow-sm overflow-hidden relative">
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
          {previewMatchesSelection ? (
            <PayrollPreviewFinanceInfo
              meta={
                attendanceFinalizedForWorkflow && attendancePreviewMatchesSelection
                  ? attendancePreviewMeta
                  : previewMeta
              }
            />
          ) : null}
        </div>
        <PayrollWorkflowStep
          step={1}
          title="Select payroll period"
          description={periodRangeLabel ?? undefined}
          status={workflowStepStatus[1]}
          action={periodFilterMenu}
        >
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2 pr-10">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{previewPeriodLabel}</h2>
              {runForPreviewMonth ? (
                <StatusLabel
                  status={normalizePayrollRunStatus(runForPreviewMonth.status)}
                  context="payroll"
                  label={formatRunStatusLabel(runForPreviewMonth.status, t)}
                />
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
              <CompactMetric
                label={t('payroll.employeesSelectedPeriod')}
                value={String(stats.totalEmployees)}
                icon={<Users className="w-4 h-4" />}
                iconClass="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              />
              <CompactMetric
                label={t('payroll.estGrossPreview')}
                value={payOutcomesPending ? 'Pending' : `$${stats.grossPayroll.toLocaleString()}`}
                icon={<DollarSign className="w-4 h-4" />}
                iconClass="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
              />
              <CompactMetric
                label={t('payroll.estNetPreview')}
                value={payOutcomesPending ? 'Pending' : `$${stats.netDisbursement.toLocaleString()}`}
                icon={<TrendingUp className="w-4 h-4" />}
                iconClass="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
              />
              <CompactMetric
                label={t('payroll.nextRun')}
                value={stats.nextRun}
                icon={<Calendar className="w-4 h-4" />}
                iconClass="bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
              />
            </div>
            {runAlerts.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary-200/80 bg-primary-50/60 px-3 py-2 text-xs text-primary-900 dark:border-primary-800/50 dark:bg-primary-950/20 dark:text-primary-100">
                <span className="font-semibold shrink-0">{t('payroll.upcomingReminder')}</span>
                <span className="text-primary-800 dark:text-primary-200">
                  {runAlerts.map((a) => a.label).join(' · ')}
                </span>
                <Link
                  to="/payroll/calendar"
                  className="font-medium text-primary-700 dark:text-primary-300 hover:underline inline-flex items-center gap-1 ml-auto"
                >
                  {t('payroll.editCalendar')} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            ) : null}
          </div>
        </PayrollWorkflowStep>

        <PayrollWorkflowStep
          step={2}
          title="Prepare payroll"
          status={workflowStepStatus[2]}
        >
          <div className="px-5 pt-1">
            <PayrollAttendanceFinalizeCard
              variant="inline"
              hideHeading
              month={`${year}-${String(month).padStart(2, '0')}`}
              onStatusChange={handleAttendancePeriodChange}
              periodFromParent={periodForFinalizeCard}
            />
          </div>
          {attendanceFinalizedForWorkflow
            ? renderPreviewTable(
                attendancePreviewItems,
                attendancePreviewItemsFiltered,
                attendancePreviewLoading,
                attendancePreviewMeta,
                attendancePreviewMatchesSelection,
                false,
                'Loading attendance-based preview…',
                'No employees were calculated for this finalized attendance preview.'
              )
            : renderPreviewTable(
                previewItems,
                previewItemsFiltered,
                previewLoading,
                previewMeta,
                previewMatchesSelection,
                true,
                t('common.loading'),
                'No active employees found for payroll preview.'
              )}
        </PayrollWorkflowStep>

        <PayrollWorkflowStep
          step={3}
          title="Run payroll"
          status={workflowStepStatus[3]}
          isLast
          action={
            previewMonthFinalized && runForPreviewMonth ? (
              <Link to={`/payroll/runs/${runForPreviewMonth.id}`}>
                <Button variant="outline" size="sm" type="button">
                  {t('payroll.previewPendingRunAction')}
                </Button>
              </Link>
            ) : previewMonthHasOpenRun && runForPreviewMonth ? (
              <Link to={`/payroll/runs/${runForPreviewMonth.id}`}>
                <Button variant="outline" size="sm" type="button">
                  {t('payroll.previewPendingRunAction')}
                </Button>
              </Link>
            ) : (
              <Button
                onClick={() => setModalOpen(true)}
                disabled={!attendanceFinalizedForWorkflow || previewMonthFinalized}
                title={
                  !attendanceFinalizedForWorkflow
                    ? 'Finalize attendance in step 2 before calculating payroll.'
                    : previewMonthFinalized
                      ? t('payroll.previewClosedDescription')
                      : undefined
                }
                icon={
                  previewMonthCanRunAgain ? (
                    <RefreshCw className="w-4 h-4" />
                  ) : (
                    <Calculator className="w-4 h-4" />
                  )
                }
              >
                {previewMonthCanRunAgain
                  ? t('payroll.runAgain') || 'Run again'
                  : t('payroll.calculatePayroll')}
              </Button>
            )
          }
        />
      </Card>
      ) : (
        <Card className="surface-card-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('payroll.runsListTitle') || 'Payroll list'}
                <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {year}
                </span>
              </h3>
              {yearScopedPayrollListRows.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('payroll.runsListYearCount', {
                      count: yearScopedPayrollListRows.length,
                      year: String(year),
                    }) || `${yearScopedPayrollListRows.length} in ${year}`}
                  </span>
                  {payrollListPendingApprovalCount > 0 ? (
                    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      {t('payroll.runsListPendingRemark', {
                        count: payrollListPendingApprovalCount,
                      }) ||
                        `${payrollListPendingApprovalCount} not approved yet`}
                    </span>
                  ) : null}
                  {payrollListActionNeededCount > 0 &&
                  payrollListActionNeededCount !== payrollListPendingApprovalCount ? (
                    <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-0.5 font-medium text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
                      {t('payroll.runsListActionNeededRemark', {
                        count: payrollListActionNeededCount,
                      }) || `${payrollListActionNeededCount} need action`}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {listFilterMenu}
            </div>
          </div>
          {yearScopedPayrollListRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {t('payroll.runsListEmptyYear', { year: String(year) }) ||
                `No payroll runs for ${year}. Switch year in Filters, or calculate a period on Payroll cycle.`}
            </p>
          ) : filteredPayrollListRows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {t('payroll.runsListEmptyFilter') ||
                'No payrolls match this status filter. Clear filters to see the full year.'}
            </p>
          ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[640px] text-sm hcms-table-compact">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <SortableTableHeader
                    label={t('payroll.period') || 'Period'}
                    column="period"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={payrollRunsThClass}
                  />
                  <SortableTableHeader
                    label={t('payroll.employeesSelectedPeriod')}
                    column="employees"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={payrollRunsThClass}
                  />
                  <SortableTableHeader
                    label={t('payroll.estNetPreview')}
                    column="net"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={payrollRunsThClass}
                  />
                  <SortableTableHeader
                    label={t('common.status') || 'Status'}
                    column="status"
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                    className={payrollRunsThClass}
                  />
                  <th className={`${payrollRunsThClass} hidden sm:table-cell`}>
                    {t('payroll.runsListRemarkCol') || 'Remark'}
                  </th>
                  <th className={`${payrollRunsThClass} text-right`}>{t('common.action') || 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {sortedPayrollListRows.map((row) => {
                  if (row.kind === 'locked_period') {
                    const periodDate = parseISO(`${row.month}-01`);
                    const periodLabel = Number.isNaN(periodDate.getTime())
                      ? row.month
                      : periodDate.toLocaleDateString(dateLocale, {
                          month: 'long',
                          year: 'numeric',
                        });
                    const rangeStart = row.payPeriodStart
                      ? formatDateOnlyDisplay(row.payPeriodStart)
                      : null;
                    const rangeEnd = row.payPeriodEnd
                      ? formatDateOnlyDisplay(row.payPeriodEnd)
                      : null;
                    const rangeLabel =
                      rangeStart && rangeEnd ? `${rangeStart} – ${rangeEnd}` : null;
                    const lockedAt = row.finalizedAt
                      ? formatDateOnlyDisplay(row.finalizedAt)
                      : null;
                    const isSelected = row.month === previewMonthKey;
                    const openCalculate = () => {
                      const [y, m] = row.month.split('-').map(Number);
                      if (y) setYear(y);
                      if (m >= 1 && m <= 12) setMonth(m);
                      setOverviewSection('cycle');
                      setModalOpen(true);
                    };
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 dark:border-slate-800/80 transition-colors ${
                          isSelected
                            ? 'bg-primary-50/50 dark:bg-primary-950/20'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-3 min-w-[10rem]">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {periodLabel}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {rangeLabel ||
                              t('payroll.lockedPeriodPendingCalc') ||
                              'Attendance locked — not calculated yet'}
                            {lockedAt ? ` · ${lockedAt}` : ''}
                          </p>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-slate-500 dark:text-slate-400">
                          —
                        </td>
                        <td className="py-3 px-3 tabular-nums text-slate-500 dark:text-slate-400">
                          —
                        </td>
                        <td className="py-3 px-3">
                          <StatusLabel
                            status="LOCKED"
                            context="payroll"
                            label={formatRunStatusLabel('LOCKED', t)}
                            size="sm"
                          />
                        </td>
                        <td className="py-3 px-3 hidden sm:table-cell">
                          <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {t('payroll.runsListRemarkLocked') || 'Calculate required'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <ResponsiveRowActions
                            menuLabel={t('common.actions') || 'Run actions'}
                            actions={[
                              {
                                key: 'calculate',
                                label: t('payroll.calculatePayroll') || 'Calculate payroll',
                                icon: <Calculator className="w-4 h-4" />,
                                onClick: openCalculate,
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  }

                  const run = row.run;
                  const periodDate = parseISO(`${String(run.month).slice(0, 7)}-01`);
                  const periodLabel = Number.isNaN(periodDate.getTime())
                    ? String(run.month)
                    : periodDate.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' });
                  let calculatedLabel = '—';
                  const calculatedAt = run.calculatedAt || run.createdAt;
                  if (calculatedAt) {
                    try {
                      calculatedLabel = formatDateOnlyDisplay(calculatedAt);
                    } catch {
                      calculatedLabel = calculatedAt;
                    }
                  }
                  const isSelected =
                    String(run.month).slice(0, 7) === previewMonthKey;
                  const monthKey = String(run.month).slice(0, 7);
                  const monthCanonical = runsByMonthKey.get(monthKey);
                  const canRunAgainForRow =
                    isInactivePayrollRunStatus(String(run.status)) &&
                    (!monthCanonical ||
                      isInactivePayrollRunStatus(String(monthCanonical.status)));
                  const runStatus = normalizePayrollRunStatus(String(run.status));
                  const showUnapprovedRemark = !isFinalizedPayrollStatus(runStatus);
                  const remarkLabel = canRunAgainForRow
                    ? t('payroll.runsListRemarkRunAgain') || 'Run again available'
                    : runStatus === 'PENDING_APPROVAL' || runStatus === 'UNDER_REVIEW'
                      ? t('payroll.runsListRemarkAwaitingApproval') || 'Awaiting approval'
                      : runStatus === 'DRAFT'
                        ? t('payroll.runsListRemarkDraft') || 'Draft — finish review'
                        : showUnapprovedRemark
                          ? t('payroll.runsListRemarkNeedsAction') || 'Needs action'
                          : null;
                  const rowActions = [
                    {
                      key: 'view',
                      label: t('common.view') || 'View',
                      icon: <FileText className="w-4 h-4" />,
                      onClick: () => navigate(`/payroll/runs/${run.id}`),
                    },
                    ...(canRunAgainForRow
                      ? [
                          {
                            key: 'run-again',
                            label: t('payroll.runAgain') || 'Run again',
                            icon: <RefreshCw className="w-4 h-4" />,
                            onClick: () => {
                              const [y, m] = monthKey.split('-').map(Number);
                              if (y) setYear(y);
                              if (m >= 1 && m <= 12) setMonth(m);
                              setOverviewSection('cycle');
                              setModalOpen(true);
                            },
                          },
                        ]
                      : []),
                  ];
                  return (
                    <tr
                      key={run.id}
                      className={`border-b border-slate-100 dark:border-slate-800/80 transition-colors ${
                        isSelected
                          ? 'bg-primary-50/50 dark:bg-primary-950/20'
                          : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-3 min-w-[10rem]">
                        <p className="font-semibold text-slate-900 dark:text-white">{periodLabel}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {t('payroll.periodCalculated', { date: calculatedLabel })}
                          {run.calculatedByName
                            ? ` · ${t('payroll.runBy', { name: run.calculatedByName })}`
                            : ''}
                        </p>
                      </td>
                      <td className="py-3 px-3 tabular-nums text-slate-700 dark:text-slate-200">
                        {run.totalEmployees}
                      </td>
                      <td className="py-3 px-3 font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatPayrollMoney(run.totalNetPay, { currency })}
                      </td>
                      <td className="py-3 px-3">
                        <StatusLabel
                          status={runStatus}
                          context="payroll"
                          label={formatRunStatusLabel(run.status, t)}
                          size="sm"
                        />
                      </td>
                      <td className="py-3 px-3 hidden sm:table-cell">
                        {remarkLabel ? (
                          <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {remarkLabel}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <ResponsiveRowActions
                          menuLabel={t('common.actions') || 'Run actions'}
                          actions={rowActions}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('payroll.createRunTitle')}
        help="payroll.createRun"
        size="lg"
      >
        <div className="space-y-3 sm:space-y-5 min-w-0 max-w-full">
          <PayrollAttendanceFinalizeCard
            month={`${year}-${String(month).padStart(2, '0')}`}
            onStatusChange={handleAttendancePeriodChange}
            periodFromParent={periodForFinalizeCard}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('common.year')}</span>
              <NumericField
                kind="integer"
                filterOptions={{ maxLength: 4 }}
                value={year}
                onValueChange={(v) => setYear(Number(v) || year)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('payroll.month')}</span>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className={`${selectClass} mt-1 w-full`}
              >
                {MONTH_KEYS.map((key, i) => (
                  <option key={key} value={i + 1}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('payroll.runDate')}</span>
              <DatePickerInput
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{t('payroll.payDate')}</span>
              <DatePickerInput
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>
          <ApproverApprovalField
            required
            value={approverUserIds}
            selected={approverCandidates}
            onChange={(userIds, candidates) => {
              setApproverUserIds(userIds);
              setApproverCandidates(candidates);
            }}
            label={t('payroll.approversLabel') || 'Payroll approvers'}
            hint={
              t('payroll.approversHint') ||
              'Select who should review and approve this payroll run. The first person approves first, then each person below in order.'
            }
            modalTitle={t('payroll.approversModalTitle') || 'Select payroll approvers'}
          />
          <div className="hcms-modal-actions hcms-modal-actions--end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={creating}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleCreateRun()}
              isLoading={creating}
              disabled={
                !approverUserIds.length ||
                (previewMatchesSelection && (previewMeta?.errors?.length ?? 0) > 0)
              }
            >
              {t('payroll.runPayroll')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PayrollDashboard;
