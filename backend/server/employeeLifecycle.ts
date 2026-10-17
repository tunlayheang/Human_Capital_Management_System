import type { Transaction } from 'sequelize';
import { Op, QueryTypes } from 'sequelize';
import fs from 'node:fs';
import {
  sequelize,
  Employee,
  Department,
  Position,
  HistoryEmployee,
  EmployeeStatusHistory,
  EmployeeDependent,
  EmployeeIssuedCard,
  EmployeeAllowanceAssignment,
  SalaryStructure,
  EmployeeSetting,
  ProjectAssignment,
  User,
  LeaveBalance,
  EmployeeLeaveTypeAssignment,
  MonthlyPlanningRosterEntry,
  RosterException,
  RosterAssignment,
  Notification,
  UserDeviceSession,
  EmployeeReview,
  Message,
} from './db';
import { syncPortalUserActiveForEmployee } from './portalUserAccount.js';
import { writeWorkflowStatusAudit, writeDomainAudit } from './domainAuditService.js';
import { OFFBOARDED_STATUSES } from './employeeArchiveService.js';
import {
  employeeHasResignationLetter,
  resolveUploadDiskPath,
} from './employeeDocumentService.js';
import { EMPLOYEE_STATUS_DRAFT, normalizeEmployeeLifecycleStatus } from './employeeDraft.js';
import { findUserIdByEmployeePk, resolveEmployeePk } from './employeeIdentity.js';
import { employeeLookupWhere } from './employeeIdFormat.js';

const RESTORABLE_STATUSES = [...OFFBOARDED_STATUSES, 'suspended'] as const;

export class EmployeeLifecycleError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type OffboardType = 'terminate' | 'resign';

async function hasResignationLetter(
  employeePk: string,
  transaction: Transaction
): Promise<boolean> {
  return employeeHasResignationLetter(employeePk, transaction);
}

function employeeSnapshotJson(employee: InstanceType<typeof Employee>): string {
  const plain = employee.toJSON() as Record<string, unknown>;
  return JSON.stringify(plain);
}

/** Persist a point-in-time employee row into the historical archive. */
export async function archiveEmployeeSnapshot(params: {
  employee: InstanceType<typeof Employee>;
  reason: string;
  archivedBy?: string | null;
  transaction: Transaction;
}): Promise<number> {
  const now = new Date();
  await HistoryEmployee.update(
    { is_currently_terminated: false },
    {
      where: {
        employee_id: params.employee.employee_id,
        is_currently_terminated: true,
      },
      transaction: params.transaction,
    }
  );

  const archive = await HistoryEmployee.create(
    {
      employee_pk: params.employee.id,
      employee_id: params.employee.employee_id,
      employee_snapshot: employeeSnapshotJson(params.employee),
      terminated_at: now,
      termination_reason: String(params.reason || '').trim() || 'Offboarded',
      terminated_by: params.archivedBy ?? null,
      is_currently_terminated: true,
    },
    { transaction: params.transaction }
  );

  return archive.id as number;
}

async function logStatusChange(
  employeePk: string,
  oldStatus: string | null | undefined,
  newStatus: string,
  reason: string | null | undefined,
  changedBy: string | null | undefined,
  transaction: Transaction
) {
  try {
    await EmployeeStatusHistory.create(
      {
        employee_id: employeePk,
        old_status: oldStatus ?? null,
        new_status: newStatus,
        reason: reason ?? null,
        changed_by: changedBy ?? null,
        changed_at: new Date(),
      },
      { transaction }
    );
  } catch (err) {
    console.warn('[employeeLifecycle] Status history log skipped:', (err as Error)?.message || err);
  }
}

