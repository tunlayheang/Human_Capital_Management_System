import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../constants/permissionKeys';
import { LoadingState } from '../../components/common/LoadingState';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatusLabel } from '../../components/ui/StatusLabel';
import { inputClass } from '../../constants/designSystem';
import { todayYmdInCompanyTz } from '../../utils/companyCalendar';
import {
  PayrollOverlapBanner,
  type PayrollOverlapView,
} from '../../components/payroll/PayrollOverlapBanner';
import { SettlementCalculationDetail } from '../../components/payroll/SettlementCalculationDetail';
import { SettlementEngineNotice } from '../../components/offboarding-wizard/SettlementEngineNotice';
import { settlementCalculationFromRow } from '../../offboarding/settlementFormUtils';
import { formatDisplayDate } from '../../utils/formatDisplayDate';
import {
  OFFBOARDING_HUB_PATH,
  offboardingHubUrl,
} from '../../offboarding/offboardingRoutes';
import { useWorkspaceTabTitle } from '../../hooks/useWorkspaceTabTitle';
import { DatePickerInput } from '@/components/ui/shadcn/date-picker-input';

type SettlementRow = Record<string, unknown> & {
  id: string;
  employeeId: string;
  employeeName?: string;
  status?: string;
  netUsd?: number;
  lastWorkingDate?: string;
  paymentDecision?: string;
  paymentDetailsJson?: string;
  payrollOverlap?: PayrollOverlapView;
  payrollOverlapJson?: string;
  recommendedPayUsd?: number;
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Approved — payment pending',
  PAYMENT_PROCESSING: 'Payment processing',
  PENDING_REMOVAL_APPROVAL: 'Awaiting final removal approval',
  PAID: 'Paid',
  LOCKED: 'Closed (no payment)',
};

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

