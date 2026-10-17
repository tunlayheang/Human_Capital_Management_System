import { Employee, User } from '../db.js';
import { portalUserIdForDepartment } from '../departmentManager.js';
import { businessDateKey } from '../payrollRunNotificationService.js';
import { createNotification, notifyRoles } from '../notificationService.js';
import {
  computedProbationEndDate,
  formatDateOnly,
  normalizeWorkerType,
  resolveProbationPeriodMonths,
} from '../probationService.js';
import { effectiveProbationReviewDate, daysBetween } from './probationReviewStatus.js';
import { isEmployeeInProbationReviewScope } from './probationReviewService.js';
import { joinEmployeeNameParts } from '../employeeDisplayName.js';

const REMINDER_DAYS = [14, 7, 0] as const;

async function listActiveEmployeesOnProbation(today: string) {
  const employees: any[] = await Employee.findAll({
    where: { status: 'active', probation_confirmed_at: null },
    attributes: [
      'id',
      'employee_id',
      'first_name',
      'last_name',
      'join_date',
      'probation_period_months',
      'probation_next_review_date',
      'probation_confirmed_at',
      'worker_type',
      'department_id',
    ],
  });
  return employees
    .map((row) => (row.get ? row.get({ plain: true }) : row))
    .filter((emp) => isEmployeeInProbationReviewScope(emp))
    .map((emp) => {
      const join = formatDateOnly(emp.join_date) ?? today;
      const workerType = normalizeWorkerType(emp.worker_type);
      const months = resolveProbationPeriodMonths(emp.probation_period_months, workerType, true);
      const probationEnd = computedProbationEndDate(join, months) ?? join;
      const reviewDate = effectiveProbationReviewDate({
        probationEnd,
        nextReviewDate: emp.probation_next_review_date,
      });
      const daysRemaining = daysBetween(today, reviewDate);
      const name = joinEmployeeNameParts(emp.first_name, emp.last_name) || emp.employee_id;
      return { emp, name, reviewDate, daysRemaining };
    });
}

async function managerUserIdForEmployee(employee: {
  department_id?: string | null;
}): Promise<string | null> {
  return portalUserIdForDepartment(employee.department_id);
}

export async function dispatchProbationReviewReminders(
  dateKey: string = businessDateKey()
): Promise<number> {
  const today = dateKey.slice(0, 10);
  const queue = await listActiveEmployeesOnProbation(today);
  let sent = 0;

  for (const item of queue) {
    if (!REMINDER_DAYS.includes(item.daysRemaining as (typeof REMINDER_DAYS)[number])) {
      continue;
    }

    const dayLabel =
      item.daysRemaining === 0
        ? 'today'
        : item.daysRemaining === 7
          ? 'in 7 days'
          : 'in 14 days';

    const title =
      item.daysRemaining === 0
        ? 'Probation review due today'
        : `Probation review due ${dayLabel}`;

    const message = `${item.name} (${item.emp.employee_id}) — probation review ${dayLabel} (${item.reviewDate}). Open Performance → Probation review.`;
    const link = '/performance?tab=probation';
    const suffix = `${item.emp.employee_id}-${item.reviewDate}-${item.daysRemaining}`;

    await notifyRoles(['HR'], {
      idPrefix: `probation-reminder-hr-${suffix}`,
      title,
      message,
      type: item.daysRemaining === 0 ? 'WARNING' : 'INFO',
      link,
    });
    sent += 1;

    const managerUserId = await managerUserIdForEmployee(item.emp);
    if (managerUserId) {
      await createNotification({
        id: `probation-reminder-mgr-${suffix}-${managerUserId}`,
        userId: managerUserId,
        title,
        message,
        type: item.daysRemaining === 0 ? 'WARNING' : 'INFO',
        link,
      });
      sent += 1;
    }
  }

  return sent;
}

let schedulerStarted = false;
let lastSchedulerDay = '';

export function startProbationReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = () => {
    const today = businessDateKey();
    if (lastSchedulerDay === today) return;
    lastSchedulerDay = today;
    void dispatchProbationReviewReminders(today).catch((err) => {
      console.warn(
        '[probation] Reminder tick failed:',
        err instanceof Error ? err.message : err
      );
    });
  };

  tick();
  setInterval(tick, 15 * 60 * 1000);
  console.log('[probation] Review reminder scheduler started (14 / 7 / 0 days).');
}
