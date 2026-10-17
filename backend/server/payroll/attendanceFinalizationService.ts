import { Op } from 'sequelize';
import { AttendanceRecord } from '../db.js';
import { PayrollAttendancePeriod } from './payrollHybridSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import type { AttendancePeriodStatus } from './hybridPayrollTypes.js';
import type { ResolvedPayrollCycle } from './payrollCalendarCycleTypes.js';
import { resolvePayrollCycleForMonth } from './payrollCalendarCycleService.js';
import { businessDateKey } from '../payrollRunNotificationService.js';
import {
  formatAttendanceCutoffFreezeLabel,
  isAttendanceCutoffReached,
} from './payrollAttendanceCutoff.js';

type AttendanceFreezeTrigger = 'SCHEDULER' | 'MANUAL' | 'CALENDAR' | 'PAYROLL_APPROVED';

export class AttendanceCutoffNotReachedError extends Error {
  statusCode = 409;
  code = 'ATTENDANCE_CUTOFF_NOT_REACHED';
  constructor(cutoffDate: string, now = new Date()) {
    const today = businessDateKey(now);
    super(
      `Attendance can only be frozen on or after ${formatAttendanceCutoffFreezeLabel(cutoffDate)}. ` +
        `Now is ${today} (ICT); attendance input remains open until midnight on the cutoff date.`
    );
    this.name = 'AttendanceCutoffNotReachedError';
  }
}

function isCutoffReached(cutoffDate: string, now = new Date()): boolean {
  return isAttendanceCutoffReached(cutoffDate, now);
}

/** Manual and auto freeze both require the same ICT midnight instant — no trigger exemptions. */
function assertCutoffReachedForFreeze(
  cycle: ResolvedPayrollCycle,
  _freezeTrigger: AttendanceFreezeTrigger
): void {
  if (!isCutoffReached(cycle.attendanceCutoffDate)) {
    throw new AttendanceCutoffNotReachedError(cycle.attendanceCutoffDate);
  }
}

function periodId(month: string, payrollGroupId: string): string {
  return `att-period-${month}-${payrollGroupId}`;
}

