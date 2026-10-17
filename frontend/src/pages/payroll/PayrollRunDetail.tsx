import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';
import {
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../constants/permissionKeys';
import type { PayrollRun, Payslip, User } from '../../types';
import type { WorkflowApproverCandidate } from '../../components/workflow/ApproverSelectPanel';
import { useLanguage } from '../../context/LanguageContext';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import { formatPayrollMoney } from '../../utils/payrollCurrencyDisplay';
import { formatRunStatusLabel, isFinalizedPayrollStatus, isInactivePayrollRunStatus, normalizePayrollRunStatus, normalizePayslip } from './payrollUtils';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { exportPayrollRun, downloadPayslipPdf } from './payrollRunExports';
import type { ExportFileExt } from '../../utils/export/exportDocumentStandard';
import { ExportFormatMenu } from '../../components/ui/ExportFormatMenu';
import { PayrollItemsTable } from './PayrollItemsTable';
import { PayrollReviewToolbar } from './PayrollReviewToolbar';
import { buildPayrollItemRow } from './payrollItemRows';
import {
  collectDepartmentOptions,
  DEFAULT_PAYROLL_REVIEW_FILTERS,
  filterPayrollReviewItems,
  rowMatchesChangedFilter,
  paymentStatusLabel,
  type PayrollReviewFilterState,
} from './payrollReviewFilters';
import {
  buildPayrollEmployeeProfilesForItems,
  getPayrollEmployeeProfile,
  type PayrollEmployeeProfile,
} from './payrollEmployeeDisplay';
import { PayrollApprovalTracker, viewerPayrollApproverStep } from '../../components/payroll/payrollApprovalDisplay';
import { ApproverApprovalField } from '../../components/workflow/ApproverApprovalField';
import { useWorkspaceTabTitle } from '../../hooks/useWorkspaceTabTitle';

export const PayrollRunDetail: React.FC = () => {
  const params = useParams<{ id?: string; runId?: string }>();
  const id = params.id ?? params.runId;
  const navigate = useNavigate();
  const location = useLocation();
  const approvalContext = /\/payroll\/approvals\//.test(location.pathname);
  const listPath = approvalContext ? '/payroll/approvals' : '/payroll';
  const { showToast } = useToast();
  const { hasPermission, user } = useAuth();
  const { t } = useLanguage();
  const { currency } = usePreferredCurrency();
  const canProcess = hasPermission(PERM.PAYROLL_PROCESS);

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'return' | 'cancel' | null>(null);
  const [employeeProfiles, setEmployeeProfiles] = useState<
    Record<string, PayrollEmployeeProfile>
  >({});
  const [reviewFilters, setReviewFilters] = useState<PayrollReviewFilterState>(
    DEFAULT_PAYROLL_REVIEW_FILTERS
  );
  const [routeApproverUserIds, setRouteApproverUserIds] = useState<string[]>([]);
  const [routeApproverCandidates, setRouteApproverCandidates] = useState<
    WorkflowApproverCandidate[]
  >([]);
  const [routing, setRouting] = useState(false);

  const runTabTitle = useMemo(() => {
    if (!run?.month) return null;
    try {
      const key = String(run.month).slice(0, 7);
      return format(parseISO(`${key}-01`), 'MMMM yyyy');
    } catch {
      return String(run.month).slice(0, 7) || run.month;
    }
  }, [run?.month]);
  useWorkspaceTabTitle(runTabTitle);

  const tabCache = useWorkspaceTabCache<{
    run: PayrollRun | null;
    items: Payslip[];
    employeeProfiles: Record<string, PayrollEmployeeProfile>;
  }>({
    slot: 'payroll-run-detail-v1',
    cacheKey: id ?? '',
    getSnapshot: () => ({ run, items, employeeProfiles }),
    applySnapshot: (cached) => {
      setRun(cached.run);
      setItems(cached.items);
      setEmployeeProfiles(cached.employeeProfiles);
      setLoading(false);
    },
    shouldPersist: (cached) => cached.items.length > 0,
    persistDeps: [run, items, employeeProfiles, id],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!id) return;
    if (!opts?.background) setLoading(true);
    try {
      const [runRes, itemsRes, usersRes, employeesRes] = await Promise.all([
        Api.payroll.getRunDetails(id),
        Api.payroll.getRunItems(id),
        Api.users.getAll().catch(() => [] as User[]),
        Api.employees.getAll({ page: 1, limit: 500, status: 'active', assigned_id_only: '1', include_compensation: '1' }).catch(() => ({ employees: [] })),
      ]);
      const users = usersRes as User[];
      const usersById = Object.fromEntries(users.map((u) => [u.id, u]));
      const monthPrefix = String(runRes?.month ?? '').slice(0, 7);
      const runFrozen =
        Boolean(runRes?.readOnly) || isFinalizedPayrollStatus(String(runRes?.status ?? ''));
      const normalized = Array.isArray(itemsRes)
        ? itemsRes.map((row) => {
            const slip = row as Payslip;
            return normalizePayslip(slip, {
              user: usersById[slip.userId],
              monthPrefix,
              runStatus: String(runRes?.status ?? ''),
              frozen: runFrozen || Boolean(slip.readOnly),
            });
          })
        : [];
      setEmployeeProfiles(
        buildPayrollEmployeeProfilesForItems(normalized, users, employeesRes)
      );
      setItems(normalized);
      setRun(runRes);
    } catch (e) {
      console.error(e);
      if (!opts?.background) setRun(null);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [id]);

  useWorkspaceTabMountLoad(load, [load, id], tabCache, Boolean(id));

  useEffect(() => {
    if (!run) return;
    const ids =
      run.assignedApproverUserIds ??
      run.assignedApprovers?.map((entry) => entry.userId).filter(Boolean) ??
      [];
    setRouteApproverUserIds(ids);
    if (run.assignedApprovers?.length) {
      setRouteApproverCandidates(
        run.assignedApprovers.map((entry, index) => ({
          userId: entry.userId,
          employeePk: entry.userId,
          name: entry.name ?? 'Approver',
          email: '',
          role: '',
          roleLabel: '',
          levelCode: null,
          levelLabel: null,
          employeeCode: null,
          positionTitle: null,
          departmentId: '',
          departmentName: '',
          hasPortalAccess: true,
        }))
      );
    }
  }, [run]);

  const handleRouteApprovers = async () => {
    if (!id) return;
    if (!routeApproverUserIds.length) {
      showToast(
        t('payroll.approversRequired') || 'Select at least one approver before routing.',
        'error'
      );
      return;
    }
    setRouting(true);
    try {
      const result = await Api.payroll.setRunApprovers(id, routeApproverUserIds);
      showToast(
        result?.message ||
          t('payroll.routeApproversSuccess') ||
          'Payroll run routed to the selected approver(s).',
        'success'
      );
      await load({ background: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not route payroll approvers.', 'error');
    } finally {
      setRouting(false);
    }
  };

  const handleApproveConfirm = async (payload?: { reason?: string }) => {
    if (!id) return;
    const notes = payload?.reason?.trim() ?? '';
    if (notes.length < 3) {
      showToast(
        t('payroll.approveCommentRequired') || 'Approval comment is required (min 3 characters).',
        'error'
      );
      return;
    }
    setActionLoading(true);
    try {
      const result = (await Api.payroll.workflow(id, 'approve', { notes })) as {
        message?: string;
        status?: string;
      };
      const finalized = String(result?.status ?? '').toUpperCase() === 'APPROVED';
      showToast(
        result?.message ||
          (t('payroll.approveSuccess') || 'Payroll run approved successfully'),
        'success'
      );
      setConfirmAction(null);
      if (finalized) {
        navigate(listPath);
      } else {
        await load();
      }
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error && e.message
          ? e.message
          : t('payroll.approveFailed') || 'Approval failed';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectConfirm = async (payload?: { reason?: string }) => {
    if (!id) return;
    const reason = payload?.reason?.trim() ?? '';
    if (reason.length < 3) {
      showToast(
        t('payroll.rejectReasonRequired') || 'Rejection reason is required (min 3 characters).',
        'error'
      );
      return;
    }
    setActionLoading(true);
    try {
      await Api.payroll.workflow(id, 'reject', { reason });
      showToast(t('payroll.rejectSuccess') || 'Payroll run rejected', 'info');
      setConfirmAction(null);
      navigate(listPath);
    } catch (e) {
      console.error(e);
      showToast(t('payroll.rejectFailed') || 'Rejection failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReturnConfirm = async (payload?: { reason?: string }) => {
    if (!id) return;
    const notes = payload?.reason?.trim() ?? '';
    if (notes.length < 3) {
      showToast(t('payroll.returnNotesRequired') || 'Return notes are required (min 3 characters).', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await Api.payroll.workflow(id, 'return', { notes });
      showToast(t('payroll.returnSuccess') || 'Payroll run returned to the preparer.', 'success');
      setConfirmAction(null);
      navigate(listPath);
    } catch (e) {
      console.error(e);
      showToast(t('payroll.returnFailed') || 'Return failed', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelConfirm = async (payload?: { reason?: string }) => {
    if (!id) return;
    const reason = payload?.reason?.trim() || '';
    if (!reason) return;
    setActionLoading(true);
    try {
      await Api.payroll.cancelRun(id, { reason });
      showToast(
        t('payroll.cancelSuccess') ||
          'Payroll run cancelled. You can calculate payroll again for this period.',
        'info'
      );
      setConfirmAction(null);
      navigate(listPath);
    } catch (e) {
      console.error(e);
      showToast(
        e instanceof Error ? e.message : t('payroll.cancelFailed') || 'Cancel failed',
        'error'
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleExport = async (format: ExportFileExt) => {
    if (!run) return;
    if (filteredItems.length === 0) {
      showToast('No data to export', 'error');
      return;
    }
    try {
      const ok = await exportPayrollRun(format, run, filteredItems, employeeProfiles, {
        viewMode: reviewFilters.viewMode,
      });
      if (format === 'pdf' && !ok) {
        showToast('Please allow popups to export PDF', 'warning');
        return;
      }
      showToast(`Payroll report exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      console.error(e);
      showToast('Export failed', 'error');
    }
  };

  const handleDownloadPayslip = async (item: Payslip) => {
    if (!run) return;
    try {
      const profile = getPayrollEmployeeProfile(
        item.userId,
        employeeProfiles,
        item.employeeId
      );
      await downloadPayslipPdf(run, item, profile);
      showToast(`Payslip for ${profile.displayName} downloaded`, 'success');
    } catch (e) {
      console.error(e);
      showToast(
        e instanceof Error && e.message
          ? `Failed to generate PDF: ${e.message}`
          : 'Failed to generate PDF',
        'error'
      );
    }
  };

  const handleSaveReviewerNote = async (item: Payslip, note: string) => {
    try {
      await Api.payroll.updatePayslip(item.id, { reviewerNote: note.trim() || null });
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, reviewerNote: note.trim() || null } : row))
      );
      showToast('Reviewer note saved', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to save reviewer note', 'error');
    }
  };

  const runLocked = Boolean(run?.readOnly) || isFinalizedPayrollStatus(String(run?.status ?? ''));

  const rowsById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildPayrollItemRow>>();
    for (const item of items) {
      const profile = getPayrollEmployeeProfile(
        item.userId,
        employeeProfiles,
        item.employeeId,
        item.breakdown?.reviewSnapshot
      );
      map.set(item.id, buildPayrollItemRow(item, profile));
    }
    return map;
  }, [items, employeeProfiles]);

  const filteredItems = useMemo(
    () => filterPayrollReviewItems(items, rowsById, reviewFilters),
    [items, rowsById, reviewFilters]
  );

  const departmentOptions = useMemo(
    () => collectDepartmentOptions([...rowsById.values()]),
    [rowsById]
  );

  const changedCount = useMemo(
    () => [...rowsById.values()].filter((row) => rowMatchesChangedFilter(row, true)).length,
    [rowsById]
  );

  const reviewFiltersActive =
    reviewFilters.changedOnly ||
    Boolean(reviewFilters.departmentId) ||
    Boolean(reviewFilters.search.trim());

  if (loading) {
    return <LoadingState variant="page" layout="form" label="Loading run details…" />;
  }

  if (!run) {
    return <div className="py-12 text-slate-500">Run not found</div>;
  }

  const periodDate = parseISO(`${String(run.month).slice(0, 7)}-01`);
  const calculatedAt = parseISO(run.calculatedAt || run.createdAt);
  const statusUpper = normalizePayrollRunStatus(String(run.status));
  const canActOnRun = ['DRAFT', 'UNDER_REVIEW', 'PENDING_APPROVAL'].includes(statusUpper);
  const selfApprovalBlocked = run.selfApprovalBlocked === true;
  const canApproverReview = run.canApproverReview === true;
  const canEditApprovers = run.canEditApprovers === true;
  const needsApproverRouting = run.needsApproverRouting === true;
  const showCancel = statusUpper === 'PENDING_APPROVAL' && run.canCancel === true && canProcess;
  const showWorkflowActions = canActOnRun && (canProcess || canApproverReview);
  const showRunAgain = canProcess && isInactivePayrollRunStatus(statusUpper);
  const showActions = showWorkflowActions || showCancel || showRunAgain;
  const showRoutingPanel =
    statusUpper === 'PENDING_APPROVAL' && canProcess && canEditApprovers;
  const showApprove = showWorkflowActions && canApproverReview && !selfApprovalBlocked;
  const approvalStep = viewerPayrollApproverStep(run, user?.id);
  const waitingOnChain =
    showWorkflowActions &&
    !showApprove &&
    !selfApprovalBlocked &&
    !showRoutingPanel &&
    Boolean(run.assignedApprovers?.length) &&
    statusUpper === 'PENDING_APPROVAL';

  const runnerLabel = run.calculatedByName?.trim() || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate(listPath)} aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                Payroll Run: {format(periodDate, 'MMMM yyyy')}
              </h2>
              <StatusLabel
                status={statusUpper}
                context="payroll"
                label={formatRunStatusLabel(run.status, t)}
              />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Run ID: {run.id} • Calculated {formatDateTimeDisplay(calculatedAt)}
              {runnerLabel
                ? ` • ${t('payroll.runBy', { name: runnerLabel }) || `Run by ${runnerLabel}`}`
                : ''}
            </p>
          </div>
        </div>
        {((showActions && !(showRoutingPanel && needsApproverRouting)) || showRunAgain) ? (
          <div className="flex flex-wrap gap-2 shrink-0">
            {showRunAgain ? (
              <Button
                onClick={() => {
                  const key = String(run.month).slice(0, 7);
                  navigate('/payroll', {
                    state: {
                      year: Number(key.slice(0, 4)) || undefined,
                      month: Number(key.slice(5, 7)) || undefined,
                      openCreateRun: true,
                    },
                  });
                }}
                disabled={actionLoading}
                icon={<RefreshCw className="w-4 h-4" />}
              >
                {t('payroll.runAgain') || 'Run again'}
              </Button>
            ) : null}
            {showCancel ? (
              <Button
                variant="outline"
                onClick={() => setConfirmAction('cancel')}
                disabled={actionLoading}
                className="text-amber-700 hover:bg-amber-50 border-amber-200 dark:text-amber-300 dark:hover:bg-amber-900/20"
                icon={<XCircle className="w-4 h-4" />}
              >
                {t('payroll.cancelRun') || 'Cancel run'}
              </Button>
            ) : null}
            {showApprove ? (
              <Button
                variant="outline"
                onClick={() => setConfirmAction('reject')}
                disabled={actionLoading}
                className="text-red-600 hover:bg-red-50 border-red-200 dark:hover:bg-red-900/20"
                icon={<XCircle className="w-4 h-4" />}
              >
                {t('payroll.reject') || 'Reject'}
              </Button>
            ) : null}
            {showApprove ? (
              <Button
                variant="outline"
                onClick={() => setConfirmAction('return')}
                disabled={actionLoading}
                icon={<RotateCcw className="w-4 h-4" />}
              >
                {t('payroll.return') || 'Return'}
              </Button>
            ) : null}
            {showApprove ? (
              <Button
                onClick={() => setConfirmAction('approve')}
                disabled={actionLoading}
                className="bg-primary-600 hover:bg-primary-700"
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                {t('payroll.approve') || 'Approve'}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showActions && selfApprovalBlocked ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Approval requires a different user</p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">
            You calculated this payroll run. Another HR user with payroll approval access must
            approve it (maker-checker). Admins can approve their own runs; in local development
            maker-checker is usually off — restart the API after changing{' '}
            <code className="text-xs">PAYROLL_MAKER_CHECKER</code>.
          </p>
        </div>
      ) : null}

      {showRoutingPanel ? (
        <div className="rounded-lg border border-primary-200 bg-primary-50/50 px-4 py-4 text-sm dark:border-primary-900/50 dark:bg-primary-950/20">
          <p className="font-semibold text-slate-900 dark:text-white">
            {needsApproverRouting
              ? t('payroll.routeApproversTitle') || 'Route for approval'
              : t('payroll.changeApproversTitle') || 'Approval routing'}
          </p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            {needsApproverRouting
              ? t('payroll.routeApproversBody') ||
                'Select the specific people who should review and approve this payroll run before it can be finalized.'
              : t('payroll.changeApproversBody') ||
                'Update who is in the approval chain. Changes are only allowed before anyone signs off.'}
          </p>
          <div className="mt-4">
            <ApproverApprovalField
              required
              value={routeApproverUserIds}
              selected={routeApproverCandidates}
              onChange={(userIds, candidates) => {
                setRouteApproverUserIds(userIds);
                setRouteApproverCandidates(candidates);
              }}
              label={t('payroll.approversLabel') || 'Payroll approvers'}
              hint={
                t('payroll.approversHint') ||
                'Select who should review and approve this payroll run. The first person approves first, then each person below in order.'
              }
              modalTitle={t('payroll.approversModalTitle') || 'Select payroll approvers'}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => void handleRouteApprovers()}
              isLoading={routing}
              disabled={!routeApproverUserIds.length}
            >
              {needsApproverRouting
                ? t('payroll.routeApproversAction') || 'Route for approval'
                : t('payroll.updateApproversAction') || 'Update approvers'}
            </Button>
          </div>
        </div>
      ) : null}

      {waitingOnChain ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
          <p className="font-semibold">Waiting on another approver</p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            {run.currentApproverName
              ? `This run is waiting for ${run.currentApproverName} to sign off.`
              : 'This run is waiting for an earlier approver in the chain.'}
            {approvalStep?.phase === 'queued'
              ? ` Your step is ${approvalStep.stepNumber} of ${approvalStep.total}.`
              : ''}
          </p>
          {run.assignedApprovers?.length ? (
            <div className="mt-3">
              <PayrollApprovalTracker row={run} viewerUserId={user?.id} />
            </div>
          ) : null}
        </div>
      ) : null}

      {showApprove && run.assignedApprovers?.length ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <p className="font-semibold text-emerald-950 dark:text-emerald-100">Your approval is required</p>
          <PayrollApprovalTracker row={run} compact viewerUserId={user?.id} />
        </div>
      ) : null}

      {(run.readOnly || isFinalizedPayrollStatus(run.status)) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <p className="font-semibold">Historical record — view only</p>
          <p className="mt-1">
            Amounts were frozen when this run was approved. Changing employee salary or attendance
            today does not alter this month&apos;s payroll.
          </p>
          {run.assignedApprovers?.length ? (
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <PayrollApprovalTracker row={run} viewerUserId={user?.id} />
            </div>
          ) : null}
        </div>
      )}

      <div className="stat-card-grid">
        {[
          { label: 'Total Employees', value: String(run.totalEmployees) },
          {
            label: 'Total Net Pay',
            value: formatPayrollMoney(Number(run.totalNetPay), { currency }),
          },
          {
            label: 'Total Employer Cost',
            value: formatPayrollMoney(
              items.reduce((acc, item) => {
                const profile = getPayrollEmployeeProfile(
                  item.userId,
                  employeeProfiles,
                  item.employeeId,
                  item.breakdown?.reviewSnapshot
                );
                return acc + buildPayrollItemRow(item, profile).totalEmployerCostUsd;
              }, 0),
              { currency }
            ),
          },
          {
            label: 'Payment Status',
            value: (() => {
              const statuses = new Set(
                items.map((i) => i.paymentStatus).filter(Boolean)
              );
              if (statuses.size === 1) {
                return paymentStatusLabel([...statuses][0]!);
              }
              if (statuses.size > 1) return 'Mixed';
              return isFinalizedPayrollStatus(run.status) ? 'Pending' : 'Pre-approval';
            })(),
          },
        ].map((stat) => (
          <Card
            key={stat.label}
            className="p-4 border-none shadow-sm bg-slate-50 dark:bg-slate-800"
          >
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="text-lg font-bold mt-1 text-slate-900 dark:text-white">
              {stat.value}
            </p>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={confirmAction === 'cancel'}
        onClose={() => !actionLoading && setConfirmAction(null)}
        title={t('payroll.confirmCancelTitle') || 'Cancel payroll run?'}
        description={
          t('payroll.confirmCancelDescription') ||
          'This withdraws the run from approval. Approvers will be notified, and you can calculate payroll for this period again.'
        }
        variant="danger"
        confirmLabel={t('payroll.cancelRun') || 'Cancel run'}
        confirmIcon={<XCircle className="w-4 h-4" />}
        showReasonInput
        reasonRequired
        reasonPlaceholder={
          t('payroll.cancelReasonPlaceholder') || 'Reason for cancelling (required)…'
        }
        loading={actionLoading}
        onConfirm={(payload) => void handleCancelConfirm(payload)}
      />

      <ConfirmDialog
        open={confirmAction === 'approve'}
        onClose={() => !actionLoading && setConfirmAction(null)}
        title={t('payroll.confirmApproveTitle') || 'Approve payroll run?'}
        description={
          t('payroll.confirmApproveDescription') ||
          'This will approve and finalize the run and trigger disbursements. A comment is required and will be recorded with your sign-off.'
        }
        variant="success"
        confirmLabel={t('payroll.approve') || 'Approve'}
        confirmIcon={<CheckCircle2 className="w-4 h-4" />}
        showReasonInput
        reasonRequired
        reasonPlaceholder={
          t('payroll.approveCommentPlaceholder') || 'Approval comment (required)…'
        }
        loading={actionLoading}
        onConfirm={(payload) => void handleApproveConfirm(payload)}
      />

      <ConfirmDialog
        open={confirmAction === 'reject'}
        onClose={() => !actionLoading && setConfirmAction(null)}
        title={t('payroll.confirmRejectTitle') || 'Reject payroll run?'}
        description={
          t('payroll.confirmRejectDescription') ||
          'The run will be marked rejected. Add a reason so finance and HR can review why it was not approved.'
        }
        variant="danger"
        confirmLabel={t('payroll.reject') || 'Reject'}
        confirmIcon={<XCircle className="w-4 h-4" />}
        showReasonInput
        reasonRequired
        reasonPlaceholder={
          t('payroll.rejectReasonPlaceholder') || 'Enter rejection reason (required)…'
        }
        loading={actionLoading}
        onConfirm={(payload) => void handleRejectConfirm(payload)}
      />

      <ConfirmDialog
        open={confirmAction === 'return'}
        onClose={() => !actionLoading && setConfirmAction(null)}
        title={t('payroll.confirmReturnTitle') || 'Return payroll run?'}
        description={
          t('payroll.confirmReturnDescription') ||
          'The run will go back to the preparer for revision. Add notes explaining what needs to change.'
        }
        variant="success"
        confirmLabel={t('payroll.return') || 'Return'}
        confirmIcon={<RotateCcw className="w-4 h-4" />}
        showReasonInput
        reasonRequired
        reasonPlaceholder={
          t('payroll.returnNotesPlaceholder') || 'Enter return notes (required, min 3 characters)…'
        }
        loading={actionLoading}
        onConfirm={(payload) => void handleReturnConfirm(payload)}
      />

      <div className="space-y-4">
        {items.length > 0 ? (
          <Card className="border-none shadow-sm overflow-hidden">
            <PayrollReviewToolbar
              filters={reviewFilters}
              onChange={(next) => setReviewFilters((prev) => ({ ...prev, ...next }))}
              departmentOptions={departmentOptions}
              changedCount={changedCount}
            />
          </Card>
        ) : null}

        <Card className="p-0 border-none shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h3 className="font-semibold text-slate-900 dark:text-white">Payroll Items Breakdown</h3>
            <div className="flex flex-wrap gap-2">
              <ExportFormatMenu variant="button" onExport={handleExport} formats={['csv', 'xlsx']} />
            </div>
          </div>
          {items.length > 0 && filteredItems.length === 0 && reviewFiltersActive ? (
            <p className="px-5 py-10 text-center text-slate-500">
              No employees match the current review filters for this run.
            </p>
          ) : (
            <PayrollItemsTable
              items={filteredItems}
              employeeProfiles={employeeProfiles}
              onDownloadPayslip={handleDownloadPayslip}
              viewMode={reviewFilters.viewMode}
              showReviewerNotes
              readOnly={runLocked || !canProcess}
              onSaveReviewerNote={handleSaveReviewerNote}
            />
          )}
        </Card>
      </div>
    </div>
  );
};

export default PayrollRunDetail;
