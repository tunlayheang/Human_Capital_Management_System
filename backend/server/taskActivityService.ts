import { Op } from 'sequelize';
import { AuditLog, Employee, Task, User, sequelize } from './db.js';
import {
  diffAuditSnapshots,
  pickAuditFields,
  writeDomainAudit,
} from './domainAuditService.js';

/** Canonical + legacy entityType values used in auditlogs for tasks. */
export const TASK_ENTITY_TYPE = 'tasks';
export const TASK_ENTITY_TYPES = ['tasks', 'Task', 'TASK', 'task'] as const;

const TASK_AUDIT_KEYS = [
  'title',
  'description',
  'projectId',
  'assigneeId',
  'status',
  'progress',
  'priority',
  'startDate',
  'dueDate',
  'estimatedHours',
  'loggedHours',
] as const;

export type TaskActivityAction =
  | 'CREATED'
  | 'UPDATED'
  | 'HANDED_OVER'
  | 'PROGRESS_UPDATED'
  | 'STATUS_CHANGED'
  | 'DELETED';

export type TaskActivityEntry = {
  id: string;
  taskId: string;
  projectId: string | null;
  action: TaskActivityAction | string;
  summary: string;
  taskTitle: string;
  performedBy: string | null;
  performedByName: string | null;
  at: string;
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  oldAssigneeId?: string | null;
  newAssigneeId?: string | null;
  oldAssigneeName?: string | null;
  newAssigneeName?: string | null;
};

function plainTask(row: unknown): Record<string, unknown> {
  if (!row) return {};
  const anyRow = row as { get?: (opts: { plain: boolean }) => Record<string, unknown> };
  if (typeof anyRow.get === 'function') return anyRow.get({ plain: true }) ?? {};
  return row as Record<string, unknown>;
}

function taskTitleOf(snapshot: Record<string, unknown> | null | undefined): string {
  const title = String(snapshot?.title ?? '').trim();
  return title || 'Untitled task';
}

function parseJsonValue(input: unknown): unknown {
  if (input == null) return null;
  if (typeof input === 'object') return input;
  if (typeof input !== 'string') return input;
  let current: unknown = input.trim();
  if (!current) return null;
  // Audit JSON columns are often double-encoded (LONGTEXT + DataTypes.JSON).
  // Keep parsing while the value remains a JSON string.
  for (let i = 0; i < 4; i += 1) {
    if (typeof current !== 'string') break;
    const s = current.trim();
    if (!s) return null;
    try {
      current = JSON.parse(s);
    } catch {
      return current;
    }
  }
  return current;
}

function asRecord(input: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(input);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  try {
    const rows = (await User.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'display_name', 'email', 'employeeId'],
      raw: true,
    })) as Array<{
      id?: string;
      display_name?: string | null;
      email?: string | null;
      employeeId?: string | null;
    }>;
    const employeeIds = rows
      .map((r) => String(r.employeeId ?? '').trim())
      .filter(Boolean);
    const empNameById = new Map<string, string>();
    if (employeeIds.length) {
      try {
        const emps = (await Employee.findAll({
          where: { id: { [Op.in]: employeeIds } },
          attributes: ['id', 'first_name', 'last_name', 'preferred_name'],
          raw: true,
        })) as Array<{
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          preferred_name?: string | null;
        }>;
        for (const emp of emps) {
          const eid = String(emp.id ?? '').trim();
          if (!eid) continue;
          const preferred = String(emp.preferred_name ?? '').trim();
          const full = `${String(emp.first_name ?? '').trim()} ${String(emp.last_name ?? '').trim()}`.trim();
          empNameById.set(eid, preferred || full || eid);
        }
      } catch {
        /* preferred_name may be missing on older schemas */
        try {
          const emps = (await Employee.findAll({
            where: { id: { [Op.in]: employeeIds } },
            attributes: ['id', 'first_name', 'last_name'],
            raw: true,
          })) as Array<{ id?: string; first_name?: string | null; last_name?: string | null }>;
          for (const emp of emps) {
            const eid = String(emp.id ?? '').trim();
            if (!eid) continue;
            const full = `${String(emp.first_name ?? '').trim()} ${String(emp.last_name ?? '').trim()}`.trim();
            empNameById.set(eid, full || eid);
          }
        } catch {
          /* non-fatal */
        }
      }
    }
    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (!id) continue;
      const fromEmp = empNameById.get(String(row.employeeId ?? '').trim());
      const name =
        String(row.display_name ?? '').trim() ||
        fromEmp ||
        String(row.email ?? '').trim() ||
        id;
      map.set(id, name);
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

