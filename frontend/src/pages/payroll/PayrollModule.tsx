import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { PageLoader } from '../../components/common/PageLoader';
import { useAuth } from '../../context/AuthContext';
import {
  canAccessFullPayrollModule,
  canAccessPayrollApprovals,
} from '../../utils/payrollAccess';
import PayrollDashboard from './PayrollDashboard';
import PayrollCalendar from './PayrollCalendar';
import PayrollRules from './PayrollRules';
import PayrollRunDetail from './PayrollRunDetail';
import PayrollApprovalsPage from './PayrollApprovalsPage';
import PayrollPayment from './PayrollPayment';
import { LegacyFinalPayRedirect } from './LegacyFinalPayRedirect';
import { PageShell, PageHeader } from '../../components/ui/page';
import { useRoutePageMeta, useSyncDocumentTitle } from '../../hooks/useRoutePageMeta';

type PayrollRoute = 'overview' | 'calendar' | 'rules' | 'approvals' | 'approval-detail' | 'payment' | 'run-detail' | 'other';

function getPayrollRoute(pathname: string): PayrollRoute {
  const path = pathname.replace(/\/$/, '') || '/';
  if (/^\/payroll\/approvals\/[^/]+$/.test(path)) return 'approval-detail';
  if (/^\/payroll\/runs\/[^/]+$/.test(path)) return 'run-detail';
  if (path === '/payroll/calendar') return 'calendar';
  if (path === '/payroll/rules') return 'rules';
  if (path === '/payroll/payment') return 'payment';
  if (path === '/payroll/approvals') return 'approvals';
  if (path === '/payroll') return 'overview';
  return 'other';
}

export const PayrollModule: React.FC = () => {
  const location = useLocation();
  const { hasPermission, user } = useAuth();
  const pathname = location.pathname.replace(/\/$/, '') || '/';
  const fullPayrollAccess = canAccessFullPayrollModule(hasPermission, user?.role);
  const approvalsAccess = canAccessPayrollApprovals(hasPermission, user?.role);
  const approverOnlyPath =
    pathname === '/payroll/approvals' ||
    /^\/payroll\/approvals\/[^/]+$/.test(pathname) ||
    /^\/payroll\/runs\/[^/]+$/.test(pathname);
  const paymentPath = pathname === '/payroll/payment';
  if (!fullPayrollAccess && !approverOnlyPath && !paymentPath) {
    if (approvalsAccess) return <Navigate to="/payroll/approvals" replace />;
    return <Navigate to="/forbidden" replace state={{ from: pathname }} />;
  }
  if (!fullPayrollAccess && approverOnlyPath && !approvalsAccess) {
    return <Navigate to="/forbidden" replace state={{ from: pathname }} />;
  }
  if (paymentPath && !fullPayrollAccess) {
    return <Navigate to="/forbidden" replace state={{ from: pathname }} />;
  }
  const route = getPayrollRoute(location.pathname);
  const payrollHome = fullPayrollAccess ? '/payroll' : '/payroll/approvals';

  const routeMeta = useRoutePageMeta();
  useSyncDocumentTitle(routeMeta?.title);

  return (
    <PageShell>
      {routeMeta && route !== 'run-detail' && route !== 'approval-detail' && route !== 'other' && (
        <PageHeader
          title={routeMeta.title}
          subtitle={routeMeta.subtitle}
          iconComponent={routeMeta.icon}
        />
      )}

      <Suspense fallback={<PageLoader layout={route === 'rules' ? 'form' : route === 'calendar' ? 'dashboard' : route === 'payment' ? 'list' : 'dashboard'} />}>
        <Routes>
          <Route
            index
            element={
              fullPayrollAccess ? (
                <PayrollDashboard />
              ) : (
                <Navigate to="/payroll/approvals" replace />
              )
            }
          />
          <Route
            path="calendar"
            element={
              fullPayrollAccess ? (
                <PayrollCalendar />
              ) : (
                <Navigate to="/payroll/approvals" replace />
              )
            }
          />
          <Route path="final-settlement" element={<LegacyFinalPayRedirect />} />
          <Route path="final-settlement/payment" element={<LegacyFinalPayRedirect />} />
          <Route path="records" element={<Navigate to="/reports" replace />} />
          <Route
            path="rules"
            element={
              fullPayrollAccess ? (
                <PayrollRules />
              ) : (
                <Navigate to="/payroll/approvals" replace />
              )
            }
          />
          <Route
            path="payment"
            element={
              fullPayrollAccess ? (
                <PayrollPayment />
              ) : (
                <Navigate to="/payroll/approvals" replace />
              )
            }
          />
          <Route
            path="approvals/:runId"
            element={
              approvalsAccess ? (
                <PayrollRunDetail />
              ) : (
                <Navigate to="/forbidden" replace state={{ from: pathname }} />
              )
            }
          />
          <Route
            path="approvals"
            element={
              approvalsAccess ? (
                <PayrollApprovalsPage />
              ) : (
                <Navigate to="/forbidden" replace state={{ from: pathname }} />
              )
            }
          />
          <Route
            path="runs/:id"
            element={
              approvalsAccess ? (
                <PayrollRunDetail />
              ) : (
                <Navigate to="/forbidden" replace state={{ from: pathname }} />
              )
            }
          />
          <Route path="*" element={<Navigate to={payrollHome} replace />} />
        </Routes>
      </Suspense>
    </PageShell>
  );
};

export default PayrollModule;
