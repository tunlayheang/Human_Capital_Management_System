import React, { useCallback } from 'react';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ReviewPendingItemsPanel } from '../components/reviews/ReviewPendingItemsPanel';
import { ActionInboxModalShell } from '../components/action-inbox/ActionInboxModalShell';
import { useReviewInbox } from '../hooks/useReviewInbox';
import { useLanguage } from '../context/LanguageContext';
import { modalOverlayCloseTarget } from '../utils/modalOverlayRoutes';

export const ReviewsProbationQueue: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { probationItems, loading, refresh, isManagement } = useReviewInbox(true);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleClose = useCallback(() => {
    const target = modalOverlayCloseTarget('/approvals/evaluations/probation');
    navigate({ pathname: target.pathname, search: target.search });
  }, [navigate]);

  if (!loading && !isManagement) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <ActionInboxModalShell
      isOpen
      onClose={handleClose}
      backTo={{
        label: t('reviews.backToDashboard') || t('nav.dashboard') || 'Back to dashboard',
        onClick: handleClose,
      }}
      title={t('reviews.probationQueue') || 'Probation evaluations'}
      subtitle={
        probationItems.length > 0
          ? (t('reviews.probationDetailSubtitle') || '{n} probation review(s) routed to you.').replace(
              '{n}',
              String(probationItems.length)
            )
          : t('reviews.probationDetailSubtitleEmpty') ||
            'Probation reviews assigned to you will appear here.'
      }
      iconComponent={ClipboardList}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('common.refresh') || 'Refresh'}
        </Button>
      }
    >
      <ReviewPendingItemsPanel
        items={probationItems}
        loading={loading}
        emptyTitle={t('reviews.probationQueueEmpty') || 'No probation reviews waiting for your evaluation.'}
        emptyBody={
          t('reviews.probationQueueEmptyBody') ||
          'When HR routes a probation review to you, it will show up in this list.'
        }
      />
    </ActionInboxModalShell>
  );
};

export default ReviewsProbationQueue;
