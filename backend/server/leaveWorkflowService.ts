import { Op } from 'sequelize';
import { AuditLog, Department, Employee, LeaveRequest, LeaveType, User, sequelize } from './db.js';
import { writeWorkflowStatusAudit } from './domainAuditService.js';
import { findEmployeeByUserId } from './userAccountService.js';
import { USER_ACCOUNT_ATTRIBUTES, serializeUserForClient } from './userAccountService.js';

export const LEAVE_STATUS = {
  PENDING: 'PENDING',
  MANAGER_APPROVED: 'MANAGER_APPROVED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  /** Returned to submitter for revision / resubmit */
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;

function requireWorkflowComment(raw: string | null | undefined, label = 'comment'): string | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length < 3) return null;
  return trimmed;
}

let workflowColumnsReady = false;

export async function ensureLeaveWorkflowColumns(): Promise<void> {
  if (workflowColumnsReady) return;
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('leaverequests');
    if (!desc.assignedManagerId) {
      await qi.addColumn('leaverequests', 'assignedManagerId', {
        type: 'VARCHAR(255)',
        allowNull: true,
      });
      console.log('[db] leaverequests.assignedManagerId column added.');
    }
    if (!desc.managerApprovedAt) {
      await qi.addColumn('leaverequests', 'managerApprovedAt', {
        type: 'DATETIME',
        allowNull: true,
      });
    }
    if (!desc.managerApprovedBy) {
      await qi.addColumn('leaverequests', 'managerApprovedBy', {
        type: 'VARCHAR(255)',
        allowNull: true,
      });
    }
    if (!desc.hrApprovedAt) {
      await qi.addColumn('leaverequests', 'hrApprovedAt', {
        type: 'DATETIME',
        allowNull: true,
      });
    }
    if (!desc.hrApprovedBy) {
      await qi.addColumn('leaverequests', 'hrApprovedBy', {
        type: 'VARCHAR(255)',
        allowNull: true,
      });
    }
    workflowColumnsReady = true;
    await backfillLeaveApproverTracking();
  } catch (err) {
    console.warn('[db] ensureLeaveWorkflowColumns:', (err as Error).message);
  }
}

/** Normalize leave row for API (camelCase + legacy snake_case). */
export function serializeLeaveRequest(row: unknown): Record<string, unknown> {
  const plain =
    row && typeof (row as { get?: (o: { plain: boolean }) => unknown }).get === 'function'
      ? ((row as { get: (o: { plain: boolean }) => Record<string, unknown> }).get({ plain: true }) as Record<
          string,
          unknown
        >)
      : ({ ...(row as Record<string, unknown>) } as Record<string, unknown>);

  return {
    ...plain,
    assignedManagerId: plain.assignedManagerId ?? plain.assigned_manager_id ?? null,
    managerApprovedAt: plain.managerApprovedAt ?? plain.manager_approved_at ?? null,
    managerApprovedBy: plain.managerApprovedBy ?? plain.manager_approved_by ?? null,
    hrApprovedAt: plain.hrApprovedAt ?? plain.hr_approved_at ?? null,
    hrApprovedBy: plain.hrApprovedBy ?? plain.hr_approved_by ?? null,
    appliedOn: plain.appliedOn ?? plain.applied_on ?? null,
    createdAt: plain.createdAt ?? plain.created_at ?? null,
    updatedAt: plain.updatedAt ?? plain.updated_at ?? null,
  };
}

