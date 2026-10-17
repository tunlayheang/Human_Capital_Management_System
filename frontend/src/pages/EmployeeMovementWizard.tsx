import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { ContentSkeleton } from '../components/common/ContentSkeleton';
import { WorkflowWizardShell } from '../components/workflow/WorkflowWizardShell';
import { WizardFooterLayout } from '../components/workflow/WizardFooterLayout';
import {
  StepSelectEmployee,
  type EmployeePickRow,
} from '../components/offboarding-wizard/StepSelectEmployee';
import { StepMovementDetails } from '../components/employee-movement-wizard/StepMovementDetails';
import { StepMovementReview } from '../components/employee-movement-wizard/StepMovementReview';
import type { WorkflowApproverCandidate } from '../components/workflow/ApproverSelectPanel';
import { Button } from '../components/ui/Button';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceTabTitle } from '../hooks/useWorkspaceTabTitle';
import { employeeSearchHaystack, matchesEmployeeSearch } from '../utils/employeeSearchText';
import { resolveEmployeeRecordDisplayName } from '../utils/personDisplayName';
import {
  appraisalMovementNote,
  clearAppraisalMovementPrefill,
  persistAppraisalMovementPrefill,
  readAppraisalMovementPrefill,
  type AppraisalMovementPrefill,
} from '../components/appraisal/appraisalMovementUtils';
import { Department, Position } from '../types';
import { Api } from '../services/api';
import {
  defaultMovementFormState,
  filterPositionsForDepartment,
  isPlacementMovementType,
  isSalaryMovementType,
  loadMovementWizardCatalog,
  movementFormFromAppraisalPrefill,
  normalizeActiveEmployee,
  resolveMovementSalaryRangePosition,
  submitMovement,
  suggestSalaryFromAppraisal,
  suggestSalaryFromPosition,
  type ActiveEmployee,
  type MovementFormState,
} from '../employeeMovement/movementFormLogic';
import {
  getMovementWizardSteps,
  maxReachableMovementStep,
  validateMovementWizardStep,
} from '../employeeMovement/movementWizardSteps';

type LocationState = {
  appraisalPrefill?: AppraisalMovementPrefill | null;
};