function normalizeStatus(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function formatUsd(n: unknown): string {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parsePaymentDetails(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

export const FinalSettlementPayment: React.FC = () => {
  const { showToast } = useToast();
  const { hasPermission, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const settlementIdParam = searchParams.get('settlementId')?.trim() ?? '';
  const employeeIdParam = searchParams.get('employeeId')?.trim() ?? '';

  const canProcess =
    hasPermission(PERM.PAYROLL_PROCESS) ||
    String(user?.role ?? '').toUpperCase() === 'HR';

  const [loading, setLoading] = useState(true);
  const [settlement, setSettlement] = useState<SettlementRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [decision, setDecision] = useState<'pay' | 'skip' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentDate, setPaymentDate] = useState(() => todayYmdInCompanyTz());
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [acknowledgeVariance, setAcknowledgeVariance] = useState(false);

  const applySettlementRow = (row: SettlementRow) => {
    setSettlement(row);
    const overlap = (row.payrollOverlap ?? null) as PayrollOverlapView | null;
    const recommended =
      overlap?.recommendedPayUsd ??
      Number(row.recommendedPayUsd ?? row.netUsd ?? 0);
    setPaymentAmount(String(recommended));
    setAcknowledgeVariance(false);
  };

  const loadSettlement = useCallback(async () => {
    setLoading(true);
    try {
      if (settlementIdParam) {
        const row = (await Api.payroll.getFinalSettlement(settlementIdParam)) as SettlementRow;
        applySettlementRow(row);
        return;
      }
      if (employeeIdParam) {
        const rows = (await Api.payroll.listFinalSettlements({ employeeId: employeeIdParam })) as SettlementRow[];
        const list = Array.isArray(rows) ? rows : [];
        const preferred =
          list.find((r) => normalizeStatus(r.status) === 'APPROVED') ??
          list.find((r) => normalizeStatus(r.status) === 'PENDING_REMOVAL_APPROVAL') ??
          list.find((r) => ['PAID', 'LOCKED'].includes(normalizeStatus(r.status))) ??
          list[0];
        if (preferred) {
          const full = (await Api.payroll.getFinalSettlement(preferred.id)) as SettlementRow;
          applySettlementRow(full);
        } else {
          setSettlement(null);
        }
        return;
      }
      setSettlement(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load settlement', 'error');
      setSettlement(null);
    } finally {
      setLoading(false);
    }
  }, [employeeIdParam, settlementIdParam, showToast]);

  useEffect(() => {
    void loadSettlement();
  }, [loadSettlement]);

  const settlementTabTitle = settlement?.employeeName?.trim() || null;
  useWorkspaceTabTitle(settlementTabTitle);

  const status = normalizeStatus(settlement?.status);
  const paymentDetails = useMemo(
    () => parsePaymentDetails(settlement?.paymentDetailsJson),
    [settlement?.paymentDetailsJson]
  );
  const payrollOverlap = (settlement?.payrollOverlap ?? null) as PayrollOverlapView | null;
  const paymentCalculation = useMemo(
    () => settlementCalculationFromRow(settlement),
    [settlement]
  );
  const payBlocked = Boolean(payrollOverlap?.blocksSeparatePayment);

  const showDecisionStep =
    status === 'APPROVED' && canProcess && decision === null;
  const showPayForm = status === 'APPROVED' && canProcess && decision === 'pay';
  const showSkipForm = status === 'APPROVED' && canProcess && decision === 'skip';
  const showRemovalApproval = status === 'PENDING_REMOVAL_APPROVAL' && canProcess;
  const isTerminal = status === 'PAID' || status === 'LOCKED';

  const handleRecordPayment = async () => {
    if (!settlement) return;
    const amountUsd = parseFloat(paymentAmount);
    if (!paymentMethod || !paymentDate) {
      showToast('Payment method and date are required', 'error');
      return;
    }
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      showToast('Enter a valid payment amount', 'error');
      return;
    }
    setBusy(true);
    try {
      const updated = (await Api.payroll.transitionFinalSettlement(settlement.id, 'record_payment', {
        payment: {
          method: paymentMethod,
          paymentDate,
          reference: paymentReference.trim() || undefined,
          amountUsd,
          notes: paymentNotes.trim() || undefined,
        },
        acknowledgePaymentVariance: acknowledgeVariance,
      })) as SettlementRow;
      applySettlementRow(updated);
      setDecision(null);
      showToast('Payment recorded — settlement marked paid', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Payment failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSkipPayment = async () => {
    if (!settlement) return;
    const reason = skipReason.trim();
    if (!reason) {
      showToast('Please enter a reason before submitting.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const updated = (await Api.payroll.transitionFinalSettlement(settlement.id, 'skip_payment', {
        reason,
      })) as SettlementRow;
      setSettlement(updated);
      setDecision(null);
      showToast('Sent for final removal approval (no payment)', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveRemoval = async () => {
    if (!settlement) return;
    setBusy(true);
    try {
      const updated = (await Api.payroll.transitionFinalSettlement(
        settlement.id,
        'approve_final_removal'
      )) as SettlementRow;
      setSettlement(updated);
      showToast('Final removal approved — employee offboarding is closed', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Approval failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 mt-0.5"
          onClick={() =>
            navigate(
              employeeIdParam
                ? offboardingHubUrl({ employeeId: employeeIdParam })
                : OFFBOARDING_HUB_PATH
            )
          }
          icon={<ArrowLeft className="w-4 h-4" />}
        >
          Back
        </Button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Banknote className="w-5 h-5 text-primary-600" aria-hidden />
            Separate payment (final pay)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Option A: pay the leaver separately from the monthly payroll batch — use the recommended amount
            when monthly pay already covered part of the month.
          </p>
          <SettlementEngineNotice className="mt-3" />
        </div>
      </div>

      {loading ? (
        <LoadingState variant="panel" layout="form" label="Loading settlement…" />
      ) : !settlement ? (
        <Card className="p-6 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {employeeIdParam
              ? `No final pay record for ${employeeIdParam}. Calculate and approve in the offboarding wizard first.`
              : 'Open from Employees → Offboarding, or pass settlementId in the URL.'}
          </p>
          <Link
            to={
              employeeIdParam
                ? offboardingHubUrl({ view: 'final-pay', employeeId: employeeIdParam })
                : offboardingHubUrl({ view: 'final-pay' })
            }
            className="text-sm text-primary-600 hover:underline font-medium"
          >
            Go to offboarding — final pay
          </Link>
        </Card>
      ) : (
        <Card className="p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Employee</p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {settlement.employeeId}
                {settlement.employeeName ? ` · ${settlement.employeeName}` : ''}
              </p>
              <p className="text-sm text-slate-500 mt-0.5">
                Last day {formatDisplayDate(settlement.lastWorkingDate)} · Net {formatUsd(settlement.netUsd)}
              </p>
            </div>
            <StatusLabel
              status={status}
              context="settlement"
              label={STATUS_LABEL[status] ?? status}
            />
          </div>

          {payrollOverlap?.recommendedPayUsd != null && status === 'APPROVED' && canProcess ? (
            <div className="rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-950/30 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-800 dark:text-primary-200">
                Recommended separate payment
              </p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                {formatUsd(payrollOverlap.recommendedPayUsd)}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Settlement net {formatUsd(settlement.netUsd)}
                {payrollOverlap.alreadyPaidViaMonthlyUsd != null &&
                payrollOverlap.alreadyPaidViaMonthlyUsd > 0
                  ? ` · Already paid via monthly ${formatUsd(payrollOverlap.alreadyPaidViaMonthlyUsd)}`
                  : ''}
              </p>
            </div>
          ) : null}

          <PayrollOverlapBanner overlap={payrollOverlap} calculation={paymentCalculation} />
          {paymentCalculation ? (
            <SettlementCalculationDetail calculation={paymentCalculation} />
          ) : null}

          {!canProcess && !isTerminal && (
            <p className="text-sm text-amber-800 dark:text-amber-200 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
              You need payroll process permission to record payment or approve final removal.
            </p>
          )}

          {status !== 'APPROVED' && status !== 'PENDING_REMOVAL_APPROVAL' && !isTerminal && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Payment is only available after management approves the settlement (status Approved).
              Current status: {STATUS_LABEL[status] ?? status}.
            </p>
          )}

          {showDecisionStep && (
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                Will you pay the final settlement amount?
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDecision('pay')}
                  disabled={payBlocked}
                  className="rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-950/30 p-4 text-left hover:border-primary-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="font-semibold text-primary-800 dark:text-primary-200">Pay</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Record payment details and mark settlement as paid.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setDecision('skip')}
                  className="rounded-xl border-2 border-slate-200 dark:border-slate-700 p-4 text-left hover:border-slate-400 transition-colors"
                >
                  <p className="font-semibold text-slate-900 dark:text-white">Do not pay</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Request approval to finally remove the employee without payment.
                  </p>
                </button>
              </div>
            </div>
          )}

          {showPayForm && (
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Payment details</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-400">Method *</span>
                  <select
                    className={`${inputClass} mt-1 w-full`}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Payment date *</span>
                  <DatePickerInput className={`${inputClass} mt-1 w-full`}
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600 dark:text-slate-400">Amount (USD) *</span>
                  <div className="flex gap-2 mt-1">
                    <input
                      className={`${inputClass} flex-1`}
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                    />
                    {payrollOverlap && payrollOverlap.recommendedPayUsd != null ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          setPaymentAmount(String(payrollOverlap.recommendedPayUsd ?? ''))
                        }
                      >
                        Use recommended
                      </Button>
                    ) : null}
                  </div>
                </label>
                {payrollOverlap?.requiresPaymentAcknowledgment ||
                (payrollOverlap?.recommendedPayUsd === 0 && parseFloat(paymentAmount) > 0) ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acknowledgeVariance}
                      onChange={(e) => setAcknowledgeVariance(e.target.checked)}
                    />
                    <span className="text-slate-600 dark:text-slate-400">
                      I confirm this payment amount (may differ from the recommended separate-pay
                      balance after monthly payroll).
                    </span>
                  </label>
                ) : null}
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-400">Reference / transaction ID</span>
                  <input
                    className={`${inputClass} mt-1 w-full`}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-400">Notes</span>
                  <textarea
                    className={`${inputClass} mt-1 w-full min-h-[56px]`}
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDecision(null)}>
                  Back
                </Button>
                <Button size="sm" isLoading={busy} onClick={() => void handleRecordPayment()}>
                  Confirm payment
                </Button>
              </div>
            </div>
          )}

          {showSkipForm && (
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
              <div className="flex gap-2 text-amber-800 dark:text-amber-200">
                <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden />
                <p className="text-sm">
                  No payment will be issued. The next step requires an approver to confirm final removal of
                  the employee from offboarding (restore will be blocked after approval).
                </p>
              </div>
              <label className="block text-sm">
                <span className="text-slate-600 dark:text-slate-400">
                  Reason <span className="text-red-500">*</span>
                </span>
                <textarea
                  className={`${inputClass} mt-1 w-full min-h-[56px]`}
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="Why is final payment not being made? (required)"
                  required
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDecision(null)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  isLoading={busy}
                  disabled={!skipReason.trim()}
                  onClick={() => void handleSkipPayment()}
                >
                  Submit for removal approval
                </Button>
              </div>
            </div>
          )}

          {showRemovalApproval && (
            <div className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-4">
              <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" aria-hidden />
                Require approval for finally remove employee
              </p>
              {paymentDetails?.reason ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="text-slate-400">Reason: </span>
                  {String(paymentDetails.reason)}
                </p>
              ) : null}
              <Button size="sm" isLoading={busy} onClick={() => void handleApproveRemoval()}>
                Approve
              </Button>
            </div>
          )}

          {status === 'PAID' && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-2">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                Payment recorded
              </p>
              {paymentDetails ? (
                <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                  <li>Method: {String(paymentDetails.method ?? '—')}</li>
                  <li>Date: {formatDisplayDate(String(paymentDetails.paymentDate ?? ''))}</li>
                  <li>Amount: {formatUsd(paymentDetails.amountUsd)}</li>
                  {paymentDetails.reference ? <li>Reference: {String(paymentDetails.reference)}</li> : null}
                </ul>
              ) : null}
            </div>
          )}

          {status === 'LOCKED' && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <XCircle className="w-4 h-4" aria-hidden />
                Offboarding closed without payment — employee cannot be restored without admin intervention.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default FinalSettlementPayment;
