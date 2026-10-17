import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { LoadingState } from '../../components/common/LoadingState';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import type { PayrollAttendancePeriod } from '../../types';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';

function todayKey(): string {
  return todayYmdInCompanyTz();
}

function isCutoffNotReached(period: PayrollAttendancePeriod | null): boolean {
  if (!period?.attendanceCutoffDate) return false;
  if (period.isCutoffReached === true) return false;
  if (period.isCutoffReached === false) return true;
  return todayKey() < period.attendanceCutoffDate;
}

function canFreezeAttendancePeriod(
  period: PayrollAttendancePeriod | null,
  isFinalized: boolean
): boolean {
  if (!period || isFinalized) return false;
  if (period.canFreezeAttendance != null) return period.canFreezeAttendance;
  if (period.isCutoffReached != null) return period.isCutoffReached;
  if (period.attendanceCutoffDate) {
    return todayKey() >= period.attendanceCutoffDate;
  }
  return false;
}

function canReopenAttendancePeriod(period: PayrollAttendancePeriod | null): boolean {
  if (!period) return false;
  if (period.canReopenAttendance != null) return period.canReopenAttendance;
  if (period.status === 'FINALIZED') return true;
  if (period.status !== 'LOCKED') return false;
  const cutoffNotReached = isCutoffNotReached(period);
  if (period.freezeTrigger === 'PAYROLL_APPROVED' && !cutoffNotReached) return false;
  if (period.freezeTrigger === 'SCHEDULER' && cutoffNotReached) return false;
  return true;
}

type Props = {
  month: string;
  onStatusChange?: (period: PayrollAttendancePeriod) => void;
  /** When provided (e.g. from payroll preview), skips duplicate API fetch. */
  periodFromParent?: PayrollAttendancePeriod | null;
  skipFetch?: boolean;
  /** Optional actions (e.g. calculate payroll) shown beside finalize controls. */
  actions?: React.ReactNode;
  /** `inline` embeds in a parent card without its own Card wrapper. */
  variant?: 'card' | 'inline';
  /** Hide the section title when a parent workflow step already labels this block. */
  hideHeading?: boolean;
};

