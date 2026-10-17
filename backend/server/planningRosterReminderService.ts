import { Op } from 'sequelize';
import { User } from './db.js';
import { businessDateKey } from './payrollRunNotificationService.js';
import {
  getEffectivePermissionsForUser,
  hasEffectivePermission,
} from './effectivePermissions.js';
import { createNotification } from './notificationService.js';
import { listMonthlyPlanningRosters } from './monthlyPlanningRosterService.js';

const NOTIFICATION_TYPE = 'WARNING';

/** True on the calendar day that is exactly two days before month-end (Asia/Phnom_Penh). */
export function isPlanningRosterReminderDay(dateKey: string): boolean {
  const parts = dateKey.slice(0, 10).split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
  const [year, month1, day] = parts;
  const daysInMonth = new Date(year, month1, 0).getDate();
  return day === daysInMonth - 2;
}

export function nextCalendarMonth(dateKey: string): {
  month: number;
  year: number;
  label: string;
  periodKey: string;
} {
  const [year, month1] = dateKey.slice(0, 10).split('-').map(Number);
  const next = new Date(year, month1, 1);
  const month = next.getMonth();
  const y = next.getFullYear();
  const label = next.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Phnom_Penh',
  });
  return {
    month,
    year: y,
    label,
    periodKey: `${y}-${String(month + 1).padStart(2, '0')}`,
  };
}

/** HR users who can access Leaves → Planning (leave.view or leave.edit). */
export async function hasLeavePlanningAccess(userId: string): Promise<boolean> {
  const user: any = await User.findByPk(userId, { attributes: ['id', 'role', 'isActive'] });
  if (!user || user.isActive === false) return false;
  const role = String(user.role || '').toUpperCase();
  if (role !== 'HR') return false;
  const perms = await getEffectivePermissionsForUser(userId);
  return (
    hasEffectivePermission(perms, 'leave.edit') || hasEffectivePermission(perms, 'leave.view')
  );
}

export async function listPlanningRosterReminderRecipients(): Promise<string[]> {
  const users = await User.findAll({
    where: { isActive: true, role: { [Op.in]: ['HR'] } },
    attributes: ['id'],
  });
  const recipients: string[] = [];
  for (const row of users) {
    const id = String(row.get('id'));
    if (await hasLeavePlanningAccess(id)) recipients.push(id);
  }
  return recipients;
}

async function nextMonthRosterAlreadyExists(month: number, year: number): Promise<boolean> {
  const rows = await listMonthlyPlanningRosters({ month, year });
  return rows.length > 0;
}

export async function upsertPlanningRosterReminderNotification(
  userId: string,
  periodKey: string,
  monthLabel: string
): Promise<void> {
  await createNotification({
    id: `roster-planning-reminder-${userId}-${periodKey}`,
    userId,
    title: 'Create next month roster',
    message: `Please create the fixed roster for ${monthLabel}. Open Leaves → Planning to set up team coverage before the new month starts.`,
    type: NOTIFICATION_TYPE,
    link: '/leaves?scope=manage&tab=planning',
  });
}

/** Notify HR (with Planning access) 2 days before month-end if next month's roster is missing. */
export async function dispatchPlanningRosterReminders(
  dateKey: string = businessDateKey()
): Promise<number> {
  const day = dateKey.slice(0, 10);
  if (!isPlanningRosterReminderDay(day)) return 0;

  const { month, year, label, periodKey } = nextCalendarMonth(day);
  if (await nextMonthRosterAlreadyExists(month, year)) {
    console.log(
      `[roster] Planning reminder skipped — roster already exists for ${label}`
    );
    return 0;
  }

  const recipients = await listPlanningRosterReminderRecipients();
  for (const userId of recipients) {
    await upsertPlanningRosterReminderNotification(userId, periodKey, label);
  }
  if (recipients.length > 0) {
    console.log(
      `[roster] Planning roster reminders sent for ${label} (${recipients.length} HR user(s))`
    );
  }
  return recipients.length;
}

let schedulerStarted = false;
let lastSchedulerDay = '';

export function startPlanningRosterReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastSchedulerDay === today) return;
    lastSchedulerDay = today;
    void dispatchPlanningRosterReminders(today).catch((err) => {
      console.warn(
        '[roster] Planning roster reminder tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
  console.log('[roster] Planning roster reminder scheduler started (2 days before month-end).');
}
