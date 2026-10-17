import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ApprovalsMovementQueue } from './ApprovalsMovementQueue';
import { ReviewsKpiQueue } from './ReviewsKpiQueue';
import { ReviewsProbationQueue } from './ReviewsProbationQueue';
import { ManagementRouteGate } from '../components/approvals/ManagementRouteGate';

/** Drill-down approval/evaluation modals only — hub lives on the dashboard. */
export const ApprovalsModule: React.FC = () => (
  <Routes>
    <Route index element={<Navigate to="/dashboard" replace />} />
    <Route
      path="appraisals"
      element={<Navigate to="/performance?tab=kpi-appraisals&view=approval" replace />}
    />
    <Route
      path="movements"
      element={
        <ManagementRouteGate>
          <ApprovalsMovementQueue />
        </ManagementRouteGate>
      }
    />
    <Route
      path="probation"
      element={<Navigate to="/performance?tab=probation&view=approval" replace />}
    />
    <Route path="payroll" element={<Navigate to="/payroll/approvals" replace />} />
    <Route path="evaluations/kpi" element={<ReviewsKpiQueue />} />
    <Route path="evaluations/probation" element={<ReviewsProbationQueue />} />
    <Route path="evaluations/self" element={<Navigate to="/my-performance?tab=action" replace />} />
    <Route path="reviews" element={<Navigate to="/dashboard" replace />} />
    <Route path="reviews/kpi" element={<Navigate to="/approvals/evaluations/kpi" replace />} />
    <Route path="reviews/probation" element={<Navigate to="/approvals/evaluations/probation" replace />} />
    <Route path="reviews/self" element={<Navigate to="/my-performance?tab=action" replace />} />
  </Routes>
);

export default ApprovalsModule;
