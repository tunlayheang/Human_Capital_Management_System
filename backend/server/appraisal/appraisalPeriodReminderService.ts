import { QueryTypes } from 'sequelize';
import { sequelize } from '../db.js';
import { businessDateKey } from '../payrollRunNotificationService.js';
import { notifyRoles } from '../notificationService.js';
import type { AppraisalPeriodRow } from './appraisalTypes.js';

function formatDateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export async function dispatchAppraisalPeriodAlertNotifications(
  dateKey: string = businessDateKey()
): Promise<number> {
  const today = dateKey.slice(0, 10);
  const periods = (await sequelize.query(
    `SELECT id, name, start_date, end_date, status, is_active, alert_notification_date, alert_notification_sent_at
     FROM appraisal_periods
     WHERE alert_notification_date IS NOT NULL
       AND DATE(alert_notification_date) = :today
       AND COALESCE(is_active, 1) = 1
       AND (
         alert_notification_sent_at IS NULL
         OR DATE(alert_notification_sent_at) <> :today
       )`,
    { replacements: { today }, type: QueryTypes.SELECT }
  )) as AppraisalPeriodRow[];

  if (!periods.length) return 0;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let sent = 0;

  for (const period of periods) {
    const start = formatDateOnly(period.start_date) ?? '';
    const end = formatDateOnly(period.end_date) ?? '';
    const status = String(period.status || 'DRAFT');

    await notifyRoles(['HR', 'ADMIN', 'MANAGER'], {
      idPrefix: `appraisal-period-alert-${period.id}-${today}`,
      title: 'KPI appraisal period reminder',
      message: `${period.name} (${start} → ${end}) — scheduled alert for today. Status: ${status.replace(/_/g, ' ')}. Open Performance → KPI appraisals to begin or continue reviews.`,
      type: 'INFO',
      link: '/performance?tab=kpi-appraisals',
    });

    await sequelize.query(
      `UPDATE appraisal_periods
       SET alert_notification_sent_at = :today, updated_at = :now
       WHERE id = :id`,
      { replacements: { id: period.id, today, now } }
    );
    sent += 1;
  }

  return sent;
}

let schedulerStarted = false;
let lastSchedulerDay = '';

export function startAppraisalPeriodReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastSchedulerDay === today) return;
    lastSchedulerDay = today;
    void dispatchAppraisalPeriodAlertNotifications(today).catch((err) => {
      console.warn(
        '[appraisal] Period alert tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
  console.log('[appraisal] Period alert notification scheduler started.');
}
