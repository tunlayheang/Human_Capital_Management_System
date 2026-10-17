import { businessDateKey } from './payrollRunNotificationService.js';
import { addCalendarDays, dateKeyIct } from './attendanceTimeZone.js';
import { reconcileAttendanceAbsences } from './attendanceReconcileService.js';

let started = false;
let lastDay = '';

/** Once per ICT calendar day — backfill missing attendance rows (absent / day off / leave). */
export function startAttendanceReconcileScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastDay === today) return;
    lastDay = today;

    const from = addCalendarDays(today, -14);
    void reconcileAttendanceAbsences({ from, to: today })
      .then((r) => {
        if (r.created > 0) {
          console.log(
            `[attendance] Daily reconcile: ${r.created} row(s) for ${from}..${today} (${r.datesProcessed} day(s))`
          );
        }
      })
      .catch((err) => {
        console.error('[attendance] Daily reconcile failed:', err);
      });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
}

/** Defer startup reconcile so first API requests are not blocked after restart. */
export function runAttendanceReconcileOnStartup(): void {
  const delayMs = Number(process.env.ATTENDANCE_STARTUP_RECONCILE_DELAY_MS) || 90_000;
  setTimeout(() => {
    const today = dateKeyIct();
    const from = addCalendarDays(today, -14);
    void reconcileAttendanceAbsences({ from, to: today }).catch((err) => {
      console.warn('[attendance] Startup reconcile:', (err as Error)?.message || err);
    });
  }, delayMs);
}