/** Backfill approver ids on existing rows (safe to run repeatedly). */
export async function backfillLeaveApproverTracking(): Promise<void> {
  try {
    await sequelize.query(
      `UPDATE leaverequests
       SET managerApprovedBy = assignedManagerId
       WHERE status IN ('MANAGER_APPROVED', 'APPROVED')
         AND (managerApprovedBy IS NULL OR managerApprovedBy = '')
         AND assignedManagerId IS NOT NULL AND assignedManagerId != ''`
    );

    const approvedRows = (await LeaveRequest.findAll({
      where: { status: LEAVE_STATUS.APPROVED },
      attributes: ['id', 'hrApprovedBy', 'hrApprovedAt'],
      raw: true,
    })) as Array<{ id: string; hrApprovedBy?: string | null }>;

    for (const row of approvedRows) {
      if (String(row.hrApprovedBy ?? '').trim()) continue;
      const logs = (await AuditLog.findAll({
        where: { entityType: 'LeaveRequest', entityId: String(row.id), action: 'STATUS_CHANGE' },
        order: [['createdAt', 'DESC']],
        limit: 20,
        raw: true,
      })) as Array<{ performedBy?: string; newValue?: { status?: string } }>;
      const hrLog = logs.find(
        (l) => String(l.newValue?.status ?? '').toUpperCase() === LEAVE_STATUS.APPROVED
      );
      const performer = String(hrLog?.performedBy ?? '').trim();
      if (!performer) continue;
      await LeaveRequest.update({ hrApprovedBy: performer }, { where: { id: row.id } });
    }

    const missingHr = (await LeaveRequest.findAll({
      where: { status: LEAVE_STATUS.APPROVED, hrApprovedBy: { [Op.or]: [null, ''] } },
      attributes: ['id', 'userId', 'managerApprovedBy', 'managerApprovedAt', 'updatedAt'],
      raw: true,
    })) as Array<{
      id: string;
      userId: string;
      managerApprovedBy?: string | null;
      managerApprovedAt?: Date | string | null;
      updatedAt?: Date | string | null;
    }>;

    if (missingHr.length) {
      const hrUsers = (await User.findAll({
        where: { role: { [Op.in]: ['HR', 'ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        attributes: ['id', 'role', 'lastActivity'],
        order: [['lastActivity', 'DESC']],
        raw: true,
      })) as Array<{ id: string; role: string; lastActivity?: Date | string | null }>;

      for (const row of missingHr) {
        const exclude = new Set(
          [String(row.userId ?? ''), String(row.managerApprovedBy ?? '')].filter(Boolean)
        );
        const hrOnly = hrUsers.filter(
          (u) => String(u.role).toUpperCase() === 'HR' && !exclude.has(String(u.id))
        );
        const pool = hrOnly.length ? hrOnly : hrUsers.filter((u) => !exclude.has(String(u.id)));
        const pick = pool[0]?.id;
        if (!pick) continue;
        const hrAt = row.updatedAt ? new Date(row.updatedAt) : new Date();
        await LeaveRequest.update(
          { hrApprovedBy: pick, hrApprovedAt: hrAt },
          { where: { id: row.id } }
        );
      }
    }
  } catch (err) {
    console.warn('[db] backfillLeaveApproverTracking:', (err as Error).message);
  }
}

function resolveManagerApproverId(
  actorId: string,
  actorRole: string,
  assignedManagerId: string
): string {
  if (!actorId) return assignedManagerId || actorId;
  if (assignedManagerId && actorId === assignedManagerId) return actorId;
  if (['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole) && assignedManagerId) {
    return assignedManagerId;
  }
  return actorId;
}

async function logLeaveStatusChange(
  leaveId: string,
  actorId: string,
  previousStatus: string,
  nextStatus: string,
  reason?: string | null
): Promise<void> {
  if (!actorId) return;
  await writeWorkflowStatusAudit({
    entityType: 'leave_request',
    entityId: leaveId,
    previousStatus,
    nextStatus,
    performedBy: actorId,
    reason: reason ?? undefined,
  });
}

export async function resolveDefaultLeaveManagerId(employeeUserId: string): Promise<string | null> {
  try {
    const employee = await findEmployeeByUserId(employeeUserId);
    if (!employee) return null;
    const plain = employee.get ? employee.get({ plain: true }) : employee;
    const deptId = String(plain.department_id ?? '').trim();
    if (deptId) {
      const dept: any = await Department.findByPk(deptId, { attributes: ['managerId'] });
      const portalId = String(dept?.managerId ?? '').trim();
      if (portalId && portalId !== employeeUserId) {
        const mgr: any = await User.findByPk(portalId, { attributes: ['id', 'role', 'isActive'] });
        if (mgr && mgr.isActive !== false && String(mgr.role ?? '').toUpperCase() === 'MANAGER') {
          return portalId;
        }
      }
    }
  } catch {
    /* optional */
  }
  return null;
}

export type LeaveApproverManagerRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId?: string;
  departmentName?: string;
  /** True when this manager is the department head (managerId on departments row). */
  isDepartmentHead?: boolean;
};

export type LeaveApproverDepartmentRow = {
  departmentId: string;
  departmentName: string;
  managers: LeaveApproverManagerRow[];
};

function managerRowKey(m: LeaveApproverManagerRow): string {
  return m.id;
}

async function buildManagerRow(
  row: any,
  excludeUserId?: string
): Promise<LeaveApproverManagerRow | null> {
  const id = String(row.id ?? '').trim();
  if (!id || id === excludeUserId) return null;
  try {
    const profile = await serializeUserForClient(row.get({ plain: true }));
    const departmentId = profile.departmentId
      ? String(profile.departmentId).trim()
      : undefined;
    return {
      id,
      name: profile.name || profile.email || id,
      email: profile.email || '',
      role: 'MANAGER',
      departmentId,
    };
  } catch {
    return {
      id,
      name: String(row.email || id),
      email: String(row.email || ''),
      role: 'MANAGER',
    };
  }
}

/** Managers eligible as first approver, grouped by department. */
export async function listLeaveApproverDepartmentGroups(
  excludeUserId?: string
): Promise<LeaveApproverDepartmentRow[]> {
  const [managerUsers, departments] = await Promise.all([
    User.findAll({
      where: { isActive: true, role: 'MANAGER' },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
      order: [['email', 'ASC']],
    }) as Promise<any[]>,
    Department.findAll({
      attributes: ['id', 'name', 'managerId'],
      order: [['name', 'ASC']],
      raw: true,
    }) as Promise<{ id: string; name?: string; managerId?: string | null }[]>,
  ]);

  const deptNameById = new Map<string, string>();
  const managersByDept = new Map<string, Map<string, LeaveApproverManagerRow>>();

  for (const d of departments) {
    const deptId = String(d.id ?? '').trim();
    if (!deptId) continue;
    deptNameById.set(deptId, String(d.name ?? '').trim() || deptId);
    if (!managersByDept.has(deptId)) managersByDept.set(deptId, new Map());
  }

  for (const row of managerUsers) {
    const mgr = await buildManagerRow(row, excludeUserId);
    if (!mgr) continue;
    const deptId = String(mgr.departmentId ?? '').trim();
    if (!deptId) continue;
    if (!managersByDept.has(deptId)) {
      managersByDept.set(deptId, new Map());
      if (!deptNameById.has(deptId)) deptNameById.set(deptId, deptId);
    }
    managersByDept.get(deptId)!.set(managerRowKey(mgr), mgr);
  }

  for (const d of departments) {
    const deptId = String(d.id ?? '').trim();
    const headUserId = String(d.managerId ?? '').trim();
    if (!deptId || !headUserId || headUserId === excludeUserId) continue;

    const headUser: any = await User.findByPk(headUserId, {
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (!headUser || headUser.isActive === false) continue;
    if (String(headUser.role ?? '').toUpperCase() !== 'MANAGER') continue;

    const headRow = await buildManagerRow(headUser, excludeUserId);
    if (!headRow) continue;

    if (!managersByDept.has(deptId)) {
      managersByDept.set(deptId, new Map());
      deptNameById.set(deptId, String(d.name ?? '').trim() || deptId);
    }
    const bucket = managersByDept.get(deptId)!;
    const existing = bucket.get(headRow.id);
    bucket.set(headRow.id, {
      ...headRow,
      departmentId: deptId,
      departmentName: deptNameById.get(deptId),
      isDepartmentHead: true,
      name: existing?.name || headRow.name,
    });
  }

  const groups: LeaveApproverDepartmentRow[] = [];
  for (const [departmentId, bucket] of managersByDept) {
    const managers = [...bucket.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (managers.length === 0) continue;
    const departmentName = deptNameById.get(departmentId) || departmentId;
    for (const m of managers) {
      m.departmentId = departmentId;
      m.departmentName = departmentName;
    }
    groups.push({ departmentId, departmentName, managers });
  }

  groups.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return groups;
}

export async function listLeaveApproverManagers(
  excludeUserId?: string
): Promise<LeaveApproverManagerRow[]> {
  const groups = await listLeaveApproverDepartmentGroups(excludeUserId);
  const flat: LeaveApproverManagerRow[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const m of g.managers) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      flat.push(m);
    }
  }
  flat.sort((a, b) => a.name.localeCompare(b.name));
  return flat;
}

export async function managerEligibleForLeaveDepartment(
  managerUserId: string,
  departmentId: string
): Promise<boolean> {
  const mgrId = String(managerUserId ?? '').trim();
  const deptId = String(departmentId ?? '').trim();
  if (!mgrId || !deptId) return false;

  const dept: any = await Department.findByPk(deptId, {
    attributes: ['id', 'managerId'],
  });
  if (!dept) return false;
  if (String(dept.managerId ?? '').trim() === mgrId) return true;

  const mgr: any = await User.findByPk(mgrId, {
    attributes: ['id', 'role', 'isActive', 'employeeId'],
  });
  if (!mgr || mgr.isActive === false || String(mgr.role ?? '').toUpperCase() !== 'MANAGER') {
    return false;
  }

  const employeeId = String(mgr.employeeId ?? '').trim();
  if (!employeeId) return false;

  const emp: any = await Employee.findByPk(employeeId, {
    attributes: ['department_id'],
  });
  return String(emp?.department_id ?? emp?.get?.('department_id') ?? '').trim() === deptId;
}

export async function resolveDefaultLeaveManagerContext(
  employeeUserId: string
): Promise<{ managerId: string | null; departmentId: string | null }> {
  const managerId = await resolveDefaultLeaveManagerId(employeeUserId);
  if (!managerId) return { managerId: null, departmentId: null };

  const groups = await listLeaveApproverDepartmentGroups(employeeUserId);
  for (const g of groups) {
    if (g.managers.some((m) => m.id === managerId)) {
      return { managerId, departmentId: g.departmentId };
    }
  }

  const mgr: any = await User.findByPk(managerId, { attributes: ['employeeId'] });
  const employeeId = String(mgr?.employeeId ?? '').trim();
  if (employeeId) {
    const emp: any = await Employee.findByPk(employeeId, { attributes: ['department_id'] });
    const departmentId = String(emp?.department_id ?? '').trim() || null;
    return { managerId, departmentId };
  }

  return { managerId, departmentId: null };
}

export async function validateAssignedManagerId(
  managerUserId: string,
  requesterUserId: string,
  departmentId?: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const id = String(managerUserId ?? '').trim();
  if (!id) return { ok: false, message: 'Please select a manager to review your request first.' };
  if (id === requesterUserId) {
    return { ok: false, message: 'You cannot assign yourself as the approving manager.' };
  }
  const mgr: any = await User.findByPk(id, { attributes: ['id', 'role', 'isActive'] });
  if (!mgr || mgr.isActive === false) {
    return { ok: false, message: 'Selected manager account is not active.' };
  }
  const role = String(mgr.role ?? '').toUpperCase();
  if (role !== 'MANAGER') {
    return { ok: false, message: 'Selected approver must have the Manager access role.' };
  }

  const deptId = String(departmentId ?? '').trim();
  if (deptId) {
    const inDept = await managerEligibleForLeaveDepartment(id, deptId);
    if (!inDept) {
      return {
        ok: false,
        message: 'Selected manager is not available for the chosen department.',
      };
    }
  }

  return { ok: true };
}

/** Persist the requester-selected approver chain for a leave + notify the first approver. */
export async function assignLeaveApproverChain(
  leaveId: string,
  userIds: string[],
  summary: string
): Promise<void> {
  if (!userIds.length) return;
  const {
    LEAVE_APPROVER_CONFIG,
    replaceChainApprovers,
    loadChainApprovers,
    notifyChainApproversOnSubmit,
  } = await import('./workflowChainApproverService.js');
  await replaceChainApprovers(LEAVE_APPROVER_CONFIG, leaveId, userIds);
  const approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, leaveId);
  await notifyChainApproversOnSubmit(LEAVE_APPROVER_CONFIG, leaveId, approvers, summary);
}

/** Normalize leave.type when stored as catalog id/code, and attach Khmer labels. */
async function attachLeaveTypeKhmerLabels(
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;
  try {
    const types = (await LeaveType.findAll({
      attributes: ['id', 'name', 'nameKh', 'code'],
      raw: true,
    })) as Array<{
      id?: string;
      name?: string;
      nameKh?: string | null;
      code?: string | null;
    }>;

    const byId = new Map<string, { name: string; nameKh: string | null }>();
    const byCode = new Map<string, { name: string; nameKh: string | null }>();
    const byName = new Map<string, { name: string; nameKh: string | null }>();
    for (const t of types) {
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      const meta = { name, nameKh: String(t.nameKh ?? '').trim() || null };
      const id = String(t.id ?? '').trim().toLowerCase();
      const code = String(t.code ?? '').trim().toLowerCase();
      if (id) byId.set(id, meta);
      if (code) byCode.set(code, meta);
      byName.set(name.toLowerCase(), meta);
    }

    return rows.map((row) => {
      const raw = String(row.type ?? '').trim();
      const key = raw.toLowerCase();
      const meta = byId.get(key) ?? byCode.get(key) ?? byName.get(key) ?? null;
      const type = meta?.name ?? raw;
      const typeKh = meta?.nameKh ?? null;
      return { ...row, type, typeKh };
    });
  } catch {
    return rows.map((row) => ({ ...row, typeKh: row.typeKh ?? null }));
  }
}

/**
 * Persist leave.request `type` values that still store leave-type ids (e.g. lt-annual)
 * as the catalog display name (Annual Leave). Safe to run repeatedly.
 */
export async function normalizeLeaveRequestTypeIdsToNames(): Promise<number> {
  try {
    const types = (await LeaveType.findAll({
      attributes: ['id', 'name'],
      raw: true,
    })) as Array<{ id?: string; name?: string }>;
    let updated = 0;
    for (const t of types) {
      const name = String(t.name ?? '').trim();
      const id = String(t.id ?? '').trim();
      if (!name || !id || name === id) continue;
      const [affected] = await LeaveRequest.update(
        { type: name },
        { where: { type: id } }
      );
      updated += Number(affected) || 0;
    }
    return updated;
  } catch (err) {
    console.warn(
      '[leave] Could not normalize leave request type ids:',
      (err as Error)?.message || err
    );
    return 0;
  }
}

/** Merge ordered-approver-chain DTO fields onto a serialized leave row. */
export async function serializeLeaveWithApprovers(row: unknown): Promise<Record<string, unknown>> {
  const base = serializeLeaveRequest(row);
  const [withKh] = await attachLeaveTypeKhmerLabels([base]);
  const enriched = withKh ?? base;
  const { LEAVE_APPROVER_CONFIG, loadChainApprovers, serializeChainApproversForDto } = await import(
    './workflowChainApproverService.js'
  );
  const approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, String(enriched.id ?? ''));
  if (!approvers.length) return enriched;
  return { ...enriched, ...serializeChainApproversForDto(approvers) };
}

/** Batch variant for list endpoints (one query for all chains). */
export async function serializeLeavesWithApprovers(
  rows: unknown[]
): Promise<Record<string, unknown>[]> {
  const base = await attachLeaveTypeKhmerLabels(rows.map((row) => serializeLeaveRequest(row)));
  const { LEAVE_APPROVER_CONFIG, loadChainApproversBatch, serializeChainApproversForDto } =
    await import('./workflowChainApproverService.js');
  const ids = base.map((row) => String(row.id ?? '')).filter(Boolean);
  const map = await loadChainApproversBatch(LEAVE_APPROVER_CONFIG, ids);
  return base.map((row) => {
    const approvers = map.get(String(row.id ?? '')) ?? [];
    if (!approvers.length) return row;
    return { ...row, ...serializeChainApproversForDto(approvers) };
  });
}

export type LeaveStatusTransitionResult =
  | {
      ok: true;
      leave: any;
      previousStatus: string;
      nextStatus: string;
      /** True when an ordered approver chain handled the transition + notifications. */
      chainHandled?: boolean;
    }
  | { ok: false; status: number; message: string };

/** Short human label for notifications, e.g. "Annual leave (2026-01-02 → 2026-01-05)". */
export function buildLeaveSummary(leave: any): string {
  const type = String(leave.type ?? 'Leave');
  const start = String(leave.startDate ?? '').slice(0, 10);
  const end = String(leave.endDate ?? leave.startDate ?? '').slice(0, 10);
  const range = end && end !== start ? `${start} → ${end}` : start;
  return `${type} leave${range ? ` (${range})` : ''}`;
}

/** Apply the terminal side-effects when a leave reaches APPROVED (validation, balance, sync). */
async function applyLeaveFinalApproval(
  leaveId: string,
  actorId: string,
  current: string,
  assignedManagerId: string,
  rejectionReason?: string | null
): Promise<{ ok: true; leave: any } | { ok: false; status: number; message: string }> {
  const { validateLeaveApproval, applyLeaveBalanceOnApproval } = await import(
    './leaveValidationService.js'
  );
  const approvalCheck = await validateLeaveApproval(leaveId);
  if (!approvalCheck.ok) {
    return { ok: false, status: 400, message: approvalCheck.message };
  }

  const existing: any = await LeaveRequest.findByPk(leaveId);
  const hrAt = new Date();
  const patch: Record<string, unknown> = {
    status: LEAVE_STATUS.APPROVED,
    hrApprovedAt: hrAt,
    hrApprovedBy: actorId,
  };
  if (!String(existing?.managerApprovedBy ?? '').trim() && assignedManagerId) {
    patch.managerApprovedBy = assignedManagerId;
    if (!existing?.managerApprovedAt) patch.managerApprovedAt = hrAt;
  }
  await LeaveRequest.update(patch, { where: { id: leaveId } });
  await logLeaveStatusChange(
    leaveId,
    actorId,
    current,
    LEAVE_STATUS.APPROVED,
    rejectionReason ? String(rejectionReason).trim() : undefined
  );
  await applyLeaveBalanceOnApproval(leaveId);
  try {
    const { syncApprovedLeaveToPlanningRoster } = await import(
      './planningRosterLeaveSyncService.js'
    );
    const sync = await syncApprovedLeaveToPlanningRoster(leaveId);
    if (!sync.ok && sync.message) {
      console.warn(`[roster] Leave ${leaveId} approved but roster sync: ${sync.message}`);
    }
  } catch (syncErr) {
    console.error('[roster] Leave approval roster sync failed:', syncErr);
  }
  try {
    const { syncApprovedLeaveToAttendanceRecords } = await import(
      './attendanceLeaveSyncService.js'
    );
    await syncApprovedLeaveToAttendanceRecords(leaveId);
  } catch (attSyncErr) {
    console.error('[attendance] Leave approval attendance sync failed:', attSyncErr);
  }
  const refreshed: any = await LeaveRequest.findByPk(leaveId);
  return { ok: true, leave: refreshed };
}

/**
 * Ordered multi-approver chain transition. Each approver approves in turn;
 * the final approval triggers the same side-effects as legacy HR finalize.
 * Only the current pending step may act — later steps wait until earlier ones finish.
 */
async function transitionLeaveViaChain(params: {
  leave: any;
  current: string;
  next: string;
  actorId: string;
  actorRole: string;
  assignedManagerId: string;
  rejectionReason?: string | null;
}): Promise<LeaveStatusTransitionResult> {
  const { leave, current, next, actorId, actorRole, assignedManagerId } = params;
  const leaveId = String(leave.id);
  const summary = buildLeaveSummary(leave);

  const {
    LEAVE_APPROVER_CONFIG,
    loadChainApprovers,
    chainRequiresActorApproval,
    getCurrentPendingChainApprover,
    markChainApproverApproved,
    allChainApproversApproved,
    notifyNextChainApproverTurn,
    notifyChainWorkflowFinished,
  } = await import('./workflowChainApproverService.js');

  let approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, leaveId);

  if (current !== LEAVE_STATUS.PENDING) {
    return {
      ok: false,
      status: 400,
      message: 'This leave request is no longer awaiting approval.',
    };
  }

  const isCurrentApprover = chainRequiresActorApproval(approvers, actorId);
  if (!isCurrentApprover) {
    return {
      ok: false,
      status: 403,
      message: 'It is not your turn to act on this leave request yet.',
    };
  }

  if (next === LEAVE_STATUS.REJECTED) {
    const comment = requireWorkflowComment(params.rejectionReason);
    if (!comment) {
      return { ok: false, status: 400, message: 'A rejection comment is required (min 3 characters).' };
    }
    leave.status = LEAVE_STATUS.REJECTED;
    leave.rejectionReason = comment;
    await leave.save();
    try {
      const { removeLeaveFromPlanningRoster } = await import(
        './planningRosterLeaveSyncService.js'
      );
      await removeLeaveFromPlanningRoster(leaveId);
    } catch (syncErr) {
      console.error('[roster] Leave reject roster cleanup failed:', syncErr);
    }
    await notifyChainWorkflowFinished({
      cfg: LEAVE_APPROVER_CONFIG,
      entityId: leaveId,
      outcome: 'rejected',
      approvers,
      submitterUserId: String(leave.userId ?? ''),
      summary,
    });
    await logLeaveStatusChange(leaveId, actorId, current, LEAVE_STATUS.REJECTED, comment);
    return {
      ok: true,
      leave,
      previousStatus: current,
      nextStatus: LEAVE_STATUS.REJECTED,
      chainHandled: true,
    };
  }

  if (next === LEAVE_STATUS.RETURNED) {
    return returnLeaveRequest(leaveId, { id: actorId, role: actorRole }, params.rejectionReason);
  }

  if (next !== LEAVE_STATUS.APPROVED && next !== LEAVE_STATUS.MANAGER_APPROVED) {
    return { ok: false, status: 400, message: `Unsupported status: ${next}` };
  }

  const approveComment = requireWorkflowComment(params.rejectionReason);
  if (!approveComment) {
    return { ok: false, status: 400, message: 'An approval comment is required (min 3 characters).' };
  }

  // Advance the chain by one step (the current pending approver signs off).
  const currentApprover = getCurrentPendingChainApprover(approvers);
  if (currentApprover) {
    try {
      await markChainApproverApproved(LEAVE_APPROVER_CONFIG, leaveId, currentApprover.userId);
    } catch (markErr) {
      const err = markErr as { status?: number; message?: string; code?: string };
      return {
        ok: false,
        status: err.status ?? 403,
        message: err.message || 'You cannot approve this leave request at this time.',
      };
    }
  }
  approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, leaveId);

  if (!allChainApproversApproved(approvers)) {
    await notifyNextChainApproverTurn(LEAVE_APPROVER_CONFIG, leaveId, approvers, summary);
    const refreshed: any = await LeaveRequest.findByPk(leaveId);
    await logLeaveStatusChange(leaveId, actorId, current, LEAVE_STATUS.PENDING, approveComment);
    return {
      ok: true,
      leave: refreshed,
      previousStatus: current,
      nextStatus: LEAVE_STATUS.PENDING,
      chainHandled: true,
    };
  }

  const finalize = await applyLeaveFinalApproval(
    leaveId,
    actorId,
    current,
    assignedManagerId,
    approveComment
  );
  if (!finalize.ok) return finalize;
  await notifyChainWorkflowFinished({
    cfg: LEAVE_APPROVER_CONFIG,
    entityId: leaveId,
    outcome: 'approved',
    approvers,
    submitterUserId: String(leave.userId ?? ''),
    summary,
  });
  return {
    ok: true,
    leave: finalize.leave,
    previousStatus: current,
    nextStatus: LEAVE_STATUS.APPROVED,
    chainHandled: true,
  };
}