function classifyUpdateAction(changed: Record<string, unknown>): TaskActivityAction {
  const keys = Object.keys(changed);
  // Track priority: handover → status → progress → generic update.
  if (keys.includes('assigneeId')) return 'HANDED_OVER';
  if (keys.includes('status')) return 'STATUS_CHANGED';
  if (keys.includes('progress')) return 'PROGRESS_UPDATED';
  return 'UPDATED';
}

function buildUpdateSummary(
  action: TaskActivityAction,
  title: string,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  nameById: Map<string, string>
): string {
  if (action === 'HANDED_OVER' || 'assigneeId' in newValue) {
    const fromId = String(oldValue.assigneeId ?? '').trim();
    const toId = String(newValue.assigneeId ?? '').trim();
    const fromName = fromId ? nameById.get(fromId) || fromId : 'Unassigned';
    const toName = toId ? nameById.get(toId) || toId : 'Unassigned';
    if ('assigneeId' in newValue && Object.keys(newValue).length === 1) {
      return `Handed over “${title}” from ${fromName} to ${toName}`;
    }
    return `Updated “${title}” and handed over from ${fromName} to ${toName}`;
  }
  if (action === 'PROGRESS_UPDATED') {
    const from = oldValue.progress ?? 0;
    const to = newValue.progress ?? 0;
    return `Updated progress on “${title}” from ${from}% to ${to}%`;
  }
  if (action === 'STATUS_CHANGED') {
    const from = String(oldValue.status ?? '').trim() || '—';
    const to = String(newValue.status ?? '').trim() || '—';
    return `Changed status on “${title}” from ${from} to ${to}`;
  }
  const fields = Object.keys(newValue);
  if (fields.length <= 3) {
    return `Updated “${title}” (${fields.join(', ')})`;
  }
  return `Updated “${title}” (${fields.length} fields)`;
}

export async function logTaskCreated(params: {
  task: unknown;
  performedBy?: string | null;
}): Promise<void> {
  const snapshot = plainTask(params.task);
  const taskId = String(snapshot.id ?? '').trim();
  if (!taskId) return;
  const projectId = String(snapshot.projectId ?? '').trim() || null;
  const title = taskTitleOf(snapshot);
  await writeDomainAudit({
    entityType: TASK_ENTITY_TYPE,
    entityId: taskId,
    action: 'CREATED',
    performedBy: params.performedBy,
    oldValue: null,
    newValue: pickAuditFields(snapshot, [...TASK_AUDIT_KEYS]),
    reason: `Created task “${title}”`,
    metadata: {
      projectId,
      taskTitle: title,
      kind: 'created',
    },
  });
}

export async function logTaskUpdated(params: {
  before: unknown;
  after: unknown;
  performedBy?: string | null;
}): Promise<boolean> {
  const before = plainTask(params.before);
  const after = plainTask(params.after);
  const taskId = String(after.id ?? before.id ?? '').trim();
  if (!taskId) return false;

  const diff = diffAuditSnapshots(before, after, [...TASK_AUDIT_KEYS]);
  if (!diff) return false;

  const nameById = await resolveUserNames([
    String(diff.oldValue.assigneeId ?? ''),
    String(diff.newValue.assigneeId ?? ''),
  ]);
  const action = classifyUpdateAction(diff.newValue);
  const title = taskTitleOf(after.title ? after : before);
  const summary = buildUpdateSummary(action, title, diff.oldValue, diff.newValue, nameById);
  const projectId = String(after.projectId ?? before.projectId ?? '').trim() || null;

  await writeDomainAudit({
    entityType: TASK_ENTITY_TYPE,
    entityId: taskId,
    action,
    performedBy: params.performedBy,
    oldValue: diff.oldValue,
    newValue: diff.newValue,
    reason: summary,
    metadata: {
      projectId,
      taskTitle: title,
      kind: action === 'HANDED_OVER' ? 'handover' : 'update',
      oldAssigneeId: diff.oldValue.assigneeId ?? null,
      newAssigneeId: diff.newValue.assigneeId ?? null,
      statusChange:
        action === 'STATUS_CHANGED'
          ? {
              before: diff.oldValue.status ?? null,
              after: diff.newValue.status ?? null,
            }
          : undefined,
      progressChange:
        action === 'PROGRESS_UPDATED' ||
        Object.prototype.hasOwnProperty.call(diff.newValue, 'progress')
          ? {
              before: diff.oldValue.progress ?? null,
              after: diff.newValue.progress ?? null,
            }
          : undefined,
    },
  });
  return true;
}

