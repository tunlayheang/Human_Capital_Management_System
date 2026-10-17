import { Op } from 'sequelize';
import { Employee, Payslip, PayrollRun } from '../db.js';
import { findEmployeePkByUserId } from '../employeeIdentity.js';
import { loadBreakdownForPayslipId } from '../payslipBreakdownService.js';
import { isPayrollRunLocked } from './payrollWorkflowService.js';
import { FinalSettlementRun } from './finalSettlementSchema.js';

/** Option A — final pay is calculated and disbursed on its own, not via the monthly batch. */
export const FINAL_PAY_DISBURSEMENT_MODE = 'SEPARATE_IMMEDIATE' as const;

export type PayrollOverlapScenario =
  | 'NO_MONTHLY_RUN'
  | 'EXCLUDED_FROM_MONTHLY'
  | 'MONTHLY_DRAFT_INCLUDES_EMPLOYEE'
  | 'MONTHLY_IN_FLIGHT'
  | 'MONTHLY_PAID_DELTA_DUE'
  | 'MONTHLY_PAID_FULLY_COVERED'
  | 'MONTHLY_OVERPAID_VS_SETTLEMENT'
  | 'SETTLEMENT_ALREADY_PAID';

export type PayrollOverlapAssessment = {
  disbursementMode: typeof FINAL_PAY_DISBURSEMENT_MODE;
  scenario: PayrollOverlapScenario;
  severity: 'info' | 'warning' | 'error';
  monthlyRunId: string | null;
  monthlyRunStatus: string | null;
  monthlyPayslipId: string | null;
  monthlyNetUsd: number | null;
  settlementNetUsd: number;
  /** Amount to pay via Offboarding → Payment (Option A). */
  recommendedPayUsd: number;
  alreadyPaidViaMonthlyUsd: number;
  deltaUsd: number;
  messages: string[];
  actions: string[];
  blocksSeparatePayment: boolean;
  requiresPaymentAcknowledgment: boolean;
};

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function assessFinalSettlementPayrollOverlap(params: {
  userId: string;
  employeeDisplayId: string;
  month: string;
  lastWorkingDate: string;
  settlementNetUsd: number;
  settlementId?: string;
  settlementStatus?: string;
}): Promise<PayrollOverlapAssessment> {
  const settlementNetUsd = roundUsd(Math.max(0, Number(params.settlementNetUsd) || 0));
  const month = params.month.slice(0, 7);
  const base = {
    disbursementMode: FINAL_PAY_DISBURSEMENT_MODE,
    monthlyRunId: null as string | null,
    monthlyRunStatus: null as string | null,
    monthlyPayslipId: null as string | null,
    monthlyNetUsd: null as number | null,
    settlementNetUsd,
    recommendedPayUsd: settlementNetUsd,
    alreadyPaidViaMonthlyUsd: 0,
    deltaUsd: settlementNetUsd,
  };

  const st = String(params.settlementStatus ?? '').toUpperCase();
  if (st === 'PAID' || st === 'LOCKED') {
    return {
      ...base,
      scenario: 'SETTLEMENT_ALREADY_PAID',
      severity: 'info',
      recommendedPayUsd: 0,
      deltaUsd: 0,
      messages: ['Final settlement is already closed for this employee.'],
      actions: [],
      blocksSeparatePayment: true,
      requiresPaymentAcknowledgment: false,
    };
  }

  const monthlyRun = await PayrollRun.findOne({
    where: {
      month,
      status: { [Op.notIn]: ['REJECTED', 'REVERSED', 'CANCELLED'] },
    },
    order: [['createdAt', 'DESC']],
  });

  if (!monthlyRun) {
    return {
      ...base,
      scenario: 'NO_MONTHLY_RUN',
      severity: 'info',
      messages: [
        `No monthly payroll run exists for ${month}. Pay the full approved net via Final settlement → Payment (separate from monthly payroll).`,
      ],
      actions: ['Record payment on the Payment step after settlement approval.'],
      blocksSeparatePayment: false,
      requiresPaymentAcknowledgment: false,
    };
  }

  const monthlyRunId = String(monthlyRun.get('id'));
  const monthlyRunStatus = String(monthlyRun.get('status') ?? 'DRAFT').toUpperCase();
  const payslip = await Payslip.findOne({
    where: { payrollRunId: monthlyRunId, userId: params.userId },
  });

  if (!payslip) {
    return {
      ...base,
      scenario: 'EXCLUDED_FROM_MONTHLY',
      severity: 'info',
      monthlyRunId,
      monthlyRunStatus,
      messages: [
        `Employee is not on the ${month} monthly payroll run (expected after offboarding). Pay ${settlementNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} via separate final payment.`,
      ],
      actions: [
        'Do not add this employee back to the monthly run.',
        'Use Offboarding → Payment after settlement is approved.',
      ],
      blocksSeparatePayment: false,
      requiresPaymentAcknowledgment: false,
    };
  }

  const monthlyPayslipId = String(payslip.get('id'));
  const breakdown = await loadBreakdownForPayslipId(monthlyPayslipId);
  const monthlyNetUsd = roundUsd(Number(breakdown?.netSalary ?? 0));
  const alreadyPaidViaMonthlyUsd =
    monthlyRunStatus === 'PAID' || monthlyRunStatus === 'PAYMENT_PROCESSING' ? monthlyNetUsd : 0;
  const deltaUsd = roundUsd(settlementNetUsd - monthlyNetUsd);
  const recommendedPayUsd = roundUsd(Math.max(0, deltaUsd));

  const runLocked = isPayrollRunLocked(monthlyRunStatus);
  const monthlyPaid = monthlyRunStatus === 'PAID' || monthlyRunStatus === 'PAYMENT_PROCESSING';

  if (!runLocked && !monthlyPaid) {
    return {
      ...base,
      scenario: monthlyRunStatus === 'DRAFT' ? 'MONTHLY_DRAFT_INCLUDES_EMPLOYEE' : 'MONTHLY_IN_FLIGHT',
      severity: 'error',
      monthlyRunId,
      monthlyRunStatus,
      monthlyPayslipId,
      monthlyNetUsd,
      recommendedPayUsd: settlementNetUsd,
      alreadyPaidViaMonthlyUsd: 0,
      deltaUsd: settlementNetUsd,
      messages: [
        `This employee still appears on the ${month} monthly payroll run (${monthlyRunStatus}, est. net ${monthlyNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}).`,
        'Option A: remove them from the monthly run (or reverse the draft) before paying final settlement separately.',
      ],
      actions: [
        'Open Payroll → monthly run and exclude this employee, then refresh final settlement.',
        'Pay only through Final settlement → Payment — never both monthly and final settlement for the same period.',
      ],
      blocksSeparatePayment: true,
      requiresPaymentAcknowledgment: false,
    };
  }

  if (deltaUsd <= 0) {
    return {
      ...base,
      scenario: monthlyNetUsd > settlementNetUsd ? 'MONTHLY_OVERPAID_VS_SETTLEMENT' : 'MONTHLY_PAID_FULLY_COVERED',
      severity: monthlyNetUsd > settlementNetUsd ? 'warning' : 'info',
      monthlyRunId,
      monthlyRunStatus,
      monthlyPayslipId,
      monthlyNetUsd,
      recommendedPayUsd: 0,
      alreadyPaidViaMonthlyUsd: monthlyPaid ? monthlyNetUsd : 0,
      deltaUsd,
      messages:
        monthlyNetUsd > settlementNetUsd
          ? [
              `Monthly payroll net (${monthlyNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}) exceeds final settlement (${settlementNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}).`,
              'Review for overpayment — a payroll correction or recovery may be required instead of an additional final payment.',
            ]
          : [
              monthlyPaid
                ? `Monthly payroll already paid ${monthlyNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} for ${month}, which covers or exceeds the final settlement net.`
                : `Monthly payroll (${monthlyRunStatus}) net matches or exceeds final settlement — no separate payment required.`,
            ],
      actions:
        monthlyNetUsd > settlementNetUsd
          ? ['Consult finance before recording any payment.', 'Consider skip payment → final removal approval if no pay is due.']
          : ['Use Payment → Do not pay if nothing further is owed.', 'Mark settlement complete via skip-payment path if appropriate.'],
      blocksSeparatePayment: monthlyNetUsd > settlementNetUsd,
      requiresPaymentAcknowledgment: false,
    };
  }

  return {
    ...base,
    scenario: 'MONTHLY_PAID_DELTA_DUE',
    severity: 'warning',
    monthlyRunId,
    monthlyRunStatus,
    monthlyPayslipId,
    monthlyNetUsd,
    recommendedPayUsd,
    alreadyPaidViaMonthlyUsd: monthlyPaid ? monthlyNetUsd : 0,
    deltaUsd,
    messages: [
      monthlyPaid
        ? `Monthly payroll paid ${monthlyNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} for ${month}.`
        : `Monthly payroll (${monthlyRunStatus}) shows ${monthlyNetUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} for ${month}.`,
      `Pay only the remaining ${recommendedPayUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} via separate final payment (Option A).`,
    ],
    actions: [
      'Enter the recommended amount on the Payment step unless finance approves a different figure.',
      'Do not pay the full settlement net again if monthly already paid part of the month.',
    ],
    blocksSeparatePayment: false,
    requiresPaymentAcknowledgment: true,
  };
}

