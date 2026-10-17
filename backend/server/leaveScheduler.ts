import { runMonthlyAccrual } from './leaveAccrualService.js';
import { runYearEndRenewal, provisionYearlyFixedAllocations } from './leaveRenewalService.js';
import { ensureDefaultLeaveBalancesForActiveEmployees } from './leaveBalanceService.js';
import {
  currentAccrualMonth,
  isLastDayOfMonth,
  previousAccrualMonth,
} from './leaveAccrualRules.js';

let schedulerStarted = false;
let lastMonthEndAccrualKey = '';
let lastYearEndKey = '';

function yearKey(d = new Date()): string {
  return String(d.getFullYear());
}

export function startLeaveRenewalScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const now = new Date();
    const yKey = yearKey(now);

    if (isLastDayOfMonth(now)) {
      const month = currentAccrualMonth(now);
      if (lastMonthEndAccrualKey !== month) {
        lastMonthEndAccrualKey = month;
        void runMonthlyAccrual(month)
          .then((r) => {
            if (r.processed > 0 || r.errors.length > 0) {
              console.log(
                `[leave] Month-end accrual ${month}: ${r.processed} ledger entry(ies), ${r.skipped} skipped`
              );
            }
            if (r.errors.length > 0) {
              console.warn('[leave] Month-end accrual errors:', r.errors.slice(0, 5).join('; '));
            }
          })
          .catch((err) => {
            console.warn(
              '[leave] Month-end accrual job failed:',
              err instanceof Error ? err.message : err
            );
          });
      }
    } else if (now.getDate() === 1) {
      const catchUpMonth = previousAccrualMonth(now);
      if (lastMonthEndAccrualKey !== catchUpMonth) {
        lastMonthEndAccrualKey = catchUpMonth;
        void runMonthlyAccrual(catchUpMonth)
          .then((r) => {
            if (r.processed > 0) {
              console.log(
                `[leave] Catch-up accrual ${catchUpMonth}: ${r.processed} ledger entry(ies)`
              );
            }
          })
          .catch((err) => {
            console.warn(
              '[leave] Catch-up accrual failed:',
              err instanceof Error ? err.message : err
            );
          });
      }
    }

    if (now.getDate() === 1 && now.getMonth() === 0 && lastYearEndKey !== yKey) {
      lastYearEndKey = yKey;
      void runYearEndRenewal(now.getFullYear())
        .then((r) => {
          console.log(
            `[leave] Year-end renewal ${r.closingYear}→${r.newYear}: ${r.renewed} renewed, ${r.skipped} skipped`
          );
          return provisionYearlyFixedAllocations(now.getFullYear());
        })
        .then((p) => {
          if (p.updated > 0) {
            console.log(`[leave] Fixed allocation refresh: ${p.updated} entitlement(s) updated`);
          }
        })
        .catch((err) => {
          console.warn(
            '[leave] Year-end renewal job failed:',
            err instanceof Error ? err.message : err
          );
        });
    }
  };

  // One-shot heal for active employees missing leave balances (draft→active gaps, etc.).
  void ensureDefaultLeaveBalancesForActiveEmployees()
    .then((r) => {
      if (r.provisioned > 0) {
        console.log(
          `[leave] Bootstrap leave defaults: ${r.provisioned}/${r.scanned} employee(s) provisioned`
        );
      }
    })
    .catch((err) => {
      console.warn(
        '[leave] Bootstrap leave defaults failed:',
        err instanceof Error ? err.message : err
      );
    });

  tick();
  setInterval(tick, 60 * 60 * 1000);
  console.log('[leave] Leave renewal scheduler started (month-end accrual + year-end).');
}
