import { AuditLog, Notification, Project, ProjectAssignment, Task, sequelize } from './db.js';

const PROJECT_ID_RE = /^P(\d{4,})$/i;
const TASK_ID_RE = /^T(\d{1,6})$/i;

export function isCanonicalProjectId(value: string): boolean {
  return PROJECT_ID_RE.test(String(value ?? '').trim());
}

export function isCanonicalTaskId(value: string): boolean {
  return TASK_ID_RE.test(String(value ?? '').trim());
}

function parseProjectNumber(id: unknown): number {
  const m = String(id ?? '').trim().match(PROJECT_ID_RE);
  return m ? Number(m[1]) : 0;
}

function parseTaskNumber(id: unknown): number {
  const m = String(id ?? '').trim().match(TASK_ID_RE);
  return m ? Number(m[1]) : 0;
}

export async function generateNextProjectId(): Promise<string> {
  const rows = (await Project.findAll({
    attributes: ['id'],
    raw: true,
  })) as Array<{ id?: string }>;
  const max = rows.reduce((n, row) => Math.max(n, parseProjectNumber(row.id)), 0);
  return `P${String(max + 1).padStart(4, '0')}`;
}

export async function generateNextTaskId(): Promise<string> {
  const rows = (await Task.findAll({
    attributes: ['id'],
    raw: true,
  })) as Array<{ id?: string }>;
  const max = rows.reduce((n, row) => Math.max(n, parseTaskNumber(row.id)), 0);
  const next = max + 1;
  if (next > 999999) {
    throw new Error('Task ticket sequence exceeded T999999');
  }
  return `T${next}`;
}

function replaceStrings(value: unknown, pairs: ReadonlyMap<string, string>): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const [from, to] of pairs) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, pairs));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = replaceStrings(entry, pairs);
    }
    return out;
  }
  return value;
}

/**
 * One-time normalization of legacy project/task ids to:
 * - Project: P0001, P0002, ...
 * - Task: T1, T2, ...
 */
export async function ensureCanonicalProjectTaskIds(): Promise<void> {
  const projects = (await Project.findAll({
    attributes: ['id', 'createdAt'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    raw: true,
  })) as Array<{ id?: string; createdAt?: string | null }>;
  const tasks = (await Task.findAll({
    attributes: ['id', 'createdAt', 'projectId'],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
    raw: true,
  })) as Array<{ id?: string; createdAt?: string | null; projectId?: string | null }>;

  let nextProject = projects.reduce((n, row) => Math.max(n, parseProjectNumber(row.id)), 0);
  const projectMap = new Map<string, string>();
  for (const row of projects) {
    const oldId = String(row.id ?? '').trim();
    if (!oldId || isCanonicalProjectId(oldId)) continue;
    nextProject += 1;
    projectMap.set(oldId, `P${String(nextProject).padStart(4, '0')}`);
  }

  let nextTask = tasks.reduce((n, row) => Math.max(n, parseTaskNumber(row.id)), 0);
  const taskMap = new Map<string, string>();
  for (const row of tasks) {
    const oldId = String(row.id ?? '').trim();
    if (!oldId || isCanonicalTaskId(oldId)) continue;
    nextTask += 1;
    taskMap.set(oldId, `T${nextTask}`);
  }

  if (!projectMap.size && !taskMap.size) return;

  const allPairs = new Map<string, string>([...projectMap, ...taskMap]);

  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction });
    try {
      for (const [oldId, newId] of projectMap) {
        await ProjectAssignment.update({ projectId: newId }, { where: { projectId: oldId }, transaction });
        await Task.update({ projectId: newId }, { where: { projectId: oldId }, transaction });
        await Project.update({ id: newId }, { where: { id: oldId }, transaction });
      }

      for (const [oldId, newId] of taskMap) {
        await Task.update({ id: newId }, { where: { id: oldId }, transaction });
      }

      const notifications = (await Notification.findAll({
        attributes: ['id', 'entityId', 'link'],
        raw: true,
        transaction,
      })) as Array<{ id?: string; entityId?: string | null; link?: string | null }>;
      for (const row of notifications) {
        const id = String(row.id ?? '').trim();
        if (!id) continue;
        const entityId = row.entityId ? String(replaceStrings(row.entityId, allPairs)) : row.entityId;
        const link = row.link ? String(replaceStrings(row.link, allPairs)) : row.link;
        if (entityId === row.entityId && link === row.link) continue;
        await Notification.update({ entityId, link }, { where: { id }, transaction });
      }

      const logs = (await AuditLog.findAll({
        attributes: ['id', 'entityId', 'metadata', 'oldValue', 'newValue'],
        raw: true,
        transaction,
      })) as Array<{
        id?: string;
        entityId?: string | null;
        metadata?: unknown;
        oldValue?: unknown;
        newValue?: unknown;
      }>;
      for (const row of logs) {
        const id = String(row.id ?? '').trim();
        if (!id) continue;
        const entityId = row.entityId ? String(replaceStrings(row.entityId, allPairs)) : row.entityId;
        const metadata = replaceStrings(row.metadata, allPairs);
        const oldValue = replaceStrings(row.oldValue, allPairs);
        const newValue = replaceStrings(row.newValue, allPairs);
        if (
          entityId === row.entityId &&
          JSON.stringify(metadata) === JSON.stringify(row.metadata) &&
          JSON.stringify(oldValue) === JSON.stringify(row.oldValue) &&
          JSON.stringify(newValue) === JSON.stringify(row.newValue)
        ) {
          continue;
        }
        await AuditLog.update({ entityId, metadata, oldValue, newValue }, { where: { id }, transaction });
      }
    } finally {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction });
    }
  });

  console.log(
    `[db] Canonicalized ids: ${projectMap.size} project(s), ${taskMap.size} task(s).`
  );
}
