import React, { useEffect, useMemo } from 'react';
import { useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { Plus, Users, ArrowRightLeft, UserX, UserPlus } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useLanguage } from '../context/LanguageContext';
import { EmployeeList, type EmployeeRowPermissionFlags } from './EmployeeList';
import { EmployeeInput } from './EmployeeInput';
import { EmployeeOffboarding } from './EmployeeOffboarding';
import { EmployeeOffboardingWizard } from './EmployeeOffboardingWizard';
import FinalSettlementPayment from './payroll/FinalSettlementPayment';
import { EmployeeMovements } from './EmployeeMovements';
import { EmployeeMovementWizard } from './EmployeeMovementWizard';
import { EmployeeMovementViewWizard } from './EmployeeMovementViewWizard';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../constants/permissionKeys';
import { hasOffboardingStageAccess, offboardingRowPermissions } from '../config/offboardingAccess';
import { PageShell, PageHeader, RestrictedAccess } from '../components/ui/page';
import { useRoutePageMeta, useSyncDocumentTitle } from '../hooks/useRoutePageMeta';

import { formatAccessRoleLabel } from '../utils/accessRole';

function roleLabelFromApi(name: string): string {
  const upper = name?.toUpperCase();
  if (upper === 'HR') return 'Humanresource';
  return formatAccessRoleLabel(name) || name || '';
}

