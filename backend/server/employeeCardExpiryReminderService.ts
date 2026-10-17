import { EmployeeIssuedCard } from './db.js';
import { businessDateKey } from './payrollRunNotificationService.js';
import { notifyRoles } from './notificationService.js';

/** Alert HR this many calendar days before the card expire_date. */
export const CARD_EXPIRY_REMINDER_DAYS = 7;

function addCalendarDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Notify HR for active employee ID cards that expire in exactly 7 days.
 * Uses stable notification ids so the same card/day only alerts once.
 */
export async function dispatchEmployeeCardExpiryReminders(
  dateKey: string = businessDateKey()
): Promise<number> {
  const today = dateKey.slice(0, 10);
  const targetExpire = addCalendarDays(today, CARD_EXPIRY_REMINDER_DAYS);

  const cards = await EmployeeIssuedCard.findAll({
    where: {
      status: 'active',
      expire_date: targetExpire,
    },
    attributes: [
      'id',
      'display_employee_id',
      'name_en',
      'expire_date',
      'position_title',
    ],
  });

  let sent = 0;
  for (const row of cards) {
    const plain = row.get({ plain: true }) as {
      id?: string;
      display_employee_id?: string;
      name_en?: string;
      expire_date?: string;
      position_title?: string;
    };
    const cardId = String(plain.id ?? '').trim();
    const empId = String(plain.display_employee_id ?? '').trim();
    if (!cardId || !empId) continue;

    const name = String(plain.name_en ?? '').trim() || empId;
    const expire = String(plain.expire_date ?? targetExpire).slice(0, 10);
    const title = 'Employee ID card expires in 7 days';
    const message = `${name} (${empId}) — ID card expires on ${expire}. Renew or reissue the card before it expires.`;
    const link = `/employees/card/${encodeURIComponent(empId)}/${encodeURIComponent(cardId)}`;
    const suffix = `${cardId}-${expire}-d${CARD_EXPIRY_REMINDER_DAYS}`;

    await notifyRoles(['HR', 'ADMIN'], {
      idPrefix: `card-expiry-hr-${suffix}`,
      title,
      message,
      type: 'WARNING',
      link,
    });
    sent += 1;
  }

  return sent;
}

let schedulerStarted = false;
let lastSchedulerDay = '';

export function startEmployeeCardExpiryReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastSchedulerDay === today) return;
    lastSchedulerDay = today;
    void dispatchEmployeeCardExpiryReminders(today).catch((err) => {
      console.warn(
        '[employee-card] Expiry reminder tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
  console.log(
    `[employee-card] Expiry reminder scheduler started (${CARD_EXPIRY_REMINDER_DAYS} days before expire).`
  );
}
