import { sequelize, LeaveBalance } from './db.js';
import { roundLeaveDays } from './leaveBalanceCalc.js';
import { ensureLeaveLedgerSchema } from './leaveLedgerSchema.js';

export type LeaveLedgerTransactionType = 'accrual' | 'usage' | 'carry_forward' | 'adjustment';

export type LeaveLedgerEntryInput = {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  calendarYear: number;
  accrualMonth: string | null;
  transactionType: LeaveLedgerTransactionType;
  days: number;
  joinDate?: string | null;
  joinDay?: number | null;
  appliedTier?: string | null;
  sourceRef?: string | null;
  generatedBy: string;
  auditJson?: Record<string, unknown> | null;
};

export function leaveAccrualLedgerId(
  employeeId: string,
  leaveTypeId: string,
  accrualMonth: string
): string {
  return `lla-${employeeId}-${leaveTypeId}-${accrualMonth}`;
}

export function leaveUsageLedgerId(leaveRequestId: string): string {
  return `llu-${leaveRequestId}`;
}

export async function findLeaveLedgerEntry(id: string): Promise<boolean> {
  await ensureLeaveLedgerSchema();
  const [rows] = (await sequelize.query(
    `SELECT id FROM leave_ledger WHERE id = :id LIMIT 1`,
    { replacements: { id } }
  )) as [Array<{ id: string }>, unknown];
  return rows.length > 0;
}

export async function findAccrualLedgerForMonth(
  employeeId: string,
  leaveTypeId: string,
  accrualMonth: string
): Promise<boolean> {
  await ensureLeaveLedgerSchema();
  const [rows] = (await sequelize.query(
    `SELECT id FROM leave_ledger
     WHERE employee_id = :employeeId
       AND leave_type_id = :leaveTypeId
       AND accrual_month = :accrualMonth
       AND transaction_type = 'accrual'
     LIMIT 1`,
    { replacements: { employeeId, leaveTypeId, accrualMonth } }
  )) as [Array<{ id: string }>, unknown];
  return rows.length > 0;
}

/** Remove a premature accrual row (e.g. posted before join day). */
export async function deleteAccrualLedgerForMonth(
  employeeId: string,
  leaveTypeId: string,
  accrualMonth: string
): Promise<boolean> {
  await ensureLeaveLedgerSchema();
  const [result] = (await sequelize.query(
    `DELETE FROM leave_ledger
     WHERE employee_id = :employeeId
       AND leave_type_id = :leaveTypeId
       AND accrual_month = :accrualMonth
       AND transaction_type = 'accrual'`,
    { replacements: { employeeId, leaveTypeId, accrualMonth } }
  )) as [{ affectedRows?: number }, unknown];
  return Number(result?.affectedRows ?? 0) > 0;
}

/** Insert ledger row; returns false if accrual month already exists (idempotent). */
export async function insertLeaveLedgerEntry(
  entry: LeaveLedgerEntryInput
): Promise<{ created: boolean }> {
  await ensureLeaveLedgerSchema();

  if (entry.transactionType === 'accrual' && entry.accrualMonth) {
    const exists = await findAccrualLedgerForMonth(
      entry.employeeId,
      entry.leaveTypeId,
      entry.accrualMonth
    );
    if (exists) return { created: false };
  } else {
    const exists = await findLeaveLedgerEntry(entry.id);
    if (exists) return { created: false };
  }

  try {
    await sequelize.query(
      `INSERT INTO leave_ledger
        (id, employee_id, leave_type_id, calendar_year, accrual_month, transaction_type,
         days, join_date, join_day, applied_tier, source_ref, generated_by, audit_json)
       VALUES
        (:id, :employeeId, :leaveTypeId, :calendarYear, :accrualMonth, :transactionType,
         :days, :joinDate, :joinDay, :appliedTier, :sourceRef, :generatedBy, :auditJson)`,
      {
        replacements: {
          id: entry.id,
          employeeId: entry.employeeId,
          leaveTypeId: entry.leaveTypeId,
          calendarYear: entry.calendarYear,
          accrualMonth: entry.accrualMonth,
          transactionType: entry.transactionType,
          days: entry.days,
          joinDate: entry.joinDate ?? null,
          joinDay: entry.joinDay ?? null,
          appliedTier: entry.appliedTier ?? null,
          sourceRef: entry.sourceRef ?? null,
          generatedBy: entry.generatedBy,
          auditJson: entry.auditJson ? JSON.stringify(entry.auditJson) : null,
        },
      }
    );
    return { created: true };
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'original' in err
      ? (err as { original?: { code?: string } }).original?.code
      : undefined;
    if (code === 'ER_DUP_ENTRY') return { created: false };
    throw err;
  }
}

