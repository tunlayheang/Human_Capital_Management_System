import { Op } from 'sequelize';
import { PayrollRun } from '../db.js';

/** Payroll runs still being prepared or reviewed (informational — does not block rule edits). */
export const IN_FLIGHT_PAYROLL_STATUSES = ['DRAFT', 'UNDER_REVIEW', 'PENDING_APPROVAL'] as const;

export class MasterDataEffectiveDateRequiredError extends Error {
  statusCode = 400;
  code = 'MASTER_DATA_EFFECTIVE_DATE_REQUIRED';
  constructor(message?: string) {
    super(
      message ??
        'Effective date is required. Payroll-affecting changes must specify when they take effect.'
    );
    this.name = 'MasterDataEffectiveDateRequiredError';
  }
}

export class PayrollMasterDataConflictError extends Error {
  statusCode = 409;
  code = 'PAYROLL_MASTER_DATA_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'PayrollMasterDataConflictError';
  }
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

export function parseMasterDataEffectiveFrom(raw: unknown): string {
  const d = String(raw ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new MasterDataEffectiveDateRequiredError();
  }
  return d;
}

/** Read effective date from common request body keys (camelCase or snake_case). */
export function readEffectiveFromPayload(body: Record<string, unknown>): unknown {
  return body.effective_from ?? body.effectiveFrom ?? body.effective_date ?? body.effectiveDate;
}

export function resolveEffectiveFromPayload(body: Record<string, unknown>): string | undefined {
  const raw = readEffectiveFromPayload(body);
  if (raw == null || String(raw).trim() === '') return undefined;
  return parseMasterDataEffectiveFrom(raw);
}

export function requireEffectiveFromPayload(body: Record<string, unknown>): string {
  const resolved = resolveEffectiveFromPayload(body);
  if (!resolved) {
    throw new MasterDataEffectiveDateRequiredError();
  }
  return resolved;
}

/** Active payroll run for a month that is not yet approved/locked. */
export async function findInFlightPayrollRunForMonth(
  month: string,
  payrollGroupId = 'default'
): Promise<Record<string, unknown> | null> {
  const monthStr = monthKey(month);
  const row = await PayrollRun.findOne({
    where: {
      month: monthStr,
      status: { [Op.in]: [...IN_FLIGHT_PAYROLL_STATUSES] },
    },
    order: [['updatedAt', 'DESC']],
  });
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  if (
    payrollGroupId !== 'default' &&
    plain.payrollGroupId &&
    plain.payrollGroupId !== payrollGroupId
  ) {
    return null;
  }
  return plain;
}

/**
 * Guard payroll rule / master-data scheduling.
 *
 * Draft, pending-approval, and approved runs do **not** block edits — payslips keep
 * snapshotted amounts from when the run was calculated. Only a **LOCKED** attendance
 * period for that month blocks changes (locked source data).
 */
export async function assertPayrollMasterDataEditableForEffectiveDate(
  effectiveFrom: string,
  payrollGroupId = 'default'
): Promise<void> {
  const effectiveIso = parseMasterDataEffectiveFrom(effectiveFrom);
  const month = monthKey(effectiveIso);

  const { getAttendancePeriod } = await import('./attendanceFinalizationService.js');
  const period = await getAttendancePeriod(month, payrollGroupId);
  if (String(period.status ?? '').toUpperCase() === 'LOCKED') {
    throw new PayrollMasterDataConflictError(
      `Attendance data for ${month} is locked. ` +
        'Choose an effective date in a later month, or reopen the locked period before changing payroll rules.'
    );
  }
}
