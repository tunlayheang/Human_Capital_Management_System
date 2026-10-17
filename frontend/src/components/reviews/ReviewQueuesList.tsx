import React from 'react';
import { Award, ClipboardPenLine, GraduationCap, UserRound } from 'lucide-react';
import { Card } from '../ui/Card';
import { QueueIconTile } from '../dashboard/QueueIconTile';
import { useLanguage } from '../../context/LanguageContext';
import { ApprovalQueueLinkCard } from '../approvals/ApprovalQueueLinkCard';
import { useActionInboxNavigate } from '../../hooks/useActionInboxNavigate';
import type { ReviewQueueKey } from '../../hooks/useReviewInbox';
import type { RequiredActionItem } from '../../hooks/useRequiredActions';
import { selfEvaluationQueueNavigatePath } from '../../utils/reviewNavigation';
import { LoadingState } from '../common/LoadingState';

type Props = {
  kpiCount: number;
  probationCount: number;
  selfCount: number;
  selfItems?: RequiredActionItem[];
  isManagement: boolean;
  loading?: boolean;
  variant?: 'default' | 'dashboard';
};

export const ReviewQueuesList: React.FC<Props> = ({
  kpiCount,
  probationCount,
  selfCount,
  selfItems = [],
  isManagement,
  loading,
  variant = 'default',
}) => {
  const { openInbox } = useActionInboxNavigate();
  const { t } = useLanguage();

  const queues: Array<{
    key: ReviewQueueKey;
    icon: React.ElementType;
    accent: string;
    title: string;
    description: string;
    count: number;
    onClick: () => void;
    show: boolean;
  }> = [
    {
      key: 'kpi',
      icon: ClipboardPenLine,
      accent: 'bg-amber-600',
      title: t('reviews.kpiQueue') || 'KPI evaluations',
      description:
        kpiCount > 0
          ? (t('reviews.kpiQueueHint') || '{n} employee(s) routed to you for KPI evaluation.').replace(
              '{n}',
              String(kpiCount)
            )
          : t('reviews.kpiQueueEmpty') || 'No KPI appraisals waiting for your evaluation.',
      count: kpiCount,
      onClick: () => openInbox('/approvals/evaluations/kpi'),
      show: isManagement,
    },
    {
      key: 'probation',
      icon: GraduationCap,
      accent: 'bg-teal-600',
      title: t('reviews.probationQueue') || 'Probation evaluations',
      description:
        probationCount > 0
          ? (t('reviews.probationQueueHint') || '{n} probation review(s) routed to you.').replace(
              '{n}',
              String(probationCount)
            )
          : t('reviews.probationQueueEmpty') || 'No probation reviews waiting for your evaluation.',
      count: probationCount,
      onClick: () => openInbox('/approvals/evaluations/probation'),
      show: isManagement,
    },
    {
      key: 'self',
      icon: UserRound,
      accent: 'bg-violet-600',
      title: t('reviews.selfQueue') || 'Self-evaluations',
      description:
        selfCount > 0
          ? (t('reviews.selfQueueHint') || '{n} self-evaluation(s) waiting for you.').replace(
              '{n}',
              String(selfCount)
            )
          : t('reviews.selfQueueEmpty') || 'No self-evaluations due right now.',
      count: selfCount,
      onClick: () => openInbox(selfEvaluationQueueNavigatePath(selfItems)),
      show: true,
    },
  ];

  const visibleQueues = queues.filter((q) => q.show || (q.key === 'kpi' && q.count > 0));
  const sortedQueues =
    variant === 'dashboard'
      ? [...visibleQueues].sort((a, b) => b.count - a.count)
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
            actionCount={queue.count}
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
          <Award className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('reviews.queuesTitle') || 'Review queues'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('reviews.queuesSubtitle') ||
                'Open a queue to see employees routed to you, then complete each evaluation.'}
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
              actionCount={queue.count}
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

export default ReviewQueuesList;
