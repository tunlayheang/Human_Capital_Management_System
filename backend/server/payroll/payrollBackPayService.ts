/**
 * Rolls forward amounts owed after a payroll month was locked:
 * - Approved payroll adjustments not yet applied (reopen blocked → adjustment path)
 *
 * OT after attendance cutoff is NOT back-paid here. With cutoff-to-cutoff salary months,
 * that OT belongs to the next period’s normal OT columns (avoids double payment).
 */
import { Op } from 'sequelize';
import { Payslip, User } from '../db.js';
import { PayrollAdjustment } from './payrollHybridSchema.js';
import type { PayrollBreakdown } from '../payrollCalculation.js';
import { reconcilePayrollBreakdown } from '../payrollCalculation.js';
import { loadPayrollEngineInputs, type PayrollEngineInputs } from '../payrollEngineInputs.js';
import { computeSalaryTaxDual, usdBracketsToKhr } from '../cambodiaSalaryTax.js';
import { computeNssfDual } from '../nssfAssumedWage.js';
import { findEmployeeWithCompensation } from '../salaryStructureService.js';
import { usdToKhr } from '../usdToKhr.js';

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

export function previousPayrollMonth(month: string): string {
  const key = month.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  if (m <= 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export type PayrollBackPayDetail = {
  sourceMonth: string;
  adjustmentUsd: number;
  /** Always 0 — retained for API/compat; post-cutoff OT uses next-period OT instead. */
  postCutoffOtUsd: number;
  totalUsd: number;
  lines: string[];
};

type AdjustmentPlain = {
  userId?: string;
  amountUsd?: unknown;
  month?: string;
  description?: string | null;
  adjustmentType?: string | null;
};

/** Pure helper — sums approved unapplied adjustments per user (for tests + batch build). */
export function buildBackPayFromAdjustments(
  rows: AdjustmentPlain[],
  targetMonth: string
): Map<string, PayrollBackPayDetail> {
  const target = targetMonth.slice(0, 7);
  const byUser = new Map<
    string,
    { adjustmentUsd: number; lines: string[]; earliestMonth: string }
  >();

  for (const row of rows) {
    const uid = String(row.userId ?? '').trim();
    if (!uid) continue;
    const amt = roundUsd(Number(row.amountUsd) || 0);
    if (amt === 0) continue;
    const adjMonth = String(row.month ?? '').slice(0, 7) || previousPayrollMonth(target);
    const desc = String(row.description ?? row.adjustmentType ?? 'adjustment');
    const cur = byUser.get(uid) ?? {
      adjustmentUsd: 0,
      lines: [],
      earliestMonth: adjMonth,
    };
    cur.adjustmentUsd = roundUsd(cur.adjustmentUsd + amt);
    cur.lines.push(`${adjMonth} adjustment: ${desc} ($${amt})`);
    if (adjMonth < cur.earliestMonth) cur.earliestMonth = adjMonth;
    byUser.set(uid, cur);
  }

  const result = new Map<string, PayrollBackPayDetail>();
  for (const [userId, cur] of byUser) {
    if (cur.adjustmentUsd === 0) continue;
    result.set(userId, {
      sourceMonth: cur.earliestMonth || previousPayrollMonth(target),
      adjustmentUsd: cur.adjustmentUsd,
      postCutoffOtUsd: 0,
      totalUsd: cur.adjustmentUsd,
      lines: cur.lines,
    });
  }
  return result;
}

/** Batch back-pay lookup for all employees in a payroll month. */
export async function preloadBackPayForMonth(
  targetMonth: string,
  employeesByUserId: Map<string, Record<string, unknown>>
): Promise<Map<string, PayrollBackPayDetail>> {
  const target = targetMonth.slice(0, 7);
  const userIds = [...employeesByUserId.keys()].map(String).filter(Boolean);
  if (!userIds.length) return new Map();

  const adjustmentRows = await PayrollAdjustment.findAll({
    where: {
      status: 'APPROVED',
      appliedAt: { [Op.is]: null },
      month: { [Op.lt]: target },
      userId: { [Op.in]: userIds },
    },
  });
  const plains = adjustmentRows.map((r) => r.get({ plain: true }) as AdjustmentPlain);
  return buildBackPayFromAdjustments(plains, target);
}

export async function computePendingBackPayForUser(
  userId: string,
  targetMonth: string
): Promise<PayrollBackPayDetail> {
  const target = targetMonth.slice(0, 7);
  const adjustments = await PayrollAdjustment.findAll({
    where: {
      userId,
      status: 'APPROVED',
      appliedAt: { [Op.is]: null },
      month: { [Op.lt]: target },
    },
  });
  const map = buildBackPayFromAdjustments(
    adjustments.map((r) => r.get({ plain: true }) as AdjustmentPlain),
    target
  );
  return (
    map.get(userId) ?? {
      sourceMonth: previousPayrollMonth(target),
      adjustmentUsd: 0,
      postCutoffOtUsd: 0,
      totalUsd: 0,
      lines: [],
    }
  );
}

/** Recompute statutory deductions after adding back pay to gross. */
export async function applyBackPayToBreakdown(
  breakdown: PayrollBreakdown,
  backPay: PayrollBackPayDetail,
  userId: string,
  opts?: {
    employee?: Record<string, unknown> | null;
    engineInputs?: PayrollEngineInputs;
  }
): Promise<PayrollBreakdown> {
  if (!backPay.totalUsd) return breakdown;

  const employee =
    opts?.employee !== undefined ? opts.employee : await findEmployeeWithCompensation(userId);
  const user = await User.findByPk(userId);
  const userPlain = user?.get({ plain: true }) as Record<string, unknown> | undefined;

  const engineInputs = opts?.engineInputs ?? (await loadPayrollEngineInputs());
  const { compliance, nssfBrackets, taxBrackets } = engineInputs;
  const exchangeRate = Number(compliance?.exchangeRate ?? breakdown.exchangeRate ?? 4100);
  const grossSalary = roundUsd((breakdown.grossSalary ?? 0) + backPay.totalUsd);
  const { resolveTaxDependentsForEmployeeRow } = await import('../employeeChildrenService.js');
  const dependents = await resolveTaxDependentsForEmployeeRow(
    employee as Record<string, unknown> | null,
    userPlain
  );
  const nssfEnrolled = (employee as Record<string, unknown>)?.nssf_enrolled !== false;

  const nssfDual = computeNssfDual({
    monthlyGrossUsd: Math.max(0, grossSalary),
    exchangeRateKhrPerUsd: exchangeRate,
    nssfEnrolled,
    occupationalEmployeePct: compliance?.nssfOccupationalRiskEmployeePct ?? 0,
    healthcareEmployeePct: compliance?.nssfHealthcareEmployeePct ?? 0,
    pensionEmployeePct: compliance?.nssfPensionEmployeePct ?? 2,
    pensionEmployeeCapKhr: compliance?.nssfPensionEmployeeCapKhr ?? 24_000,
    occupationalEmployerPct: compliance?.nssfOccupationalRiskEmployerPct ?? 0.8,
    healthcareEmployerPct: compliance?.nssfHealthcareEmployerPct ?? 2.6,
    pensionEmployerPct: compliance?.nssfPensionEmployerPct ?? 2,
    brackets: nssfBrackets,
  });
  const nssf = nssfDual.employeeContributionUsd;

  const taxDual = computeSalaryTaxDual({
    monthlyGrossUsd: Math.max(0, grossSalary),
    taxDependents: dependents,
    exchangeRateKhrPerUsd: exchangeRate,
    bracketsKhr: taxBrackets?.length ? usdBracketsToKhr(taxBrackets, exchangeRate) : undefined,
  });
  const taxOnSalary = taxDual.taxOnSalaryUsd;

  const deductions = {
    nssf,
    taxOnSalary: roundUsd(taxOnSalary),
    absences: breakdown.deductions?.absences ?? 0,
    advances: breakdown.deductions?.advances ?? 0,
    total: 0,
  };
  deductions.total = roundUsd(
    deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances
  );

  const netSalary = roundUsd(Math.max(0, grossSalary - deductions.total));
  const netSalaryKHR = usdToKhr(netSalary, exchangeRate);

  const hybrid = breakdown.hybrid
    ? {
        ...breakdown.hybrid,
        adjustmentTotal: roundUsd((breakdown.hybrid.adjustmentTotal ?? 0) + backPay.totalUsd),
        notes: [
          ...breakdown.hybrid.notes,
          `Back pay from ${backPay.sourceMonth}: $${backPay.totalUsd} (included in this run).`,
        ],
      }
    : undefined;

  return reconcilePayrollBreakdown({
    ...breakdown,
    grossSalary,
    deductions,
    nssfDetail: nssfDual.nssfDetail ?? breakdown.nssfDetail,
    nssfSalaryKhr: nssfDual.nssfSalaryKhr,
    nssfSalaryUsd: nssfDual.nssfSalaryUsd,
    employeeContributionKhr: nssfDual.employeeContributionKhr,
    employeeContributionUsd: nssfDual.employeeContributionUsd,
    employerContributionKhr: nssfDual.employerContributionKhr,
    employerContributionUsd: nssfDual.employerContributionUsd,
    taxableIncomeKhr: taxDual.taxableIncomeKhr,
    taxableIncomeUsd: taxDual.taxableIncomeUsd,
    taxAmountKhr: taxDual.taxAmountKhr,
    taxAmountUsd: taxDual.taxAmountUsd,
    taxableBaseUsd: taxDual.taxableIncomeUsd,
    exchangeRateUsed: taxDual.exchangeRateUsed,
    netSalary,
    exchangeRate,
    netSalaryKHR,
    backPayment: backPay.totalUsd,
    backPaymentSourceMonth: backPay.sourceMonth,
    hybrid,
  });
}

/**
 * Mark rolled-forward adjustments as applied when a payroll run is approved/locked.
 * Only touches employees who were on that run (avoids clearing unpaid adjustments for others).
 */
export async function markBackPayAdjustmentsApplied(
  targetMonth: string,
  appliedAtIso: string,
  userIds: string[]
): Promise<number> {
  const target = targetMonth.slice(0, 7);
  const ids = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!ids.length) return 0;

  const [affected] = await PayrollAdjustment.update(
    { status: 'APPLIED', appliedAt: appliedAtIso },
    {
      where: {
        status: 'APPROVED',
        appliedAt: { [Op.is]: null },
        month: { [Op.lt]: target },
        userId: { [Op.in]: ids },
      },
    }
  );
  return Number(affected) || 0;
}

/** User ids on a payroll run (for scoped adjustment apply). */
export async function loadPayrollRunUserIds(runId: string): Promise<string[]> {
  const rows = await Payslip.findAll({
    where: { payrollRunId: runId },
    attributes: ['userId'],
  });
  return [
    ...new Set(
      rows
        .map((r) => String((r.get('userId') as string) ?? '').trim())
        .filter(Boolean)
    ),
  ];
}
