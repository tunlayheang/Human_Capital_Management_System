import { Op, QueryTypes } from 'sequelize';
import { Notification, sequelize } from './db.js';
import { ensureNotification, getUserDisplayName } from './notificationService.js';
import {
  getRequiredActionsForViewer,
  type RequiredActionItem,
  type RequiredActionKind,
} from './requiredActionsService.js';

const RA_ID_PREFIX = 'ra-pending-';
const SENSITIVE_PENDING_PREFIX = 'sensitive-pending-';

/** Avoid re-running the full multi-module queue sync on every 10s notification poll. */
const SYNC_MIN_INTERVAL_MS = Number(process.env.REQUIRED_ACTION_SYNC_MS || 60_000);
const lastRequiredActionSyncAt = new Map<string, number>();

function notificationIdForAction(userId: string, actionId: string): string {
  return `${RA_ID_PREFIX}${actionId}-${userId}`;
}

function categoryTitle(kind: RequiredActionKind, urgency: RequiredActionItem['urgency']): string {
  if (kind.includes('self_eval')) return 'Action needed: self-evaluation';
  if (kind.includes('manager_review') || kind.includes('_review')) {
    return urgency === 'high' ? 'Pending work: review due' : 'Pending work: review';
  }
  if (kind.includes('final_approval') || kind.includes('approval')) {
    return 'Request pending your approval';
  }
  if (kind.includes('hr_')) return 'Pending work: HR action';
  return 'Pending work';
}

/**
 * Mirror the viewer's live required-action queue into the notification inbox so
 * reminders / requests / pending work always surface in the bell.
 */
export async function syncRequiredActionNotificationsForUser(
  viewer: {
    id?: string;
    role?: string;
    displayName?: string;
  },
  opts?: { force?: boolean }
): Promise<void> {
  const userId = String(viewer.id ?? '').trim();
  if (!userId) return;

  const now = Date.now();
  const last = lastRequiredActionSyncAt.get(userId) ?? 0;
  if (!opts?.force && now - last < SYNC_MIN_INTERVAL_MS) {
    return;
  }
  lastRequiredActionSyncAt.set(userId, now);

  const { items } = await getRequiredActionsForViewer(viewer);
  const activeIds = new Set<string>();

  // Upsert in parallel (chunked) — sequential ensureNotification was a deploy latency killer.
  const upsertJobs = items.map((item) => {
    const id = notificationIdForAction(userId, item.id);
    activeIds.add(id);
    return ensureNotification({
      id,
      userId,
      title: categoryTitle(item.kind, item.urgency),
      message: `${item.title}${item.subtitle ? ` — ${item.subtitle}` : ''}`,
      type: item.urgency === 'high' ? 'WARNING' : 'INFO',
      link: item.href,
      entityId: item.entityId || undefined,
      entityType: item.module || item.kind || undefined,
    });
  });
  for (let i = 0; i < upsertJobs.length; i += 10) {
    await Promise.all(upsertJobs.slice(i, i + 10));
  }

  // Keep ADMIN/HR notified of pending sensitive change requests.
  const role = String(viewer.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'HR' || role === 'SUPER_ADMIN') {
    try {
      const pendingSensitive = (await sequelize.query(
        `SELECT id, employee_pk, change_reason, effective_date, submitted_by
         FROM employee_sensitive_changes
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 30`,
        { type: QueryTypes.SELECT }
      )) as Array<{
        id?: string;
        employee_pk?: string;
        change_reason?: string;
        effective_date?: string;
        submitted_by?: string | null;
      }>;

      for (const row of pendingSensitive) {
        const changeId = String(row.id ?? '').trim();
        if (!changeId) continue;
        const id = `${SENSITIVE_PENDING_PREFIX}${changeId}-${userId}`;
        activeIds.add(id);
        const submitter = row.submitted_by
          ? await getUserDisplayName(String(row.submitted_by))
          : 'A team member';
        const emp = String(row.employee_pk ?? 'employee');
        const effective = row.effective_date ? String(row.effective_date).slice(0, 10) : '';
        await ensureNotification({
          id,
          userId,
          title: 'Sensitive change request pending',
          message: `${submitter} submitted placement/pay changes for ${emp}${
            effective ? ` (effective ${effective})` : ''
          }. Review in Employees.`,
          type: 'WARNING',
          link: '/employees?tab=list',
        });
      }
    } catch {
      /* table may not exist yet in some envs */
    }
  }

  // Mark resolved queue notifications as read so the badge clears.
  const [staleRa, stalePerm, staleSensitive] = await Promise.all([
    Notification.findAll({
      where: { userId, isRead: false, id: { [Op.like]: `${RA_ID_PREFIX}%` } },
      attributes: ['id'],
    }),
    Notification.findAll({
      where: { userId, isRead: false, id: { [Op.like]: 'perm-req-%' } },
      attributes: ['id'],
    }),
    Notification.findAll({
      where: { userId, isRead: false, id: { [Op.like]: `${SENSITIVE_PENDING_PREFIX}%` } },
      attributes: ['id'],
    }),
  ]);

  const staleIds = [...staleRa, ...stalePerm, ...staleSensitive]
    .map((row) => String(row.get('id')))
    .filter((id) => !activeIds.has(id));

  if (staleIds.length) {
    await Notification.update({ isRead: true }, { where: { id: { [Op.in]: staleIds }, userId } });
  }
}