export async function transitionLeaveStatus(
  leaveId: string,
  nextStatusRaw: string,
  actor: { id: string; role: string },
  rejectionReason?: string | null
): Promise<LeaveStatusTransitionResult> {
  await ensureLeaveWorkflowColumns();
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, status: 404, message: 'Leave request not found' };

  const { assertPayrollReviewInputsUpdatableForRange, PayrollReviewFrozenError } = await import(
    './payroll/payrollReviewInputGuard.js'
  );
  const { PayrollPeriodFrozenError } = await import('./payroll/payrollPeriodFreezeService.js');
  try {
    await assertPayrollReviewInputsUpdatableForRange(
      String(leave.startDate ?? ''),
      String(leave.endDate ?? leave.startDate ?? '')
    );
  } catch (e) {
    if (e instanceof PayrollPeriodFrozenError || e instanceof PayrollReviewFrozenError) {
      return { ok: false, status: 409, message: e.message };
    }
    throw e;
  }

  const current = String(leave.status ?? '').toUpperCase();
  const next = String(nextStatusRaw ?? '').toUpperCase();
  const actorRole = String(actor.role ?? '').toUpperCase();
  const actorId = String(actor.id ?? '').trim();
  const assignedManagerId = String(leave.assignedManagerId ?? '').trim();

  // When the request was submitted with an ordered approver chain, route the
  // transition through the chain (sequential, turn-based) instead of the
  // legacy manager → HR steps.
  const { LEAVE_APPROVER_CONFIG, loadChainApprovers } = await import(
    './workflowChainApproverService.js'
  );
  const existingChain = await loadChainApprovers(LEAVE_APPROVER_CONFIG, String(leave.id));
  if (existingChain.length) {
    return transitionLeaveViaChain({
      leave,
      current,
      next,
      actorId,
      actorRole,
      assignedManagerId,
      rejectionReason,
    });
  }

  if (next === LEAVE_STATUS.RETURNED) {
    return returnLeaveRequest(leaveId, actor, rejectionReason);
  }

  if (next === LEAVE_STATUS.REJECTED) {
    if (!['PENDING', LEAVE_STATUS.MANAGER_APPROVED].includes(current)) {
      return { ok: false, status: 400, message: 'This leave request can no longer be rejected.' };
    }
    const comment = requireWorkflowComment(rejectionReason);
    if (!comment) {
      return { ok: false, status: 400, message: 'A rejection comment is required (min 3 characters).' };
    }
    const canReject =
      ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole) ||
      (current === LEAVE_STATUS.PENDING &&
        assignedManagerId &&
        actorId === assignedManagerId) ||
      (current === LEAVE_STATUS.PENDING &&
        actorRole === 'MANAGER' &&
        !assignedManagerId);
    if (!canReject) {
      return { ok: false, status: 403, message: 'You are not allowed to reject this request.' };
    }
    leave.status = LEAVE_STATUS.REJECTED;
    leave.rejectionReason = comment;
    await leave.save();
    try {
      const { removeLeaveFromPlanningRoster } = await import(
        './planningRosterLeaveSyncService.js'
      );
      await removeLeaveFromPlanningRoster(String(leave.id));
    } catch (syncErr) {
      console.error('[roster] Leave reject roster cleanup failed:', syncErr);
    }
    await logLeaveStatusChange(String(leave.id), actorId, current, LEAVE_STATUS.REJECTED, comment);
    return { ok: true, leave, previousStatus: current, nextStatus: LEAVE_STATUS.REJECTED };
  }

  if (next === LEAVE_STATUS.MANAGER_APPROVED) {
    if (current !== LEAVE_STATUS.PENDING) {
      return { ok: false, status: 400, message: 'Leave is not awaiting manager approval.' };
    }
    const approveComment = requireWorkflowComment(rejectionReason);
    if (!approveComment) {
      return { ok: false, status: 400, message: 'An approval comment is required (min 3 characters).' };
    }
    if (!assignedManagerId) {
      return {
        ok: false,
        status: 400,
        message: 'This request has no assigned manager — HR can approve directly.',
      };
    }
    if (actorId !== assignedManagerId && !['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole)) {
      return {
        ok: false,
        status: 403,
        message: 'Only the assigned manager can approve this step.',
      };
    }
    await LeaveRequest.update(
      {
        status: LEAVE_STATUS.MANAGER_APPROVED,
        managerApprovedAt: new Date(),
        managerApprovedBy: resolveManagerApproverId(actorId, actorRole, assignedManagerId),
      },
      { where: { id: String(leave.id) } }
    );
    await logLeaveStatusChange(
      String(leave.id),
      actorId,
      current,
      LEAVE_STATUS.MANAGER_APPROVED,
      approveComment
    );
    const refreshedMgr: any = await LeaveRequest.findByPk(String(leave.id));
    return {
      ok: true,
      leave: refreshedMgr,
      previousStatus: current,
      nextStatus: LEAVE_STATUS.MANAGER_APPROVED,
    };
  }

  if (next === LEAVE_STATUS.APPROVED) {
    const approveComment = requireWorkflowComment(rejectionReason);
    if (!approveComment) {
      return { ok: false, status: 400, message: 'An approval comment is required (min 3 characters).' };
    }
    const hrCanFinalize =
      ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole) &&
      (current === LEAVE_STATUS.MANAGER_APPROVED ||
        (current === LEAVE_STATUS.PENDING && !assignedManagerId));
    if (!hrCanFinalize) {
      if (current === LEAVE_STATUS.PENDING && assignedManagerId) {
        return {
          ok: false,
          status: 400,
          message: 'Manager must approve first before HR can finalize.',
        };
      }
      return { ok: false, status: 403, message: 'Only HR or Admin can finalize leave approval.' };
    }
    if (!actorId) {
      return {
        ok: false,
        status: 401,
        message: 'Could not identify the approving user. Please sign in again and retry.',
      };
    }

    const { validateLeaveApproval, applyLeaveBalanceOnApproval } = await import(
      './leaveValidationService.js'
    );
    const approvalCheck = await validateLeaveApproval(String(leave.id));
    if (!approvalCheck.ok) {
      return { ok: false, status: 400, message: approvalCheck.message };
    }

    const hrAt = new Date();
    const patch: Record<string, unknown> = {
      status: LEAVE_STATUS.APPROVED,
      hrApprovedAt: hrAt,
      hrApprovedBy: actorId,
    };
    if (
      !String(leave.managerApprovedBy ?? '').trim() &&
      assignedManagerId &&
      current === LEAVE_STATUS.MANAGER_APPROVED
    ) {
      patch.managerApprovedBy = assignedManagerId;
      if (!leave.managerApprovedAt) patch.managerApprovedAt = hrAt;
    }

    await LeaveRequest.update(patch, { where: { id: String(leave.id) } });
    await logLeaveStatusChange(
      String(leave.id),
      actorId,
      current,
      LEAVE_STATUS.APPROVED,
      approveComment
    );
    await applyLeaveBalanceOnApproval(String(leave.id));
    try {
      const { syncApprovedLeaveToPlanningRoster } = await import(
        './planningRosterLeaveSyncService.js'
      );
      const sync = await syncApprovedLeaveToPlanningRoster(String(leave.id));
      if (!sync.ok && sync.message) {
        console.warn(`[roster] Leave ${leave.id} approved but roster sync: ${sync.message}`);
      }
    } catch (syncErr) {
      console.error('[roster] Leave approval roster sync failed:', syncErr);
    }
    try {
      const { syncApprovedLeaveToAttendanceRecords } = await import(
        './attendanceLeaveSyncService.js'
      );
      await syncApprovedLeaveToAttendanceRecords(String(leave.id));
    } catch (attSyncErr) {
      console.error('[attendance] Leave approval attendance sync failed:', attSyncErr);
    }
    const refreshed: any = await LeaveRequest.findByPk(String(leave.id));
    return {
      ok: true,
      leave: refreshed,
      previousStatus: current,
      nextStatus: LEAVE_STATUS.APPROVED,
    };
  }

  return { ok: false, status: 400, message: `Unsupported status: ${next}` };
}

