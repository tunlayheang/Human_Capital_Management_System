import { applyDueScheduledMovements } from './employeeMovementService.js';
import {
  businessDateKey,
  scheduleDailyAtBusinessMidnight,
} from './dailyJobScheduler.js';

const APPLIED_BY_SYSTEM = 'system-scheduler';

let handle: ReturnType<typeof scheduleDailyAtBusinessMidnight> | null = null;

/**
 * Movement Effective Job — applies approved movements whose EffectiveDate <= today.
 * Runs daily at 00:00 Asia/Phnom_Penh and once on startup for catch-up.
 */
export async function runMovementEffectiveJob(): Promise<number> {
  return applyDueScheduledMovements({ appliedBy: APPLIED_BY_SYSTEM });
}

export function startEmployeeMovementScheduler(): void {
  if (handle) return;
  handle = scheduleDailyAtBusinessMidnight('movement-effective', async () => {
    const applied = await runMovementEffectiveJob();
    if (applied > 0) {
      console.log(
        `[movements] Movement Effective Job applied ${applied} movement(s) on ${businessDateKey()}`
      );
    }
  });
  console.log('[movements] Movement Effective Job scheduler started (00:00 Phnom Penh).');
}

export function runEmployeeMovementsOnStartup(): void {
  void runMovementEffectiveJob().then((n) => {
    if (n > 0) console.log(`[movements] Startup applied ${n} due movement(s)`);
  });
}

export function getMovementSchedulerDay(): string {
  return businessDateKey();
}
