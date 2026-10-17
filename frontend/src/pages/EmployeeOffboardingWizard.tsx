import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import {
  StepSettlement,
  type StepSettlementHandle,
} from '../components/offboarding-wizard/StepSettlement';
import {
  StepPayment,
  type StepPaymentHandle,
} from '../components/offboarding-wizard/StepPayment';
import { Button } from '../components/ui/Button';
import { Api } from '../services/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { offboardingRowPermissions } from '../config/offboardingAccess';
import {
  getOffboardingWizardSteps,
  maxReachableStepIndex,
  normalizeSettlementStatus,
  paymentDecisionMade,
  paymentStepComplete,
  pickLatestSettlement,
  settlementSaved,
  suggestedStepIndex,
  type SettlementSummary,
} from '../offboarding/offboardingWizardSteps';
import { useLanguage } from '../context/LanguageContext';
import { useWorkspaceTabTitle } from '../hooks/useWorkspaceTabTitle';
import type { SettlementRow } from '../offboarding/settlementFormUtils';
import { employeeSearchHaystack, matchesEmployeeSearch } from '../utils/employeeSearchText';
import { resolveEmployeeRecordDisplayName } from '../utils/personDisplayName';

type EmployeeDetail = EmployeePickRow & {
  status?: string;
};

export const EmployeeOffboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const wizardSteps = useMemo(() => getOffboardingWizardSteps(t), [t]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { user, hasPermission } = useAuth();
  const perms = offboardingRowPermissions({ hasPermission, userRole: user?.role });

  const settlementRef = useRef<StepSettlementHandle>(null);
  const paymentRef = useRef<StepPaymentHandle>(null);

  const employeeIdParam =
    searchParams.get('employeeId')?.trim() ||
    searchParams.get('employee')?.trim() ||
    '';
  const stepParam = parseInt(searchParams.get('step') ?? '', 10);

  const [currentStep, setCurrentStep] = useState(() =>
    Number.isFinite(stepParam) && stepParam >= 0 && stepParam < wizardSteps.length
      ? stepParam
      : 0
  );
  const [selectQuery, setSelectQuery] = useState('');
  const [activeEmployees, setActiveEmployees] = useState<EmployeePickRow[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [settlement, setSettlement] = useState<SettlementRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);

  const syncUrl = useCallback(
    (step: number, eid?: string | null) => {
      const next = new URLSearchParams();
      const id = eid ?? employee?.employee_id ?? employeeIdParam;
      if (id) next.set('employeeId', id);
      if (step > 0) next.set('step', String(step));
      setSearchParams(next, { replace: true });
    },
    [employee?.employee_id, employeeIdParam, setSearchParams]
  );

  const loadActiveEmployees = useCallback(async () => {
    setActiveLoading(true);
    try {
      const res = await Api.employees.getAll({
        page: 1,
        limit: 300,
        status: 'active',
        assigned_id_only: '1',
      });
      setActiveEmployees((res?.employees ?? []) as EmployeePickRow[]);
    } catch {
      setActiveEmployees([]);
    } finally {
      setActiveLoading(false);
    }
  }, []);

  const loadEmployee = useCallback(
    async (eid: string) => {
      setEmployeeLoading(true);
      try {
        let row: EmployeeDetail | null = null;
        try {
          row = (await Api.employees.getById(eid)) as EmployeeDetail;
        } catch {
          for (const status of ['terminated', 'resigned', 'active'] as const) {
            const res = await Api.employees.getAll({ page: 1, limit: 50, status, search: eid });
            const found = (res?.employees ?? []).find(
              (e: { employee_id: string }) => e.employee_id === eid
            ) as EmployeeDetail | undefined;
            if (found) {
              row = found;
              break;
            }
          }
        }
        if (!row?.employee_id) {
          showToast(t('offboarding.wizard.employeeNotFound'), 'error');
          setEmployee(null);
          return;
        }
        setEmployee(row);

        if (perms.canPayroll) {
          const settlements = (await Api.payroll.listFinalSettlements({
            employeeId: eid,
          })) as SettlementSummary[];
          const picked = pickLatestSettlement(Array.isArray(settlements) ? settlements : []);
          if (picked?.id) {
            const full = (await Api.payroll.getFinalSettlement(picked.id)) as SettlementRow;
            setSettlement(full);
          } else {
            setSettlement(null);
          }
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : t('offboarding.wizard.loadEmployeeFailed'), 'error');
        setEmployee(null);
      } finally {
        setEmployeeLoading(false);
      }
    },
    [perms.canPayroll, showToast, t]
  );

  useEffect(() => {
    void loadActiveEmployees();
  }, [loadActiveEmployees]);

  useEffect(() => {
    if (employeeIdParam) {
      void loadEmployee(employeeIdParam);
    }
  }, [employeeIdParam, loadEmployee]);

  useEffect(() => {
    if (Number.isFinite(stepParam) && stepParam >= 0 && stepParam < wizardSteps.length) {
      setCurrentStep(stepParam);
    }
  }, [stepParam, wizardSteps.length]);

  useEffect(() => {
    if (!employee || employeeLoading) return;
    if (Number.isFinite(stepParam) && stepParam >= 0) return;
    const suggested = suggestedStepIndex({
      hasEmployee: true,
      settlementStatus: normalizeSettlementStatus(settlement?.status),
      settlement,
    });
    setCurrentStep(suggested);
    syncUrl(suggested, employee.employee_id);
  }, [employee, employeeLoading, settlement?.status, stepParam, syncUrl, settlement]);

  const settlementStatus = normalizeSettlementStatus(settlement?.status);
  const paymentDone = paymentStepComplete(settlementStatus);
  const payDecisionMade = paymentDecisionMade(settlementStatus);

  useEffect(() => {
    if (currentStep === 2) {
      setPaymentReady(paymentDone || payDecisionMade);
    } else {
      setPaymentReady(false);
    }
  }, [currentStep, paymentDone, payDecisionMade]);

  const maxStep = maxReachableStepIndex({
    hasEmployee: Boolean(employee),
    settlementStatus,
    settlement,
  });

  const filteredActive = useMemo(() => {
    if (!selectQuery.trim()) return [];
    return activeEmployees.filter((e) =>
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
          e.department?.name,
          e.department?.name_kh ?? e.department?.nameKh,
          e.position?.title,
          e.position?.title_kh ?? e.position?.titleKh,
        ]),
        selectQuery
      )
    );
  }, [activeEmployees, selectQuery]);

  const activeStep = wizardSteps[currentStep];
  const readOnlySettlement = ['PAID', 'LOCKED', 'PENDING_PAYROLL_OFFBOARD'].includes(settlementStatus);

  const footerHint = useMemo(() => {
    if (currentStep === 0) {
      return employee
        ? t('offboarding.wizard.footer.selectReady')
        : t('offboarding.wizard.footer.selectRequired');
    }
    if (currentStep === 1) {
      return readOnlySettlement
        ? t('offboarding.wizard.footer.settlementLocked')
        : t('offboarding.wizard.footer.settlementSave');
    }
    if (paymentDone || payDecisionMade) {
      return t('offboarding.wizard.footer.paymentDone');
    }
    return paymentReady
      ? t('offboarding.wizard.footer.paymentReady')
      : t('offboarding.wizard.footer.paymentRequired');
  }, [currentStep, employee, paymentDone, payDecisionMade, paymentReady, readOnlySettlement, t]);

  const validateStep = async (step: number): Promise<boolean> => {
    switch (step) {
      case 0:
        if (!employee) {
          showToast(t('offboarding.wizard.toast.selectFirst'), 'error');
          return false;
        }
        return true;
      case 1:
        if (readOnlySettlement && settlementSaved(settlement)) {
          return true;
        }
        return (await settlementRef.current?.save()) ?? false;
      case 2:
        return paymentRef.current?.canComplete() ?? paymentReady;
      default:
        return true;
    }
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
      const ok = await validateStep(step);
      if (!ok) {
        setCurrentStep(step);
        syncUrl(step);
        return;
      }
      if (step === 1 && employee) {
        await loadEmployee(employee.employee_id);
      }
      step += 1;
      setCurrentStep(step);
      syncUrl(step);
      if (step < index) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = async () => {
    const ok = await validateStep(currentStep);
    if (!ok) {
      if (currentStep === 2) {
        showToast(
          paymentReady
            ? t('offboarding.wizard.footer.paymentReady')
            : t('offboarding.wizard.footer.paymentRequired'),
          'warning'
        );
      }
      return;
    }

    if (currentStep === 1 && employee) {
      await loadEmployee(employee.employee_id);
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleComplete = async () => {
    if (paymentDone) {
      navigate('/employees/offboarding');
      return;
    }
    const ready = await validateStep(2);
    if (!ready) {
      showToast(t('offboarding.wizard.footer.paymentRequired'), 'warning');
      return;
    }
    setActionBusy(true);
    try {
      const ok = await paymentRef.current?.confirm();
      if (ok) {
        navigate('/employees/offboarding');
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleSelectEmployee = (row: EmployeePickRow) => {
    setEmployee(row);
    syncUrl(currentStep, row.employee_id);
    void loadEmployee(row.employee_id);
  };

  const employeeName = employee
    ? resolveEmployeeRecordDisplayName(employee, language)
    : '';

  useWorkspaceTabTitle(employeeName || null);

  const statusBadge = paymentDone
    ? t('offboarding.wizard.badge.complete')
    : settlementSaved(settlement)
      ? t('offboarding.wizard.badge.inProgress')
      : employee
        ? t('offboarding.wizard.badge.selected')
        : t('offboarding.wizard.badge.new');

  const renderStepContent = () => {
    if (employeeLoading && employeeIdParam && currentStep > 0) {
      return (
        <ContentSkeleton layout="form" rows={1} label={t('offboarding.wizard.loadingEmployee')} />
      );
    }

    switch (currentStep) {
        case 0:
          return (
            <StepSelectEmployee
              query={selectQuery}
              onQueryChange={setSelectQuery}
              rows={filteredActive}
              loading={activeLoading}
              selectedId={employee?.employee_id ?? null}
              selectedRow={employee}
              onSelect={handleSelectEmployee}
            />
          );
        case 1:
          if (!employee) {
            return <p className="text-sm text-slate-500">{t('offboarding.wizard.selectFirst')}</p>;
          }
          return (
            <StepSettlement
              ref={settlementRef}
              employee={employee}
              canPayroll={perms.canPayroll}
              onSettlementChange={setSettlement}
            />
          );
        case 2:
          if (!employee) return null;
          return (
            <StepPayment
              ref={paymentRef}
              employeeId={employee.employee_id}
              settlementId={settlement?.id}
              canPayroll={perms.canPayroll}
              onReadyChange={setPaymentReady}
              onPaymentComplete={async () => {
                await loadEmployee(employee.employee_id);
              }}
            />
          );
        default:
          return null;
    }
  };

  const isLastStep = currentStep === wizardSteps.length - 1;

  return (
    <WorkflowWizardShell
      header={
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/employees/offboarding')}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors shrink-0"
              aria-label={t('offboarding.wizard.offboardingList')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('offboarding.wizard.title')}
                </h2>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                    paymentDone
                      ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                      : employee
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {statusBadge}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {employeeName
                  ? `${employee?.employee_id} · ${employeeName}`
                  : t('offboarding.wizard.subtitle')}
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
                {t('offboarding.wizard.back')}
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
                    {t('offboarding.wizard.completing')}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {paymentDone
                      ? t('offboarding.complete.backToList')
                      : t('offboarding.wizard.complete')}
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleNext()}
                disabled={actionBusy}
                className="h-9 w-auto shadow-md shadow-primary-500/20 px-5"
              >
                {currentStep === 1 && !readOnlySettlement
                  ? t('offboarding.wizard.saveAndNext')
                  : t('offboarding.wizard.next')}
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

export default EmployeeOffboardingWizard;
