import React from 'react';
import { ArrowRight, Briefcase, Calendar, Clock, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useLanguage } from '../../context/LanguageContext';
import type { ApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';

type Props = {
  summary: ApprovalInboxSummary | null;
};

function QueueLinkCard({
  icon: Icon,
  title,
  description,
  count,
  onClick,
  accent,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  count: number;
  onClick: () => void;
  accent: string;
}) {
  if (count <= 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${accent}`}
          >
            <Icon className="w-5 h-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="warning" className="tabular-nums">
            {count}
          </Badge>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-primary-500 transition-colors" />
        </div>
      </div>
    </button>
  );
}

export const OtherApprovalQueuesPanel: React.FC<Props> = ({ summary }) => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const leaveCount = summary?.breakdown.leaveRequests ?? 0;
  const overtimeCount = summary?.breakdown.overtimeRequests ?? 0;

  if (leaveCount <= 0 && overtimeCount <= 0) return null;

  return (
    <Card className="border-slate-200/80 dark:border-slate-700">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('approvals.otherQueuesTitle') || 'Other approval queues'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('approvals.otherQueuesSubtitle') ||
              'Open the module to review leave and overtime requests from your team.'}
          </p>
        </div>
      </div>
      <div className="space-y-3">
        <QueueLinkCard
          icon={Calendar}
          title={t('approvals.leaveQueue') || 'Leave Approval'}
          description={
            t('approvals.leaveQueueHint') || 'Pending leave requests waiting for your decision.'
          }
          count={leaveCount}
          onClick={() => navigate('/leaves?scope=manage&tab=requests')}
          accent="bg-violet-600"
        />
        <QueueLinkCard
          icon={Clock}
          title={t('approvals.overtimeQueue') || 'OT Approval'}
          description={
            t('approvals.overtimeQueueHint') || 'Pending overtime submissions from your team.'
          }
          count={overtimeCount}
          onClick={() => navigate('/overtime?scope=manage&tab=requests')}
          accent="bg-amber-600"
        />
      </div>
    </Card>
  );
};

export const ApprovalsEmptyState: React.FC<{ trackingCount?: number }> = ({ trackingCount = 0 }) => {
  const { t } = useLanguage();

  return (
    <Card className="border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="flex flex-col items-center text-center py-10 px-4">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 mb-4">
          <Briefcase className="w-7 h-7" aria-hidden />
        </span>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          {t('approvals.allCaughtUpTitle') || 'You are all caught up'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">
          {trackingCount > 0
            ? t('approvals.allCaughtUpTracking') ||
              'Nothing needs your sign-off right now. You can still track assigned appraisal steps below.'
            : t('approvals.allCaughtUpBody') ||
              'No appraisals, movements, leave, or overtime requests need your approval at the moment.'}
        </p>
      </div>
    </Card>
  );
};
