import type { SeniorityPaymentFrequency } from './seniorityTypes.js';
import { roundUsd } from './seniorityAccrualEngine.js';

/** Determine payout for this payroll event from accrual + frequency + balance. */
export function computeSeniorityPayoutForCycle(params: {
  paymentFrequency: SeniorityPaymentFrequency;
  proratedAccrualUsd: number;
  ledgerBalanceUsd: number;
  payrollRunType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
  monthIndex?: number;
}): { payoutUsd: number; accrueOnly: boolean; payLedgerBalance: boolean } {
  const accrual = roundUsd(params.proratedAccrualUsd);
  const balance = roundUsd(params.ledgerBalanceUsd);
  const isFinal = params.payrollRunType === 'FINAL_SETTLEMENT';

  if (isFinal || params.paymentFrequency === 'final_settlement_only') {
    return {
      payoutUsd: roundUsd(balance + accrual),
      accrueOnly: false,
      payLedgerBalance: true,
    };
  }

  if (params.paymentFrequency === 'deferred') {
    return { payoutUsd: 0, accrueOnly: true, payLedgerBalance: false };
  }

  const m = params.monthIndex ?? new Date().getMonth();

  if (params.paymentFrequency === 'monthly') {
    return { payoutUsd: accrual, accrueOnly: false, payLedgerBalance: false };
  }

  if (params.paymentFrequency === 'quarterly') {
    const payMonth = m === 2 || m === 5 || m === 8 || m === 11;
    return {
      payoutUsd: payMonth ? roundUsd(balance + accrual) : 0,
      accrueOnly: !payMonth,
      payLedgerBalance: payMonth,
    };
  }

  if (params.paymentFrequency === 'semiannual') {
    const payMonth = m === 5 || m === 11;
    return {
      payoutUsd: payMonth ? roundUsd(balance + accrual) : 0,
      accrueOnly: !payMonth,
      payLedgerBalance: payMonth,
    };
  }

  if (params.paymentFrequency === 'yearly') {
    const payMonth = m === 11;
    return {
      payoutUsd: payMonth ? roundUsd(balance + accrual) : 0,
      accrueOnly: !payMonth,
      payLedgerBalance: payMonth,
    };
  }

  return { payoutUsd: accrual, accrueOnly: false, payLedgerBalance: false };
}
