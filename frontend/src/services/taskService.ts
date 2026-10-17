import { Api } from './api';
import { Task } from '../types';

function asTasks(rows: unknown): Task[] {
  return Array.isArray(rows) ? (rows as Task[]) : [];
}

export type TaskListOptions = {
  deleted?: 'exclude' | 'only' | 'include';
};

export const taskService = {
  async getAll(options?: TaskListOptions): Promise<Task[]> {
    return asTasks(await Api.tasks.getAll({ deleted: options?.deleted ?? 'exclude' }));
  },

  async getByProject(projectId: string, options?: TaskListOptions): Promise<Task[]> {
    const all = await this.getAll(options);
    return all.filter((t) => t.projectId === projectId);
  },

  async create(
    task: Omit<Task, 'id' | 'createdAt'> & Partial<Pick<Task, 'id' | 'createdAt'>>
  ): Promise<Task> {
    const created = await Api.tasks.create(task);
    return created as Task;
  },

  async update(task: Task): Promise<Task> {
    const updated = await Api.tasks.update(task);
    return updated as Task;
  },

  async delete(id: string): Promise<void> {
    await Api.tasks.delete(id);
  },
};
