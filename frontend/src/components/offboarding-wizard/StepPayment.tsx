import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Banknote, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../constants/permissionKeys';
import { StatusLabel } from '../ui/StatusLabel';
import {
  normalizeSettlementStatus,
  settlementStatusLabel,
} from '../../offboarding/offboardingWizardSteps';
import {
  formatDisplayDate,
  isSimplifiedOffboardingSettlement,
  SIMPLIFIED_PRE_PAYMENT_STATUSES,
  type SettlementRow,
} from '../../offboarding/settlementFormUtils';
import { useLanguage } from '../../context/LanguageContext';

type Props = {
  employeeId: string;
  settlementId?: string | null;
  canPayroll: boolean;
  onPaymentComplete: () => void;
  onReadyChange?: (ready: boolean) => void;
};

export type StepPaymentHandle = {
  canComplete: () => boolean;
  confirm: () => Promise<boolean>;
};

export const StepPayment = forwardRef<StepPaymentHandle, Props>(function StepPayment(
  { employeeId, settlementId, canPayroll, onPaymentComplete, onReadyChange },
  ref
) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { hasPermission, user } = useAuth();
  const canProcess =
    hasPermission(PERM.PAYROLL_PROCESS) || String(user?.role ?? '').toUpperCase() === 'HR';

  const [loading, setLoading] = useState(true);
  const [settlement, setSettlement] = useState<SettlementRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'PAY' | 'NO_PAY' | null>(null);

  const loadSettlement = useCallback(async () => {
    setLoading(true);
    try {
      if (settlementId) {
        const row = (await Api.payroll.getFinalSettlement(settlementId)) as SettlementRow;
        setSettlement(row);
        return;
      }
      const rows = (await Api.payroll.listFinalSettlements({ employeeId })) as SettlementRow[];
      const list = Array.isArray(rows) ? rows : [];
      const preferred =
        list.find((r) => {
          const st = normalizeSettlementStatus(r.status);
          return (
            isSimplifiedOffboardingSettlement(r) && SIMPLIFIED_PRE_PAYMENT_STATUSES.has(st)
          );
        }) ??
        list.find((r) => normalizeSettlementStatus(r.status) === 'DRAFT') ??
        list[0];
      if (preferred?.id) {
        const full = (await Api.payroll.getFinalSettlement(preferred.id)) as SettlementRow;
        setSettlement(full);
      } else {
        setSettlement(null);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load settlement', 'error');
      setSettlement(null);
    } finally {
      setLoading(false);
    }
  }, [employeeId, settlementId, showToast]);

  useEffect(() => {
    void loadSettlement();
  }, [loadSettlement]);

  const status = normalizeSettlementStatus(settlement?.status);
  const isComplete = ['PAID', 'LOCKED', 'PENDING_PAYROLL_OFFBOARD'].includes(status);
  const simplified = isSimplifiedOffboardingSettlement(settlement);
  const canChoose =
    canProcess &&
    !isComplete &&
    (status === 'DRAFT' || (simplified && SIMPLIFIED_PRE_PAYMENT_STATUSES.has(status)));

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!settlement?.id) return false;
    if (isComplete) return true;
    if (!decision) {
      showToast('Select Pay or No pay first', 'error');
      return false;
    }

    setBusy(true);
    try {
      const updated = (await Api.payroll.completeSimplifiedOffboardingPayment(settlement.id, {
        decision,
      })) as SettlementRow;
      setSettlement(updated);
      showToast(
        decision === 'PAY'
          ? 'Employee stays active until payroll is approved, then becomes inactive automatically.'
          : 'Employee marked inactive immediately.',
        'success'
      );
      onPaymentComplete();
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [settlement?.id, isComplete, decision, showToast, onPaymentComplete]);

  const canComplete = useCallback(() => {
    if (isComplete) return true;
    return Boolean(decision && canChoose);
  }, [isComplete, decision, canChoose]);

  useImperativeHandle(ref, () => ({ canComplete, confirm }), [canComplete, confirm]);

  useEffect(() => {
    onReadyChange?.(canComplete());
  }, [canComplete, onReadyChange]);

  if (!canPayroll) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
        Payroll access is required for the payment step.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        Loading…
      </p>
    );
  }

  if (!settlement) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
        Save the settlement step first.
      </p>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {settlement.employeeId}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              LWD {formatDisplayDate(settlement.lastWorkingDate)}
            </p>
          </div>
          <StatusLabel status={status} context="settlement" label={settlementStatusLabel(t, status)} />
        </div>

        {isComplete && status === 'PENDING_PAYROLL_OFFBOARD' && (
          <div className="text-sm text-emerald-800 dark:text-emerald-200 flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
            Pay selected — employee remains active until the payroll run for this period is approved,
            then status changes to inactive automatically.
          </div>
        )}

        {isComplete && status === 'LOCKED' && (
          <div className="text-sm flex gap-2 text-slate-700 dark:text-slate-300">
            <XCircle className="w-4 h-4 shrink-0" aria-hidden />
            No pay — employee is inactive immediately.
          </div>
        )}

        {isComplete && status === 'PAID' && (
          <div className="text-sm text-emerald-800 dark:text-emerald-200 flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
            Offboarding complete — employee inactive after payroll was processed.
          </div>
        )}

        {canChoose && (
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t('offboarding.payment.question')}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDecision('PAY')}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  decision === 'PAY'
                    ? 'border-primary-500 bg-primary-50/80 dark:bg-primary-950/40 shadow-sm ring-2 ring-primary-100 dark:ring-primary-900/40'
                    : 'border-slate-200 dark:border-slate-700 hover:border-primary-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Banknote className="w-4 h-4 text-primary-600" aria-hidden />
                  <p className="font-semibold text-primary-800 dark:text-primary-200">
                    {t('offboarding.payment.payTitle')}
                  </p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('offboarding.payment.payDescription')}
                </p>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDecision('NO_PAY')}
                className={`rounded-xl border-2 p-4 text-left transition-all ${
                  decision === 'NO_PAY'
                    ? 'border-slate-500 bg-slate-100/80 dark:bg-slate-800/60 shadow-sm ring-2 ring-slate-200 dark:ring-slate-700'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-slate-500" aria-hidden />
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {t('offboarding.payment.noPayTitle')}
                  </p>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('offboarding.payment.noPayDescription')}
                </p>
              </button>
            </div>
          </div>
        )}

        {!canProcess && !isComplete && (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            You need payroll process permission to confirm payment.
          </p>
        )}

        {canProcess && !isComplete && !canChoose && (
          <p className="text-sm text-amber-800 dark:text-amber-200">
            This settlement is not ready for Pay / No pay. Go back to the settlement step and save
            again, or open Continue wizard from the offboarding list.
          </p>
        )}
      </div>
    </div>
  );
});

export default StepPayment;