export async function persistSettlementPayrollOverlap(
  settlementId: string,
  assessment: PayrollOverlapAssessment
): Promise<void> {
  const row = await FinalSettlementRun.findByPk(settlementId);
  if (!row) return;
  await row.update({
    payrollOverlapJson: JSON.stringify(assessment),
    recommendedPayUsd: assessment.recommendedPayUsd,
    disbursementMode: assessment.disbursementMode,
    linkedMonthlyRunId: assessment.monthlyRunId ?? row.get('linkedMonthlyRunId'),
  });
}

export function parsePayrollOverlap(raw: unknown): PayrollOverlapAssessment | null {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    return o as PayrollOverlapAssessment;
  } catch {
    return null;
  }
}

/** Block monthly run payment when leavers have approved final settlement pending separate pay. */
export async function findMonthlyPayConflictsForRun(runId: string): Promise<
  Array<{ employeeId: string; settlementId: string; status: string; netUsd: number }>
> {
  const run = await PayrollRun.findByPk(runId);
  if (!run) return [];
  const month = String(run.get('month') ?? '').slice(0, 7);
  const payslips = await Payslip.findAll({ where: { payrollRunId: runId } });
  const conflicts: Array<{ employeeId: string; settlementId: string; status: string; netUsd: number }> =
    [];

  for (const ps of payslips) {
    const userId = String(ps.get('userId') ?? '');
    const employeePk = userId ? await findEmployeePkByUserId(userId) : null;
    const emp = employeePk ? await Employee.findByPk(employeePk) : null;
    const displayId = String(emp?.get('employee_id') ?? '');
    if (!displayId || !employeePk) continue;

    const settlement = await FinalSettlementRun.findOne({
      where: {
        employee_id: employeePk,
        month,
        status: { [Op.in]: ['APPROVED', 'PENDING_REMOVAL_APPROVAL'] },
      },
    });
    if (settlement) {
      conflicts.push({
        employeeId: displayId,
        settlementId: String(settlement.get('id')),
        status: String(settlement.get('status')),
        netUsd: Number(settlement.get('netUsd') ?? 0),
      });
    }
  }
  return conflicts;
}

export function validateSeparatePaymentAmount(params: {
  overlap: PayrollOverlapAssessment | null;
  amountUsd: number;
  acknowledgeVariance?: boolean;
}): { ok: true } | { ok: false; message: string } {
  const { overlap, amountUsd, acknowledgeVariance } = params;
  if (!overlap) return { ok: true };
  if (overlap.blocksSeparatePayment) {
    return {
      ok: false,
      message: overlap.messages[0] ?? 'Resolve monthly payroll overlap before paying final settlement.',
    };
  }
  if (overlap.recommendedPayUsd <= 0 && amountUsd > 0.01) {
    if (!acknowledgeVariance) {
      return {
        ok: false,
        message:
          'No separate payment is recommended — monthly payroll already covers this settlement. Check "I confirm this payment" to proceed anyway.',
      };
    }
    return { ok: true };
  }
  const tolerance = 0.02;
  if (
    overlap.requiresPaymentAcknowledgment &&
    amountUsd > overlap.recommendedPayUsd + tolerance &&
    !acknowledgeVariance
  ) {
    return {
      ok: false,
      message: `Payment exceeds recommended remaining ${overlap.recommendedPayUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Confirm variance to proceed.`,
    };
  }
  return { ok: true };
}