/**
 * Return a pending leave to the submitter for revision.
 * Clears the approver chain so a clean resubmit can start a new chain.
 */
export async function returnLeaveRequest(
  leaveId: string,
  actor: { id: string; role: string },
  notes?: string | null
): Promise<LeaveStatusTransitionResult> {
  await ensureLeaveWorkflowColumns();
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, status: 404, message: 'Leave request not found' };

  const current = String(leave.status ?? '').toUpperCase();
  if (current !== LEAVE_STATUS.PENDING && current !== LEAVE_STATUS.MANAGER_APPROVED) {
    return {
      ok: false,
      status: 400,
      message: 'Only pending leave requests can be returned for revision.',
    };
  }

  const comment = requireWorkflowComment(notes);
  if (!comment) {
    return { ok: false, status: 400, message: 'A return comment is required (min 3 characters).' };
  }

  const actorId = String(actor.id ?? '').trim();
  const actorRole = String(actor.role ?? '').toUpperCase();
  const assignedManagerId = String(leave.assignedManagerId ?? '').trim();
  const isHrAdmin = ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole);

  const {
    LEAVE_APPROVER_CONFIG,
    loadChainApprovers,
    chainRequiresActorApproval,
  } = await import('./workflowChainApproverService.js');

  const approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, leaveId);
  if (approvers.length) {
    if (!chainRequiresActorApproval(approvers, actorId)) {
      return {
        ok: false,
        status: 403,
        message: 'It is not your turn to return this leave request.',
      };
    }
  } else {
    const canReturn =
      isHrAdmin ||
      (current === LEAVE_STATUS.PENDING &&
        assignedManagerId &&
        actorId === assignedManagerId) ||
      (current === LEAVE_STATUS.PENDING && actorRole === 'MANAGER' && !assignedManagerId) ||
      (current === LEAVE_STATUS.MANAGER_APPROVED && isHrAdmin);
    if (!canReturn) {
      return { ok: false, status: 403, message: 'You are not allowed to return this request.' };
    }
  }

  leave.status = LEAVE_STATUS.RETURNED;
  leave.rejectionReason = comment;
  leave.managerApprovedAt = null;
  leave.managerApprovedBy = null;
  leave.hrApprovedAt = null;
  leave.hrApprovedBy = null;
  await leave.save();

  // Keep the previous approver chain so resubmit can prefill names/ids.
  // Inbox / approve paths only act when leave status is PENDING, so RETURNED is safe.

  try {
    const { createNotification } = await import('./notificationService.js');
    const ownerId = String(leave.userId ?? '').trim();
    if (ownerId) {
      await createNotification({
        userId: ownerId,
        id: `leave-returned-${leaveId}-${ownerId}-${Date.now()}`,
        title: 'Leave request returned',
        message: `${buildLeaveSummary(leave)} was returned for revision: ${comment}`,
        type: 'WARNING',
        link: `/leaves?scope=self&leaveId=${encodeURIComponent(leaveId)}`,
      });
    }
  } catch {
    /* non-fatal */
  }

  await logLeaveStatusChange(leaveId, actorId, current, LEAVE_STATUS.RETURNED, comment);
  return {
    ok: true,
    leave,
    previousStatus: current,
    nextStatus: LEAVE_STATUS.RETURNED,
    chainHandled: true,
  };
}

