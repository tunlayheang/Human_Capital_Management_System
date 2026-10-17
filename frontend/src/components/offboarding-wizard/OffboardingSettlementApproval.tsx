import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/Button';
import { StatusLabel } from '../ui/StatusLabel';
import {
  normalizeSettlementStatus,
  settlementStatusLabel,
} from '../../offboarding/offboardingWizardSteps';
import { type SettlementRow } from '../../offboarding/settlementFormUtils';

type Props = {
  settlement: SettlementRow;
  canProcess: boolean;
  onUpdated: (row: SettlementRow) => void;
};

export const OffboardingSettlementApproval: React.FC<Props> = ({
  settlement,
  canProcess,
  onUpdated,
}) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const status = normalizeSettlementStatus(settlement.status);
  const inReview = ['HR_REVIEW', 'FINANCE_REVIEW', 'MANAGEMENT_APPROVAL'].includes(status);
  const managementSigned = Boolean(
    settlement.managementApprovedBy ?? (settlement as { management_approved_by?: string }).management_approved_by
  );
  const showSubmit = status === 'PAID' && !managementSigned;
  const complianceDone = status === 'APPROVED' || (status === 'PAID' && managementSigned);
  const needsPayslipRetry =
    complianceDone && !settlement.payslipId && status === 'PAID';
  const showApprovalPanel = status === 'PAID' || inReview || complianceDone;

  const handleTransition = async (action: string) => {
    setBusy(true);
    try {
      const updated = (await Api.payroll.transitionFinalSettlement(settlement.id, action, {
        clearance: action === 'submit' ? {} : undefined,
      })) as SettlementRow & { payslipWarning?: string };
      onUpdated(updated);
      if (updated.payslipWarning) {
        showToast(
          `Approved, but payslip could not be generated: ${updated.payslipWarning}. Use Generate payslip to retry.`,
          'warning'
        );
      } else {
        showToast('Status updated', 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
      if (action === 'management_approve') {
        try {
          const fresh = (await Api.payroll.getFinalSettlement(settlement.id)) as SettlementRow;
          onUpdated(fresh);
        } catch {
          /* keep current settlement in UI */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (!showApprovalPanel) {
    return null;
  }

  if (complianceDone && !needsPayslipRetry) {
    return (
      <p className="text-sm text-emerald-800 dark:text-emerald-200 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2">
        Settlement approved — compliance sign-off complete
        {status === 'PAID' ? ' (payment already recorded).' : '.'}
      </p>
    );
  }

  if (needsPayslipRetry) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-amber-900 dark:text-amber-100 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
          Compliance is signed off but the final payslip was not generated. Click below to retry.
        </p>
        <Button size="sm" isLoading={busy} onClick={() => void handleTransition('management_approve')}>
          Generate payslip
        </Button>
      </div>
    );
  }

  if (!canProcess) {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
        You need payroll process permission to submit or approve settlements.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/20 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          Settlement approval
        </p>
        <StatusLabel status={status} context="settlement" label={settlementStatusLabel(t, status)} size="sm" />
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Offboarding steps are done. Submit for HR → Finance → Management review to sign off the
        final settlement {status === 'PAID' ? '(payment already recorded)' : ''}.
      </p>

      {showSubmit && (
        <Button size="sm" isLoading={busy} onClick={() => void handleTransition('submit')}>
          Submit for HR review
        </Button>
      )}

      <div className="flex flex-wrap gap-2">
        {status === 'HR_REVIEW' && (
          <Button size="sm" isLoading={busy} onClick={() => void handleTransition('hr_approve')}>
            Approve
          </Button>
        )}
        {status === 'FINANCE_REVIEW' && (
          <Button size="sm" isLoading={busy} onClick={() => void handleTransition('finance_approve')}>
            Approve
          </Button>
        )}
        {status === 'MANAGEMENT_APPROVAL' && (
          <Button size="sm" isLoading={busy} onClick={() => void handleTransition('management_approve')}>
            Approve
          </Button>
        )}
        {inReview && (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void handleTransition('reject')}>
            Reject
          </Button>
        )}
      </div>

      {busy && (
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
          Updating…
        </p>
      )}
    </div>
  );
};

export default OffboardingSettlementApproval;
