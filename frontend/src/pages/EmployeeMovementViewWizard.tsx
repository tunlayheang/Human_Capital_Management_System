import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { WorkflowWizardShell } from '../components/workflow/WorkflowWizardShell';
import { WizardFooterLayout } from '../components/workflow/WizardFooterLayout';
import { StepMovementDetails } from '../components/employee-movement-wizard/StepMovementDetails';
import { StepMovementReview } from '../components/employee-movement-wizard/StepMovementReview';
import { Button } from '../components/ui/Button';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useWorkspaceTabTitle } from '../hooks/useWorkspaceTabTitle';
import { resolveEmployeeRecordDisplayName } from '../utils/personDisplayName';
import { Department, Position } from '../types';
import { Api } from '../services/api';
import { PERM } from '../constants/permissionKeys';
import type { EmployeeMovementRow } from '../types/employeeMovement';
import {
  loadMovementWizardCatalog,
  movementFormFromRow,
  normalizeActiveEmployee,
  filterPositionsForDepartment,
  resubmitMovement,
  resolveMovementSalaryRangePosition,
  type ActiveEmployee,
  type MovementFormState,
} from '../employeeMovement/movementFormLogic';
import {
  getMovementWizardSteps,
  validateMovementWizardStep,
} from '../employeeMovement/movementWizardSteps';
import { canActorResubmitReturnedMovement, isReturnedMovementStatus } from '../utils/movementResubmitAccess';
import {
  MovementApprovalTracker,
  MovementListCard,
  movementTypeLabel,
  movementStatusBadge,
} from '../components/employee/employeeMovementDisplay';
import { exportMovementReviewDocument } from '../utils/exportMovementReviewPdf';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import {
  resolveDepartmentDisplayName,
  resolvePositionTitle,
} from '../utils/localizedEntityLabel';
import {
  formatContractMoneyAmount,
  normalizeContractCurrency,
} from '../utils/contractMoney';
import { resolveExchangeRateKhrPerUsd } from '../utils/payrollExchangeRateCache';
import {
  isMetadataMovementType,
  isPlacementMovementType,
  isSalaryMovementType,
  parseSalaryInput,
} from '../employeeMovement/movementFormLogic';
import type { WorkflowApproverCandidate } from '../components/workflow/ApproverSelectPanel';

function approverCandidateFromAssigned(a: {
  userId: string;
  name?: string | null;
}): WorkflowApproverCandidate {
  return {
    userId: a.userId,
    employeePk: '',
    name: a.name?.trim() || a.userId,
    email: '',
    role: '',
    roleLabel: '',
    levelCode: null,
    levelLabel: null,
    employeeCode: null,
    positionTitle: null,
    departmentId: '',
    departmentName: '',
    hasPortalAccess: true,
  };
}

type LocationState = {
  movement?: EmployeeMovementRow | null;
};

