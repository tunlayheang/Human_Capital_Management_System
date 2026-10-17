import type { WorkflowApproverCandidate } from '../components/workflow/ApproverSelectPanel';
import { formatAccessRoleLabel } from './accessRole';
import { resolvePersonDisplayName } from './personDisplayName';
import { userDisplayEmployeeCode, type EnrichedUserLike } from './userProfile';
import type { Language } from '../i18n/types';

/** True when a value is empty or looks like a portal/system id, not a person name. */
export function looksLikePortalUserId(value: string | null | undefined): boolean {
  const s = String(value ?? '').trim();
  if (!s) return true;
  // Portal ids are often `u-…` / uuid-like; never treat those as display names.
  if (/^u-\d+$/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Safe label for approvers/evaluators. Never returns a raw portal id like `u-3`.
 * Prefer users-map enrichment, then API name, then a human fallback.
 */
export function resolveWorkflowPersonLabel(
  name: string | null | undefined,
  options?: {
    userId?: string | null;
    usersById?: Record<string, EnrichedUserLike | null | undefined> | Map<string, EnrichedUserLike>;
    language?: Language;
    fallback?: string;
  }
): string {
  const fallback = String(options?.fallback ?? 'Approver').trim() || 'Approver';
  const userId = String(options?.userId ?? '').trim();
  const usersById = options?.usersById;
  const fromMap =
    userId && usersById
      ? usersById instanceof Map
        ? usersById.get(userId)
        : usersById[userId]
      : undefined;
  if (fromMap) {
    const fromUser = resolvePersonDisplayName(fromMap, options?.language ?? 'en');
    if (fromUser && !looksLikePortalUserId(fromUser)) return fromUser;
  }
  const apiName = String(name ?? '').trim();
  if (apiName && !looksLikePortalUserId(apiName) && apiName !== userId) return apiName;
  return fallback;
}

/** Prefer a full directory candidate; otherwise build a safe stub from the saved chain row. */
export function mergeAssignedApproverCandidate(
  assigned: { userId: string; name?: string | null },
  directory?: Map<string, WorkflowApproverCandidate> | Record<string, WorkflowApproverCandidate>,
  language: Language = 'en'
): WorkflowApproverCandidate {
  const userId = String(assigned.userId ?? '').trim();
  const fromDir =
    directory instanceof Map
      ? directory.get(userId)
      : directory
        ? directory[userId]
        : undefined;
  if (fromDir) {
    const resolvedName = resolveWorkflowPersonLabel(fromDir.name || assigned.name, {
      userId,
      language,
      fallback: fromDir.name || 'Approver',
    });
    return {
      ...fromDir,
      userId: fromDir.userId || userId,
      name: looksLikePortalUserId(resolvedName) ? fromDir.name || 'Approver' : resolvedName,
    };
  }
  return approverCandidateFromAssigned(assigned, undefined, language);
}

/** Build a picker candidate from a saved approver chain row, enriching from the users list when possible. */
export function approverCandidateFromAssigned(
  a: { userId: string; name?: string | null },
  usersById?: Record<string, EnrichedUserLike | null | undefined> | Map<string, EnrichedUserLike>,
  language: Language = 'en'
): WorkflowApproverCandidate {
  const userId = String(a.userId ?? '').trim();
  const fromMap =
    usersById instanceof Map
      ? usersById.get(userId)
      : usersById
        ? usersById[userId]
        : undefined;
  const resolvedName = resolveWorkflowPersonLabel(a.name, {
    userId,
    usersById,
    language,
    fallback: '',
  });
  const roleRaw = String(fromMap?.role ?? '').trim();
  const emp = fromMap?.employee as
    | {
        department_id?: string | null;
        department_name?: string | null;
        position_title?: string | null;
      }
    | null
    | undefined;

  return {
    userId,
    employeePk: '',
    name: resolvedName || 'Approver',
    email: String((fromMap as { email?: string } | undefined)?.email ?? ''),
    role: roleRaw,
    roleLabel: roleRaw ? formatAccessRoleLabel(roleRaw) : '',
    levelCode: null,
    levelLabel: null,
    employeeCode: fromMap ? userDisplayEmployeeCode(fromMap) || null : null,
    positionTitle: emp?.position_title ? String(emp.position_title) : null,
    departmentId: emp?.department_id ? String(emp.department_id) : '',
    departmentName: emp?.department_name ? String(emp.department_name) : '',
    hasPortalAccess: true,
  };
}
