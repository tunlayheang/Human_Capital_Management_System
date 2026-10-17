import { Op } from 'sequelize';
import { createNotification } from '../notificationService.js';
import { PersonalHubItem, ensurePersonalHubSchema } from './personalHubSchema.js';

function formatAlertWhen(alertAt: Date): string {
  return alertAt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function dispatchPersonalHubAlertNotifications(
  userId?: string
): Promise<number> {
  await ensurePersonalHubSchema();
  const now = new Date();

  const where: Record<string, unknown> = {
    kind: 'alert',
    isDone: false,
    alertAt: { [Op.lte]: now },
    alertNotifiedAt: { [Op.is]: null },
  };
  if (userId) where.userId = userId;

  const rows = await PersonalHubItem.findAll({
    where,
    order: [['alertAt', 'ASC']],
    limit: userId ? 50 : 200,
  });

  let sent = 0;
  for (const row of rows) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const ownerId = String(plain.userId ?? '').trim();
    const alertId = String(plain.id ?? '').trim();
    const title = String(plain.title ?? 'Reminder').trim() || 'Reminder';
    const notes = plain.body != null ? String(plain.body).trim() : '';
    const alertAtRaw = plain.alertAt ?? plain.createdAt;
    const alertAt =
      alertAtRaw instanceof Date ? alertAtRaw : new Date(String(alertAtRaw));
    if (!ownerId || !alertId || Number.isNaN(alertAt.getTime())) continue;

    const whenLabel = formatAlertWhen(alertAt);
    const overdue = alertAt.getTime() < now.getTime();
    await createNotification({
      id: `personal-hub-alert-${alertId}`,
      userId: ownerId,
      title: overdue ? 'Personal reminder overdue' : 'Personal reminder',
      message: notes
        ? `${title} — ${whenLabel}. ${notes}`
        : `${title} — scheduled for ${whenLabel}. Open My Workspace to review.`,
      type: overdue ? 'WARNING' : 'INFO',
      link: '/personal-analytics',
    });

    row.set('alertNotifiedAt', now);
    await row.save();
    sent += 1;
  }

  return sent;
}

let schedulerStarted = false;

export function startPersonalHubAlertReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    void dispatchPersonalHubAlertNotifications().catch((err) => {
      console.warn(
        '[personal-hub] Alert reminder tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 60 * 1000);
  console.log('[personal-hub] Personal reminder notification scheduler started (1 min).');
}
