import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTimeDisplay } from '../../utils/formatDisplayDate';
import { Check, Loader2, PauseCircle, RotateCcw, Users, Clock, X } from 'lucide-react';
import { Api } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { PeriodSelectToolbar } from '../../components/ui/PeriodSelectToolbar';
import { ListSearchFilterBar } from '../../components/ui/page';
import { FilterMenuSelect, PageFilterMenu } from '../../components/ui/PageFilterMenu';
import { countActiveFilters } from '../../utils/filterActiveCount';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { usePreferredCurrency } from '../../context/PreferredCurrencyContext';
import { formatPayrollMoney } from '../../utils/payrollCurrencyDisplay';
import type { PayrollPaymentQueueItem, PayrollPaymentRunOption, PayslipDisbursementStatus } from '../../types';
import {
  normalizePaymentMethod,
  PAYMENT_METHOD_OPTIONS,
  type PaymentMethod,
} from '../../utils/paymentMethod';
import { LoadingState } from '../../components/common/LoadingState';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { StatCard } from '../../components/ui/page/StatCard';
import { ExportFormatMenu } from '../../components/ui/ExportFormatMenu';
import { ListIconButton } from '../../components/ui/ListIconButton';
import { ResponsiveRowActions } from '../../components/ui/ResponsiveRowActions';
import { RulesConfigHelp } from '../../components/ui/RulesConfigHelp';
import { listToolbarIconPillClass } from '../../constants/designSystem';
import type { ExportFileExt } from '../../utils/export';
import { exportPayrollPaymentBankFile } from '../../utils/exportPayrollPaymentBank';
import {
  SortableTableHeader,
  sortRowsByColumn,
  useListColumnSort,
} from '../../utils/listColumnSort';

type PaymentSortCol = 'employee' | 'netPay' | 'method' | 'status' | 'updated';

function getPaymentQueueSortValue(
  row: PayrollPaymentQueueItem,
  column: PaymentSortCol,
  paymentMethodLabel: (method: PaymentMethod | undefined) => string,
  disbursementLabel: (status: PayslipDisbursementStatus) => string
): string | number {
  switch (column) {
    case 'employee':
      return row.employeeName || row.employeeId || '';
    case 'netPay':
      return Number(row.netPay ?? 0);
    case 'method':
      return paymentMethodLabel(normalizePaymentMethod(row.paymentMethod));
    case 'status':
      return disbursementLabel(row.disbursementStatus);
    case 'updated':
      return row.disbursementStatusAt ?? '';
    default:
      return '';
  }
}

const paymentThClass =
  'py-2.5 px-3 font-semibold text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400';

type StatusFilter = 'all' | PayslipDisbursementStatus;
type PaymentMethodFilter = 'all' | PaymentMethod;

