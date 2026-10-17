import {
  listCyclesDueForFreeze,
  resolvePayrollCycleForMonth,
} from './payrollCalendarCycleService.js';
import { lockAttendanceForCycle } from './attendanceFinalizationService.js';
import { isAttendanceCutoffReached } from './payrollAttendanceCutoff.js';
import { PayrollAttendancePeriod } from './payrollHybridSchema.js';

let schedulerStarted = false;
let catchUpInFlight: Promise<number> | null = null;

/** Auto-freeze attendance when payroll calendar cutoff midnight (ICT) is reached. */
export async function runAttendanceFreezeJob(now = new Date()): Promise<number> {
  const due = await listCyclesDueForFreeze(now);
  let frozen = 0;

  for (const { cycle } of due) {
    await lockAttendanceForCycle({
      cycle,
      actorUserId: 'system-scheduler',
      freezeTrigger: 'SCHEDULER',
      notes: `Automatic freeze at midnight ICT on calendar cutoff (${cycle.attendanceCutoffDate}).`,
    });
    frozen += 1;
    console.log(
      `[payroll] Auto-froze attendance for ${cycle.month} group=${cycle.payrollGroupId} (cutoff ${cycle.attendanceCutoffDate} 00:00 ICT)`
    );
    try {
      const { notifyAttendancePeriodFrozen } = await import('../notificationService.js');
      void notifyAttendancePeriodFrozen({
        month: cycle.month,
        payrollGroupId: cycle.payrollGroupId,
        trigger: 'SCHEDULER',
      });
    } catch (err) {
      console.warn('[payroll] attendance freeze notification failed:', err);
    }
  }

  return frozen;
}

/**
 * Catch-up for a single month when auto-freeze is on and cutoff midnight ICT has passed.
 * Used by prepare-payroll / period reads so Render sleep or a missed scheduler tick
 * cannot leave the period OPEN after the cutoff.
 */
export async function ensureAutoFreezeCatchUpForPeriod(
  month: string,
  payrollGroupId = 'default',
  now = new Date()
): Promise<boolean> {
  const monthKey = String(month ?? '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return false;
  const year = parseInt(monthKey.slice(0, 4), 10);
  if (!Number.isFinite(year)) return false;

  const { getPayrollCalendar } = await import('../payrollCalendarService.js');
  const cal = await getPayrollCalendar(year);
  if (cal.autoFreezeAttendanceOnCutoff === false) return false;

  const cycle = await resolvePayrollCycleForMonth(monthKey, payrollGroupId);
  if (!isAttendanceCutoffReached(cycle.attendanceCutoffDate, now)) return false;

  let row = await PayrollAttendancePeriod.findOne({
    where: { month: monthKey, payrollGroupId },
  });
  if (!row && payrollGroupId === 'default') {
    row = await PayrollAttendancePeriod.findOne({ where: { month: monthKey } });
  }
  const status = String(row?.get('status') ?? 'OPEN').toUpperCase();
  if (status === 'LOCKED' || status === 'FINALIZED') return false;

  await lockAttendanceForCycle({
    cycle,
    actorUserId: 'system-scheduler',
    freezeTrigger: 'SCHEDULER',
    notes: `Automatic freeze catch-up after cutoff midnight ICT (${cycle.attendanceCutoffDate}).`,
  });
  console.log(
    `[payroll] Auto-freeze catch-up for ${cycle.month} group=${cycle.payrollGroupId} (cutoff ${cycle.attendanceCutoffDate})`
  );
  try {
    const { notifyAttendancePeriodFrozen } = await import('../notificationService.js');
    void notifyAttendancePeriodFrozen({
      month: cycle.month,
      payrollGroupId: cycle.payrollGroupId,
      trigger: 'SCHEDULER',
    });
  } catch (err) {
    console.warn('[payroll] attendance freeze notification failed:', err);
  }
  return true;
}

/** Deduped full catch-up (used after calendar save / scheduler tick). */
export async function runAttendanceFreezeJobDeduped(now = new Date()): Promise<number> {
  if (catchUpInFlight) return catchUpInFlight;
  catchUpInFlight = runAttendanceFreezeJob(now).finally(() => {
    catchUpInFlight = null;
  });
  return catchUpInFlight;
}

export function startPayrollAttendanceFreezeScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run periodically (not once-per-day). Freezing is idempotent for already-FINALIZED
  // periods, and this lets toggling "Freeze automatically" on mid-cutoff-day take effect
  // without waiting for the next Cambodia calendar day.
  const tick = () => {
    void runAttendanceFreezeJobDeduped(new Date()).catch((err) => {
      console.warn(
        '[payroll] Attendance freeze scheduler tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 5 * 60 * 1000);
  console.log(
    '[payroll] Attendance freeze scheduler started (every 5 min; freezes at 00:00 ICT / midnight on cutoff date).'
  );
}

/** Manual freeze aligned to calendar (HR override). */
export async function manualFreezeFromCalendar(
  month: string,
  actorUserId: string,
  payrollGroupId = 'default'
): Promise<void> {
  const cycle = await resolvePayrollCycleForMonth(month, payrollGroupId);
  await lockAttendanceForCycle({
    cycle,
    actorUserId,
    freezeTrigger: 'MANUAL',
    notes: 'Manual freeze from payroll calendar.',
  });
  try {
    const { notifyAttendancePeriodFrozen } = await import('../notificationService.js');
    void notifyAttendancePeriodFrozen({
      month,
      payrollGroupId,
      trigger: 'MANUAL',
    });
  } catch (err) {
    console.warn('[payroll] manual freeze notification failed:', err);
  }
}
