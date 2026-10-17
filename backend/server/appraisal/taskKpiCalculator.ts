import { QueryTypes } from 'sequelize';
import { Task, sequelize } from '../db.js';
import { Op } from 'sequelize';
import { clampScore } from './appraisalTypes.js';

const DONE_STATUSES = new Set(['DONE', 'COMPLETED']);

export type TaskKpiInput = {
  status: string;
  dueDate?: string | null;
  updatedAt?: string | null;
  /** Percent complete (0–100). A task at 100% counts as done even if status lags. */
  progress?: number | null;
};

/** Mirror of the projects module: a task is done by status OR by reaching 100% progress. */
function isTaskComplete(status: string, progress?: number | null): boolean {
  if (DONE_STATUSES.has(status)) return true;
  return Number(progress ?? 0) >= 100;
}

export function scoreTaskCompletionFromTasks(
  tasks: TaskKpiInput[],
  periodEndDate: string
): { score: number; breakdown: Record<string, number> } {
  if (!tasks.length) {
    return {
      score: 100,
      breakdown: { assigned: 0, completedOnTime: 0, overdue: 0, completed: 0 },
    };
  }

  const periodEnd = String(periodEndDate).slice(0, 10);
  let completedOnTime = 0;
  let overdue = 0;
  let completed = 0;

  for (const task of tasks) {
    const status = String(task.status ?? '').toUpperCase();
    const dueDate = String(task.dueDate ?? '').slice(0, 10);
    const completedOn = String(task.updatedAt ?? '').slice(0, 10);
    const isDone = isTaskComplete(status, task.progress);

    if (isDone) {
      completed += 1;
      if (!dueDate) {
        completedOnTime += 1;
      } else if (completedOn && completedOn <= dueDate) {
        completedOnTime += 1;
      } else if (!completedOn && dueDate >= periodEnd) {
        completedOnTime += 1;
      }
    } else if (dueDate && dueDate < periodEnd) {
      overdue += 1;
    }
  }

  const assigned = tasks.length;
  const onTimeRate = assigned > 0 ? (completedOnTime / assigned) * 100 : 100;
  const overduePenalty = overdue * 5;
  const score = clampScore(onTimeRate - overduePenalty);

  return {
    score,
    breakdown: {
      assigned,
      completedOnTime,
      overdue,
      completed,
    },
  };
}

export async function calculateTaskCompletionKpiScore(
  userId: string,
  startDate: string,
  endDate: string
): Promise<{ score: number; breakdown: Record<string, number> }> {
  const tasks = await Task.findAll({
    where: {
      assigneeId: userId,
      [Op.or]: [
        { dueDate: { [Op.between]: [startDate, endDate] } },
        { createdAt: { [Op.between]: [startDate, endDate] } },
      ],
    },
    attributes: ['status', 'dueDate', 'updatedAt', 'progress'],
  });

  return scoreTaskCompletionFromTasks(
    tasks.map((task) => ({
      status: String(task.get('status') ?? ''),
      dueDate: task.get('dueDate') as string | null,
      updatedAt: (task.get('updatedAt') as string | null) ?? null,
      progress: (task.get('progress') as number | null) ?? 0,
    })),
    endDate
  );
}

export async function previewTaskKpiForPeriod(
  userId: string,
  periodId: string
): Promise<{ score: number; breakdown: Record<string, number> }> {
  const rows = (await sequelize.query(
    `SELECT start_date, end_date FROM appraisal_periods WHERE id = :id LIMIT 1`,
    { replacements: { id: periodId }, type: QueryTypes.SELECT }
  )) as Array<{ start_date: string; end_date: string }>;
  const period = rows[0];
  if (!period) throw new Error('Appraisal period not found');
  return calculateTaskCompletionKpiScore(userId, String(period.start_date), String(period.end_date));
}