export async function getAttendancePeriod(
  month: string,
  payrollGroupId = 'default',
  options?: { skipAutoFreezeCatchUp?: boolean }
) {
  const monthKey = month.slice(0, 7);

  if (!options?.skipAutoFreezeCatchUp) {
    try {
      const { ensureAutoFreezeCatchUpForPeriod } = await import('./attendanceFreezeScheduler.js');
      await ensureAutoFreezeCatchUpForPeriod(monthKey, payrollGroupId);
    } catch (err) {
      console.warn(
        '[payroll] Auto-freeze catch-up failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  const cycle = await resolvePayrollCycleForMonth(monthKey, payrollGroupId);
  let row = await PayrollAttendancePeriod.findOne({
    where: { month: monthKey, payrollGroupId },
  });
  if (!row && payrollGroupId === 'default') {
    row = await PayrollAttendancePeriod.findOne({ where: { month: monthKey } });
  }
  const cutoffDate = cycle.attendanceCutoffDate;
  const cutoffReached = isCutoffReached(cutoffDate);

  if (!row) {
    const status = 'OPEN' as AttendancePeriodStatus;
    const reviewFrozen = false;
    return {
      month: monthKey,
      payrollGroupId,
      payrollCalendarId: cycle.calendarId,
      payrollCycleId: cycle.cycleId,
      status,
      payPeriodStart: cycle.periodStart,
      payPeriodEnd: cycle.periodEnd,
      attendanceCutoffDate: cutoffDate,
      finalizedBy: null,
      finalizedAt: null,
      freezeTrigger: null,
      isCutoffReached: cutoffReached,
      canFreezeAttendance: cutoffReached && status === 'OPEN',
      reviewFrozen,
      frozenThroughDate: cutoffDate,
      allowNewInputInFrozenRange: true,
      allowUpdatesInFrozenRange: !reviewFrozen,
    };
  }
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const status = String(plain.status ?? 'OPEN') as AttendancePeriodStatus;
  const reviewFrozen = status === 'FINALIZED' || status === 'LOCKED';
  const frozenThrough =
    (plain.attendanceCutoffDate as string) ?? cutoffDate;
  // OPEN periods follow the live calendar cycle (cutoff-to-cutoff). Locked snapshots keep stored bounds.
  const payPeriodStart = reviewFrozen
    ? String(plain.payPeriodStart)
    : cycle.periodStart;
  const payPeriodEnd = reviewFrozen
    ? String(plain.payPeriodEnd)
    : cycle.periodEnd;
  return {
    id: String(plain.id),
    month: String(plain.month),
    payrollGroupId: String(plain.payrollGroupId ?? payrollGroupId),
    payrollCalendarId: String(plain.payrollCalendarId ?? cycle.calendarId),
    payrollCycleId: String(plain.payrollCycleId ?? cycle.cycleId),
    status,
    payPeriodStart,
    payPeriodEnd,
    attendanceCutoffDate: reviewFrozen
      ? (plain.attendanceCutoffDate as string) ?? cutoffDate
      : cutoffDate,
    finalizedBy: (plain.finalizedBy as string) ?? null,
    finalizedAt: (plain.finalizedAt as string) ?? null,
    freezeTrigger: (plain.freezeTrigger as string) ?? null,
    notes: (plain.notes as string) ?? null,
    isCutoffReached: cutoffReached,
    canFreezeAttendance: cutoffReached && status === 'OPEN',
    canReopenAttendance:
      status === 'FINALIZED' ||
      (status === 'LOCKED' &&
        !(
          (cutoffReached && String(plain.freezeTrigger ?? '') === 'PAYROLL_APPROVED') ||
          (!cutoffReached && String(plain.freezeTrigger ?? '') === 'SCHEDULER')
        )),
    reviewFrozen,
    frozenThroughDate: frozenThrough,
    allowNewInputInFrozenRange: true,
    allowUpdatesInFrozenRange: !reviewFrozen,
  };
}

export async function assertAttendanceFinalizedForPayroll(
  month: string,
  payrollGroupId = 'default'
): Promise<void> {
  const period = await getAttendancePeriod(month, payrollGroupId);
  if (period.status !== 'FINALIZED' && period.status !== 'LOCKED') {
    const cycle = await resolvePayrollCycleForMonth(month.slice(0, 7), payrollGroupId);
    const err = new Error(
      `Attendance for ${period.month} must be frozen per payroll calendar (cutoff ${cycle.attendanceCutoffDate}) before payroll calculation.`
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
}

export async function lockAttendanceForCycle(params: {
  cycle: ResolvedPayrollCycle;
  actorUserId: string;
  freezeTrigger: AttendanceFreezeTrigger;
  notes?: string;
  status?: 'FINALIZED' | 'LOCKED';
}): Promise<ReturnType<typeof getAttendancePeriod>> {
  const { cycle, actorUserId, freezeTrigger } = params;
  // Manual and automatic cutoff freezes share FINALIZED. LOCKED is reserved for
  // post–payroll-approval hard locks (freezeTrigger PAYROLL_APPROVED).
  const status = params.status ?? 'FINALIZED';
  const monthKey = cycle.month;
  const existing = await getAttendancePeriod(monthKey, cycle.payrollGroupId, {
    skipAutoFreezeCatchUp: true,
  });

  const existingStatus = String(existing.status ?? '').toUpperCase();
  const existingTrigger = String(existing.freezeTrigger ?? '').toUpperCase();
  // Already hard-locked after payroll approval — do not downgrade.
  if (existingStatus === 'LOCKED' && existingTrigger === 'PAYROLL_APPROVED') {
    return existing;
  }
  // Normalize legacy auto-freeze rows that used LOCKED under SCHEDULER.
  const normalizeSchedulerLocked =
    existingStatus === 'LOCKED' && existingTrigger === 'SCHEDULER' && status === 'FINALIZED';
  if (existingStatus === status && !normalizeSchedulerLocked) {
    return existing;
  }
  if (existingStatus === 'LOCKED' && status === 'FINALIZED' && !normalizeSchedulerLocked) {
    return existing;
  }

  assertCutoffReachedForFreeze(cycle, freezeTrigger);

  const end =
    cycle.attendanceCutoffDate && cycle.attendanceCutoffDate <= cycle.periodEnd
      ? cycle.attendanceCutoffDate
      : cycle.periodEnd;

  const records = await AttendanceRecord.findAll({
    where: { date: { [Op.between]: [cycle.periodStart, end] } },
  });

  const missingPunch = records.filter(
    (r) =>
      String((r as any).status ?? '').toUpperCase() === 'PRESENT' &&
      !(r as any).checkIn &&
      !(r as any).check_in
  ).length;

  const id = existing.id ?? periodId(monthKey, cycle.payrollGroupId);
  const now = new Date().toISOString();
  const payload = {
    id,
    month: monthKey,
    payrollGroupId: cycle.payrollGroupId,
    payrollCalendarId: cycle.calendarId,
    payrollCycleId: cycle.cycleId,
    payPeriodStart: cycle.periodStart,
    payPeriodEnd: cycle.periodEnd,
    attendanceCutoffDate: cycle.attendanceCutoffDate,
    status,
    finalizedBy: actorUserId,
    finalizedAt: now,
    freezeTrigger,
    notes:
      params.notes ??
      `Frozen ${records.length} record(s) through ${end}. Missing punch on present days: ${missingPunch}.`,
  };

  const row = await PayrollAttendancePeriod.findByPk(id);
  const stamp = new Date();
  if (row) {
    await row.update(payload);
  } else {
    await PayrollAttendancePeriod.create({
      ...payload,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  await writePayrollAuditLog({
    entityType: 'attendance_period',
    entityId: id,
    actionType: status === 'LOCKED' ? 'ATTENDANCE_LOCKED' : 'ATTENDANCE_FINALIZED',
    userId: actorUserId === 'system-scheduler' ? null : actorUserId,
    oldValue: existing,
    newValue: payload,
    metadata: {
      freezeTrigger,
      payrollCalendarId: cycle.calendarId,
      payrollCycleId: cycle.cycleId,
      triggeredByCalendar: true,
    },
  });

  return getAttendancePeriod(monthKey, cycle.payrollGroupId, {
    skipAutoFreezeCatchUp: true,
  });
}

/** Undo attendance locks that were applied before the calendar cutoff (e.g. after early payroll approval). */
export async function reopenAttendanceLockedBeforeCutoff(): Promise<number> {
  const rows: any[] = await PayrollAttendancePeriod.findAll({
    where: { status: { [Op.in]: ['LOCKED', 'FINALIZED'] } },
  });
  let reopened = 0;
  for (const row of rows) {
    const plain = row.get({ plain: true });
    const month = String(plain.month ?? '').slice(0, 7);
    if (!month) continue;
    const payrollGroupId = String(plain.payrollGroupId ?? 'default');
    const period = await getAttendancePeriod(month, payrollGroupId, {
      skipAutoFreezeCatchUp: true,
    });
    if (period.isCutoffReached) continue;
    const trigger = String(plain.freezeTrigger ?? '');
    if (trigger !== 'PAYROLL_APPROVED' && trigger !== 'SCHEDULER') continue;
    await row.update({
      status: 'OPEN',
      finalizedBy: null,
      finalizedAt: null,
      freezeTrigger: null,
      notes: 'Reopened automatically — attendance stays open until the calendar cutoff date.',
    });
    reopened += 1;
  }
  return reopened;
}

/** Validate and freeze attendance for payroll (manual / pre-run). */
export async function finalizeAttendancePeriod(
  month: string,
  userId: string,
  notes?: string,
  payrollGroupId = 'default'
): Promise<ReturnType<typeof getAttendancePeriod>> {
  const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
  return lockAttendanceForCycle({
    cycle,
    actorUserId: userId,
    freezeTrigger: 'MANUAL',
    notes,
    status: 'FINALIZED',
  });
}

export async function reopenAttendancePeriod(
  month: string,
  userId: string,
  payrollGroupId = 'default',
  reason?: string
): Promise<void> {
  const monthKey = month.slice(0, 7);
  const period = await getAttendancePeriod(monthKey, payrollGroupId);
  const cycle = await resolvePayrollCycleForMonth(monthKey, payrollGroupId);
  const cutoffNotReached = !isCutoffReached(cycle.attendanceCutoffDate);

  if (
    period.status === 'LOCKED' &&
    period.freezeTrigger === 'PAYROLL_APPROVED' &&
    !cutoffNotReached
  ) {
    const err = new Error(
      'Attendance is locked because payroll for this month was approved. Reopen is not allowed — use payroll adjustment.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  if (
    period.status === 'LOCKED' &&
    period.freezeTrigger === 'SCHEDULER' &&
    cutoffNotReached
  ) {
    const err = new Error(
      'Calendar-scheduled locks cannot be reopened before the cutoff date. Attendance stays open until cutoff.'
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  if (!cutoffNotReached) {
    const { assertPayrollMonthInputsEditable } = await import('./payrollPeriodFreezeService.js');
    await assertPayrollMonthInputsEditable(monthKey, payrollGroupId);
  }
  const row = await PayrollAttendancePeriod.findOne({
    where: { month: monthKey, payrollGroupId },
  });
  if (!row) return;
  const before = row.get({ plain: true });
  await row.update({
    status: 'OPEN',
    finalizedBy: null,
    finalizedAt: null,
    freezeTrigger: null,
    notes: reason ?? 'Reopened for corrections',
  });
  await writePayrollAuditLog({
    entityType: 'attendance_period',
    entityId: String(before.id),
    actionType: 'ATTENDANCE_REOPENED',
    userId,
    oldValue: before,
    newValue: row.get({ plain: true }),
    metadata: { override: true, reason },
  });
}
