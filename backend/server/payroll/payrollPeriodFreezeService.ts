import { Op } from 'sequelize';
import { PayrollRun } from '../db.js';
import { isPayrollRunLocked } from './payrollWorkflowService.js';
import { lockAttendanceForCycle } from './attendanceFinalizationService.js';
import { resolvePayrollCycleForMonth } from './payrollCalendarCycleService.js';
import { writePayrollAuditLog } from './payrollAuditService.js';

export class PayrollPeriodFrozenError extends Error {
  statusCode = 409;
  code = 'PAYROLL_PERIOD_FROZEN';
  constructor(message: string) {
    super(message);
    this.name = 'PayrollPeriodFrozenError';
  }
}

const UNLOCKED_RUN_STATUSES = ['REJECTED', 'REVERSED', 'CANCELLED'];

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function monthsInRange(start: string, end: string): string[] {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  if (e < s) return [];
  const out: string[] = [];
  let y = Number(s.slice(0, 4));
  let m = Number(s.slice(5, 7));
  const endY = Number(e.slice(0, 4));
  const endM = Number(e.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Approved / locked payroll run for a calendar month (if any). */
export async function findLockedPayrollRunForMonth(
  month: string,
  payrollGroupId = 'default'
): Promise<Record<string, unknown> | null> {
  const monthStr = monthKey(month);
  const row = await PayrollRun.findOne({
    where: {
      month: monthStr,
      status: { [Op.notIn]: UNLOCKED_RUN_STATUSES },
    },
    order: [['updatedAt', 'DESC']],
  });
  if (!row) return null;
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  if (!isPayrollRunLocked(String(plain.status ?? ''))) return null;
  if (payrollGroupId !== 'default' && plain.payrollGroupId && plain.payrollGroupId !== payrollGroupId) {
    return null;
  }
  return plain;
}

export async function isPayrollMonthFrozen(month: string, payrollGroupId = 'default'): Promise<boolean> {
  return Boolean(await findLockedPayrollRunForMonth(month, payrollGroupId));
}

export async function assertPayrollMonthInputsEditable(
  month: string,
  payrollGroupId = 'default'
): Promise<void> {
  const run = await findLockedPayrollRunForMonth(month, payrollGroupId);
  if (!run) return;
  throw new PayrollPeriodFrozenError(
    `Payroll for ${monthKey(month)} is approved (${String(run.status)}). ` +
      'Attendance, leave, and overtime for this period are frozen. Use a payroll adjustment for corrections.'
  );
}

export async function assertPayrollDateInputsEditable(
  date: string,
  payrollGroupId = 'default'
): Promise<void> {
  const d = date.slice(0, 10);
  const { resolveSalaryMonthForDate, resolvePayrollCycleForMonth } = await import(
    './payrollCalendarCycleService.js'
  );
  const { isAttendanceCutoffReached } = await import('./payrollAttendanceCutoff.js');

  const salaryMonth = await resolveSalaryMonthForDate(d, payrollGroupId);
  const cycle = await resolvePayrollCycleForMonth(salaryMonth, payrollGroupId);
  const cutoff = cycle.attendanceCutoffDate.slice(0, 10);
  const periodStart = cycle.periodStart.slice(0, 10);

  // Outside this salary window (including days after cutoff) — leave editable.
  if (d < periodStart || d > cutoff) return;
  // Only lock after ICT midnight on the cutoff date.
  if (!isAttendanceCutoffReached(cutoff)) return;

  await assertPayrollMonthInputsEditable(salaryMonth, payrollGroupId);
}

export async function assertPayrollDateRangeInputsEditable(
  startDate: string,
  endDate: string,
  payrollGroupId = 'default'
): Promise<void> {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  const { resolveSalaryMonthForDate, resolvePayrollCycleForMonth } = await import(
    './payrollCalendarCycleService.js'
  );
  const { isAttendanceCutoffReached } = await import('./payrollAttendanceCutoff.js');

  const candidates = new Set<string>(monthsInRange(start, end));
  candidates.add(await resolveSalaryMonthForDate(start, payrollGroupId));
  candidates.add(await resolveSalaryMonthForDate(end, payrollGroupId));

  for (const month of candidates) {
    if (!month) continue;
    const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
    const cutoff = cycle.attendanceCutoffDate.slice(0, 10);
    const periodStart = cycle.periodStart.slice(0, 10);
    // Requested range must overlap the locked salary window through cutoff.
    if (end < periodStart || start > cutoff) continue;
    if (!isAttendanceCutoffReached(cutoff)) continue;
    await assertPayrollMonthInputsEditable(month, payrollGroupId);
  }
}

/** Lock attendance + audit when payroll is approved so inputs match payslip snapshots. */
export async function freezePayrollInputsAfterApproval(params: {
  runId: string;
  month: string;
  actorUserId: string;
  payrollGroupId?: string;
}): Promise<void> {
  const payrollGroupId = params.payrollGroupId ?? 'default';
  const month = params.month.slice(0, 7);
  const { getAttendancePeriod } = await import('./attendanceFinalizationService.js');
  const period = await getAttendancePeriod(month, payrollGroupId);

  // Attendance input stays open until the calendar cutoff; the scheduler locks on cutoff day.
  if (!period.isCutoffReached) {
    return;
  }

  // Respect HR reopen before cutoff — do not force-lock on server sync or payroll approval.
  if (period.status === 'OPEN') {
    return;
  }

  if (period.status === 'LOCKED' && period.freezeTrigger === 'PAYROLL_APPROVED') {
    return;
  }

  const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
  await lockAttendanceForCycle({
    cycle,
    actorUserId: params.actorUserId,
    freezeTrigger: 'PAYROLL_APPROVED',
    status: 'LOCKED',
    notes: `Locked because payroll run ${params.runId} was approved. Historical inputs are view-only.`,
  });

  await writePayrollAuditLog({
    entityType: 'payroll_run',
    entityId: params.runId,
    actionType: 'PAYROLL_INPUTS_FROZEN',
    userId: params.actorUserId === 'system-sync' ? null : params.actorUserId,
    newValue: { month, payrollGroupId },
    metadata: { attendanceLocked: true },
  });
}

/** Backfill attendance locks for payroll runs approved before freeze policy existed. */
export async function syncInputFreezeForApprovedPayrollRuns(): Promise<void> {
  const rows = await PayrollRun.findAll({
    where: { status: { [Op.notIn]: ['REJECTED', 'REVERSED', 'CANCELLED', 'DRAFT', 'PENDING_APPROVAL', 'UNDER_REVIEW'] } },
  });
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const status = String(plain.status ?? '');
    if (!isPayrollRunLocked(status)) continue;
    const month = String(plain.month ?? '').slice(0, 7);
    if (!month) continue;
    const { getAttendancePeriod } = await import('./attendanceFinalizationService.js');
    const period = await getAttendancePeriod(month, String(plain.payrollGroupId ?? 'default'));
    if (!period.isCutoffReached) continue;
    if (period.status === 'OPEN') continue;
    if (period.status === 'LOCKED' && period.freezeTrigger === 'PAYROLL_APPROVED') continue;
    try {
      await freezePayrollInputsAfterApproval({
        runId: String(plain.id),
        month,
        actorUserId: 'system-sync',
        payrollGroupId: String(plain.payrollGroupId ?? 'default'),
      });
    } catch (err) {
      console.warn(
        '[payroll-freeze] Backfill skipped for',
        month,
        (err as Error)?.message || err
      );
    }
  }
}