export async function sumLedgerDaysForYear(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  transactionType?: LeaveLedgerTransactionType
): Promise<number> {
  await ensureLeaveLedgerSchema();
  const typeFilter = transactionType ? 'AND transaction_type = :transactionType' : '';
  const [rows] = (await sequelize.query(
    `SELECT COALESCE(SUM(days), 0) AS total
     FROM leave_ledger
     WHERE employee_id = :employeeId
       AND leave_type_id = :leaveTypeId
       AND calendar_year = :year
       ${typeFilter}`,
    {
      replacements: { employeeId, leaveTypeId, year, transactionType },
    }
  )) as [Array<{ total: number }>, unknown];
  return roundLeaveDays(Number(rows[0]?.total ?? 0));
}

export async function sumAccruedFromLedger(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<number> {
  return sumLedgerDaysForYear(employeeId, leaveTypeId, year, 'accrual');
}

export async function sumUsageFromLedger(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<number> {
  const total = await sumLedgerDaysForYear(employeeId, leaveTypeId, year, 'usage');
  return roundLeaveDays(Math.abs(total));
}

export async function latestAccrualMonthFromLedger(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<string | null> {
  await ensureLeaveLedgerSchema();
  const [rows] = (await sequelize.query(
    `SELECT accrual_month AS accrualMonth
     FROM leave_ledger
     WHERE employee_id = :employeeId
       AND leave_type_id = :leaveTypeId
       AND calendar_year = :year
       AND transaction_type = 'accrual'
       AND accrual_month IS NOT NULL
     ORDER BY accrual_month DESC
     LIMIT 1`,
    { replacements: { employeeId, leaveTypeId, year } }
  )) as [Array<{ accrualMonth: string }>, unknown];
  return rows[0]?.accrualMonth ?? null;
}

export type LeaveLedgerRow = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  calendar_year: number;
  accrual_month: string | null;
  transaction_type: LeaveLedgerTransactionType;
  days: number;
  join_date: string | null;
  join_day: number | null;
  applied_tier: string | null;
  source_ref: string | null;
  generated_by: string;
  audit_json: Record<string, unknown> | null;
  created_at: string;
};

export async function listLeaveLedgerEntries(
  employeeId: string,
  year?: number,
  leaveTypeId?: string
): Promise<LeaveLedgerRow[]> {
  await ensureLeaveLedgerSchema();
  const filters = ['employee_id = :employeeId'];
  const replacements: Record<string, unknown> = { employeeId };
  if (year != null) {
    filters.push('calendar_year = :year');
    replacements.year = year;
  }
  if (leaveTypeId) {
    filters.push('leave_type_id = :leaveTypeId');
    replacements.leaveTypeId = leaveTypeId;
  }
  const [rows] = (await sequelize.query(
    `SELECT * FROM leave_ledger
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at ASC, accrual_month ASC`,
    { replacements }
  )) as [LeaveLedgerRow[], unknown];
  return rows.map((r) => ({
    ...r,
    days: Number(r.days),
    audit_json:
      r.audit_json && typeof r.audit_json === 'string'
        ? (JSON.parse(r.audit_json) as Record<string, unknown>)
        : r.audit_json,
  }));
}

/** Sync LeaveBalance.accrued, used, lastAccrualMonth from immutable ledger entries. */
export async function syncLeaveBalanceFromLedger(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<void> {
  const balance: any = await LeaveBalance.findOne({
    where: { employeeId, leaveTypeId, year },
  });
  if (!balance) return;

  const accrued = await sumAccruedFromLedger(employeeId, leaveTypeId, year);
  const used = await sumUsageFromLedger(employeeId, leaveTypeId, year);
  const lastAccrualMonth = await latestAccrualMonthFromLedger(employeeId, leaveTypeId, year);

  await balance.update({
    accrued,
    used,
    lastAccrualMonth,
    updatedAt: new Date(),
  });
}
