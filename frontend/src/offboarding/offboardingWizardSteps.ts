import type { WizardStep } from '../components/EmployeeWizardStepper';
import { Banknote, User, Wallet } from 'lucide-react';

const SETTLEMENT_STATUS_KEYS = [
  'DRAFT',
  'PENDING_PAYROLL_OFFBOARD',
  'HR_REVIEW',
  'FINANCE_REVIEW',
  'MANAGEMENT_APPROVAL',
  'APPROVED',
  'PENDING_REMOVAL_APPROVAL',
  'PAID',
  'LOCKED',
  'REJECTED',
] as const;

/** Wizard step index: select employee = 0, settlement = 1, payment = 2 */
export const OFFBOARDING_SETTLEMENT_STEP = 1;

export function getOffboardingWizardSteps(t: (path: string) => string): WizardStep[] {
  return [
    {
      id: 'select',
      label: t('offboarding.wizard.steps.select.label'),
      description: t('offboarding.wizard.steps.select.description'),
      icon: User,
    },
    {
      id: 'settlement',
      label: t('offboarding.wizard.steps.settlement.label'),
      description: t('offboarding.wizard.steps.settlement.description'),
      icon: Banknote,
    },
    {
      id: 'payment',
      label: t('offboarding.wizard.steps.payment.label'),
      description: t('offboarding.wizard.steps.payment.description'),
      icon: Wallet,
    },
  ];
}

export function settlementStatusLabel(t: (path: string) => string, status: unknown): string {
  const key = normalizeSettlementStatus(status);
  if ((SETTLEMENT_STATUS_KEYS as readonly string[]).includes(key)) {
    return t(`offboarding.settlement.status.${key}`);
  }
  return key || '—';
}

export type SettlementSummary = {
  id: string;
  employeeId: string;
  status: string;
  netUsd?: number;
  recommendedPayUsd?: number;
};

export function normalizeSettlementStatus(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

export function isOffboardedStatus(status?: string): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'terminated' || s === 'resigned';
}

export function settlementSaved(
  settlement?: { id?: string; status?: string } | null
): boolean {
  if (!settlement?.id) return false;
  const st = normalizeSettlementStatus(settlement.status);
  return st !== 'REJECTED';
}

/** Payment step done: no-pay (inactive) or paid after payroll run — not while awaiting payroll. */
export function paymentStepComplete(settlementStatus: string): boolean {
  const st = normalizeSettlementStatus(settlementStatus);
  return st === 'PAID' || st === 'LOCKED';
}

/** Pay or no-pay was chosen (pay path may still await payroll run). */
export function paymentDecisionMade(settlementStatus: string): boolean {
  const st = normalizeSettlementStatus(settlementStatus);
  return st === 'PAID' || st === 'LOCKED' || st === 'PENDING_PAYROLL_OFFBOARD';
}

/** Hub list: workflow finished (employee inactive). */
export function isOffboardingCaseClosed(settlementStatus: string): boolean {
  return paymentStepComplete(settlementStatus);
}

export function maxReachableStepIndex(params: {
  hasEmployee: boolean;
  settlementStatus: string;
  settlement?: { id?: string; status?: string } | null;
}): number {
  if (!params.hasEmployee) return 0;
  if (!settlementSaved(params.settlement)) return 1;
  if (!paymentStepComplete(params.settlementStatus)) return 2;
  return 2;
}

export function suggestedStepIndex(params: {
  hasEmployee: boolean;
  settlementStatus: string;
  settlement?: { id?: string; status?: string } | null;
}): number {
  return maxReachableStepIndex(params);
}

export function suggestedWizardStepIndex(params: {
  settlementStatus: string;
  settlement?: { id?: string; status?: string } | null;
}): number {
  return suggestedStepIndex({
    hasEmployee: true,
    settlementStatus: params.settlementStatus,
    settlement: params.settlement,
  });
}

export function pickLatestSettlement(rows: SettlementSummary[]): SettlementSummary | undefined {
  if (!rows.length) return undefined;
  const nonRejected = rows.filter((r) => normalizeSettlementStatus(r.status) !== 'REJECTED');
  const list = nonRejected.length ? nonRejected : rows;
  return list[0];
}