export async function offboardEmployee(params: {
  displayEmployeeId: string;
  type: OffboardType;
  reason: string;
  offboardedBy?: string | null;
  source?: import('./offboardSource.js').OffboardSource | null;
  resignationSubmittedAt?: string | null;
  resignationApprovedAt?: string | null;
  lastWorkingDate?: string | null;
  finalSettlementDate?: string | null;
}): Promise<{ message: string; history_id: number }> {
  const reason = String(params.reason || '').trim();
  if (!reason) {
    throw new EmployeeLifecycleError('Offboarding reason is required', 400);
  }
  const offboardType: OffboardType = params.type === 'resign' ? 'resign' : 'terminate';
  const targetStatus = offboardType === 'resign' ? 'resigned' : 'terminated';
  const actionLabel = offboardType === 'resign' ? 'resigned' : 'terminated';

  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findOne({
      where: employeeLookupWhere(params.displayEmployeeId) as never,
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Position, as: 'position', attributes: ['id', 'title'] },
      ],
      transaction,
    });

    if (!employee) {
      throw new EmployeeLifecycleError('Employee not found', 404);
    }

    const currentStatus = String(employee.status || '').toLowerCase();
    if (currentStatus === 'terminated' || currentStatus === 'resigned') {
      throw new EmployeeLifecycleError('Employee is already offboarded', 400);
    }

    if (offboardType === 'resign') {
      const hasLetter = await hasResignationLetter(String(employee.id), transaction);
      if (!hasLetter) {
        throw new EmployeeLifecycleError(
          'Resignation requires a Resignation Letter document. Upload it in Employee Documents first.',
          400
        );
      }
    }

    const oldStatus = employee.status;
    const now = new Date();

    const historyId = await archiveEmployeeSnapshot({
      employee,
      reason,
      archivedBy: params.offboardedBy ?? null,
      transaction,
    });

    const lastWorking =
      params.lastWorkingDate?.slice(0, 10) ??
      params.finalSettlementDate?.slice(0, 10) ??
      now.toISOString().slice(0, 10);

    await employee.update(
      {
        status: targetStatus,
        terminated_at: now,
        termination_reason: reason,
        offboard_type: offboardType,
        offboard_source: params.source ?? null,
        resignation_submitted_at: params.resignationSubmittedAt
          ? new Date(params.resignationSubmittedAt)
          : offboardType === 'resign'
            ? now
            : null,
        resignation_approved_at: params.resignationApprovedAt
          ? new Date(params.resignationApprovedAt)
          : null,
        last_working_date: lastWorking,
        final_settlement_date: params.finalSettlementDate?.slice(0, 10) ?? null,
        updated_at: now,
      },
      { transaction }
    );

    await syncPortalUserActiveForEmployee(employee, false, transaction, {
      forceFrozen: true,
    });

    await logStatusChange(
      employee.id,
      oldStatus,
      targetStatus,
      reason,
      params.offboardedBy ?? null,
      transaction
    );

    return {
      message: `Employee ${actionLabel} successfully and archived to history.`,
      history_id: historyId,
      employeePk: String(employee.id),
      employeeDisplayId: params.displayEmployeeId,
      offboardType,
      previousStatus: String(oldStatus ?? 'active'),
      nextStatus: targetStatus,
    };
  }).then(async (result) => {
    await writeWorkflowStatusAudit({
      entityType: 'employee',
      entityId: params.displayEmployeeId,
      previousStatus: result.previousStatus,
      nextStatus: result.nextStatus,
      performedBy: params.offboardedBy ?? null,
      reason: params.reason,
      metadata: { lifecycle: 'offboard', offboardType: result.offboardType },
    });
    try {
      const { notifyOffboardingCompleted } = await import('./notificationService.js');
      void notifyOffboardingCompleted({
        employeePk: result.employeePk,
        employeeDisplayId: result.employeeDisplayId,
        offboardType: result.offboardType,
        reason: params.reason,
      });
    } catch (err) {
      console.warn('[lifecycle] offboard notification failed:', err);
    }
    return { message: result.message, history_id: result.history_id };
  });
}