export async function logTaskDeleted(params: {
  task: unknown;
  performedBy?: string | null;
}): Promise<void> {
  const snapshot = plainTask(params.task);
  const taskId = String(snapshot.id ?? '').trim();
  if (!taskId) return;
  const projectId = String(snapshot.projectId ?? '').trim() || null;
  const title = taskTitleOf(snapshot);
  await writeDomainAudit({
    entityType: TASK_ENTITY_TYPE,
    entityId: taskId,
    action: 'DELETED',
    performedBy: params.performedBy,
    oldValue: pickAuditFields(snapshot, [...TASK_AUDIT_KEYS]),
    newValue: null,
    reason: `Cancelled task “${title}”`,
    metadata: {
      projectId,
      taskTitle: title,
      kind: 'deleted',
    },
  });
}

export async function logProjectDeleted(params: {
  project: unknown;
  performedBy?: string | null;
}): Promise<void> {
  const snapshot =
    params.project && typeof params.project === 'object'
      ? ((params.project as { get?: (o: { plain: boolean }) => Record<string, unknown> }).get
          ? (params.project as { get: (o: { plain: boolean }) => Record<string, unknown> }).get({
              plain: true,
            })
          : { ...(params.project as Record<string, unknown>) })
      : {};
  const projectId = String(snapshot.id ?? '').trim();
  if (!projectId) return;
  const title = String(snapshot.title ?? 'Project').trim() || 'Project';
  await writeDomainAudit({
    entityType: 'projects',
    entityId: projectId,
    action: 'DELETED',
    performedBy: params.performedBy,
    oldValue: pickAuditFields(snapshot, [
      'title',
      'description',
      'status',
      'progress',
      'deadline',
      'startDate',
      'priority',
      'departmentId',
      'leadId',
    ]),
    newValue: null,
    reason: `Cancelled project “${title}”`,
    metadata: {
      projectTitle: title,
      kind: 'deleted',
    },
  });
}

function metadataOf(row: Record<string, unknown>): Record<string, unknown> {
  return asRecord(row.metadata);
}

function extractTaskSnapshot(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  if (root.request && typeof root.request === 'object') {
    return asRecord(root.request);
  }
  // HTTP middleware sometimes double-stringifies the response payload.
  if (typeof root.response === 'string' || (root.response && typeof root.response === 'object')) {
    const parsed = asRecord(root.response);
    if (Object.keys(parsed).length) return parsed;
  }
  // Domain audits store the task field diff / snapshot at the root.
  return root;
}

function changesFromSnapshots(
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>
): Array<{ field: string; from: unknown; to: unknown }> {
  const keys = Array.from(new Set([...Object.keys(oldValue), ...Object.keys(newValue)]));
  return keys
    .filter((field) => JSON.stringify(oldValue[field] ?? null) !== JSON.stringify(newValue[field] ?? null))
    .map((field) => ({
      field,
      from: oldValue[field] ?? null,
      to: newValue[field] ?? null,
    }));
}

