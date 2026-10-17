import { Op } from 'sequelize';
import { Project, ProjectAssignment, Task } from './db.js';
import { businessDateKey } from './payrollRunNotificationService.js';
import {
  createNotification,
  notifyUserIds,
  resolvePortalUserIdsForRefs,
} from './notificationService.js';

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function dispatchWorkDeadlineReminders(
  dateKey: string = businessDateKey()
): Promise<{ tasks: number; projects: number }> {
  const today = dateKey.slice(0, 10);
  const taskSoon = addDays(today, 2);
  const projectSoon = addDays(today, 7);
  let taskCount = 0;
  let projectCount = 0;

  const tasks: any[] = await Task.findAll({
    where: {
      status: { [Op.notIn]: ['DONE'] },
      dueDate: { [Op.lte]: taskSoon },
    },
  });
  for (const task of tasks) {
    const userId = String(task.assigneeId || '').trim();
    const dueDate = String(task.dueDate || '').slice(0, 10);
    if (!userId || !dueDate) continue;
    const overdue = dueDate < today;
    const link = task.projectId
      ? `/projects?project=${encodeURIComponent(String(task.projectId))}&task=${encodeURIComponent(String(task.id))}`
      : '/projects';
    await createNotification({
      id: overdue
        ? `task-overdue-${task.id}-${today}-${userId}`
        : `task-due-soon-${task.id}-${dueDate}-${userId}`,
      userId,
      title: overdue ? 'Task overdue' : 'Task deadline approaching',
      message: overdue
        ? `${task.title || 'A task'} was due on ${dueDate}. Update its status or due date.`
        : `${task.title || 'A task'} is due on ${dueDate}.`,
      type: 'WARNING',
      category: 'TASK',
      priority: overdue ? 'HIGH' : 'NORMAL',
      entityId: String(task.id),
      entityType: 'TASK',
      link,
    });
    taskCount += 1;
  }

  const projects: any[] = await Project.findAll({
    where: {
      status: { [Op.notIn]: ['COMPLETED', 'ARCHIVED'] },
      deadline: { [Op.lte]: projectSoon },
    },
  });
  for (const project of projects) {
    const deadline = String(project.deadline || '').slice(0, 10);
    if (!deadline) continue;
    const assignments = await ProjectAssignment.findAll({
      where: { projectId: String(project.id), isActive: true },
      attributes: ['employeeId'],
    });
    const recipients = await resolvePortalUserIdsForRefs([
      ...assignments.map((row) => row.get('employeeId')),
      project.leadId,
    ]);
    const overdue = deadline < today;
    await notifyUserIds(recipients, {
      idPrefix: overdue
        ? `project-overdue-${project.id}-${today}`
        : `project-due-soon-${project.id}-${deadline}`,
      title: overdue ? 'Project deadline passed' : 'Project deadline approaching',
      message: overdue
        ? `${project.title || 'A project'} was due on ${deadline}.`
        : `${project.title || 'A project'} is due on ${deadline}.`,
      type: 'WARNING',
      category: 'PROJECT',
      priority: overdue ? 'HIGH' : 'NORMAL',
      entityId: String(project.id),
      entityType: 'PROJECT',
      link: `/projects?project=${encodeURIComponent(String(project.id))}`,
    });
    projectCount += 1;
  }

  return { tasks: taskCount, projects: projectCount };
}

let schedulerStarted = false;
let lastDay = '';

export function startWorkDeadlineReminderScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = () => {
    const today = businessDateKey();
    if (lastDay === today) return;
    lastDay = today;
    void dispatchWorkDeadlineReminders(today).catch((error) => {
      console.warn('[notifications] work deadline reminder failed:', (error as Error).message);
    });
  };
  tick();
  setInterval(tick, 15 * 60 * 1000);
}