export async function terminateEmployee(params: {
  displayEmployeeId: string;
  reason: string;
  terminatedBy?: string | null;
}): Promise<{ message: string; history_id: number }> {
  return offboardEmployee({
    displayEmployeeId: params.displayEmployeeId,
    type: 'terminate',
    reason: params.reason,
    offboardedBy: params.terminatedBy ?? null,
  });
}

export async function restoreEmployee(params: {
  displayEmployeeId: string;
  restoredBy?: string | null;
  restoreReason?: string | null;
}): Promise<{ message: string }> {
  const restoreReason = String(params.restoreReason ?? '').trim();
  if (!restoreReason) {
    throw new EmployeeLifecycleError('Restore reason is required', 400);
  }

  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findOne({
      where: employeeLookupWhere(params.displayEmployeeId) as never,
      transaction,
    });

    if (!employee) {
      throw new EmployeeLifecycleError('Employee not found', 404);
    }

    const plain = employee.get({ plain: true }) as Record<string, unknown>;
    if (plain.final_removal_approved_at) {
      throw new EmployeeLifecycleError(
        'Cannot restore: final removal was approved after settlement without payment.',
        409
      );
    }

    const { FinalSettlementRun } = await import('./payroll/finalSettlementSchema.js');
    const { Op } = await import('sequelize');
    const { resolveEmployeePk } = await import('./employeeIdentity.js');
    const employeePk = await resolveEmployeePk(params.displayEmployeeId);
    const closedSettlement =
      employeePk &&
      (await FinalSettlementRun.findOne({
        where: {
          employee_id: employeePk,
          status: { [Op.in]: ['PAID', 'LOCKED'] },
        },
        transaction,
      }));
    if (closedSettlement) {
      throw new EmployeeLifecycleError(
        'Cannot restore: final settlement payment or offboarding closure is complete.',
        409
      );
    }

    const currentStatus = String(employee.status || '').toLowerCase();
    if (!(RESTORABLE_STATUSES as readonly string[]).includes(currentStatus)) {
      throw new EmployeeLifecycleError('Employee is not offboarded', 400);
    }

    const now = new Date();
    const archive = await HistoryEmployee.findOne({
      where: {
        employee_id: params.displayEmployeeId,
        is_currently_terminated: true,
      },
      order: [['terminated_at', 'DESC']],
      transaction,
    });

    if (archive) {
      await archive.update(
        {
          restored_at: now,
          restored_by: params.restoredBy ?? null,
          is_currently_terminated: false,
        },
        { transaction }
      );
    }

    await employee.update(
      {
        status: 'active',
        terminated_at: null,
        termination_reason: null,
        offboard_type: null,
        offboard_source: null,
        resignation_submitted_at: null,
        resignation_approved_at: null,
        last_working_date: null,
        last_valid_working_date: null,
        final_settlement_date: null,
        suspended_at: null,
        separation_type: null,
        investigation_status: null,
        abandonment_flagged_at: null,
        final_removal_approved_at: null,
        final_removal_approved_by: null,
        updated_at: now,
      },
      { transaction }
    );

    await syncPortalUserActiveForEmployee(employee, true, transaction);

    await logStatusChange(
      employee.id,
      currentStatus,
      'active',
      restoreReason,
      params.restoredBy ?? null,
      transaction
    );

    return {
      message: 'Employee restored successfully.',
      previousStatus: currentStatus,
      employeeDisplayId: params.displayEmployeeId,
    };
  }).then(async (result) => {
    await writeWorkflowStatusAudit({
      entityType: 'employee',
      entityId: result.employeeDisplayId,
      previousStatus: result.previousStatus,
      nextStatus: 'active',
      performedBy: params.restoredBy ?? null,
      reason: restoreReason,
      metadata: { lifecycle: 'restore' },
    });
    return { message: result.message };
  });
}

