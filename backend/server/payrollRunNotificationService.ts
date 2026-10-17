import { Op } from 'sequelize';
import { PayrollCalendar, User } from './db.js';
import { createNotification } from './notificationService.js';

const PAYROLL_ROLES = new Set(['ADMIN', 'HR', 'SUPER_ADMIN']);
const NOTIFICATION_TYPE = 'INFO';

/** Cambodia business date (YYYY-MM-DD) for reminder scheduling. */
export function businessDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(date);
}

function formatDisplayDate(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Phnom_Penh',
  });
}

function parseCalendarRunDates(raw: unknown): string[] {
  if (raw == null || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const config =
    o.config != null && typeof o.config === 'object'
      ? (o.config as Record<string, unknown>)
      : o;
  if (!Array.isArray(config.runDates)) return [];
  return config.runDates.map((d) => String(d).slice(0, 10)).filter(Boolean);
}

export async function isPayrollRunScheduledOn(dateKey: string): Promise<boolean> {
  const rows = await PayrollCalendar.findAll();
  for (const row of rows) {
    const plain = row.get({ plain: true }) as { config?: unknown };
    const dates = parseCalendarRunDates(plain.config ?? plain);
    if (dates.some((d) => d.slice(0, 10) === dateKey)) return true;
  }
  return false;
}

export async function listPayrollRunNotificationRecipients(): Promise<string[]> {
  const users = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: [...PAYROLL_ROLES] },
    },
    attributes: ['id'],
  });
  return users.map((u) => String(u.get('id')));
}

export async function upsertPayrollRunNotification(
  userId: string,
  runDate: string
): Promise<void> {
  const key = runDate.slice(0, 10);
  const id = `payroll-run-${userId}-${key}`;
  const label = formatDisplayDate(key);
  await createNotification({
    id,
    userId,
    title: 'Payroll run today',
    message: `Scheduled payroll processing for ${label}. Open Payroll to review and process the run.`,
    type: NOTIFICATION_TYPE,
    link: '/payroll',
  });
}

/** Create in-app notifications for everyone who should process payroll on `dateKey`. */
export async function dispatchPayrollRunRemindersForDate(
  dateKey: string = businessDateKey()
): Promise<number> {
  const day = dateKey.slice(0, 10);
  const scheduled = await isPayrollRunScheduledOn(day);
  if (!scheduled) return 0;

  const recipients = await listPayrollRunNotificationRecipients();
  for (const userId of recipients) {
    await upsertPayrollRunNotification(userId, day);
  }
  if (recipients.length > 0) {
    console.log(
      `[payroll] Payroll run reminders sent for ${day} (${recipients.length} recipient(s))`
    );
  }
  return recipients.length;
}

let schedulerStarted = false;
let lastSchedulerDay = '';

export function startPayrollRunNotificationScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastSchedulerDay === today) return;
    lastSchedulerDay = today;
    void dispatchPayrollRunRemindersForDate(today).catch((err) => {
      console.warn(
        '[payroll] Payroll run reminder tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
  console.log('[payroll] Payroll run day notification scheduler started.');
}
