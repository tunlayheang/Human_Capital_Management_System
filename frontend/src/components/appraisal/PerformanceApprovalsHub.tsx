import React from 'react';
import { AppraisalPendingApprovalsPanel } from './AppraisalPendingApprovalsPanel';
import { ProbationPendingApprovalsPanel } from '../probation/ProbationPendingApprovalsPanel';
import { useApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';

export type PerformanceApprovalsView = 'appraisal' | 'probation';

export function performanceTabToApprovalsView(tab: string): PerformanceApprovalsView {
  return tab === 'probation-approvals' ? 'probation' : 'appraisal';
}

type Props = {
  activeView: PerformanceApprovalsView;
};

/** Approvals hub content — appraisal vs probation lives in the Performance sidebar. */
export const PerformanceApprovalsHub: React.FC<Props> = ({ activeView }) => {
  const { refresh } = useApprovalInboxSummary(true);

  const handleChanged = () => {
    void refresh();
  };

  return (
    <div className="space-y-4">
      {activeView === 'appraisal' ? (
        <AppraisalPendingApprovalsPanel variant="page" onChanged={handleChanged} />
      ) : (
        <ProbationPendingApprovalsPanel variant="page" onChanged={handleChanged} />
      )}
    </div>
  );
};

export default PerformanceApprovalsHub;