export const EmployeeMovementWizard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardSteps = useMemo(() => getMovementWizardSteps(t), [t]);

  const employeeIdParam = searchParams.get('employeeId')?.trim() || '';
  const departmentIdParam = searchParams.get('departmentId')?.trim() || '';
  const stepParam = parseInt(searchParams.get('step') ?? '', 10);
  const appraisalPrefill = useMemo(() => {
    const fromState = (location.state as LocationState | null)?.appraisalPrefill;
    if (fromState) {
      persistAppraisalMovementPrefill(fromState);
      return fromState;
    }
    return readAppraisalMovementPrefill();
  }, [location.state, location.key]);

  const [currentStep, setCurrentStep] = useState(() => {
    if (appraisalPrefill?.employeeId) return 1;
    if (Number.isFinite(stepParam) && stepParam >= 0 && stepParam < wizardSteps.length) {
      return stepParam;
    }
    return 0;
  });
  const [selectQuery, setSelectQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [employees, setEmployees] = useState<ActiveEmployee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [form, setForm] = useState<MovementFormState>(() =>
    defaultMovementFormState({
      ...(appraisalPrefill ? movementFormFromAppraisalPrefill(appraisalPrefill) : {}),
      employeeId: appraisalPrefill?.employeeId || employeeIdParam || '',
      toDepartmentId: departmentIdParam || '',
      notes: appraisalPrefill ? appraisalMovementNote(appraisalPrefill) : '',
    })
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [selectedApprovers, setSelectedApprovers] = useState<WorkflowApproverCandidate[]>([]);

  const patchForm = useCallback((patch: Partial<MovementFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setStepError(null);
  }, []);

  const syncUrl = useCallback(
    (step: number, eid?: string | null) => {
      const next = new URLSearchParams();
      const id = eid ?? form.employeeId ?? employeeIdParam;
      if (id) next.set('employeeId', id);
      if (departmentIdParam) next.set('departmentId', departmentIdParam);
      if (step > 0) next.set('step', String(step));
      setSearchParams(next, { replace: true });
    },
    [departmentIdParam, employeeIdParam, form.employeeId, setSearchParams]
  );

  const selectedEmployee = useMemo(
    () => employees.find((e) => e.employee_id === form.employeeId) ?? null,
    [employees, form.employeeId]
  );

  const deptPositions = useMemo(
    () => filterPositionsForDepartment(positions, form.toDepartmentId),
    [positions, form.toDepartmentId]
  );

  const selectedPosition = useMemo(
    () => deptPositions.find((p) => p.id === form.toPositionId),
    [deptPositions, form.toPositionId]
  );

  const salaryRangePosition = useMemo(
    () =>
      resolveMovementSalaryRangePosition(
        form,
        selectedEmployee ?? undefined,
        positions,
        selectedPosition
      ),
    [form, selectedEmployee, positions, selectedPosition]
  );

  const filteredEmployees = useMemo(() => {
    if (!selectQuery.trim()) return [];
    return employees.filter((e) =>
      matchesEmployeeSearch(
        employeeSearchHaystack([
          e.employee_id,
          e.first_name,
          e.last_name,
          e.first_name_kh,
          e.last_name_kh,
          e.full_name,
          e.full_name_kh,
          e.email,
          e.phone,
        ]),
        selectQuery
      )
    );
  }, [employees, selectQuery]);

  const maxStep = maxReachableMovementStep({
    form,
    employee: selectedEmployee ?? undefined,
    salaryRangePosition,
  });

  useEffect(() => {
    setCatalogLoading(true);
    void loadMovementWizardCatalog()
      .then(({ employees: rows, departments: depts, positions: pos }) => {
        setEmployees(rows);
        setDepartments(depts);
        setPositions(pos);
      })
      .catch(() => showToast('Failed to load movement form data', 'error'))
      .finally(() => setCatalogLoading(false));
  }, [showToast]);

  useEffect(() => {
    const eid = form.employeeId?.trim();
    if (!eid) return;
    let cancelled = false;
    void Api.employees
      .getById(eid)
      .then((detail) => {
        if (cancelled || !detail) return;
        const normalized = normalizeActiveEmployee(detail as Record<string, unknown>);
        setEmployees((prev) =>
          prev.map((e) => (e.employee_id === eid ? { ...e, ...normalized } : e))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form.employeeId]);

  useEffect(() => {
    if (!employeeIdParam || form.employeeId) return;
    patchForm({ employeeId: employeeIdParam });
  }, [employeeIdParam, form.employeeId, patchForm]);

  useEffect(() => {
    if (!selectedEmployee) return;
    patchForm({ toCurrency: (selectedEmployee.currency || 'USD').toUpperCase() });
    if (form.movementType === 'promotion' && !form.toDepartmentId) {
      patchForm({ toDepartmentId: selectedEmployee.department_id });
    }
  }, [selectedEmployee, form.movementType, form.toDepartmentId, patchForm]);

  useEffect(() => {
    const suggested = suggestSalaryFromAppraisal(
      selectedEmployee ?? undefined,
      appraisalPrefill ?? undefined,
      form.movementType,
      form.toBaseSalary
    );
    if (suggested) patchForm({ toBaseSalary: suggested });
  }, [selectedEmployee, appraisalPrefill, form.movementType, form.toBaseSalary, patchForm]);

  useEffect(() => {
    if (!isPlacementMovementType(form.movementType)) {
      if (form.toPositionId || form.toDepartmentId) {
        patchForm({ toPositionId: '', toDepartmentId: '' });
      }
      return;
    }
    const suggested = suggestSalaryFromPosition(
      selectedPosition,
      selectedEmployee?.base_salary ?? 0,
      form.toBaseSalary
    );
    if (suggested) patchForm({ toBaseSalary: suggested });
  }, [
    form.movementType,
    form.toPositionId,
    form.toDepartmentId,
    form.toBaseSalary,
    selectedPosition,
    selectedEmployee?.base_salary,
    patchForm,
  ]);

  const activeStep = wizardSteps[currentStep];
  const employeeName = selectedEmployee
    ? resolveEmployeeRecordDisplayName(selectedEmployee, language)
    : '';

  useWorkspaceTabTitle(employeeName || null);

  const footerHint = useMemo(() => {
    if (currentStep === 0) {
      return selectedEmployee
        ? t('employees.movementsWizard.footer.employeeReady')
        : t('employees.movementsWizard.footer.employeeRequired');
    }
    if (currentStep === 1) {
      return t('employees.movementsWizard.footer.detailsHint');
    }
    return t('employees.movementsWizard.footer.reviewHint');
  }, [currentStep, selectedEmployee, t]);

  const validateStep = (step: number): boolean => {
    const err = validateMovementWizardStep(
      step,
      form,
      selectedEmployee ?? undefined,
      salaryRangePosition
    );
    if (err) {
      setStepError(err);
      return false;
    }
    setStepError(null);
    return true;
  };

  const jumpToStep = async (index: number) => {
    if (index <= currentStep) {
      setCurrentStep(index);
      syncUrl(index);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    let step = currentStep;
    while (step < index) {
      if (!validateStep(step)) {
        setCurrentStep(step);
        syncUrl(step);
        return;
      }
      step += 1;
      setCurrentStep(step);
      syncUrl(step);
      if (step < index) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = () => {
    if (actionBusy || catalogLoading) return;
    const err = validateMovementWizardStep(
      currentStep,
      form,
      selectedEmployee ?? undefined,
      salaryRangePosition
    );
    if (err) {
      setStepError(err);
      showToast(err, 'warning');
      return;
    }
    setStepError(null);
    const next = Math.min(currentStep + 1, wizardSteps.length - 1);
    setCurrentStep(next);
    syncUrl(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePrev = () => {
    const prev = Math.max(currentStep - 1, 0);
    setCurrentStep(prev);
    syncUrl(prev);
    setStepError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleComplete = async () => {
    if (actionBusy || catalogLoading) return;
    const err = validateMovementWizardStep(
      2,
      form,
      selectedEmployee ?? undefined,
      salaryRangePosition
    );
    if (err || !selectedEmployee) {
      if (err) {
        setStepError(err);
        showToast(err, 'warning');
      } else {
        showToast(t('employees.movementsWizard.footer.employeeRequired'), 'warning');
      }
      return;
    }
    setStepError(null);
    setActionBusy(true);
    setStepError(null);
    try {
      const res = await submitMovement({
        state: form,
        employee: selectedEmployee,
        appraisalPrefill,
      });
      if (res.pendingApproval) {
        showToast('Movement submitted for approver review.', 'warning');
      } else if (isSalaryMovementType(form.movementType)) {
        showToast('Pay change recorded.', 'success');
      } else {
        showToast('Movement recorded. Changes apply on the effective date.', 'success');
      }
      clearAppraisalMovementPrefill();
      navigate('/employees/movements');
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not save movement');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSelectEmployee = (row: EmployeePickRow) => {
    patchForm({ employeeId: row.employee_id });
    syncUrl(currentStep, row.employee_id);
  };

  const renderStepContent = () => {
    if (catalogLoading && currentStep > 0) {
      return (
        <ContentSkeleton layout="form" rows={1} label={t('employees.movementsWizard.loading')} />
      );
    }

    const stepBody = (() => {
      switch (currentStep) {
        case 0:
          if (appraisalPrefill && selectedEmployee) {
            return (
              <div className="space-y-4 max-w-3xl mx-auto w-full">
                <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-4 py-3 text-sm text-primary-900 dark:text-primary-100">
                  Employee is fixed for this appraisal-linked movement.
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {resolveEmployeeRecordDisplayName(selectedEmployee, language)}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedEmployee.employee_id}</p>
                </div>
              </div>
            );
          }
          return (
            <StepSelectEmployee
              query={selectQuery}
              onQueryChange={setSelectQuery}
              rows={filteredEmployees}
              loading={catalogLoading}
              selectedId={form.employeeId || null}
              selectedRow={selectedEmployee}
              onSelect={handleSelectEmployee}
            />
          );
        case 1:
          if (!selectedEmployee) {
            return (
              <p className="text-sm text-slate-500">
                {t('employees.movementsWizard.selectFirst')}
              </p>
            );
          }
          return (
            <StepMovementDetails
              form={form}
              onChange={patchForm}
              employee={selectedEmployee}
              departments={departments}
              deptPositions={deptPositions}
              selectedPosition={selectedPosition}
              salaryRangePosition={salaryRangePosition}
              appraisalPrefill={appraisalPrefill}
            />
          );
        case 2:
          return (
            <StepMovementReview
              form={form}
              onChange={patchForm}
              employee={selectedEmployee}
              departments={departments}
              positions={positions}
              selectedApprovers={selectedApprovers}
              onApproversChange={(_userIds, candidates) => setSelectedApprovers(candidates)}
            />
          );
        default:
          return null;
      }
    })();

    return (
      <>
        {stepBody}
        {stepError ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{stepError}</p>
        ) : null}
      </>
    );
  };

  const isLastStep = currentStep === wizardSteps.length - 1;
  const statusBadge = selectedEmployee
    ? t('employees.movementsWizard.badge.ready')
    : t('employees.movementsWizard.badge.new');

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
                  {appraisalPrefill
                    ? t('employees.movementsWizard.titleFromAppraisal')
                    : t('employees.movementsWizard.title')}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  {statusBadge}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {employeeName
                  ? `${selectedEmployee?.employee_id} · ${employeeName}`
                  : t('employees.movementsWizard.subtitle')}
              </p>
            </div>
          </div>
        </div>
      }
      steps={wizardSteps}
      currentStep={currentStep}
      maxReachableStep={maxStep}
      onStepChange={(index) => void jumpToStep(index)}
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
            ) : (
              <p className="text-xs text-slate-500 max-w-[10rem] lg:hidden">{footerHint}</p>
            )
          }
          hint={currentStep > 0 ? footerHint : undefined}
          right={
            isLastStep ? (
              <Button
                size="sm"
                onClick={() => void handleComplete()}
                disabled={actionBusy}
                className="h-9 w-auto bg-green-600 hover:bg-green-700 shadow-md shadow-green-500/20 px-5"
              >
                {actionBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('employees.movementsWizard.saving')}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {t('employees.movementsWizard.save')}
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleNext}
                disabled={actionBusy || catalogLoading}
                className="h-9 w-auto shadow-md shadow-primary-500/20 px-5"
              >
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

export default EmployeeMovementWizard;