/**
 * Owner (or HR/Admin) updates a RETURNED leave and resubmits into PENDING with a fresh approver chain.
 */
export async function resubmitReturnedLeave(
  leaveId: string,
  actor: { id: string; role: string },
  body: {
    type?: string;
    startDate?: string;
    endDate?: string;
    isHalfDay?: boolean;
    halfDayPeriod?: string | null;
    reason?: string;
    assignedManagerId?: string | null;
    assignedApproverUserIds?: string[] | null;
  }
): Promise<LeaveStatusTransitionResult> {
  await ensureLeaveWorkflowColumns();
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, status: 404, message: 'Leave request not found' };

  const current = String(leave.status ?? '').toUpperCase();
  if (current !== LEAVE_STATUS.RETURNED) {
    return {
      ok: false,
      status: 400,
      message: 'Only returned leave requests can be edited and resubmitted.',
    };
  }

  const ownerId = String(leave.userId ?? '').trim();
  const actorId = String(actor.id ?? '').trim();
  const actorRole = String(actor.role ?? '').toUpperCase();
  const isHrAdmin = ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actorRole);
  if (!isHrAdmin && ownerId !== actorId) {
    return { ok: false, status: 403, message: 'You can only resubmit your own leave requests.' };
  }

  const { normalizeLeaveCreateBody } = await import('./leaveDuration.js');
  const parsed = normalizeLeaveCreateBody({
    userId: ownerId,
    type: body.type ?? leave.type,
    startDate: body.startDate ?? leave.startDate,
    endDate: body.endDate ?? leave.endDate,
    isHalfDay: body.isHalfDay ?? leave.isHalfDay,
    halfDayPeriod: body.halfDayPeriod ?? leave.halfDayPeriod,
    reason: body.reason ?? leave.reason,
    assignedManagerId: body.assignedManagerId ?? leave.assignedManagerId,
  });
  if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };

  const { resolveAssignedChainApprovers } = await import('./workflowChainApproverService.js');
  let approverChain: string[] = [];
  try {
    approverChain = await resolveAssignedChainApprovers({
      assignedApproverUserIds: body.assignedApproverUserIds,
      requesterUserId: ownerId,
    });
  } catch (chainErr) {
    return { ok: false, status: 400, message: (chainErr as Error).message };
  }

  if (approverChain.length === 0) {
    const managerCheck = await validateAssignedManagerId(
      parsed.body.assignedManagerId,
      ownerId,
      undefined
    );
    if (!managerCheck.ok) return { ok: false, status: 400, message: managerCheck.message };
  }

  const { validateLeaveRequest } = await import('./leaveValidationService.js');
  const validation = await validateLeaveRequest({
    userId: ownerId,
    type: parsed.body.type,
    startDate: parsed.body.startDate,
    endDate: parsed.body.endDate,
    isHalfDay: parsed.body.isHalfDay,
    halfDayPeriod: parsed.body.halfDayPeriod,
    excludeRequestId: leaveId,
  });
  if (!validation.ok) return { ok: false, status: 400, message: validation.message };

  const effectiveManagerId = approverChain[0] ?? parsed.body.assignedManagerId;
  leave.type = parsed.body.type;
  leave.startDate = parsed.body.startDate;
  leave.endDate = parsed.body.endDate;
  leave.isHalfDay = parsed.body.isHalfDay;
  leave.halfDayPeriod = parsed.body.halfDayPeriod;
  leave.reason = parsed.body.reason;
  leave.assignedManagerId = effectiveManagerId;
  leave.status = LEAVE_STATUS.PENDING;
  leave.rejectionReason = null;
  leave.managerApprovedAt = null;
  leave.managerApprovedBy = null;
  leave.hrApprovedAt = null;
  leave.hrApprovedBy = null;
  leave.appliedOn = new Date().toISOString().split('T')[0];
  await leave.save();

  const plain = leave.get({ plain: true }) as Record<string, unknown>;
  if (approverChain.length) {
    await assignLeaveApproverChain(leaveId, approverChain, buildLeaveSummary(plain));
  } else {
    try {
      const { notifyLeaveSubmitted } = await import('./notificationService.js');
      void notifyLeaveSubmitted(plain as any).catch(() => undefined);
    } catch {
      /* non-fatal */
    }
  }

  await logLeaveStatusChange(leaveId, actorId, current, LEAVE_STATUS.PENDING, 'Resubmitted after return');
  return {
    ok: true,
    leave,
    previousStatus: current,
    nextStatus: LEAVE_STATUS.PENDING,
    chainHandled: Boolean(approverChain.length),
  };
}

