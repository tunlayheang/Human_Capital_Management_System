import type { EligibleAttendanceUser } from './attendanceReconcileService.js';
import { listEligibleAttendanceUsers } from './attendanceReconcileService.js';

/**
 * Manager attendance manage lists are department-team scoped.
 * Admin/HR see the full roster (undefined = no filter).
 * Manager with no team returns [] (never fall back to company-wide).
 */
export async function resolveAttendanceRosterUserIdsForActor(actor: {
  id?: string | null;
  role?: string | null;
}): Promise<string[] | undefined> {
  const role = String(actor.role ?? '').toUpperCase();
  if (role === 'ADMIN' || role === 'HR' || role === 'SUPER_ADMIN') return undefined;
  if (role !== 'MANAGER') return undefined;

  const uid = String(actor.id ?? '').trim();
  if (!uid) return [];

  const { resolveManagerTeam } = await import('./managerTeamService.js');
  const team = await resolveManagerTeam(uid);
  return Array.isArray(team.userIds) ? team.userIds.map((id) => String(id)) : [];
}

export async function filterEligibleAttendanceUsers(
  userIds?: string[]
): Promise<EligibleAttendanceUser[] | undefined> {
  if (userIds === undefined) return undefined;
  if (!userIds.length) return [];
  const allowed = new Set(userIds.map((id) => String(id)));
  return (await listEligibleAttendanceUsers()).filter((e) => allowed.has(e.userId));
}

export function actorMayAccessAttendanceUser(
  scopeUserIds: string[] | undefined,
  targetUserId: string
): boolean {
  if (scopeUserIds === undefined) return true;
  const target = String(targetUserId ?? '').trim();
  if (!target) return false;
  return scopeUserIds.includes(target);
}