export async function suspendEmployee(params: {
  displayEmployeeId: string;
  reason?: string;
  suspendedBy?: string | null;
}): Promise<{ message: string }> {
  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findOne({
      where: employeeLookupWhere(params.displayEmployeeId) as never,
      transaction,
    });
    if (!employee) throw new EmployeeLifecycleError('Employee not found', 404);
    const oldStatus = employee.status;
    const now = new Date();
    await employee.update(
      {
        status: 'suspended',
        suspended_at: now,
        updated_at: now,
      },
      { transaction }
    );
    await logStatusChange(
      employee.id,
      oldStatus,
      'suspended',
      params.reason ?? 'Suspended',
      params.suspendedBy ?? null,
      transaction
    );
    return {
      message: 'Employee suspended.',
      previousStatus: String(oldStatus ?? 'active'),
      employeeDisplayId: params.displayEmployeeId,
    };
  }).then(async (result) => {
    await writeWorkflowStatusAudit({
      entityType: 'employee',
      entityId: result.employeeDisplayId,
      previousStatus: result.previousStatus,
      nextStatus: 'suspended',
      performedBy: params.suspendedBy ?? null,
      reason: params.reason ?? 'Suspended',
      metadata: { lifecycle: 'suspend' },
    });
    return { message: result.message };
  });
}

/**
 * Permanently remove an incomplete draft employee and all related rows/files.
 * Active / offboarded employees must use offboarding — not this path.
 */