/** Employee withdraws a request before manager/HR has finalized it. */
export async function cancelLeaveByRequester(
  leaveId: string,
  requesterUserId: string
): Promise<LeaveStatusTransitionResult> {
  await ensureLeaveWorkflowColumns();
  const leave: any = await LeaveRequest.findByPk(leaveId);
  if (!leave) return { ok: false, status: 404, message: 'Leave request not found' };

  const ownerId = String(leave.userId ?? '').trim();
  const actorId = String(requesterUserId ?? '').trim();
  if (!actorId || ownerId !== actorId) {
    return { ok: false, status: 403, message: 'You can only cancel your own leave requests.' };
  }

  const current = String(leave.status ?? '').toUpperCase();
  if (current === LEAVE_STATUS.CANCELLED) {
    return { ok: false, status: 400, message: 'This request is already cancelled.' };
  }
  if (current !== LEAVE_STATUS.PENDING && current !== LEAVE_STATUS.RETURNED) {
    return {
      ok: false,
      status: 400,
      message: 'Only pending or returned requests can be cancelled.',
    };
  }

  leave.status = LEAVE_STATUS.CANCELLED;
  await leave.save();

  const { formatLeaveDateRange } = await import('./leaveDuration.js');
  const summary = `${String(leave.type)} leave (${formatLeaveDateRange(leave)})`;

  try {
    const {
      loadChainApprovers,
      notifyChainWorkflowFinished,
      LEAVE_APPROVER_CONFIG,
    } = await import('./workflowChainApproverService.js');
    const approvers = await loadChainApprovers(LEAVE_APPROVER_CONFIG, leaveId);
    if (approvers.length) {
      await notifyChainWorkflowFinished({
        cfg: LEAVE_APPROVER_CONFIG,
        entityId: leaveId,
        outcome: 'cancelled',
        approvers,
        submitterUserId: ownerId,
        summary,
      });
    } else {
      const assignedManagerId = String(leave.assignedManagerId ?? '').trim();
      if (assignedManagerId) {
        const { createNotification } = await import('./notificationService.js');
        await createNotification({
          userId: assignedManagerId,
          id: `leave-cancelled-${leaveId}-${assignedManagerId}`,
          title: 'Leave request cancelled',
          message: `${summary} was withdrawn by the employee.`,
          type: 'INFO',
          link: '/leaves?scope=manage&tab=requests',
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  await logLeaveStatusChange(leaveId, requesterUserId, current, LEAVE_STATUS.CANCELLED, 'Cancelled by requester');

  return {
    ok: true,
    leave,
    previousStatus: current,
    nextStatus: LEAVE_STATUS.CANCELLED,
  };
}
