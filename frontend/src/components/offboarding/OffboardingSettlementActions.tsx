import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { offboardingPaymentUrl } from '../../offboarding/offboardingRoutes';
import { normalizeSettlementStatus } from '../../offboarding/offboardingWizardSteps';
import { isSimplifiedOffboardingSettlement } from '../../offboarding/settlementFormUtils';

type Props = {
  settlementId: string;
  status: string;
  clearanceJson?: unknown;
  breakdown?: unknown;
  breakdownSnapshotJson?: unknown;
  onUpdated: () => void;
};

/**
 * Legacy full-settlement approval actions only.
 * Wizard (simplified) cases use Continue wizard → Pay / No pay — never this chain.
 */
export const OffboardingSettlementActions: React.FC<Props> = ({
  settlementId,
  status,
  clearanceJson,
  breakdown,
  breakdownSnapshotJson,
  onUpdated,
}) => {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const st = normalizeSettlementStatus(status);

  if (
    isSimplifiedOffboardingSettlement({
      clearanceJson,
      breakdown,
      breakdownSnapshotJson,
    })
  ) {
    return null;
  }

  const runTransition = async (action: string) => {
    setBusy(true);
    try {
      const updated = (await Api.payroll.transitionFinalSettlement(settlementId, action, {
        clearance: action === 'submit' ? {} : undefined,
      })) as { payslipWarning?: string };
      if (updated.payslipWarning) {
        showToast(
          `Approved, but payslip could not be generated: ${updated.payslipWarning}`,
          'warning'
        );
      } else {
        showToast('Status updated', 'success');
      }
      onUpdated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (st === 'APPROVED') {
    return (
      <Link
        to={offboardingPaymentUrl({ settlementId })}
        className="inline-flex text-xs font-medium text-primary-600 hover:underline"
      >
        Record separate payment →
      </Link>
    );
  }

  if (['PAID', 'LOCKED', 'REJECTED', 'PENDING_PAYROLL_OFFBOARD'].includes(st)) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {st === 'DRAFT' ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          isLoading={busy}
          onClick={() => void runTransition('submit')}
        >
          Submit for HR review
        </Button>
      ) : null}
      {st === 'HR_REVIEW' ? (
        <Button size="sm" disabled={busy} isLoading={busy} onClick={() => void runTransition('hr_approve')}>
          Approve
        </Button>
      ) : null}
      {st === 'FINANCE_REVIEW' ? (
        <Button
          size="sm"
          disabled={busy}
          isLoading={busy}
          onClick={() => void runTransition('finance_approve')}
        >
          Approve
        </Button>
      ) : null}
      {st === 'MANAGEMENT_APPROVAL' ? (
        <Button
          size="sm"
          disabled={busy}
          isLoading={busy}
          onClick={() => void runTransition('management_approve')}
        >
          Approve
        </Button>
      ) : null}
      {!['APPROVED', 'PAID', 'REJECTED'].includes(st) ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-500"
          disabled={busy}
          onClick={() => void runTransition('reject')}
        >
          Reject
        </Button>
      ) : null}
    </div>
  );
};

export default OffboardingSettlementActions;
