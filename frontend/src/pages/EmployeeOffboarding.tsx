import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useSearchParams } from 'react-router-dom';
import { Info, UserX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Api } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { offboardingRowPermissions } from '../config/offboardingAccess';
import { OffboardingHubCaseCard } from '../components/offboarding/OffboardingHubCaseCard';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { Button } from '../components/ui/Button';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import { ListSearchFilterBar } from '../components/ui/page';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/shadcn/popover';
import { countActiveFilters } from '../utils/filterActiveCount';
import { offboardingHubUrl } from '../offboarding/offboardingRoutes';
import {
  normalizeSettlementStatus,
  suggestedWizardStepIndex,
  settlementStatusLabel,
} from '../offboarding/offboardingWizardSteps';
import {
  isOffboardingAwaitingPayroll,
  isOffboardingWorkflowComplete,
} from '../offboarding/offboardingHubStatus';
import {
  EMPTY_OFFBOARDING_HUB_FILTERS,
  matchesOffboardingHubFilters,
  type OffboardingHubFilterState,
} from '../offboarding/offboardingHubFilters';
import { isSimplifiedOffboardingSettlement } from '../offboarding/settlementFormUtils';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from '../utils/formatDisplayDate';
import type { EmployeeArchiveDetail } from '../types';
import { useLanguage } from '../context/LanguageContext';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportListTable } from '../utils/export/exportListTable';

type EmployeeRow = {
  id?: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  avatar_url?: string | null;
  email?: string;
  phone?: string;
  status?: string;
  department?: { name?: string };
  position?: { title?: string };
  terminated_at?: string | null;
  termination_reason?: string | null;
  last_working_date?: string | null;
  offboard_type?: string | null;
  offboard_source?: string | null;
};

type EmployeeHistoryRow = {
  id: number;
  employee_id: string;
  terminated_at?: string | null;
  termination_reason?: string | null;
  restored_at?: string | null;
  is_currently_terminated?: boolean;
};

type SettlementSummary = {
  id: string;
  employeeId: string;
  employeeName?: string;
  status: string;
  lastWorkingDate?: string;
  netUsd?: number;
  clearanceJson?: unknown;
  breakdown?: unknown;
  breakdownSnapshotJson?: unknown;
};

function pickLatestSettlement(rows: SettlementSummary[]): SettlementSummary | undefined {
  if (!rows.length) return undefined;
  const nonRejected = rows.filter((r) => normalizeSettlementStatus(r.status) !== 'REJECTED');
  return (nonRejected.length ? nonRejected : rows)[0];
}

function settlementForEmployeeRow(
  e: EmployeeRow,
  map: Record<string, SettlementSummary>
): SettlementSummary | undefined {
  return map[e.employee_id] ?? (e.id ? map[e.id] : undefined);
}

function isCaseWorkflowComplete(
  e: EmployeeRow,
  map: Record<string, SettlementSummary>
): boolean {
  const settlement = settlementForEmployeeRow(e, map);
  const st = settlement ? normalizeSettlementStatus(settlement.status) : '';
  return isOffboardingWorkflowComplete(st, e.status);
}

function formatDisplayDate(iso?: string | null): string {
  return formatDateOnlyDisplay(iso, iso ? String(iso).slice(0, 10) : '—');
}

function formatDateTime(iso?: string | null): string {
  return formatDateTimeDisplay(iso, iso ? String(iso) : '—');
}

function pickCurrentOffboardHistory(rows: EmployeeHistoryRow[]): EmployeeHistoryRow | undefined {
  if (!rows.length) return undefined;
  return (
    rows.find(
      (r) => r.is_currently_terminated === true || (r.is_currently_terminated !== false && !r.restored_at)
    ) ??
    rows.find((r) => !r.restored_at) ??
    rows[0]
  );
}

function CaseSkeleton() {
  return <ContentSkeleton layout="list" rows={1} />;
}

