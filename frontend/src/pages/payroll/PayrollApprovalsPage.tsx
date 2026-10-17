import React, { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PayrollApprovalRunsList } from '../../components/payroll/PayrollApprovalRunsList';
import { useApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';
import { useLanguage } from '../../context/LanguageContext';
import { ListToolbarIconButton, listToolbarGlyphClass } from '../../components/ui/page';

export const PayrollApprovalsPage: React.FC = () => {
  const { t } = useLanguage();
  const { summary, refresh } = useApprovalInboxSummary(true);
  const [reloadToken, setReloadToken] = useState(0);

  const handleChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    void refresh();
    setReloadToken((token) => token + 1);
  }, [refresh]);

  const action = summary?.breakdown.payrollAction ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {action > 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {(t('approvals.payrollQueueTracking') || '{n} need your action.').replace(
              '{n}',
              String(action)
            )}
          </p>
        ) : (
          <span />
        )}
        <ListToolbarIconButton
          onClick={handleRefresh}
          icon={<RefreshCw className={listToolbarGlyphClass} />}
          title={t('common.refresh') || 'Refresh'}
          aria-label={t('common.refresh') || 'Refresh'}
        />
      </div>

      <PayrollApprovalRunsList onChanged={handleChanged} reloadToken={reloadToken} />
    </div>
  );
};

export default PayrollApprovalsPage;