export const EmployeeModule: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { hasPermission, user } = useAuth();

  const hasEmployeeView = hasPermission(PERM.EMPLOYEE_VIEW);
  const hasEmployeeCreate = hasPermission(PERM.EMPLOYEE_CREATE);
  const hasOffboardingAccess = hasOffboardingStageAccess({
    hasPermission,
    userRole: user?.role,
  });
  const offboardPerms = offboardingRowPermissions({ hasPermission, userRole: user?.role });

  const rowPermissions: EmployeeRowPermissionFlags = useMemo(
    () => ({
      canEdit:
        hasPermission(PERM.EMPLOYEE_EDIT_PERSONAL) ||
        hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
        hasPermission(PERM.EMPLOYEE_EDIT_WORK),
      canDelete: offboardPerms.canTerminate,
    }),
    [hasPermission, offboardPerms.canTerminate]
  );

  const getActiveTab = () => {
    const p = location.pathname;
    if (p.includes('/movements')) return 'movements';
    if (p.includes('/offboarding')) return 'offboarding';
    if (p.includes('/onboarding') || p.endsWith('/new') || p.includes('/edit')) return 'onboarding';
    return 'list';
  };

  const activeTab = getActiveTab();

  const isOnboardingWizard =
    location.pathname.includes('/onboarding/new') ||
    location.pathname.endsWith('/employees/new') ||
    location.pathname.includes('/edit');

  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const atListRoot = path === '/employees';
    const atOnboardingList = path === '/employees/onboarding';
    const atWizard =
      path.includes('/onboarding/new') || path.endsWith('/employees/new') || path.includes('/edit');

    if (!hasEmployeeCreate && atWizard) {
      navigate('/employees', { replace: true });
      return;
    }

    if (!hasEmployeeView && hasEmployeeCreate && (atListRoot || atOnboardingList)) {
      navigate('/employees/onboarding/new', { replace: true });
      return;
    }

    if (path === '/employees/settings' || path.startsWith('/employees/settings/')) {
      navigate('/employees', { replace: true });
    }
  }, [hasEmployeeView, hasEmployeeCreate, location.pathname, navigate]);

  const isWizardRoute =
    isOnboardingWizard ||
    location.pathname.includes('/offboarding/wizard') ||
    location.pathname.includes('/offboarding/payment') ||
    location.pathname.includes('/movements/wizard') ||
    location.pathname.includes('/movements/view');
  const showAddEmployee =
    (activeTab === 'list' || activeTab === 'onboarding') && hasEmployeeCreate && !isWizardRoute;

  const atOffboardingOnly =
    location.pathname.includes('/offboarding') &&
    hasOffboardingAccess &&
    !hasEmployeeView &&
    !hasEmployeeCreate;

  const routeMeta = useRoutePageMeta();
  useSyncDocumentTitle(routeMeta?.title);

  if (!hasEmployeeView && !hasEmployeeCreate && !hasOffboardingAccess) {
    return <RestrictedAccess message="You do not have permission to view or manage employees." />;
  }

  return (
    <PageShell className={isWizardRoute ? '!pb-0 flex flex-col flex-1 min-h-0 animate-none' : ''}>
      {!isWizardRoute && routeMeta && (
        <PageHeader
          title={routeMeta.title}
          subtitle={routeMeta.subtitle}
          iconComponent={routeMeta.icon}
          actions={
            showAddEmployee ? (
              <Button onClick={() => navigate('/employees/onboarding/new')} className="shadow-lg shadow-primary-500/20">
                <Plus className="w-4 h-4 mr-2" />
                {t('employees.newEmployee') || 'Add Employee'}
              </Button>
            ) : undefined
          }
        />
      )}

      <div
        className={
          isWizardRoute
            ? 'flex flex-col flex-1 min-h-[calc(100dvh-17rem)] lg:min-h-[calc(100dvh-15rem)] [&>*]:flex-1 [&>*]:flex [&>*]:flex-col [&>*]:min-h-0'
            : 'space-y-6'
        }
      >
        <Routes>
          <Route
            index
            element={
              hasEmployeeView ? (
                <EmployeeList roleLabelFromApi={roleLabelFromApi} rowPermissions={rowPermissions} />
              ) : hasEmployeeCreate ? (
                <Navigate to="/employees/onboarding/new" replace />
              ) : hasOffboardingAccess ? (
                <Navigate to="/employees/offboarding" replace />
              ) : (
                <RestrictedAccess message="You do not have permission to view or manage employees." />
              )
            }
          />
          <Route
            path="onboarding"
            element={
              hasEmployeeView ? (
                <EmployeeList roleLabelFromApi={roleLabelFromApi} rowPermissions={rowPermissions} />
              ) : hasEmployeeCreate ? (
                <Navigate to="/employees/onboarding/new" replace />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route
            path="onboarding/new"
            element={hasEmployeeCreate ? <EmployeeInput /> : <Navigate to="/employees" replace />}
          />
          <Route
            path="offboarding"
            element={
              hasEmployeeView || hasOffboardingAccess ? (
                <EmployeeOffboarding />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route
            path="offboarding/wizard"
            element={
              hasEmployeeView || hasOffboardingAccess ? (
                <EmployeeOffboardingWizard />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route
            path="offboarding/payment"
            element={
              hasEmployeeView || hasOffboardingAccess ? (
                <FinalSettlementPayment />
              ) : (
                <Navigate to="/employees/offboarding" replace />
              )
            }
          />
          <Route path="abandonment" element={<Navigate to="/employees/offboarding" replace />} />
          <Route
            path="movements"
            element={
              hasEmployeeView ? (
                <EmployeeMovements />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route
            path="movements/wizard"
            element={
              hasEmployeeView ? (
                <EmployeeMovementWizard />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route
            path="movements/view"
            element={
              hasEmployeeView ? (
                <EmployeeMovementViewWizard />
              ) : (
                <Navigate to="/employees" replace />
              )
            }
          />
          <Route path="new" element={hasEmployeeCreate ? <EmployeeInput /> : <Navigate to="/employees" replace />} />
          <Route path="edit/:id" element={<EmployeeInput />} />
          <Route path=":id/edit" element={<EmployeeInput />} />
          <Route path="settings" element={<Navigate to="/employees" replace />} />
          <Route path="settings/*" element={<Navigate to="/employees" replace />} />
        </Routes>
      </div>
    </PageShell>
  );
};