export const EmployeeOffboarding: React.FC = () => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canViewPayroll = offboardingRowPermissions({
    hasPermission,
    userRole: user?.role,
  }).canPayroll;
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightEmployeeId =
    searchParams.get('employeeId')?.trim() || searchParams.get('employee')?.trim() || '';

  const [loading, setLoading] = useState(true);
  const [allSettlements, setAllSettlements] = useState<SettlementSummary[]>([]);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<OffboardingHubFilterState>(EMPTY_OFFBOARDING_HUB_FILTERS);
  const [offboardedRows, setOffboardedRows] = useState<EmployeeRow[]>([]);
  const [inProgressRows, setInProgressRows] = useState<EmployeeRow[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, EmployeeHistoryRow[]>>({});
  const [settlementByEmployee, setSettlementByEmployee] = useState<Record<string, SettlementSummary>>({});
  const [archiveDetailByEmployee, setArchiveDetailByEmployee] = useState<
    Record<string, EmployeeArchiveDetail>
  >({});
  const [archiveDetailLoading, setArchiveDetailLoading] = useState<string | null>(null);

  const tabCache = useWorkspaceTabCache<{
    offboardedRows: EmployeeRow[];
    inProgressRows: EmployeeRow[];
    historyMap: Record<string, EmployeeHistoryRow[]>;
    settlementByEmployee: Record<string, SettlementSummary>;
    query: string;
    filters: OffboardingHubFilterState;
  }>({
    slot: 'employees-offboarding-v3',
    cacheKey: 'cases',
    getSnapshot: () => ({
      offboardedRows,
      inProgressRows,
      historyMap,
      settlementByEmployee,
      query,
      filters,
    }),
    applySnapshot: (cached) => {
      setOffboardedRows(cached.offboardedRows);
      setInProgressRows(cached.inProgressRows);
      setHistoryMap(cached.historyMap);
      setSettlementByEmployee(cached.settlementByEmployee);
      setQuery(cached.query);
      setFilters(cached.filters ?? EMPTY_OFFBOARDING_HUB_FILTERS);
      setLoading(false);
    },
    shouldPersist: (cached) =>
      cached.offboardedRows.length > 0 || cached.inProgressRows.length > 0,
    persistDeps: [offboardedRows, inProgressRows, historyMap, settlementByEmployee, query, filters],
  });

  const loadArchiveDetail = useCallback(async (employeeId: string) => {
    if (archiveDetailByEmployee[employeeId]) return;
    setArchiveDetailLoading(employeeId);
    try {
      const detail = await Api.employees.getArchiveDetail(employeeId);
      setArchiveDetailByEmployee((prev) => ({ ...prev, [employeeId]: detail }));
    } catch (e) {
      console.error(e);
    } finally {
      setArchiveDetailLoading(null);
    }
  }, [archiveDetailByEmployee]);

  useEffect(() => {
    if (!highlightEmployeeId) return;
    void loadArchiveDetail(highlightEmployeeId);
  }, [highlightEmployeeId, loadArchiveDetail]);

  const loadAll = useCallback(async (opts?: WorkspaceLoadOptions) => {
    try {
      if (!opts?.background) setLoading(true);
      const hub = await Api.employees.getOffboardedHub();
      const offboarded = (hub?.employees ?? []) as EmployeeRow[];
      const inProgress = (hub?.inProgress ?? []) as EmployeeRow[];
      setOffboardedRows(offboarded);
      setInProgressRows(inProgress);
      setHistoryMap((hub?.historyByEmployee ?? {}) as Record<string, EmployeeHistoryRow[]>);

      if (canViewPayroll) {
        try {
          const settlementRows = (await Api.payroll.listFinalSettlements()) as SettlementSummary[];
          const rows = Array.isArray(settlementRows) ? settlementRows : [];
          setAllSettlements(rows);
          const byEmployee: Record<string, SettlementSummary[]> = {};
          for (const row of rows) {
            const eid = row.employeeId;
            if (!eid) continue;
            if (!byEmployee[eid]) byEmployee[eid] = [];
            byEmployee[eid].push(row);
          }
          const map: Record<string, SettlementSummary> = {};
          for (const eid of Object.keys(byEmployee)) {
            const picked = pickLatestSettlement(byEmployee[eid]);
            if (picked) map[eid] = picked;
          }
          setSettlementByEmployee(map);
        } catch {
          setAllSettlements([]);
          setSettlementByEmployee({});
        }
      } else {
        setAllSettlements([]);
        setSettlementByEmployee({});
      }
    } catch (e) {
      if (!opts?.background) {
        showToast(e instanceof Error ? e.message : t('offboarding.hub.loadFailed'), 'error');
      }
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [showToast, canViewPayroll, t]);

  useWorkspaceTabMountLoad(loadAll, [loadAll], tabCache);

  const searchLower = query.trim().toLowerCase();
  const matchesSearch = useCallback(
    (e: EmployeeRow) => {
      const base = `${e.employee_id} ${e.last_name} ${e.first_name} ${e.email || ''}`.toLowerCase();
      if (base.includes(searchLower)) return true;
      const settlement = settlementByEmployee[e.employee_id] ?? (e.id ? settlementByEmployee[e.id] : undefined);
      if (settlement?.employeeName?.toLowerCase().includes(searchLower)) return true;
      if (settlement?.employeeId?.toLowerCase().includes(searchLower)) return true;
      return false;
    },
    [searchLower, settlementByEmployee]
  );

  const baseUnifiedCases = useMemo(() => {
    const items: Array<{ employee: EmployeeRow; inProgress: boolean }> = [];
    const seen = new Set<string>();

    const markSeen = (e: EmployeeRow) => {
      seen.add(e.employee_id);
      if (e.id) seen.add(e.id);
    };

    const isSeen = (e: EmployeeRow) =>
      seen.has(e.employee_id) || (e.id ? seen.has(e.id) : false);

    const resolveInProgress = (employee: EmployeeRow, hubInProgress: boolean) =>
      hubInProgress && !isCaseWorkflowComplete(employee, settlementByEmployee);

    const push = (employee: EmployeeRow, hubInProgress: boolean) => {
      if (isSeen(employee)) return;
      markSeen(employee);
      items.push({ employee, inProgress: resolveInProgress(employee, hubInProgress) });
    };

    for (const e of inProgressRows) push(e, true);

    if (canViewPayroll) {
      const latestByEmp = new Map<string, SettlementSummary>();
      for (const row of allSettlements) {
        const prev = latestByEmp.get(row.employeeId);
        const picked = pickLatestSettlement(prev ? [prev, row] : [row]);
        if (picked) latestByEmp.set(row.employeeId, picked);
      }
      for (const settlement of latestByEmp.values()) {
        const st = normalizeSettlementStatus(settlement.status);
        if (['PAID', 'REJECTED', 'LOCKED'].includes(st)) continue;
        const matched = [...inProgressRows, ...offboardedRows].some(
          (e) => e.employee_id === settlement.employeeId || e.id === settlement.employeeId
        );
        if (matched) continue;
        const parts = (settlement.employeeName ?? '').trim().split(/\s+/).filter(Boolean);
        push(
          {
            employee_id: settlement.employeeId,
            first_name: parts[0] ?? settlement.employeeId,
            last_name: parts.slice(1).join(' '),
            last_working_date: settlement.lastWorkingDate ?? null,
          },
          true
        );
      }
    }

    for (const e of offboardedRows) push(e, false);

    return items;
  }, [
    inProgressRows,
    offboardedRows,
    allSettlements,
    canViewPayroll,
    settlementByEmployee,
  ]);

  const departmentOptions = useMemo(() => {
    const names = new Set<string>();
    for (const { employee } of baseUnifiedCases) {
      const name = employee.department?.name?.trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [baseUnifiedCases]);

  const unifiedCases = useMemo(() => {
    return baseUnifiedCases.filter(({ employee, inProgress }) => {
      if (!matchesSearch(employee)) return false;
      const settlement = settlementForEmployeeRow(employee, settlementByEmployee);
      return matchesOffboardingHubFilters({
        employee,
        settlement,
        hubInProgress: inProgress,
        filters,
      });
    });
  }, [baseUnifiedCases, matchesSearch, settlementByEmployee, filters]);

  useEffect(() => {
    if (!highlightEmployeeId || loading) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-offboarding-case-id="${CSS.escape(highlightEmployeeId)}"]`
      );
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [highlightEmployeeId, loading, unifiedCases.length]);

  const filterActiveCount = countActiveFilters([
    { value: filters.workflowStatus },
    { value: filters.department },
    { value: filters.payPath },
    { value: filters.exitType },
    { value: filters.lastWorkingFrom },
    { value: filters.lastWorkingTo },
  ]);

  const hasActiveListConstraints =
    query.trim().length > 0 || filterActiveCount > 0;

  const wizardUrlFor = (employeeId: string, settlement?: SettlementSummary) => {
    const step = suggestedWizardStepIndex({
      settlementStatus: settlement ? normalizeSettlementStatus(settlement.status) : '',
      settlement,
    });
    return offboardingHubUrl({ wizard: true, employeeId, step });
  };

  const settlementForEmployee = (e: EmployeeRow): SettlementSummary | undefined =>
    settlementForEmployeeRow(e, settlementByEmployee);

  const buildDetails = (e: EmployeeRow, inProgress: boolean) => {
    const settlement = settlementForEmployee(e);
    const st = settlement ? normalizeSettlementStatus(settlement.status) : '';
    if (isOffboardingWorkflowComplete(st, e.status)) {
      const latest = pickCurrentOffboardHistory(historyMap[e.employee_id] ?? []);
      return {
        typeLabel: t('offboarding.hub.completeBadge'),
        statusBadge: 'success' as const,
        reason: latest?.termination_reason ?? e.termination_reason ?? null,
        offboardedAt: latest?.terminated_at ?? e.terminated_at ?? null,
        lastWorkingDate: e.last_working_date ?? settlement?.lastWorkingDate ?? null,
        department: e.department?.name ?? null,
        position: e.position?.title ?? null,
      };
    }
    if (inProgress) {
      return {
        typeLabel: t('offboarding.hub.inProgressBadge'),
        statusBadge: 'neutral' as const,
        reason: null,
        offboardedAt: null,
        lastWorkingDate:
          e.last_working_date ?? settlement?.lastWorkingDate ?? null,
        department: e.department?.name ?? null,
        position: e.position?.title ?? null,
      };
    }
    const latest = pickCurrentOffboardHistory(historyMap[e.employee_id] ?? []);
    const status = String(e.status ?? '').toLowerCase();
    const offboardType = String(e.offboard_type ?? '').toLowerCase();
    const isResign = status === 'resigned' || offboardType === 'resign';
    return {
      typeLabel: isResign ? t('offboarding.hub.resignation') : t('offboarding.hub.termination'),
      statusBadge: (isResign ? 'info' : 'warning') as 'info' | 'warning',
      reason: latest?.termination_reason ?? e.termination_reason ?? null,
      offboardedAt: latest?.terminated_at ?? e.terminated_at ?? null,
      lastWorkingDate:
        e.last_working_date ?? settlementForEmployee(e)?.lastWorkingDate ?? null,
      department: e.department?.name ?? null,
      position: e.position?.title ?? null,
    };
  };

  const renderCase = (e: EmployeeRow, inProgress: boolean) => {
    const settlement = settlementForEmployee(e);
    const st = settlement ? normalizeSettlementStatus(settlement.status) : '';
    const workflowComplete = isOffboardingWorkflowComplete(st, e.status);
    const awaitingPayroll = isOffboardingAwaitingPayroll(st);
    const effectiveInProgress = inProgress && !workflowComplete;
    return (
      <OffboardingHubCaseCard
        key={`${effectiveInProgress ? 'p' : 'c'}-${e.employee_id}`}
        employee={e}
        settlementStatus={st}
        settlementStatusLabel={st ? settlementStatusLabel(t, st) : ''}
        settlement={
          settlement
            ? {
                id: settlement.id,
                netUsd: settlement.netUsd,
                clearanceJson: settlement.clearanceJson,
                breakdown: settlement.breakdown,
                breakdownSnapshotJson: settlement.breakdownSnapshotJson,
              }
            : null
        }
        showSettlementActions={
          canViewPayroll && Boolean(settlement?.id) && !workflowComplete && !awaitingPayroll
        }
        onSettlementUpdated={() => void loadAll({ background: true })}
        details={buildDetails(e, effectiveInProgress)}
        inProgress={effectiveInProgress}
        highlighted={highlightEmployeeId === e.employee_id}
        archiveDetail={archiveDetailByEmployee[e.employee_id]}
        archiveLoading={archiveDetailLoading === e.employee_id}
        onContinue={() => navigate(wizardUrlFor(e.employee_id, settlement))}
        onViewArchive={
          effectiveInProgress
            ? undefined
            : () => {
                const next = new URLSearchParams(searchParams);
                next.set('employeeId', e.employee_id);
                setSearchParams(next, { replace: true });
                void loadArchiveDetail(e.employee_id);
              }
        }
        onCloseArchive={
          highlightEmployeeId === e.employee_id
            ? () => {
                const next = new URLSearchParams(searchParams);
                next.delete('employeeId');
                next.delete('employee');
                setSearchParams(next, { replace: true });
              }
            : undefined
        }
        t={t}
        formatDate={formatDisplayDate}
        formatDateTime={formatDateTime}
      />
    );
  };

  const totalCases = unifiedCases.length;
  const inProgressCount = unifiedCases.filter((c) => c.inProgress).length;
  const completedCount = unifiedCases.filter((c) => !c.inProgress).length;

  const handleExport = useCallback(
    async (format: ExportFileExt) => {
      await exportListTable(format, {
        module: 'Employee_Offboarding',
        reportTitle: t('offboarding.hub.title') || 'Employee Offboarding',
        sheetName: 'Offboarding',
        rows: unifiedCases,
        metadata: [
          { label: 'Rows', value: unifiedCases.length },
          { label: 'Search', value: query || 'All cases' },
          { label: 'Workflow status', value: filters.workflowStatus || 'All' },
          { label: 'Department', value: filters.department || 'All' },
          { label: 'Pay path', value: filters.payPath || 'All' },
          { label: 'Exit type', value: filters.exitType || 'All' },
          { label: 'Last working from', value: filters.lastWorkingFrom || 'Any' },
          { label: 'Last working to', value: filters.lastWorkingTo || 'Any' },
        ],
        columns: [
          { header: 'Employee ID', value: (row) => row.employee.employee_id, width: 16 },
          { header: 'Employee Name', value: (row) => `${row.employee.first_name || ''} ${row.employee.last_name || ''}`.trim(), width: 24 },
          { header: 'Department', value: (row) => buildDetails(row.employee, row.inProgress).department ?? '', width: 20 },
          { header: 'Position', value: (row) => buildDetails(row.employee, row.inProgress).position ?? '', width: 20 },
          { header: 'Workflow Section', value: (row) => (row.inProgress ? 'In progress' : 'Completed'), width: 16 },
          { header: 'Employee Status', value: (row) => row.employee.status ?? '', width: 16 },
          { header: 'Settlement Status', value: (row) => settlementForEmployee(row.employee)?.status ?? '', width: 18 },
          { header: 'Last Working Date', value: (row) => buildDetails(row.employee, row.inProgress).lastWorkingDate ?? '', width: 16 },
          { header: 'Offboarded At', value: (row) => buildDetails(row.employee, row.inProgress).offboardedAt ?? '', width: 18 },
          { header: 'Termination Reason', value: (row) => buildDetails(row.employee, row.inProgress).reason ?? '', width: 28 },
          { header: 'Offboard Type', value: (row) => row.employee.offboard_type ?? '', width: 16 },
          { header: 'Offboard Source', value: (row) => row.employee.offboard_source ?? '', width: 16 },
          { header: 'Net USD', value: (row) => settlementForEmployee(row.employee)?.netUsd ?? '', width: 14 },
        ],
      });
    },
    [filters, query, t, unifiedCases]
  );

  const settlementDraftCount = useMemo(
    () =>
      allSettlements.filter((s) => normalizeSettlementStatus(s.status) === 'DRAFT').length,
    [allSettlements]
  );
  const settlementPendingCount = useMemo(
    () =>
      allSettlements.filter((s) => {
        if (isSimplifiedOffboardingSettlement(s)) return false;
        return ['HR_REVIEW', 'FINANCE_REVIEW', 'MANAGEMENT_APPROVAL'].includes(
          normalizeSettlementStatus(s.status)
        );
      }).length,
    [allSettlements]
  );

  const offboardingInfoPopover = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-10 h-10 sm:w-9 sm:h-9 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:text-primary-600 hover:border-primary-300 dark:hover:text-primary-400 dark:hover:border-primary-700 transition-colors shrink-0"
          aria-label={t('offboarding.hub.howItWorksLabel')}
        >
          <Info className="w-4 h-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(20rem,calc(100vw-2rem))] p-4 space-y-3 z-50"
      >
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {t('offboarding.hub.policyTitle')}
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {t('offboarding.hub.flowHint')}
        </p>
        <ol className="space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
          <li className="flex gap-2">
            <span className="shrink-0 font-bold text-primary-600 dark:text-primary-400">1.</span>
            <span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">Settlement</span>
              {' — '}
              {t('offboarding.hub.policySteps.step1Detail')}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 font-bold text-primary-600 dark:text-primary-400">2.</span>
            <span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">Payment</span>
              {' — '}
              {t('offboarding.hub.policySteps.step2Detail')}
            </span>
          </li>
        </ol>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="space-y-5">
      <div className="surface-card overflow-hidden">
        <div className="p-4 sm:p-5 space-y-4 border-b border-slate-100 dark:border-slate-800">
          <div className="relative pr-11 sm:pr-12">
            <div className="absolute top-0 right-0 z-10">{offboardingInfoPopover}</div>

            <div className="flex flex-col gap-4 sm:gap-5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white">
                  {t('offboarding.hub.unifiedTitle')}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-xl">
                  {t('offboarding.hub.unifiedSubtitle')}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    <UserX className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {totalCases} {t('offboarding.hub.casesLabel')}
                  </span>
                  {inProgressCount > 0 ? (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 font-medium">
                      {inProgressCount} {t('offboarding.hub.inProgressSection').toLowerCase()}
                    </span>
                  ) : null}
                  {completedCount > 0 ? (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 font-medium">
                      {completedCount} {t('offboarding.hub.completedSection').toLowerCase()}
                    </span>
                  ) : null}
                  {canViewPayroll && settlementDraftCount > 0 ? (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium">
                      {settlementDraftCount} {t('offboarding.hub.draftSettlements')}
                    </span>
                  ) : null}
                  {canViewPayroll && settlementPendingCount > 0 ? (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 font-medium">
                      {settlementPendingCount} {t('offboarding.hub.awaitingApproval')}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="w-full md:w-auto md:shrink-0">
                <Button
                  onClick={() => navigate(offboardingHubUrl({ wizard: true }))}
                  className="w-full md:w-auto shadow-md shadow-primary-500/20 min-h-10 sm:min-h-11"
                >
                  {t('offboarding.hub.startWizard')}
                </Button>
              </div>
            </div>
          </div>

          <ListSearchFilterBar
            leading={
              <ExportFormatMenu
                formats={['csv', 'xlsx']}
                disabled={loading || unifiedCases.length === 0}
                onExport={handleExport}
              />
            }
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder={t('offboarding.hub.searchPlaceholder')}
            filter={
            <PageFilterMenu
              activeCount={filterActiveCount}
              onClear={() => setFilters(EMPTY_OFFBOARDING_HUB_FILTERS)}
              title={t('offboarding.hub.filterTitle')}
              className="sm:shrink-0"
            >
              <FilterMenuDateRange
                from={filters.lastWorkingFrom}
                to={filters.lastWorkingTo}
                onChange={({ from, to }) =>
                  setFilters((prev) => ({ ...prev, lastWorkingFrom: from, lastWorkingTo: to }))
                }
                fromLabel={t('offboarding.hub.filterDateFrom')}
                toLabel={t('offboarding.hub.filterDateTo')}
                hint={t('offboarding.hub.filterDateHint')}
              />
              <FilterMenuSelect
                label={t('offboarding.hub.filterWorkflowStatus')}
                value={filters.workflowStatus}
                onChange={(workflowStatus) =>
                  setFilters((prev) => ({
                    ...prev,
                    workflowStatus: workflowStatus as OffboardingHubFilterState['workflowStatus'],
                  }))
                }
                options={[
                  { value: '', label: t('offboarding.hub.filterAllStatuses') },
                  { value: 'in_progress', label: t('offboarding.hub.filterWorkflowInProgress') },
                  {
                    value: 'awaiting_payroll',
                    label: t('offboarding.hub.filterWorkflowAwaitingPayroll'),
                  },
                  { value: 'complete', label: t('offboarding.hub.filterWorkflowComplete') },
                  { value: 'draft', label: t('offboarding.hub.filterWorkflowDraft') },
                ]}
              />
              <FilterMenuSelect
                label={t('offboarding.hub.filterDepartment')}
                value={filters.department}
                onChange={(department) => setFilters((prev) => ({ ...prev, department }))}
                options={[
                  { value: '', label: t('offboarding.hub.filterAllDepartments') },
                  ...departmentOptions.map((name) => ({ value: name, label: name })),
                ]}
              />
              <FilterMenuSelect
                label={t('offboarding.hub.filterPayPath')}
                value={filters.payPath}
                onChange={(payPath) =>
                  setFilters((prev) => ({
                    ...prev,
                    payPath: payPath as OffboardingHubFilterState['payPath'],
                  }))
                }
                options={[
                  { value: '', label: t('offboarding.hub.filterAllPayPaths') },
                  { value: 'no_pay', label: t('offboarding.hub.filterPayNoPay') },
                  { value: 'paid', label: t('offboarding.hub.filterPayPaid') },
                  { value: 'awaiting_payroll', label: t('offboarding.hub.filterPayAwaiting') },
                ]}
              />
              <FilterMenuSelect
                label={t('offboarding.hub.filterExitType')}
                value={filters.exitType}
                onChange={(exitType) =>
                  setFilters((prev) => ({
                    ...prev,
                    exitType: exitType as OffboardingHubFilterState['exitType'],
                  }))
                }
                options={[
                  { value: '', label: t('offboarding.hub.filterAllExitTypes') },
                  { value: 'resignation', label: t('offboarding.hub.resignation') },
                  { value: 'termination', label: t('offboarding.hub.termination') },
                ]}
              />
            </PageFilterMenu>
            }
          />
        </div>

        <div id="offboarding-case-list" className="p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="space-y-3">
              <CaseSkeleton />
              <CaseSkeleton />
            </div>
          ) : totalCases === 0 ? (
            <div className="text-center py-10 sm:py-12 px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
              <UserX className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" aria-hidden />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {hasActiveListConstraints
                  ? t('offboarding.hub.emptyFiltered')
                  : t('offboarding.hub.emptyCases')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {unifiedCases.map(({ employee, inProgress }) => renderCase(employee, inProgress))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeOffboarding;