/** Map raw audit action (+ payload) onto Activity track actions. */
function normalizeActivityAction(
  rawAction: string,
  oldSnap: Record<string, unknown>,
  newSnap: Record<string, unknown>,
  meta: Record<string, unknown>
): TaskActivityAction {
  const a = String(rawAction || '').toUpperCase().replace(/\s+/g, '_');
  if (a === 'CREATED' || a === 'CREATE') return 'CREATED';
  if (a === 'DELETED' || a === 'DELETE') return 'DELETED';
  if (a === 'HANDED_OVER') return 'HANDED_OVER';
  if (a === 'PROGRESS_UPDATED') return 'PROGRESS_UPDATED';
  if (a === 'STATUS_CHANGED' || a === 'STATUS_CHANGE') {
    const statusMeta = asRecord(meta.statusChange);
    const beforeStatus = Object.prototype.hasOwnProperty.call(statusMeta, 'before')
      ? statusMeta.before
      : oldSnap.status;
    const afterStatus = Object.prototype.hasOwnProperty.call(statusMeta, 'after')
      ? statusMeta.after
      : newSnap.status;
    const statusChanged = JSON.stringify(beforeStatus ?? null) !== JSON.stringify(afterStatus ?? null);
    const assigneeChanged =
      Object.prototype.hasOwnProperty.call(oldSnap, 'assigneeId') &&
      JSON.stringify(oldSnap.assigneeId ?? null) !== JSON.stringify(newSnap.assigneeId ?? null);
    if (assigneeChanged) return 'HANDED_OVER';
    // Prefer Status track when the mutation was tagged as a status change.
    if (statusChanged || Object.prototype.hasOwnProperty.call(statusMeta, 'after')) {
      return 'STATUS_CHANGED';
    }
    if (
      Object.prototype.hasOwnProperty.call(newSnap, 'progress') &&
      Object.prototype.hasOwnProperty.call(oldSnap, 'progress') &&
      JSON.stringify(oldSnap.progress ?? null) !== JSON.stringify(newSnap.progress ?? null)
    ) {
      return 'PROGRESS_UPDATED';
    }
    return 'STATUS_CHANGED';
  }
  if (a === 'UPDATE' || a === 'UPDATED') {
    return classifyUpdateAction(
      Object.fromEntries(changesFromSnapshots(oldSnap, newSnap).map((c) => [c.field, c.to]))
    );
  }
  return classifyUpdateAction(
    Object.fromEntries(changesFromSnapshots(oldSnap, newSnap).map((c) => [c.field, c.to]))
  );
}

function buildHttpSummary(
  action: TaskActivityAction,
  title: string,
  oldSnap: Record<string, unknown>,
  newSnap: Record<string, unknown>,
  meta: Record<string, unknown>,
  nameById: Map<string, string>
): string {
  const statusMeta = asRecord(meta.statusChange);
  const statusBefore = statusMeta.before ?? oldSnap.status ?? null;
  const statusAfter = statusMeta.after ?? newSnap.status ?? null;
  if (action === 'CREATED') return `Created task “${title}”`;
  if (action === 'DELETED') return `Cancelled task “${title}”`;
  if (action === 'STATUS_CHANGED') {
    const from = String(statusBefore ?? '').trim() || '—';
    const to = String(statusAfter ?? '').trim() || '—';
    return `Changed status on “${title}” from ${from} to ${to}`;
  }
  if (action === 'PROGRESS_UPDATED') {
    const from = oldSnap.progress ?? statusMeta.beforeProgress ?? 0;
    const to = newSnap.progress ?? statusMeta.afterProgress ?? 0;
    return `Updated progress on “${title}” from ${from}% to ${to}%`;
  }
  if (action === 'HANDED_OVER') {
    const fromId = String(meta.oldAssigneeId ?? oldSnap.assigneeId ?? '').trim();
    const toId = String(meta.newAssigneeId ?? newSnap.assigneeId ?? '').trim();
    const fromName = fromId ? nameById.get(fromId) || fromId : 'Unassigned';
    const toName = toId ? nameById.get(toId) || toId : 'Unassigned';
    return `Handed over “${title}” from ${fromName} to ${toName}`;
  }
  return `Updated “${title}”`;
}

