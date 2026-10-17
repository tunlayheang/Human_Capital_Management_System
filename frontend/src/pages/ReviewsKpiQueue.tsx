import React, { useCallback } from 'react';
import { Award, RefreshCw } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ReviewPendingItemsPanel } from '../components/reviews/ReviewPendingItemsPanel';
import { ActionInboxModalShell } from '../components/action-inbox/ActionInboxModalShell';
import { useReviewInbox } from '../hooks/useReviewInbox';
import { useLanguage } from '../context/LanguageContext';
import { modalOverlayCloseTarget } from '../utils/modalOverlayRoutes';

export const ReviewsKpiQueue: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { kpiItems, loading, refresh, isManagement } = useReviewInbox(true);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleClose = useCallback(() => {
    const target = modalOverlayCloseTarget('/approvals/evaluations/kpi');
    navigate({ pathname: target.pathname, search: target.search });
  }, [navigate]);

  const handleBack = useCallback(() => {
    handleClose();
  }, [handleClose]);

  if (!loading && !isManagement) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <ActionInboxModalShell
      isOpen
      onClose={handleClose}
      backTo={{
        label: t('reviews.backToDashboard') || t('nav.dashboard') || 'Back to dashboard',
        onClick: handleBack,
      }}
      title={t('reviews.kpiQueue') || 'KPI evaluations'}
      subtitle={
        kpiItems.length > 0
          ? (t('reviews.kpiDetailSubtitle') || '{n} employee(s) routed to you for KPI evaluation.').replace(
              '{n}',
              String(kpiItems.length)
            )
          : t('reviews.kpiDetailSubtitleEmpty') ||
            'Employees assigned to you will appear here when HR routes a KPI appraisal.'
      }
      iconComponent={Award}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('common.refresh') || 'Refresh'}
        </Button>
      }
    >
      <ReviewPendingItemsPanel
        items={kpiItems}
        loading={loading}
        emptyTitle={t('reviews.kpiQueueEmpty') || 'No KPI appraisals waiting for your evaluation.'}
        emptyBody={
          t('reviews.kpiQueueEmptyBody') ||
          'When HR routes a KPI appraisal to you, it will show up in this list.'
        }
      />
    </ActionInboxModalShell>
  );
};

export default ReviewsKpiQueue;
