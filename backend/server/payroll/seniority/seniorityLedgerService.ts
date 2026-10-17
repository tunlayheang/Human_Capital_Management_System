import { Op } from 'sequelize';
import { EmployeeSeniorityProfile, SeniorityLedger } from '../../db.js';
import { seniorityLedgerId } from './seniorityRuleSchema.js';
import { roundUsd } from './seniorityAccrualEngine.js';
import type { SeniorityCalculationSnapshot, SeniorityLedgerType } from './seniorityTypes.js';

export async function getOrCreateSeniorityProfile(employeeId: string) {
  let row = await EmployeeSeniorityProfile.findByPk(employeeId);
  if (!row) {
    const now = new Date();
    row = await EmployeeSeniorityProfile.create({
      employee_id: employeeId,
      total_service_days: 0,
      current_balance_usd: 0,
      created_at: now,
      updated_at: now,
    });
  }
  return row;
}

export async function getLedgerBalance(employeeId: string): Promise<number> {
  const profile = await EmployeeSeniorityProfile.findByPk(employeeId);
  return roundUsd(Number(profile?.get('current_balance_usd') ?? 0));
}

export async function listSeniorityLedger(
  employeeId: string,
  opts?: { limit?: number; month?: string }
) {
  const where: Record<string, unknown> = { employee_id: employeeId };
  if (opts?.month) where.payroll_month = opts.month.slice(0, 7);

  const rows = await SeniorityLedger.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: opts?.limit ?? 200,
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function appendLedgerEntry(params: {
  employeeId: string;
  type: SeniorityLedgerType;
  amountUsd: number;
  payrollMonth?: string;
  referenceId?: string;
  reason?: string;
  ruleId?: string;
  snapshot?: SeniorityCalculationSnapshot | Record<string, unknown>;
  skipBalanceUpdate?: boolean;
}): Promise<{ id: string; balanceAfter: number }> {
  const profile = await getOrCreateSeniorityProfile(params.employeeId);
  const prev = roundUsd(Number(profile.get('current_balance_usd') ?? 0));
  const delta =
    params.type === 'payment'
      ? -Math.abs(params.amountUsd)
      : params.amountUsd;
  const balanceAfter = roundUsd(prev + delta);
  const id = seniorityLedgerId();
  const now = new Date();

  await SeniorityLedger.create({
    id,
    employee_id: params.employeeId,
    type: params.type,
    amount: roundUsd(Math.abs(params.amountUsd)),
    balance_after: balanceAfter,
    payroll_month: params.payrollMonth?.slice(0, 7) ?? null,
    reference_id: params.referenceId ?? null,
    reason: params.reason ?? params.type,
    rule_id: params.ruleId ?? null,
    snapshot: params.snapshot ?? null,
    created_at: now,
  });

  if (!params.skipBalanceUpdate) {
    await profile.update({
      current_balance_usd: balanceAfter,
      updated_at: now,
      last_calculated_date: now.toISOString().slice(0, 10),
      ...(params.type === 'accrual'
        ? { last_accrual_usd: roundUsd(params.amountUsd) }
        : {}),
    });
  }

  return { id, balanceAfter };
}

/** Prevent duplicate accrual for same employee + month. */
export async function hasAccrualForMonth(employeeId: string, month: string): Promise<boolean> {
  const m = month.slice(0, 7);
  const n = await SeniorityLedger.count({
    where: {
      employee_id: employeeId,
      payroll_month: m,
      type: 'accrual',
    },
  });
  return n > 0;
}

/** Prevent duplicate monthly payment ledger rows when payroll is re-run. */
export async function hasPaymentForMonth(employeeId: string, month: string): Promise<boolean> {
  const m = month.slice(0, 7);
  const n = await SeniorityLedger.count({
    where: {
      employee_id: employeeId,
      payroll_month: m,
      type: 'payment',
    },
  });
  return n > 0;
}

export async function reverseAccrualsForMonth(employeeId: string, month: string): Promise<void> {
  const m = month.slice(0, 7);
  const rows = await SeniorityLedger.findAll({
    where: { employee_id: employeeId, payroll_month: m, type: 'accrual' },
  });
  for (const row of rows) {
    await row.destroy();
  }
  await recalculateProfileBalance(employeeId);
}

export async function recalculateProfileBalance(employeeId: string): Promise<number> {
  const rows = await SeniorityLedger.findAll({
    where: { employee_id: employeeId },
    order: [['created_at', 'ASC']],
  });
  let balance = 0;
  for (const row of rows) {
    const type = String(row.get('type'));
    const amt = Number(row.get('amount') ?? 0);
    balance =
      type === 'payment' ? roundUsd(balance - amt) : roundUsd(balance + amt);
    await row.update({ balance_after: balance });
  }
  const profile = await getOrCreateSeniorityProfile(employeeId);
  await profile.update({
    current_balance_usd: balance,
    updated_at: new Date(),
  });
  return balance;
}
