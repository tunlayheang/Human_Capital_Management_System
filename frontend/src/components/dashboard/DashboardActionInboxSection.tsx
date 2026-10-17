import React from 'react';
import { ApprovalQueuesList } from '../approvals/ApprovalQueuesList';
import { ReviewQueuesList } from '../reviews/ReviewQueuesList';
import { useApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';
import { useReviewInbox } from '../../hooks/useReviewInbox';
import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

/** Approval + review queue icons for dashboard quick actions (no card chrome). */
export function DashboardActionInboxSection() {
  const { hasRole } = useAuth();
  const { t } = useLanguage();
  const isManagement =
    hasRole(Role.ADMIN) || hasRole(Role.HR) || hasRole(Role.MANAGER);

  const { summary, loading: approvalsLoading } = useApprovalInboxSummary(isManagement);
  const {
    kpiItems,
    probationItems,
    selfItems,
    loading: reviewsLoading,
  } = useReviewInbox(true);

  const loading = (isManagement && approvalsLoading) || reviewsLoading;

  return (
    <div
      className="dashboard-queue-icons"
      role="toolbar"
      aria-label={t('dashboard.actionQueues') || 'Approval and review queues'}
    >
      {loading ? (
        <div
          className="flex flex-wrap gap-2 items-center min-h-[3rem] w-full"
          role="status"
          aria-busy="true"
          aria-label={t('common.retrievingData')}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="h-9 w-9 rounded-xl animate-pulse bg-slate-200/80 dark:bg-slate-700/50"
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <>
          {isManagement ? (
            <ApprovalQueuesList summary={summary} loading={false} variant="dashboard" />
          ) : null}
          {isManagement ? (
            <span className="dashboard-queue-icons-divider" aria-hidden />
          ) : null}
          <ReviewQueuesList
            kpiCount={kpiItems.length}
            probationCount={probationItems.length}
            selfCount={selfItems.length}
            selfItems={selfItems}
            isManagement={isManagement}
            loading={false}
            variant="dashboard"
          />
        </>
      )}
    </div>
  );
}

export default DashboardActionInboxSection;
