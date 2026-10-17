import React from 'react';
import { Banknote, CheckCircle2, XCircle } from 'lucide-react';
import {
  PayrollOverlapBanner,
  type PayrollOverlapView,
} from '../payroll/PayrollOverlapBanner';
import type { SettlementCalculationContext } from '../../payroll/settlementCalculationDetail';
import { formatDisplayDate, formatUsd } from '../../offboarding/settlementFormUtils';
import { normalizeSettlementStatus } from '../../offboarding/offboardingWizardSteps';

function parsePaymentDetails(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
}

type Props = {
  settlementNetUsd?: number;
  recommendedPayUsd?: number;
  payrollOverlap?: PayrollOverlapView | null;
  status: string;
  paymentDetailsJson?: unknown;
  lastWorkingDate?: string | null;
  calculation?: SettlementCalculationContext | null;
  /** When true, only settlement net + Option A banner (no pay/close footer). */
  overlapOnly?: boolean;
};

/** Net pay + Option A overlap summary after payment decision (pay or close without pay). */
export const OffboardingSettlementSummary: React.FC<Props> = ({
  settlementNetUsd,
  recommendedPayUsd,
  payrollOverlap,
  status,
  paymentDetailsJson,
  lastWorkingDate,
  calculation,
  overlapOnly = false,
}) => {
  const st = normalizeSettlementStatus(status);
  const paymentDetails = parsePaymentDetails(paymentDetailsJson);
  const showPaySummary = overlapOnly || st === 'PAID' || st === 'LOCKED';

  if (!showPaySummary) return null;

  const displayNet =
    settlementNetUsd != null
      ? settlementNetUsd
      : payrollOverlap?.settlementNetUsd;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-4 space-y-4">
      <div className="flex items-start gap-2">
        <Banknote className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Final pay summary
            </p>
            {displayNet != null ? (
              <p className="text-base text-slate-900 dark:text-white mt-1">
                <span className="font-semibold">Settlement net: </span>
                <span className="text-lg font-semibold tabular-nums">{formatUsd(displayNet)}</span>
              </p>
            ) : null}
            {payrollOverlap?.recommendedPayUsd != null && st === 'PAID' ? (
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                <span className="font-medium">Separate pay amount: </span>
                <span className="font-semibold tabular-nums">
                  {formatUsd(payrollOverlap.recommendedPayUsd)}
                </span>
              </p>
            ) : null}
            {lastWorkingDate ? (
              <p className="text-xs text-slate-500 mt-0.5">
                Calculated through last working day {formatDisplayDate(lastWorkingDate)}
              </p>
            ) : null}
          </div>

          <PayrollOverlapBanner overlap={payrollOverlap ?? null} calculation={calculation} />

          {!overlapOnly && st === 'PAID' && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-900 dark:text-emerald-100">
              <p className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
                Payment recorded (separate from monthly payroll)
              </p>
              {paymentDetails ? (
                <ul className="mt-2 space-y-0.5 text-xs tabular-nums">
                  <li>Amount paid: {formatUsd(paymentDetails.amountUsd)}</li>
                  <li>Method: {String(paymentDetails.method ?? '—')}</li>
                  <li>
                    Date: {formatDisplayDate(String(paymentDetails.paymentDate ?? ''))}
                  </li>
                  {paymentDetails.reference ? (
                    <li>Reference: {String(paymentDetails.reference)}</li>
                  ) : null}
                </ul>
              ) : recommendedPayUsd != null ? (
                <p className="text-xs mt-1">Paid amount: {formatUsd(recommendedPayUsd)}</p>
              ) : null}
            </div>
          )}

          {!overlapOnly && st === 'LOCKED' && (
            <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white/80 dark:bg-slate-800/80 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200">
              <p className="font-semibold flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" aria-hidden />
                Closed without separate payment
              </p>
              <p className="text-xs mt-1 text-slate-600 dark:text-slate-400">
                No final payment was issued. Monthly payroll should not include this employee after
                offboarding.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OffboardingSettlementSummary;