export const PayrollAttendanceFinalizeCard: React.FC<Props> = ({
  month,
  onStatusChange,
  periodFromParent,
  skipFetch = false,
  actions,
  variant = 'card',
  hideHeading = false,
}) => {
  const { showToast } = useToast();
  const { confirm, ConfirmDialogHost } = useConfirmDialog();
  const monthKey = month.slice(0, 7);
  const [period, setPeriod] = useState<PayrollAttendancePeriod | null>(periodFromParent ?? null);
  const [loading, setLoading] = useState(!skipFetch && !periodFromParent);
  const [acting, setActing] = useState(false);
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const parentPeriodKey = periodFromParent
    ? [
        periodFromParent.month,
        periodFromParent.status,
        periodFromParent.payPeriodStart,
        periodFromParent.payPeriodEnd,
        periodFromParent.attendanceCutoffDate ?? '',
        String(periodFromParent.isCutoffReached ?? ''),
        String(periodFromParent.canReopenAttendance ?? ''),
        periodFromParent.freezeTrigger ?? '',
      ].join('\0')
    : '';

  const load = useCallback(async () => {
    if (skipFetch) return;
    setLoading(true);
    try {
      const row = await Api.payroll.getAttendancePeriod(monthKey);
      setPeriod(row);
      onStatusChangeRef.current?.(row);
    } catch (e) {
      console.error(e);
      setPeriod(null);
    } finally {
      setLoading(false);
    }
  }, [monthKey, skipFetch]);

  useEffect(() => {
    if (parentPeriodKey && periodFromParent) {
      setPeriod(periodFromParent);
      setLoading(false);
      return;
    }
    if (!skipFetch) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- periodFromParent read when parentPeriodKey changes
  }, [parentPeriodKey, skipFetch, load]);

  const finalize = async () => {
    if (period?.canFreezeAttendance === false) {
      showToast(
        period?.attendanceCutoffDate
          ? `Attendance can only be frozen on or after the cutoff date (${period.attendanceCutoffDate}).`
          : 'Attendance can only be frozen on the scheduled payroll cutoff date.',
        'error'
      );
      return;
    }
    if (
      !(await confirm({
        title: 'Finalize attendance?',
        description: `Finalize attendance for ${monthKey}? Payroll will use only locked attendance data.`,
        variant: 'success',
        confirmLabel: 'Finalize',
      }))
    ) {
      return;
    }
    setActing(true);
    try {
      const row = await Api.payroll.finalizeAttendancePeriod(monthKey);
      setPeriod(row);
      onStatusChange?.(row);
      showToast('Attendance period finalized', 'success');
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : 'Could not finalize attendance';
      showToast(msg, 'error');
    } finally {
      setActing(false);
    }
  };

  const reopen = async () => {
    setActing(true);
    try {
      const row = await Api.payroll.reopenAttendancePeriod(monthKey);
      setPeriod(row);
      onStatusChange?.(row);
      showToast('Attendance period reopened', 'info');
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Could not reopen attendance', 'error');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    const loadingBody = (
      <LoadingState variant="panel" layout="form" rows={1} label="Loading attendance period…" className="py-1" />
    );
    if (variant === 'inline') {
      return (
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
          {loadingBody}
        </div>
      );
    }
    return (
      <Card className="p-4 border border-slate-200 dark:border-slate-700">
        {loadingBody}
      </Card>
    );
  }

  const status = period?.status ?? 'OPEN';
  const isFinalized = status === 'FINALIZED' || status === 'LOCKED';
  const canFreeze = canFreezeAttendancePeriod(period, isFinalized);
  const cutoffNotReached = isCutoffNotReached(period);
  const canReopen = canReopenAttendancePeriod(period);

  const body = (
    <div
      className={
        variant === 'inline'
          ? 'flex flex-col sm:flex-row sm:items-center justify-between gap-3'
          : 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-10'
      }
    >
      {!hideHeading ? (
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {variant === 'inline' ? 'Attendance' : `Attendance finalization — ${monthKey}`}
          </p>
          {period?.attendanceCutoffDate && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Cutoff {period.attendanceCutoffDate}
              {!isFinalized && !canFreeze ? ' · input open until cutoff' : ''}
            </p>
          )}
        </div>
      ) : period?.attendanceCutoffDate ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 min-w-0">
          Cutoff {period.attendanceCutoffDate}
          {!isFinalized && !canFreeze ? ' · input open until cutoff' : ''}
        </p>
      ) : (
        <span className="min-w-0" />
      )}
      <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusLabel
            status={isFinalized ? status : 'PENDING'}
            context="payroll"
            label={status}
            size="sm"
          />
          {!isFinalized ? (
            <Button
              size="sm"
              onClick={() => void finalize()}
              isLoading={acting}
              disabled={!canFreeze}
              title={
                !canFreeze && period?.attendanceCutoffDate
                  ? `Available on cutoff date: ${period.attendanceCutoffDate}`
                  : undefined
              }
              icon={<Lock className="w-4 h-4" />}
            >
              Finalize attendance
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void reopen()}
              isLoading={acting}
              disabled={!canReopen}
              title={
                !canReopen
                  ? period?.freezeTrigger === 'PAYROLL_APPROVED'
                    ? 'Locked because payroll was approved — use payroll adjustment instead'
                    : 'This attendance period cannot be reopened'
                  : cutoffNotReached
                    ? 'Reopen — attendance was frozen before the cutoff date'
                    : 'Reopen attendance for corrections'
              }
              icon={<Unlock className="w-4 h-4" />}
            >
              Reopen
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <>
        <ConfirmDialogHost />
        <div
          className={
            hideHeading
              ? 'px-5 pb-4'
              : 'px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30'
          }
        >
          {body}
        </div>
      </>
    );
  }

  return (
    <>
      <ConfirmDialogHost />
      <Card
      className="p-4 border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50"
      help="payroll.attendanceFinalize"
    >
      {body}
    </Card>
    </>
  );
};