export const EmployeeMovementViewWizard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { user, hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardSteps = useMemo(() => getMovementWizardSteps(t), [t]);

  const movementIdParam = searchParams.get('movementId')?.trim() || '';
  const stepParam = parseInt(searchParams.get('step') ?? '', 10);
  const movementFromState = (location.state as LocationState | null)?.movement ?? null;

  const [currentStep, setCurrentStep] = useState(() =>
    Number.isFinite(stepParam) && stepParam >= 0 && stepParam < wizardSteps.length ? stepParam : 0
  );
  const [loading, setLoading] = useState(true);
  const [movement, setMovement] = useState<EmployeeMovementRow | null>(movementFromState);
  const [employee, setEmployee] = useState<ActiveEmployee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [form, setForm] = useState<MovementFormState>(() =>
    movementFromState
      ? movementFormFromRow(movementFromState)
      : movementFormFromRow({ employeeId: '', movementType: 'transfer' })
  );
  const [selectedApprovers, setSelectedApprovers] = useState<WorkflowApproverCandidate[]>([]);
  const [stepError, setStepError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const canCreate =
    hasPermission(PERM.EMPLOYEE_EDIT_WORK) ||
    hasPermission(PERM.EMPLOYEE_EDIT_FINANCIAL) ||
    hasPermission(PERM.EMPLOYEE_CREATE);

  const canResubmit = useMemo(() => {
    if (!canCreate) return false;
    return canActorResubmitReturnedMovement(movement, user);
  }, [movement, canCreate, user]);

  const syncUrl = useCallback(
    (step: number) => {
      const next = new URLSearchParams();
      if (movementIdParam) next.set('movementId', movementIdParam);
      if (step > 0) next.set('step', String(step));
      setSearchParams(next, { replace: true });
    },
    [movementIdParam, setSearchParams]
  );

  const patchForm = useCallback((patch: Partial<MovementFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setStepError(null);
  }, []);

  useEffect(() => {
    if (!movementIdParam) {
      setLoading(false);
      return;
    }
    if (movementFromState && movementFromState.id === movementIdParam) {
      setMovement(movementFromState);
      setForm(movementFormFromRow(movementFromState));
      const chain = movementFromState.assignedApprovers ?? [];
      if (chain.length) {
        setSelectedApprovers(
          chain.map((a) =>
            approverCandidateFromAssigned({
              userId: a.userId,
              name: a.name ?? null,
            })
          )
        );
      }
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Api.employeeMovements
      .list()
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? (data as EmployeeMovementRow[]) : [];
        const found = rows.find((row) => String(row.id) === movementIdParam) ?? null;
        setMovement(found);
        if (found) {
          setForm(movementFormFromRow(found));
          const chain = found.assignedApprovers ?? [];
          if (chain.length) {
            setSelectedApprovers(
              chain.map((a) =>
                approverCandidateFromAssigned({
                  userId: a.userId,
                  name: a.name ?? null,
                })
              )
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) showToast('Could not load movement', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementFromState, movementIdParam, showToast]);

  useEffect(() => {
    void loadMovementWizardCatalog()
      .then(({ departments: depts, positions: pos }) => {
        setDepartments(depts);
        setPositions(pos);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const eid = movement?.employeeId?.trim();
    if (!eid) return;
    let cancelled = false;
    void Api.employees
      .getById(eid)
      .then((detail) => {
        if (cancelled || !detail) return;
        setEmployee(normalizeActiveEmployee(detail as Record<string, unknown>));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [movement?.employeeId]);

  const deptPositions = useMemo(
    () => filterPositionsForDepartment(positions, form.toDepartmentId),
    [positions, form.toDepartmentId]
  );

  const selectedPosition = useMemo(() => {
    if (form.toPositionId) {
      return (
        deptPositions.find((p) => p.id === form.toPositionId) ??
        positions.find((p) => p.id === form.toPositionId)
      );
    }
    const title = movement?.toPositionTitle?.trim();
    if (!title) return undefined;
    return (
      deptPositions.find((p) => resolvePositionTitle(p, language) === title) ??
      positions.find((p) => resolvePositionTitle(p, language) === title)
    );
  }, [deptPositions, form.toPositionId, language, movement?.toPositionTitle, positions]);

  useEffect(() => {
    if (!selectedPosition?.id || form.toPositionId) return;
    setForm((prev) => ({ ...prev, toPositionId: selectedPosition.id }));
  }, [form.toPositionId, selectedPosition?.id]);

  const salaryRangePosition = useMemo(
    () =>
      resolveMovementSalaryRangePosition(
        form,
        employee ?? undefined,
        positions,
        selectedPosition
      ),
    [form, employee, positions, selectedPosition]
  );

  const employeeName = employee
    ? resolveEmployeeRecordDisplayName(employee, language)
    : movement?.employeeName ?? '';

  useWorkspaceTabTitle(employeeName || null);

  const activeStep = wizardSteps[currentStep];
  const isLastStep = currentStep === wizardSteps.length - 1;

  const handleExport = async (format: ExportFileExt) => {
    if (!movement) return;
    try {
      await exportMovementReviewDocument(format, movement);
      showToast(`Movement exported as ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed.', 'error');
    }
  };

  const jumpToStep = (index: number) => {
    if (!canResubmit) {
      setCurrentStep(index);
      syncUrl(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (index <= currentStep) {
      setCurrentStep(index);
      syncUrl(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const err = validateMovementWizardStep(
      currentStep,
      form,
      employee ?? undefined,
      salaryRangePosition
    );
    if (err) {
      setStepError(err);
      showToast(err, 'warning');
      return;
    }
    setStepError(null);
    setCurrentStep(index);
    syncUrl(index);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = () => {
    if (actionBusy) return;
    if (canResubmit) {
      const err = validateMovementWizardStep(
        currentStep,
        form,
        employee ?? undefined,
        salaryRangePosition
      );
      if (err) {
        setStepError(err);
        showToast(err, 'warning');
        return;
      }
      setStepError(null);
    }
    const next = Math.min(currentStep + 1, wizardSteps.length - 1);
    setCurrentStep(next);
    syncUrl(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrev = () => {
    const prev = Math.max(currentStep - 1, 0);
    setCurrentStep(prev);
    syncUrl(prev);
  };

  const handleResubmit = async () => {
    if (!movement || !employee || actionBusy) return;
    const err = validateMovementWizardStep(2, form, employee, salaryRangePosition);
    if (err) {
      setStepError(err);
      showToast(err, 'warning');
      return;
    }
    setActionBusy(true);
    setStepError(null);
    try {
      await resubmitMovement({
        movementId: movement.id,
        state: form,
        employee,
      });
      showToast('Movement resubmitted for approval.', 'success');
      navigate('/employees/movements');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not resubmit movement';
      setStepError(msg);
      showToast(msg, 'error');
    } finally {
      setActionBusy(false);
    }
  };

  const renderEmployeeStep = () => {
    if (!movement) {
      return <p className="text-sm text-slate-500">Movement not found.</p>;
    }
    return (
      <div className="space-y-4 max-w-3xl mx-auto w-full">
        {isReturnedMovementStatus(movement) ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            <p className="font-semibold">Returned for revision</p>
            {movement.returnNotes ? (
              <p className="mt-1 whitespace-pre-wrap">{movement.returnNotes}</p>
            ) : null}
            {!canResubmit ? (
              <p className="mt-1.5 text-amber-800/90 dark:text-amber-200/90">
                Only the person who submitted this movement can edit and resubmit it.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-4">
          <p className="font-semibold text-slate-900 dark:text-white">
            {employeeName || movement.employeeName}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{movement.employeeId}</p>
          {movement.employeeEmail ? (
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{movement.employeeEmail}</p>
          ) : null}
          {movement.employeePhone ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{movement.employeePhone}</p>
          ) : null}
        </div>
      </div>
    );
  };

  const renderReviewStepReadOnly = () => {
    if (!movement) return null;
    const exchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');
    const payCurrency = normalizeContractCurrency(form.toCurrency);
    const newSalary = parseSalaryInput(form.toBaseSalary);
    const toDept = departments.find((d) => d.id === form.toDepartmentId);
    const deptName =
      movement.toDepartmentName ||
      (toDept ? resolveDepartmentDisplayName(toDept, language) : '');
    const posTitle =
      movement.toPositionTitle ||
      (selectedPosition ? resolvePositionTitle(selectedPosition, language) : '');

    return (
      <div className="space-y-5 max-w-3xl mx-auto w-full">
        <MovementListCard row={movement} density="default" salaryDeltaFormat="percent" showEmployee={false} />
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3 text-sm">
          <h4 className="font-semibold text-slate-900 dark:text-white">Summary</h4>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-slate-600 dark:text-slate-300">
            <div>
              <dt className="text-xs text-slate-500">Movement type</dt>
              <dd className="font-medium">{movementTypeLabel(form.movementType)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Effective date</dt>
              <dd className="font-medium">{form.effectiveDate || '—'}</dd>
            </div>
            {isPlacementMovementType(form.movementType) ? (
              <>
                <div>
                  <dt className="text-xs text-slate-500">From department</dt>
                  <dd className="font-medium">{movement.fromDepartmentName || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">To department</dt>
                  <dd className="font-medium">{deptName || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">From position</dt>
                  <dd className="font-medium">{movement.fromPositionTitle || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">To position</dt>
                  <dd className="font-medium">{posTitle || '—'}</dd>
                </div>
              </>
            ) : null}
            {isSalaryMovementType(form.movementType) && newSalary != null ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">Pay change</dt>
                <dd className="font-medium">
                  {movement.fromBaseSalary != null
                    ? `${formatContractMoneyAmount(movement.fromBaseSalary, normalizeContractCurrency(movement.fromCurrency), exchangeRate)} → `
                    : ''}
                  {formatContractMoneyAmount(newSalary, payCurrency, exchangeRate)}
                </dd>
              </div>
            ) : null}
            {isMetadataMovementType(form.movementType) && form.newContractType ? (
              <div>
                <dt className="text-xs text-slate-500">New contract type</dt>
                <dd className="font-medium">{form.newContractType}</dd>
              </div>
            ) : null}
            {isMetadataMovementType(form.movementType) && form.newEmploymentStatus ? (
              <div>
                <dt className="text-xs text-slate-500">New employment status</dt>
                <dd className="font-medium">{form.newEmploymentStatus}</dd>
              </div>
            ) : null}
          </dl>
        </div>
        {form.notes ? (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Reason for change
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{form.notes}</p>
          </div>
        ) : null}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4">
          <MovementApprovalTracker row={movement} />
        </div>
      </div>
    );
  };

  const renderStepContent = () => {
    if (loading) {
      return <ContentSkeleton layout="form" rows={1} label="Loading movement…" />;
    }
    if (!movementIdParam || !movement) {
      return (
        <div className="text-center py-12 space-y-3">
          <p className="text-sm text-slate-500">Movement not found.</p>
          <Button variant="outline" onClick={() => navigate('/employees/movements')}>
            Back to movements
          </Button>
        </div>
      );
    }

    let body: React.ReactNode = null;
    switch (currentStep) {
      case 0:
        body = renderEmployeeStep();
        break;
      case 1:
        body = (
          <StepMovementDetails
            form={form}
            onChange={canResubmit ? patchForm : () => {}}
            employee={employee}
            departments={departments}
            deptPositions={deptPositions}
            selectedPosition={selectedPosition}
            salaryRangePosition={salaryRangePosition}
            readOnly={!canResubmit}
          />
        );
        break;
      case 2:
        body = canResubmit ? (
          <StepMovementReview
            form={form}
            onChange={patchForm}
            employee={employee}
            departments={departments}
            positions={positions}
            selectedApprovers={selectedApprovers}
            onApproversChange={(_userIds, candidates) => setSelectedApprovers(candidates)}
          />
        ) : (
          renderReviewStepReadOnly()
        );
        break;
      default:
        body = null;
    }

    return (
      <>
        {body}
        {stepError ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400 max-w-3xl mx-auto">{stepError}</p>
        ) : null}
      </>
    );
  };

  const statusBadge = movement
    ? movementStatusBadge(movement.status, movement.canonicalStatus, movement.approvalProgress)
    : null;

  return (
    <WorkflowWizardShell
      header={
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/employees/movements')}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
              aria-label={t('employees.movementsWizard.backToList')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  {canResubmit
                    ? t('employees.movementsView.resubmitTitle') || 'Edit & resubmit movement'
                    : t('employees.movementsView.title') || 'View movement'}
                </h2>
                {statusBadge}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {employeeName
                  ? `${movement?.employeeId ?? ''} · ${employeeName}`
                  : canResubmit
                    ? t('employees.movementsView.resubmitSubtitle') ||
                      'Update the returned movement and resubmit for approval.'
                    : t('employees.movementsView.subtitle') || 'Review recorded movement details'}
              </p>
            </div>
          </div>
          {movement && isLastStep && !canResubmit ? (
            <ExportFormatMenu variant="button" onExport={handleExport} />
          ) : null}
        </div>
      }
      steps={wizardSteps}
      currentStep={currentStep}
      maxReachableStep={wizardSteps.length - 1}
      onStepChange={jumpToStep}
      stepHeader={{
        title: activeStep?.label ?? '',
        description: activeStep?.description,
      }}
      footer={
        <WizardFooterLayout
          left={
            currentStep > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrev}
                className="h-9 px-2.5 text-slate-600 dark:text-slate-300"
              >
                <ChevronLeft className="w-4 h-4 mr-1.5" aria-hidden />
                {t('employees.movementsWizard.back')}
              </Button>
            ) : undefined
          }
          right={
            isLastStep ? (
              canResubmit ? (
                <Button size="sm" onClick={() => void handleResubmit()} disabled={actionBusy}>
                  {actionBusy
                    ? t('employees.movementsWizard.saving') || 'Saving…'
                    : t('employees.movementsView.resubmit') || 'Resubmit for approval'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => navigate('/employees/movements')}>
                  {t('common.close') || 'Close'}
                </Button>
              )
            ) : (
              <Button type="button" size="sm" onClick={handleNext} className="h-9 w-auto px-5">
                {t('employees.movementsWizard.next')}
                <ChevronRight className="w-4 h-4 ml-2" aria-hidden />
              </Button>
            )
          }
        />
      }
    >
      {renderStepContent()}
    </WorkflowWizardShell>
  );
};

export default EmployeeMovementViewWizard;