export async function deleteDraftEmployee(params: {
  displayEmployeeId: string;
  reason: string;
  deletedBy?: string | null;
}): Promise<{ message: string }> {
  const reason = String(params.reason ?? '').trim();
  if (reason.length < 3) {
    throw new EmployeeLifecycleError('A delete reason is required (at least 3 characters).', 400);
  }

  const displayRef = String(params.displayEmployeeId ?? '').trim();
  if (!displayRef) {
    throw new EmployeeLifecycleError('Employee ID is required.', 400);
  }

  const unlinkUploadPath = (filePath: unknown) => {
    const raw = String(filePath ?? '').trim();
    if (!raw) return;
    try {
      const diskPath = resolveUploadDiskPath(raw);
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    } catch {
      /* non-fatal */
    }
  };

  const safeDestroy = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.warn(`[deleteDraftEmployee] ${label} cleanup skipped:`, err);
    }
  };

  const safeSqlDelete = async (
    table: string,
    sql: string,
    replacements: Record<string, unknown>,
    transaction: Transaction
  ) => {
    try {
      await sequelize.query(sql, {
        replacements,
        type: QueryTypes.DELETE,
        transaction,
      });
    } catch (err) {
      console.warn(`[deleteDraftEmployee] ${table} cleanup skipped:`, err);
    }
  };

  const result = await sequelize.transaction(async (transaction) => {
    const employeePk = await resolveEmployeePk(displayRef);
    if (!employeePk) {
      throw new EmployeeLifecycleError('Employee not found', 404);
    }

    const employee = await Employee.findByPk(employeePk, { transaction });
    if (!employee) {
      throw new EmployeeLifecycleError('Employee not found', 404);
    }

    const status = normalizeEmployeeLifecycleStatus(employee.get('status'));
    if (status !== EMPLOYEE_STATUS_DRAFT) {
      throw new EmployeeLifecycleError(
        'Only draft employees can be permanently deleted. Use offboarding for active records.',
        400
      );
    }

    const displayId = String(employee.get('employee_id') ?? displayRef);
    const snapshot = employee.get({ plain: true }) as Record<string, unknown>;
    const portalUserId = await findUserIdByEmployeePk(employeePk);

    // Collect upload paths before destroying rows.
    const uploadPaths = new Set<string>();
    const avatarUrl = String(snapshot.avatar_url ?? '').trim();
    if (avatarUrl) uploadPaths.add(avatarUrl);
    try {
      const docsRaw = snapshot.documents_json;
      const docs =
        typeof docsRaw === 'string'
          ? (JSON.parse(docsRaw) as unknown)
          : docsRaw;
      if (Array.isArray(docs)) {
        for (const doc of docs) {
          if (!doc || typeof doc !== 'object') continue;
          const fp = String(
            (doc as { file_path?: unknown; filePath?: unknown }).file_path ??
              (doc as { filePath?: unknown }).filePath ??
              ''
          ).trim();
          if (fp) uploadPaths.add(fp);
        }
      }
    } catch {
      /* ignore bad documents_json */
    }
    try {
      const cards = await EmployeeIssuedCard.findAll({
        where: { employee_id: employeePk },
        attributes: ['avatar_url'],
        transaction,
      });
      for (const card of cards) {
        const p = String(card.get('avatar_url') ?? '').trim();
        if (p) uploadPaths.add(p);
      }
    } catch {
      /* ignore */
    }

    // --- Portal user + user-owned rows ---
    if (portalUserId) {
      await safeDestroy('notifications', () =>
        Notification.destroy({ where: { userId: portalUserId }, transaction })
      );
      await safeDestroy('device sessions', () =>
        UserDeviceSession.destroy({ where: { userId: portalUserId }, transaction })
      );
      await safeDestroy('employee reviews', () =>
        EmployeeReview.destroy({ where: { userId: portalUserId }, transaction })
      );
      await safeDestroy('messages', () =>
        Message.destroy({
          where: {
            [Op.or]: [{ senderId: portalUserId }, { receiverId: portalUserId }],
          },
          transaction,
        })
      );
      await safeSqlDelete(
        'attendancerecords',
        'DELETE FROM `attendancerecords` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'leaverequests',
        'DELETE FROM `leaverequests` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'overtimerequests',
        'DELETE FROM `overtimerequests` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'payslips',
        'DELETE FROM `payslips` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'employee_appraisals',
        'DELETE FROM `employee_appraisals` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'userpermissionoverrides',
        'DELETE FROM `userpermissionoverrides` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'permissionoverriderequests',
        'DELETE FROM `permissionoverriderequests` WHERE `userId` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'personal_hub_items',
        'DELETE FROM `personal_hub_items` WHERE `userId` = :uid OR `user_id` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'hcms_chat_meta',
        'DELETE FROM `hcms_chat_meta` WHERE `user_id` = :uid OR `sender_id` = :uid OR `created_by` = :uid',
        { uid: portalUserId },
        transaction
      );
      await safeSqlDelete(
        'workflow_approval_steps',
        'DELETE FROM `workflow_approval_steps` WHERE `user_id` = :uid',
        { uid: portalUserId },
        transaction
      );
      await User.destroy({ where: { id: portalUserId }, transaction });
    }

    // --- Employee children (RESTRICT / NO ACTION first) ---
    await EmployeeIssuedCard.destroy({ where: { employee_id: employeePk }, transaction });
    await EmployeeDependent.destroy({ where: { employee_id: employeePk }, transaction });
    await EmployeeStatusHistory.destroy({ where: { employee_id: employeePk }, transaction });

    await safeDestroy('leave ledger', () =>
      sequelize.query('DELETE FROM `leave_ledger` WHERE `employee_id` = :pk', {
        replacements: { pk: employeePk },
        type: QueryTypes.DELETE,
        transaction,
      })
    );
    await safeDestroy('leave balances', () =>
      LeaveBalance.destroy({ where: { employeeId: employeePk }, transaction })
    );
    await safeDestroy('leave type assignments', () =>
      EmployeeLeaveTypeAssignment.destroy({ where: { employeeId: employeePk }, transaction })
    );

    await EmployeeAllowanceAssignment.destroy({ where: { employee_id: employeePk }, transaction });
    await SalaryStructure.destroy({ where: { employee_id: employeePk }, transaction });
    await EmployeeSetting.destroy({ where: { employeeId: employeePk }, transaction });
    await ProjectAssignment.destroy({ where: { employeeId: employeePk }, transaction });
    await safeDestroy('history employee', () =>
      HistoryEmployee.destroy({ where: { employee_pk: employeePk }, transaction })
    );

    // Roster / planning orphans (no FK to employees)
    await safeDestroy('monthly planning roster', () =>
      MonthlyPlanningRosterEntry.destroy({
        where: { employeeId: { [Op.in]: [employeePk, displayId] } },
        transaction,
      })
    );
    await safeDestroy('roster exceptions', () =>
      RosterException.destroy({
        where: { employeeId: { [Op.in]: [employeePk, displayId] } },
        transaction,
      })
    );
    await safeDestroy('roster assignments', () =>
      RosterAssignment.destroy({
        where: {
          entityType: 'EMPLOYEE',
          entityId: { [Op.in]: [employeePk, displayId] },
        },
        transaction,
      })
    );

    // Extra employee-linked tables (names vary by env)
    for (const [table, sql] of [
      [
        'employee_sensitive_changes',
        'DELETE FROM `employee_sensitive_changes` WHERE `employee_id` = :pk OR `employee_pk` = :pk OR `employee_id` = :code',
      ],
      [
        'employee_movements',
        'DELETE FROM `employee_movements` WHERE `employee_id` = :code OR `employee_pk` = :pk OR `employee_id` = :pk',
      ],
      [
        'salary_structure_history',
        'DELETE FROM `salary_structure_history` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'employee_seniority_profiles',
        'DELETE FROM `employee_seniority_profiles` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'seniority_ledger',
        'DELETE FROM `seniority_ledger` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'seniority_indemnity_pre2019_ledger',
        'DELETE FROM `seniority_indemnity_pre2019_ledger` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'seniority_indemnity_payments',
        'DELETE FROM `seniority_indemnity_payments` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'unified_payroll_rule_logs',
        'DELETE FROM `unified_payroll_rule_logs` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'finalsettlementruns',
        'DELETE FROM `finalsettlementruns` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'payrolldeductionauthorizations',
        'DELETE FROM `payrolldeductionauthorizations` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'employeeabandonmentcases',
        'DELETE FROM `employeeabandonmentcases` WHERE `employee_id` = :pk OR `employee_id` = :code',
      ],
      [
        'employeereviews',
        'DELETE FROM `employeereviews` WHERE `employeeRowId` = :pk OR `employee_id` = :pk OR `employee_id` = :code',
      ],
    ] as const) {
      await safeSqlDelete(table, sql, { pk: employeePk, code: displayId }, transaction);
    }

    await sequelize.query(
      `UPDATE \`departments\` SET \`department_head_id\` = NULL WHERE \`department_head_id\` = :pk`,
      {
        replacements: { pk: employeePk },
        type: QueryTypes.UPDATE,
        transaction,
      }
    );

    // Hard-delete the employee row completely (no soft-delete / archive).
    await employee.destroy({ transaction });

    // Unlink upload files after DB commit of deletes inside the same txn success path.
    // Files are removed after destroy succeeds; if txn rolls back, files remain (safer).
    return { displayId, snapshot, uploadPaths: [...uploadPaths] };
  });

  for (const filePath of result.uploadPaths) {
    unlinkUploadPath(filePath);
  }

  await writeDomainAudit({
    entityType: 'employee',
    entityId: result.displayId,
    action: 'DELETE_DRAFT',
    performedBy: params.deletedBy ?? null,
    oldValue: {
      status: EMPLOYEE_STATUS_DRAFT,
      employee_id: result.displayId,
      first_name: result.snapshot.first_name,
      last_name: result.snapshot.last_name,
    },
    newValue: null,
    reason,
    metadata: { lifecycle: 'delete_draft', purged: true },
  });

  return { message: 'Draft employee permanently deleted.' };
}
