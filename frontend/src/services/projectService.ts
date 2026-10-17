import { Api } from './api';
import { Project, ProjectStatus } from '../types';

export type ProjectListOptions = {
  /** When true, only projects with tasks assigned to the user. */
  tasksOnly?: boolean;
  /** Soft-delete listing mode for the API. */
  deleted?: 'exclude' | 'only' | 'include';
};

export const PROJECT_DELETED_FILTER = 'DELETED' as const;

export const projectService = {
  async getAll(
    status?: ProjectStatus | string,
    options?: ProjectListOptions
  ): Promise<Project[]> {
    const tasksOnly = options?.tasksOnly === true;
    const showDeletedOnly = status === PROJECT_DELETED_FILTER;
    const all = (await Api.projects.getAll({
      ...(tasksOnly ? { scope: 'self' as const } : {}),
      deleted: showDeletedOnly ? 'only' : options?.deleted ?? 'exclude',
    })) as Project[];
    if (!status || showDeletedOnly) return all;
    return all.filter((p) => p.status === status && !p.deletedAt);
  },

  async getById(id: string, options?: ProjectListOptions): Promise<Project | undefined> {
    try {
      const scope = options?.tasksOnly ? { scope: 'self' as const } : undefined;
      return (await Api.projects.getById(id, {
        ...scope,
        deleted: options?.deleted ?? 'include',
      })) as Project;
    } catch {
      return undefined;
    }
  },

  async create(project: Omit<Project, 'id'>): Promise<Project> {
    const created = await Api.projects.create(project);
    return created as Project;
  },

  async update(project: Project): Promise<Project> {
    return (await Api.projects.update(project)) as Project;
  },

  async delete(id: string): Promise<void> {
    await Api.projects.delete(id);
  },
};