export const PayrollPayment: React.FC = () => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { currency } = usePreferredCurrency();
  const { prompt, confirm, ConfirmDialogHost } = useConfirmDialog();

  const [runsLoading, setRunsLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(false);
  const [runs, setRuns] = useState<PayrollPaymentRunOption[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [queue, setQueue] = useState<PayrollPaymentQueueItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentMethodFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const checkboxClass =
    'w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 disabled:opacity-40 disabled:cursor-not-allowed';

  const paymentMethodLabel = useCallback(
    (method: PaymentMethod | undefined) => {
      if (method === 'cash') return t('payroll.paymentMethodCash');
      return t('payroll.paymentMethodBank');
    },
    [t]
  );

  const statusOptions = useMemo(
    (): Array<{ value: StatusFilter; label: string }> => [
      { value: 'all', label: t('common.all') },
      { value: 'PENDING', label: t('payroll.paymentStatusPending') },
      { value: 'PAID', label: t('payroll.paymentStatusPaid') },
      { value: 'HOLDING', label: t('payroll.paymentStatusHolding') },
    ],
    [t]
  );

  const disbursementLabel = useCallback(
    (status: PayslipDisbursementStatus) => {
      if (status === 'PAID') return t('payroll.paymentStatusPaid');
      if (status === 'HOLDING') return t('payroll.paymentStatusHolding');
      return t('payroll.paymentStatusPending');
    },
    [t]
  );

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await Api.payroll.listPaymentRuns();
      const list = Array.isArray(data) ? data : [];
      setRuns(list);
      setSelectedRunId((prev) => prev || list[0]?.runId || '');
    } catch {
      showToast(t('payroll.paymentLoadRunsError'), 'error');
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [showToast, t]);

  const loadQueue = useCallback(async () => {
    if (!selectedRunId) {
      setQueue([]);
      return;
    }
    setQueueLoading(true);
    try {
      const data = await Api.payroll.listPaymentQueue(selectedRunId);
      setQueue(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('payroll.paymentLoadQueueError'), 'error');
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }, [selectedRunId, showToast, t]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const paymentUpdatesAllowed = selectedRun?.paymentUpdatesAllowed !== false;

  const paymentMethodFilterOptions = useMemo(() => {
    const present = new Set<PaymentMethod>();
    for (const row of queue) {
      present.add(normalizePaymentMethod(row.paymentMethod));
    }
    const methods = PAYMENT_METHOD_OPTIONS.filter((option) => present.has(option.value));
    const options = methods.length > 0 ? methods : PAYMENT_METHOD_OPTIONS;
    return [
      { value: 'all' as const, label: t('payroll.paymentFilterAllMethods') },
      ...options.map((option) => ({
        value: option.value,
        label: paymentMethodLabel(option.value),
      })),
    ];
  }, [queue, paymentMethodLabel, t]);

  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((row) => {
      if (statusFilter !== 'all' && row.disbursementStatus !== statusFilter) return false;
      if (
        paymentMethodFilter !== 'all' &&
        normalizePaymentMethod(row.paymentMethod) !== paymentMethodFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        row.employeeName,
        row.employeeId,
        row.departmentName,
        row.monthLabel,
        paymentMethodLabel(normalizePaymentMethod(row.paymentMethod)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [queue, search, statusFilter, paymentMethodFilter, paymentMethodLabel]);

  const { sortBy, sortOrder, toggleSort } = useListColumnSort<PaymentSortCol>();

  const sortedQueue = useMemo(
    () =>
      sortRowsByColumn(filteredQueue, sortBy, sortOrder, (row, column) =>
        getPaymentQueueSortValue(row, column, paymentMethodLabel, disbursementLabel)
      ),
    [filteredQueue, sortBy, sortOrder, paymentMethodLabel, disbursementLabel]
  );

  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectedRunId]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(queue.map((row) => row.payslipId));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [queue]);

  const eligibleForPaid = useMemo(
    () =>
      paymentUpdatesAllowed
        ? sortedQueue.filter((row) => row.disbursementStatus !== 'PAID')
        : [],
    [sortedQueue, paymentUpdatesAllowed]
  );

  const eligibleIds = useMemo(
    () => eligibleForPaid.map((row) => row.payslipId),
    [eligibleForPaid]
  );

  const selectedEligibleCount = useMemo(
    () => eligibleIds.filter((id) => selectedIds.has(id)).length,
    [eligibleIds, selectedIds]
  );

  const allEligibleSelected =
    eligibleIds.length > 0 && selectedEligibleCount === eligibleIds.length;
  const someEligibleSelected = selectedEligibleCount > 0 && !allEligibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someEligibleSelected;
    }
  }, [someEligibleSelected]);

  const toggleRowSelected = (payslipId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(payslipId)) next.delete(payslipId);
      else next.add(payslipId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) {
        for (const id of eligibleIds) next.delete(id);
      } else {
        for (const id of eligibleIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const totals = useMemo(() => {
    const pending = queue.filter((r) => r.disbursementStatus === 'PENDING');
    const paid = queue.filter((r) => r.disbursementStatus === 'PAID');
    const holding = queue.filter((r) => r.disbursementStatus === 'HOLDING');
    const sum = (rows: PayrollPaymentQueueItem[]) =>
      rows.reduce((acc, row) => acc + Number(row.netPay || 0), 0);
    const fromQueue = {
      pendingCount: pending.length,
      paidCount: paid.length,
      holdingCount: holding.length,
      pendingNet: sum(pending),
      paidNet: sum(paid),
      employeeCount: queue.length,
    };
    if (queue.length > 0 || !selectedRun) return fromQueue;
    return {
      pendingCount: selectedRun.pendingCount,
      paidCount: selectedRun.paidCount,
      holdingCount: selectedRun.holdingCount,
      pendingNet: 0,
      paidNet: 0,
      employeeCount: selectedRun.totalEmployees,
    };
  }, [queue, selectedRun]);

  const updateStatus = async (
    row: PayrollPaymentQueueItem,
    status: PayslipDisbursementStatus,
    holdNote?: string
  ) => {
    if (!paymentUpdatesAllowed) {
      showToast(
        t('payroll.paymentWindowClosed', {
          until: selectedRun?.paymentEditableUntil ?? '',
        }) ||
          `Payment updates are closed for this run (allowed only until ${selectedRun?.paymentEditableUntil ?? 'the grace period'}).`,
        'error'
      );
      return;
    }
    setBusyId(row.payslipId);
    try {
      await Api.payroll.setPayslipDisbursement(row.payslipId, {
        status,
        holdNote,
      });
      showToast(
        status === 'PAID'
          ? t('payroll.paymentToastPaid', { name: row.employeeName })
          : status === 'HOLDING'
            ? t('payroll.paymentToastHolding', { name: row.employeeName })
            : t('payroll.paymentToastPending', { name: row.employeeName }),
        status === 'HOLDING' ? 'warning' : 'success'
      );
      await Promise.all([loadQueue(), loadRuns()]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('payroll.paymentUpdateError'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const markPaid = async (row: PayrollPaymentQueueItem) => {
    const ok = await confirm({
      title: t('payroll.paymentConfirmPaidTitle'),
      description: t('payroll.paymentConfirmPaidBody', {
        name: row.employeeName,
        period: row.monthLabel,
        amount: formatPayrollMoney(row.netPay, { currency }),
      }),
      confirmLabel: t('payroll.paymentConfirmPaidAction'),
      variant: 'success',
    });
    if (!ok) return;
    await updateStatus(row, 'PAID');
  };

  const markHolding = async (row: PayrollPaymentQueueItem) => {
    const note = await prompt({
      title: t('payroll.paymentConfirmHoldingTitle'),
      description: t('payroll.paymentConfirmHoldingBody', {
        name: row.employeeName,
        period: row.monthLabel,
      }),
      confirmLabel: t('payroll.paymentConfirmHoldingAction'),
      reasonRequired: true,
      reasonPlaceholder: t('payroll.paymentConfirmHoldingNote'),
      variant: 'danger',
    });
    if (note === null) return;
    const holdNote = typeof note === 'string' ? note : note.reason;
    const trimmed = String(holdNote ?? '').trim();
    if (!trimmed) return;
    await updateStatus(row, 'HOLDING', trimmed);
  };

  const resetPending = async (row: PayrollPaymentQueueItem) => {
    const ok = await confirm({
      title: t('payroll.paymentConfirmPendingTitle'),
      description: t('payroll.paymentConfirmPendingBody', {
        name: row.employeeName,
        period: row.monthLabel,
      }),
      confirmLabel: t('payroll.paymentConfirmPendingAction'),
    });
    if (!ok) return;
    await updateStatus(row, 'PENDING');
  };

  const bulkMarkPaid = async () => {
    if (!paymentUpdatesAllowed) {
      showToast(
        t('payroll.paymentWindowClosed', {
          until: selectedRun?.paymentEditableUntil ?? '',
        }) ||
          `Payment updates are closed for this run (allowed only until ${selectedRun?.paymentEditableUntil ?? 'the grace period'}).`,
        'error'
      );
      return;
    }
    const rows = queue.filter(
      (row) => selectedIds.has(row.payslipId) && row.disbursementStatus !== 'PAID'
    );
    if (rows.length === 0) {
      showToast(t('payroll.paymentBulkNoneEligible'), 'warning');
      return;
    }
    const totalAmount = rows.reduce((acc, row) => acc + Number(row.netPay || 0), 0);
    const ok = await confirm({
      title: t('payroll.paymentBulkConfirmPaidTitle', { count: rows.length }),
      description: t('payroll.paymentBulkConfirmPaidBody', {
        count: rows.length,
        amount: formatPayrollMoney(totalAmount, { currency }),
        period: selectedRun?.monthLabel ?? '',
      }),
      confirmLabel: t('payroll.paymentBulkConfirmPaidAction'),
      variant: 'success',
    });
    if (!ok) return;

    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        rows.map((row) =>
          Api.payroll.setPayslipDisbursement(row.payslipId, { status: 'PAID' })
        )
      );
      const success = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - success;

      if (failed === 0) {
        showToast(t('payroll.paymentBulkSuccess', { count: success }), 'success');
        clearSelection();
      } else if (success > 0) {
        showToast(t('payroll.paymentBulkPartialError', { success, failed }), 'warning');
        const failedIds = rows
          .filter((_, index) => results[index].status === 'rejected')
          .map((row) => row.payslipId);
        setSelectedIds(new Set(failedIds));
      } else {
        showToast(t('payroll.paymentUpdateError'), 'error');
      }
      await Promise.all([loadQueue(), loadRuns()]);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExport = async (format: ExportFileExt) => {
    if (!selectedRun) {
      showToast(t('payroll.paymentExportSelectRun'), 'error');
      return;
    }
    if (queue.length === 0) {
      showToast(t('payroll.paymentExportNoRows'), 'warning');
      return;
    }
    const { totalRowCount, bankRowCount, cashRowCount } = await exportPayrollPaymentBankFile(
      format,
      queue,
      selectedRun
    );
    showToast(
      t('payroll.paymentExportSuccess', {
        count: totalRowCount,
        period: selectedRun.monthLabel,
        bank: bankRowCount,
        cash: cashRowCount,
      }),
      'success'
    );
  };

  if (runsLoading) {
    return <LoadingState variant="page" layout="list" label={t('payroll.paymentLoadingRuns')} />;
  }

  return (
    <div className="space-y-6">
      <ConfirmDialogHost />
      <div className="flex justify-end">
        <RulesConfigHelp help="payroll.payment" />
      </div>

      {runs.length === 0 ? (
        <Card className="surface-card-pad">
          <p className="hcms-empty-state text-sm text-slate-500 dark:text-slate-400 text-center">
            {t('payroll.paymentNoRunsReady')}
          </p>
        </Card>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <PeriodSelectToolbar
                id="payroll-payment-run-select"
                className="min-w-[14rem] sm:max-w-md sm:flex-none"
                label={t('payroll.paymentRunLabel')}
                ariaLabel={t('payroll.paymentSwitchRun')}
                options={runs.map((run) => ({
                  id: run.runId,
                  name: run.monthLabel,
                }))}
                value={selectedRunId}
                onChange={setSelectedRunId}
                emptyLabel={t('payroll.paymentNoRunsReady')}
              />
              {selectedRun ? (
                <StatusLabel status={selectedRun.status} context="payroll" size="sm" />
              ) : null}
            </div>
            {selectedRun ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('payroll.paymentRunProgress', {
                  pending: selectedRun.pendingCount,
                  paid: selectedRun.paidCount,
                  holding: selectedRun.holdingCount,
                })}
              </p>
            ) : null}
            {selectedRun && !paymentUpdatesAllowed ? (
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                {t('payroll.paymentWindowClosedBanner', {
                  until: selectedRun.paymentEditableUntil ?? '',
                }) ||
                  `Payment updates closed after the 1-month grace period${
                    selectedRun.paymentEditableUntil
                      ? ` (ended ${selectedRun.paymentEditableUntil})`
                      : ''
                  }. Statuses are read-only.`}
              </p>
            ) : selectedRun?.paymentEditableUntil && paymentUpdatesAllowed ? (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('payroll.paymentWindowOpenHint', {
                  until: selectedRun.paymentEditableUntil,
                }) ||
                  `Payment status can be updated until ${selectedRun.paymentEditableUntil} (1 month after approval).`}
              </p>
            ) : null}
          </div>

          <div className="stat-card-grid">
            <StatCard
              label={t('payroll.paymentStatPending')}
              value={totals.pendingCount}
              hint={formatPayrollMoney(totals.pendingNet, { currency })}
              icon={Clock}
              variant="warning"
              active={statusFilter === 'PENDING'}
              onClick={() =>
                setStatusFilter((prev) => (prev === 'PENDING' ? 'all' : 'PENDING'))
              }
            />
            <StatCard
              label={t('payroll.paymentStatPaid')}
              value={totals.paidCount}
              hint={formatPayrollMoney(totals.paidNet, { currency })}
              icon={Check}
              variant="success"
              active={statusFilter === 'PAID'}
              onClick={() => setStatusFilter((prev) => (prev === 'PAID' ? 'all' : 'PAID'))}
            />
            <StatCard
              label={t('payroll.paymentStatHolding')}
              value={totals.holdingCount}
              icon={PauseCircle}
              variant="neutral"
              active={statusFilter === 'HOLDING'}
              onClick={() =>
                setStatusFilter((prev) => (prev === 'HOLDING' ? 'all' : 'HOLDING'))
              }
            />
            <StatCard
              label={t('payroll.paymentStatEmployees')}
              value={totals.employeeCount}
              icon={Users}
              variant="primary"
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            />
          </div>

          <Card className="surface-card-pad">
            {selectedRun ? (
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('payroll.paymentPayingEyebrow', { period: selectedRun.monthLabel })}
              </p>
            ) : null}
            <ListSearchFilterBar
              leading={
                <ExportFormatMenu
                  formats={['csv', 'xlsx']}
                  disabled={queueLoading || queue.length === 0}
                  onExport={handleExport}
                  className={listToolbarIconPillClass}
                />
              }
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('payroll.paymentSearchPlaceholder')}
              filter={
                <PageFilterMenu
                  activeCount={countActiveFilters([
                    { value: statusFilter, defaultValue: 'all' },
                    { value: paymentMethodFilter, defaultValue: 'all' },
                  ])}
                  title={t('payroll.paymentFilterTitle')}
                  onClear={() => {
                    setStatusFilter('all');
                    setPaymentMethodFilter('all');
                  }}
                >
                  <FilterMenuSelect
                    label={t('payroll.paymentFilterStatus')}
                    value={statusFilter}
                    options={statusOptions}
                    onChange={(value) => setStatusFilter(value as StatusFilter)}
                  />
                  <FilterMenuSelect
                    label={t('payroll.paymentFilterMethod')}
                    value={paymentMethodFilter}
                    options={paymentMethodFilterOptions}
                    onChange={(value) => setPaymentMethodFilter(value as PaymentMethodFilter)}
                  />
                </PageFilterMenu>
              }
              className="mb-4"
            />

            {selectedIds.size > 0 ? (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 dark:border-primary-800/60 bg-primary-50/80 dark:bg-primary-950/30 px-3 py-2.5">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('payroll.paymentSelectedCount', { count: selectedIds.size })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={bulkBusy || selectedEligibleCount === 0 || !paymentUpdatesAllowed}
                  onClick={() => void bulkMarkPaid()}
                  icon={
                    bulkBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )
                  }
                  iconOnly
                  title={t('payroll.paymentBulkMarkPaid')}
                  aria-label={t('payroll.paymentBulkMarkPaid')}
                />
                <ListIconButton
                  label={t('payroll.paymentBulkClearSelection')}
                  icon={<X className="w-4 h-4" />}
                  disabled={bulkBusy}
                  onClick={clearSelection}
                />
              </div>
            ) : null}

            {queueLoading ? (
              <LoadingState variant="section" layout="table" label={t('payroll.paymentLoadingPayslips')} />
            ) : sortedQueue.length === 0 ? (
              <p className="hcms-empty-state text-sm text-slate-500 dark:text-slate-400 text-center">
                {queue.length === 0
                  ? t('payroll.paymentEmptyRun')
                  : t('payroll.paymentEmptyFilter')}
              </p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full min-w-[760px] text-sm hcms-table-compact">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th className={`${paymentThClass} w-10`}>
                        <label className="inline-flex items-center cursor-pointer">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            className={checkboxClass}
                            checked={allEligibleSelected}
                            disabled={
                              bulkBusy || queueLoading || eligibleIds.length === 0
                            }
                            onChange={toggleSelectAll}
                            aria-label={t('payroll.paymentSelectAll')}
                          />
                          <span className="sr-only">{t('payroll.paymentSelectAll')}</span>
                        </label>
                      </th>
                      <SortableTableHeader
                        label={t('payroll.employee')}
                        column="employee"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={paymentThClass}
                      />
                      <SortableTableHeader
                        label={t('payroll.paymentColNetPay')}
                        column="netPay"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={paymentThClass}
                      />
                      <SortableTableHeader
                        label={t('payroll.paymentFilterMethod')}
                        column="method"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={paymentThClass}
                      />
                      <SortableTableHeader
                        label={t('common.status')}
                        column="status"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={paymentThClass}
                      />
                      <SortableTableHeader
                        label={t('payroll.paymentColUpdated')}
                        column="updated"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={paymentThClass}
                      />
                      <th className={`${paymentThClass} text-right`}>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedQueue.map((row) => {
                      const busy = busyId === row.payslipId || bulkBusy;
                      const canSelect =
                        paymentUpdatesAllowed && row.disbursementStatus !== 'PAID';
                      const isSelected = selectedIds.has(row.payslipId);
                      let updatedLabel = '—';
                      if (row.disbursementStatusAt) {
                        try {
                          updatedLabel = formatDateTimeDisplay(row.disbursementStatusAt);
                        } catch {
                          updatedLabel = row.disbursementStatusAt;
                        }
                      }
                      return (
                        <tr
                          key={row.payslipId}
                          className={`border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                            isSelected ? 'bg-primary-50/50 dark:bg-primary-950/20' : ''
                          }`}
                        >
                          <td className="py-3 px-3 w-10">
                            <input
                              type="checkbox"
                              className={checkboxClass}
                              checked={isSelected}
                              disabled={!canSelect || busy}
                              onChange={() => toggleRowSelected(row.payslipId)}
                              aria-label={row.employeeName}
                            />
                          </td>
                          <td className="py-3 px-3 min-w-[12rem]">
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {row.employeeName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {row.employeeId}
                              {row.departmentName ? ` · ${row.departmentName}` : ''}
                            </p>
                            {row.disbursementHoldNote ? (
                              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                                {row.disbursementHoldNote}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-3 px-3 font-semibold tabular-nums">
                            {formatPayrollMoney(row.netPay, { currency })}
                          </td>
                          <td className="py-3 px-3 text-slate-700 dark:text-slate-200">
                            {paymentMethodLabel(normalizePaymentMethod(row.paymentMethod))}
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              variant={
                                row.disbursementStatus === 'PAID'
                                  ? 'success'
                                  : row.disbursementStatus === 'HOLDING'
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {disbursementLabel(row.disbursementStatus)}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-500 tabular-nums">
                            {updatedLabel}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {paymentUpdatesAllowed ? (
                            <ResponsiveRowActions
                              menuLabel={t('common.actions') || 'Payment actions'}
                              actions={[
                                ...(row.disbursementStatus !== 'PAID'
                                  ? [{
                                      key: 'paid',
                                      label: t('payroll.paymentStatusPaid'),
                                      icon: busy ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                        <Check className="w-4 h-4" />
                                      ),
                                      disabled: busy,
                                      onClick: () => void markPaid(row),
                                    }]
                                  : []),
                                ...(row.disbursementStatus !== 'HOLDING'
                                  ? [{
                                      key: 'holding',
                                      label: t('payroll.paymentStatusHolding'),
                                      icon: <PauseCircle className="w-4 h-4" />,
                                      disabled: busy,
                                      onClick: () => void markHolding(row),
                                    }]
                                  : []),
                                ...(row.disbursementStatus !== 'PENDING'
                                  ? [{
                                      key: 'pending',
                                      label: t('payroll.paymentStatusPending'),
                                      icon: <RotateCcw className="w-4 h-4" />,
                                      disabled: busy,
                                      onClick: () => void resetPending(row),
                                    }]
                                  : []),
                              ]}
                            />
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};

export default PayrollPayment;