/** Activity feed for a project: task creates, updates, handovers, deletes. */
export async function listTaskActivityForProject(
  projectId: string,
  options?: { limit?: number }
): Promise<TaskActivityEntry[]> {
  const pid = String(projectId ?? '').trim();
  if (!pid) return [];
  const limit = Math.min(Math.max(Number(options?.limit) || 100, 1), 300);

  // Include soft-deleted tasks so Deleted track still resolves titles / ids.
  const projectTasks = (await Task.findAll({
    where: { projectId: pid },
    attributes: ['id', 'title', 'assigneeId'],
    raw: true,
  })) as Array<{ id?: string; title?: string; assigneeId?: string | null }>;
  const taskIds = projectTasks.map((t) => String(t.id ?? '').trim()).filter(Boolean);
  const titleByTaskId = new Map(
    projectTasks.map((t) => [String(t.id ?? '').trim(), String(t.title ?? '').trim()])
  );

  let rows: Array<Record<string, unknown>> = [];
  try {
    const entityTypeWhere = { entityType: { [Op.in]: [...TASK_ENTITY_TYPES] } };
    const projectMetaWhere = sequelize.where(
      sequelize.fn(
        'JSON_UNQUOTE',
        sequelize.fn('JSON_EXTRACT', sequelize.col('metadata'), sequelize.literal(`'$.projectId'`))
      ),
      pid
    );

    rows = (await AuditLog.findAll({
      where: taskIds.length
        ? {
            ...entityTypeWhere,
            [Op.or]: [{ entityId: { [Op.in]: taskIds } }, projectMetaWhere],
          }
        : {
            ...entityTypeWhere,
            [Op.and]: [projectMetaWhere],
          },
      order: [['createdAt', 'DESC']],
      limit: Math.min(limit * 4, 500),
      raw: true,
    })) as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn(
      '[task-activity] enriched query failed, falling back to task ids:',
      (err as Error)?.message || err
    );
    if (!taskIds.length) return [];
    rows = (await AuditLog.findAll({
      where: {
        entityType: { [Op.in]: [...TASK_ENTITY_TYPES] },
        entityId: { [Op.in]: taskIds },
      },
      order: [['createdAt', 'DESC']],
      limit: Math.min(limit * 4, 500),
      raw: true,
    })) as Array<Record<string, unknown>>;
  }

  // Keep only rows that belong to this project.
  const filtered = rows.filter((row) => {
    const entityType = String(row.entityType ?? '').toLowerCase();
    if (!TASK_ENTITY_TYPES.map((t) => t.toLowerCase()).includes(entityType)) return false;
    const meta = metadataOf(row);
    const metaProject = String(meta.projectId ?? '').trim();
    if (metaProject) return metaProject === pid;
    const taskId = String(row.entityId ?? '').trim();
    if (taskIds.includes(taskId)) return true;
    // HTTP mutation payload embeds projectId on the task body.
    const snap = extractTaskSnapshot(row.newValue);
    return String(snap.projectId ?? '').trim() === pid;
  });

  const actorIds = filtered.map((r) => String(r.performedBy ?? '').trim()).filter(Boolean);
  const assigneeIds: string[] = [];
  for (const row of filtered) {
    const meta = metadataOf(row);
    const oldSnap = {
      ...extractTaskSnapshot(row.oldValue),
      ...('status' in asRecord(row.oldValue) ? asRecord(row.oldValue) : {}),
    };
    const newSnap = extractTaskSnapshot(row.newValue);
    for (const id of [
      meta.oldAssigneeId,
      meta.newAssigneeId,
      oldSnap.assigneeId,
      newSnap.assigneeId,
    ]) {
      const s = String(id ?? '').trim();
      if (s) assigneeIds.push(s);
    }
  }
  const nameById = await resolveUserNames([...actorIds, ...assigneeIds]);

  const seen = new Set<string>();
  const entries: TaskActivityEntry[] = [];
  for (const row of filtered) {
    const id = String(row.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const meta = metadataOf(row);
    const taskId = String(row.entityId ?? '').trim();
    const oldSnapRaw = asRecord(row.oldValue);
    const newSnapRaw = asRecord(row.newValue);
    const newSnap = extractTaskSnapshot(row.newValue);
    const statusMeta = asRecord(meta.statusChange);
    const progressMeta = asRecord(meta.progressChange);
    const isHttp = String(meta.source ?? '') === 'http_mutation';
    const oldSnap: Record<string, unknown> = {
      ...extractTaskSnapshot(row.oldValue),
      ...oldSnapRaw,
    };
    if (isHttp) {
      // HTTP oldValue is often incomplete ({ status: null }). Prefer statusChange metadata.
      if (Object.prototype.hasOwnProperty.call(statusMeta, 'before')) {
        oldSnap.status = statusMeta.before;
      } else if (!Object.prototype.hasOwnProperty.call(oldSnapRaw, 'status')) {
        oldSnap.status = null;
      }
      if (Object.prototype.hasOwnProperty.call(progressMeta, 'before')) {
        oldSnap.progress = progressMeta.before;
      }
      // Do not invent assignee/progress before-values from the after snapshot.
      if (!Object.prototype.hasOwnProperty.call(oldSnapRaw, 'progress') && !('before' in progressMeta)) {
        delete oldSnap.progress;
      }
      if (!Object.prototype.hasOwnProperty.call(oldSnapRaw, 'assigneeId')) {
        delete oldSnap.assigneeId;
      }
    }
    // Prefer explicit after values from metadata when the snapshot is incomplete.
    if (
      (newSnap.status == null || newSnap.status === '') &&
      Object.prototype.hasOwnProperty.call(statusMeta, 'after')
    ) {
      newSnap.status = statusMeta.after;
    }
    if (
      (newSnap.progress == null || newSnap.progress === '') &&
      Object.prototype.hasOwnProperty.call(progressMeta, 'after')
    ) {
      newSnap.progress = progressMeta.after;
    }

    const action = normalizeActivityAction(String(row.action ?? ''), oldSnap, newSnap, meta);
    const title =
      String(meta.taskTitle ?? '').trim() ||
      titleByTaskId.get(taskId) ||
      String(newSnap.title ?? '').trim() ||
      String(oldSnap.title ?? '').trim() ||
      'Untitled task';

    const changes = isHttp
      ? buildHttpChanges(action, oldSnap, newSnap, meta)
      : (() => {
          if (action === 'DELETED') {
            return buildHttpChanges(action, oldSnapRaw, newSnapRaw, meta);
          }
          const domainChanges = changesFromSnapshots(oldSnapRaw, newSnapRaw);
          // Domain rows store only changed fields — keep them, but drop HTTP wrapper keys.
          return domainChanges.filter(
            (c) =>
              c.field !== 'request' &&
              c.field !== 'response' &&
              c.field !== 'source' &&
              (TASK_AUDIT_KEYS as readonly string[]).includes(c.field)
          );
        })();

    // Guarantee status/progress rows expose usable change chips even for legacy HTTP audits.
    if (
      (action === 'STATUS_CHANGED' || action === 'STATUS_CHANGE') &&
      !changes.some((c) => c.field === 'status')
    ) {
      changes.unshift({
        field: 'status',
        from: statusMeta.before ?? oldSnap.status ?? null,
        to: statusMeta.after ?? newSnap.status ?? null,
      });
    }
    if (
      action === 'PROGRESS_UPDATED' &&
      !changes.some((c) => c.field === 'progress')
    ) {
      changes.unshift({
        field: 'progress',
        from: progressMeta.before ?? oldSnap.progress ?? null,
        to: progressMeta.after ?? newSnap.progress ?? null,
      });
    }

    const performedBy = String(row.performedBy ?? '').trim() || null;
    const assigneeChanged =
      action === 'HANDED_OVER' ||
      changes.some((c) => c.field === 'assigneeId') ||
      (Object.prototype.hasOwnProperty.call(oldSnap, 'assigneeId') &&
        JSON.stringify(oldSnap.assigneeId ?? null) !== JSON.stringify(newSnap.assigneeId ?? null));
    // Only expose assignee ids when this event is actually a handover / assignee change.
    // Otherwise Status/Progress rows would incorrectly fill the Handovers track.
    const oldAssigneeId = assigneeChanged
      ? String(meta.oldAssigneeId ?? oldSnap.assigneeId ?? '').trim() || null
      : null;
    const newAssigneeId = assigneeChanged
      ? String(meta.newAssigneeId ?? newSnap.assigneeId ?? '').trim() || null
      : null;

    const atRaw = row.createdAt ?? row.updatedAt ?? '';
    const at =
      atRaw instanceof Date ? atRaw.toISOString() : String(atRaw || new Date().toISOString());

    const rebuiltSummary = buildHttpSummary(action, title, oldSnap, newSnap, meta, nameById);
    const rawReason = String(row.reason ?? '').trim();
    const reasonLooksWeak =
      !rawReason ||
      /\bto\s+[—\-–]\s*$/i.test(rawReason) ||
      /\bfrom\s+[—\-–]\s+to\s+[—\-–]/i.test(rawReason) ||
      /^Deleted task/i.test(rawReason);
    const summary = reasonLooksWeak ? rebuiltSummary : rawReason;

    entries.push({
      id,
      taskId,
      projectId: String(meta.projectId ?? newSnap.projectId ?? pid).trim() || pid,
      action,
      summary,
      taskTitle: title,
      performedBy,
      performedByName: performedBy ? nameById.get(performedBy) || performedBy : null,
      at,
      changes,
      oldAssigneeId,
      newAssigneeId,
      oldAssigneeName: oldAssigneeId
        ? nameById.get(oldAssigneeId) || oldAssigneeId
        : action === 'HANDED_OVER'
          ? 'Unassigned'
          : null,
      newAssigneeName: newAssigneeId
        ? nameById.get(newAssigneeId) || newAssigneeId
        : action === 'HANDED_OVER'
          ? 'Unassigned'
          : null,
    });
    if (entries.length >= limit * 2) break;
  }

  return dedupeActivityEntries(entries).slice(0, limit);
}

/** Drop near-duplicate HTTP+domain pairs for the same task action. */
function dedupeActivityEntries(entries: TaskActivityEntry[]): TaskActivityEntry[] {
  const out: TaskActivityEntry[] = [];
  for (const entry of entries) {
    const t = Date.parse(entry.at) || 0;
    const dupIdx = out.findIndex((existing) => {
      if (existing.taskId !== entry.taskId) return false;
      if (String(existing.action).toUpperCase() !== String(entry.action).toUpperCase()) return false;
      const et = Date.parse(existing.at) || 0;
      return Math.abs(et - t) <= 15_000;
    });
    if (dupIdx < 0) {
      out.push(entry);
      continue;
    }
    // Prefer richer domain summaries (non-empty reason-like text / more changes).
    const current = out[dupIdx]!;
    const preferNew =
      (entry.summary?.length ?? 0) > (current.summary?.length ?? 0) ||
      entry.changes.length > current.changes.length;
    if (preferNew) out[dupIdx] = entry;
  }
  return out;
}

function buildHttpChanges(
  action: TaskActivityAction,
  oldSnap: Record<string, unknown>,
  newSnap: Record<string, unknown>,
  meta: Record<string, unknown>
): Array<{ field: string; from: unknown; to: unknown }> {
  const statusMeta = asRecord(meta.statusChange);
  const statusBefore = statusMeta.before ?? oldSnap.status ?? null;
  const statusAfter = statusMeta.after ?? newSnap.status ?? null;
  if (action === 'STATUS_CHANGED') {
    const rows: Array<{ field: string; from: unknown; to: unknown }> = [
      { field: 'status', from: statusBefore, to: statusAfter },
    ];
    if (
      Object.prototype.hasOwnProperty.call(oldSnap, 'progress') &&
      Object.prototype.hasOwnProperty.call(newSnap, 'progress') &&
      JSON.stringify(oldSnap.progress ?? null) !== JSON.stringify(newSnap.progress ?? null)
    ) {
      rows.push({ field: 'progress', from: oldSnap.progress ?? null, to: newSnap.progress ?? null });
    }
    return rows;
  }
  if (action === 'PROGRESS_UPDATED') {
    return [
      {
        field: 'progress',
        from: oldSnap.progress ?? '—',
        to: newSnap.progress ?? 0,
      },
    ];
  }
  if (action === 'HANDED_OVER') {
    return [
      {
        field: 'assigneeId',
        from: oldSnap.assigneeId ?? null,
        to: newSnap.assigneeId ?? null,
      },
    ];
  }
  if (action === 'CREATED') {
    return Object.entries(newSnap)
      .filter(([k]) => (TASK_AUDIT_KEYS as readonly string[]).includes(k))
      .slice(0, 8)
      .map(([field, to]) => ({ field, from: null, to }));
  }
  if (action === 'DELETED') {
    // Keep delete snapshots compact — avoid status/progress fields that confuse track filters.
    return Object.entries(oldSnap)
      .filter(([k]) => k === 'title' || k === 'assigneeId' || k === 'priority')
      .slice(0, 8)
      .map(([field, from]) => ({ field, from, to: null }));
  }
  const keys = ['status', 'progress', 'assigneeId', 'priority', 'dueDate', 'title'] as const;
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const field of keys) {
    if (!(field in newSnap)) continue;
    const from = oldSnap[field];
    const to = newSnap[field];
    if (from === undefined && field !== 'status') continue;
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    out.push({ field, from: from ?? null, to: to ?? null });
  }
  return out;
}
