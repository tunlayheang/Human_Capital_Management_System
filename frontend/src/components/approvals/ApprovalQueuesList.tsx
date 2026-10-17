import React from 'react';
import {
  ArrowRightLeft,
  BadgeCheck,
  Banknote,
  Calendar,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { QueueIconTile } from '../dashboard/QueueIconTile';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { canAccessPayrollApprovals } from '../../utils/payrollAccess';
import type { ApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';
import { ApprovalQueueLinkCard } from './ApprovalQueueLinkCard';
import { LoadingState } from '../common/LoadingState';
import { useActionInboxNavigate } from '../../hooks/useActionInboxNavigate';

type Props = {
  summary: ApprovalInboxSummary | null;
  loading?: boolean;
  variant?: 'default' | 'dashboard';
};

function queueDescription(
  total: number,
  action: number,
  emptyLabel: string,
  actionLabel: (n: number) => string,
  trackingLabel: (n: number) => string
): string {
  if (total <= 0) return emptyLabel;
  if (action <= 0) return trackingLabel(total);
  if (action === total) return actionLabel(action);
  return `${actionLabel(action)} · ${trackingLabel(total - action)}`;
}

export const ApprovalQueuesList: React.FC<Props> = ({ summary, loading, variant = 'default' }) => {
  const { openInbox, navigate } = useActionInboxNavigate();
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const showPayrollQueue = canAccessPayrollApprovals(hasPermission);

  const appraisalsAction = summary?.breakdown.appraisalsAction ?? 0;
  const appraisalsTracking = summary?.breakdown.appraisalsTracking ?? 0;
  const appraisalsTotal = appraisalsAction + appraisalsTracking;
  const movements = summary?.breakdown.movements ?? 0;
  const probationAction = summary?.breakdown.probationAction ?? 0;
  const probationTracking = summary?.breakdown.probationTracking ?? 0;
  const probationTotal = probationAction + probationTracking;
  const payrollAction = summary?.breakdown.payrollAction ?? 0;
  const payrollTracking = summary?.breakdown.payrollTracking ?? 0;
  const payrollTotal = payrollAction + payrollTracking;
  const leaveCount = summary?.breakdown.leaveRequests ?? 0;
  const overtimeCount = summary?.breakdown.overtimeRequests ?? 0;

  const queues = [
    {
      key: 'appraisals',
      icon: ShieldCheck,
      accent: 'bg-amber-600',
      title: t('approvals.appraisalQueue') || 'Appraisal approvals',
      description: queueDescription(
        appraisalsTotal,
        appraisalsAction,
        t('approvals.appraisalQueueEmpty') || 'No appraisals assigned to you in the approval chain.',
        (n) =>
          (t('approvals.appraisalQueueAction') || '{n} awaiting your sign-off').replace('{n}', String(n)),
        (n) =>
          (t('approvals.appraisalQueueTracking') || '{n} in your approval queue').replace('{n}', String(n))
      ),
      count: appraisalsTotal,
      actionCount: appraisalsAction,
      onClick: () => navigate('/performance?tab=kpi-appraisals&view=approval'),
    },
    {
      key: 'probation',
      icon: BadgeCheck,
      accent: 'bg-teal-600',
      title: t('approvals.probationQueue') || 'Probation reviews',
      description: queueDescription(
        probationTotal,
        probationAction,
        t('approvals.probationQueueEmpty') || 'No probation reviews assigned to you in the approval chain.',
        (n) =>
          (t('approvals.probationQueueAction') || '{n} awaiting your sign-off').replace('{n}', String(n)),
        (n) =>
          (t('approvals.probationQueueTracking') || '{n} in your approval queue').replace('{n}', String(n))
      ),
      count: probationTotal,
      actionCount: probationAction,
      onClick: () => navigate('/performance?tab=probation&view=approval'),
    },
    {
      key: 'payroll',
      icon: Banknote,
      accent: 'bg-emerald-600',
      title: t('approvals.payrollQueue') || 'Payroll runs',
      description: queueDescription(
        payrollTotal,
        payrollAction,
        t('approvals.payrollQueueEmpty') || 'No payroll runs assigned to you in the approval chain.',
        (n) =>
          (t('approvals.payrollQueueAction') || '{n} awaiting your sign-off').replace('{n}', String(n)),
        (n) =>
          (t('approvals.payrollQueueTracking') || '{n} in your approval queue').replace('{n}', String(n))
      ),
      count: payrollTotal,
      actionCount: payrollAction,
      onClick: () => navigate('/payroll/approvals'),
    },
    {
      key: 'movements',
      icon: ArrowRightLeft,
      accent: 'bg-indigo-600',
      title: t('approvals.movementQueue') || 'Employee movements',
      description:
        movements > 0
          ? (t('approvals.movementQueueHint') || '{n} movement(s) waiting for your review.').replace(
              '{n}',
              String(movements)
            )
          : t('approvals.movementQueueEmpty') || 'No employee movements waiting for your review.',
      count: movements,
      actionCount: movements,
      onClick: () => openInbox('/approvals/movements'),
    },
    {
      key: 'leave',
      icon: Calendar,
      accent: 'bg-violet-600',
      title: t('approvals.leaveQueue') || 'Leave Approval',
      description:
        leaveCount > 0
          ? t('approvals.leaveQueueHint') || 'Pending leave requests waiting for your decision.'
          : t('approvals.leaveQueueEmpty') || 'No pending leave requests.',
      count: leaveCount,
      actionCount: leaveCount,
      onClick: () => navigate('/leaves?scope=manage&tab=requests'),
    },
    {
      key: 'overtime',
      icon: Clock,
      accent: 'bg-rose-600',
      title: t('approvals.overtimeQueue') || 'OT Approval',
      description:
        overtimeCount > 0
          ? t('approvals.overtimeQueueHint') || 'Pending overtime submissions from your team.'
          : t('approvals.overtimeQueueEmpty') || 'No pending overtime requests.',
      count: overtimeCount,
      actionCount: overtimeCount,
      onClick: () => navigate('/overtime?scope=manage&tab=requests'),
    },
  ];

  const visibleQueues = showPayrollQueue
    ? queues
    : queues.filter((queue) => queue.key !== 'payroll');
  const sortedQueues =
    variant === 'dashboard'
      ? [...visibleQueues].sort((a, b) => {
          const aScore = (a.actionCount ?? 0) > 0 ? 2 : a.count > 0 ? 1 : 0;
          const bScore = (b.actionCount ?? 0) > 0 ? 2 : b.count > 0 ? 1 : 0;
          return bScore - aScore;
        })
      : visibleQueues;

  if (variant === 'dashboard') {
    if (loading) return null;
    return (
      <>
        {sortedQueues.map((queue) => (
          <QueueIconTile
            key={queue.key}
            icon={queue.icon}
            label={queue.title}
            count={queue.count}
            actionCount={queue.actionCount}
            accent={queue.accent}
            onClick={queue.onClick}
          />
        ))}
      </>
    );
  }

  return (
    <Card className="border-slate-200/80 dark:border-slate-700">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ShieldCheck className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('approvals.queuesTitle') || 'Approval queues'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('approvals.queuesSubtitle') ||
                'Open a queue to review items and take action when it is your turn.'}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState variant="panel" layout="list" rows={3} label={t('common.retrievingData')} />
      ) : (
        <div className="space-y-3">
          {sortedQueues.map((queue) => (
            <ApprovalQueueLinkCard
              key={queue.key}
              icon={queue.icon}
              title={queue.title}
              description={queue.description}
              count={queue.count}
              actionCount={queue.actionCount}
              accent={queue.accent}
              onClick={queue.onClick}
              alwaysShow
              variant={variant}
            />
          ))}
        </div>
      )}
    </Card>
  );
};
