import React from 'react';
import { ProbationReviewWorkspace } from './ProbationReviewWorkspace';
import { ProbationPendingApprovalsPanel } from './ProbationPendingApprovalsPanel';
import type { PerformanceMode } from '../appraisal/PerformanceModeTabs';
import { useApprovalInboxSummary } from '../../hooks/useApprovalInboxSummary';

type Props = {
  /**
   * When opened from Approvals deep links (`view=approval`), show the approval
   * queue. Overview cards on the evaluation workspace stay as filters only.
   */
  mode?: PerformanceMode;
};

/** Probation hub — evaluation workspace or approval queue (no mode tabs). */
export const ProbationPerformanceHub: React.FC<Props> = ({ mode = 'evaluation' }) => {
  const showApprovals = mode === 'approval';
  const { refresh } = useApprovalInboxSummary(showApprovals);

  return (
    <div className="space-y-4">
      {showApprovals ? (
        <ProbationPendingApprovalsPanel variant="page" onChanged={() => void refresh()} />
      ) : (
        <ProbationReviewWorkspace />
      )}
    </div>
  );
};

export default ProbationPerformanceHub;
