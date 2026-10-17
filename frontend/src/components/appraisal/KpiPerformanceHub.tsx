import React from 'react';
import { KpiAppraisalListPanel } from './KpiAppraisalListPanel';
import { KpiAppraisalAnalyticsPanel } from './KpiAppraisalAnalyticsPanel';
import { KpiAppraisalSettingsPanel } from './KpiAppraisalSettingsPanel';
import { AppraisalPendingApprovalsPanel } from './AppraisalPendingApprovalsPanel';
import type { PerformanceMode } from './PerformanceModeTabs';
import { useApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';

export type KpiHubView = 'appraisals' | 'analytics' | 'configuration';

export function kpiTabToView(tab: string): KpiHubView {
  if (tab === 'kpi-appraisals') return 'appraisals';
  if (tab === 'kpi-settings') return 'configuration';
  return 'analytics';
}

type Props = {
  activeView: KpiHubView;
  /**
   * When opened from Approvals deep links (`view=approval`), show the approval
   * queue. Evaluation filters stay on the main appraisals card — no mode tabs.
   */
  mode?: PerformanceMode;
};

/** KPI hub content — section switch lives in the Performance sidebar. */
export const KpiPerformanceHub: React.FC<Props> = ({ activeView, mode = 'evaluation' }) => {
  const showApprovals = activeView === 'appraisals' && mode === 'approval';
  const { refresh } = useApprovalInboxSummary(showApprovals);

  return (
    <div className="space-y-4">
      {activeView === 'appraisals' ? (
        showApprovals ? (
          <AppraisalPendingApprovalsPanel variant="page" onChanged={() => void refresh()} />
        ) : (
          <KpiAppraisalListPanel />
        )
      ) : null}
      {activeView === 'analytics' && <KpiAppraisalAnalyticsPanel />}
      {activeView === 'configuration' && <KpiAppraisalSettingsPanel />}
    </div>
  );
};
