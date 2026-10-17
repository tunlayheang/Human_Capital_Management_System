import React, { useCallback } from 'react';
import { RefreshCw, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { MovementPendingApprovalsPanel } from '../components/employee/MovementPendingApprovalsPanel';
import { ActionInboxModalShell } from '../components/action-inbox/ActionInboxModalShell';
import { useApprovalInboxSummary } from '../hooks/useApprovalInboxSummary';
import { useLanguage } from '../context/LanguageContext';
import { modalOverlayCloseTarget } from '../utils/modalOverlayRoutes';

export const ApprovalsMovementQueue: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { summary, refresh } = useApprovalInboxSummary(true);

  const handleChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleClose = useCallback(() => {
    const target = modalOverlayCloseTarget('/approvals/movements');
    navigate({ pathname: target.pathname, search: target.search });
  }, [navigate]);

  const count = summary?.breakdown.movements ?? 0;

  return (
    <ActionInboxModalShell
      isOpen
      onClose={handleClose}
      backTo={{
        label: t('approvals.backToDashboard') || t('nav.dashboard') || 'Back to dashboard',
        onClick: handleClose,
      }}
      title={t('approvals.movementQueue') || 'Employee movements'}
      subtitle={
        count > 0
          ? (t('approvals.movementDetailSubtitle') || '{n} movement(s) waiting for your review.').replace(
              '{n}',
              String(count)
            )
          : t('approvals.movementQueueEmpty') || 'No employee movements waiting for your review.'
      }
      iconComponent={UsersRound}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('common.refresh') || 'Refresh'}
        </Button>
      }
    >
      <MovementPendingApprovalsPanel variant="page" onChanged={handleChanged} />
    </ActionInboxModalShell>
  );
};

export default ApprovalsMovementQueue;
