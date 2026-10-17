import { Op } from 'sequelize';
import { Employee, sequelize } from '../db.js';
import { EmployeeAbandonmentCase } from './abandonmentSchema.js';
import { writePayrollAuditLog } from './payrollAuditService.js';
import { computeLastValidWorkingDate } from './lastValidWorkingDateService.js';
import {
  rulesForSeparation,
  type SeparationType,
} from './separationTypes.js';
import { resolveEmployeePk, findUserIdByEmployeePk } from '../employeeIdentity.js';
import { syncPortalUserActiveForEmployee } from '../portalUserAccount.js';
import { notifyRoles } from '../notificationService.js';
import { getAbandonmentPolicy } from './abandonmentPolicyService.js';
import { employeeLookupWhere, toCanonicalEmployeeDisplayId } from '../employeeIdFormat.js';

export type InvestigationNote = {
  at: string;
  by: string;
  note: string;
  type: 'note' | 'contact' | 'manager' | 'document';
};

function parseJsonArray<T>(raw: unknown): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as T[];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function caseId(): string {
  return `abandon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function getAbandonmentCaseForEmployee(employeeRef: string) {
  const employeePk = await resolveEmployeePk(employeeRef);
  if (!employeePk) return null;
  const row = await EmployeeAbandonmentCase.findOne({
    where: {
      employee_id: employeePk,
      caseStatus: { [Op.notIn]: ['CLOSED'] },
    },
    order: [['createdAt', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
}

export async function listAbandonmentCases(filters?: {
  status?: string;
  employeeId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.caseStatus = filters.status;
  if (filters?.employeeId) {
    const pk = await resolveEmployeePk(filters.employeeId);
    if (pk) where.employee_id = pk;
  }
  const rows = await EmployeeAbandonmentCase.findAll({
    where,
    order: [['updatedAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

export async function flagPotentialAbandonment(params: {
  employeeDisplayId: string;
  employeePk: string;
  consecutiveDays: number;
  thresholdDays: number;
  payrollGroupId?: string;
}) {
  const userId = (await findUserIdByEmployeePk(params.employeePk)) ?? '';
  const existing = await EmployeeAbandonmentCase.findOne({
    where: {
      employee_id: params.employeePk,
      caseStatus: { [Op.in]: ['MONITORING', 'UNDER_INVESTIGATION', 'POTENTIAL_ABANDONMENT'] },
    },
  });

  const now = new Date().toISOString();
  if (existing) {
    await existing.update({
      consecutiveAbsenceDays: params.consecutiveDays,
      thresholdDays: params.thresholdDays,
      caseStatus: 'POTENTIAL_ABANDONMENT',
      flaggedAt: existing.get('flaggedAt') ?? now,
    });
    await Employee.update(
      {
        investigation_status: 'POTENTIAL_ABANDONMENT',
        abandonment_flagged_at: now,
      },
      { where: { id: params.employeePk } }
    );
    return existing.get({ plain: true });
  }

  const { date: lvd } = await computeLastValidWorkingDate({
    userId: params.userId,
    lookbackDays: 120,
  });

  const row = await EmployeeAbandonmentCase.create({
    id: caseId(),
    employee_id: params.employeePk,
    caseStatus: 'POTENTIAL_ABANDONMENT',
    consecutiveAbsenceDays: params.consecutiveDays,
    thresholdDays: params.thresholdDays,
    lastValidWorkingDate: lvd,
    flaggedAt: now,
    payrollGroupId: params.payrollGroupId ?? 'default',
    investigationJson: JSON.stringify([]),
    contactAttemptsJson: JSON.stringify([]),
  });

  await Employee.update(
    {
      investigation_status: 'POTENTIAL_ABANDONMENT',
      abandonment_flagged_at: now,
      last_valid_working_date: lvd,
    },
    { where: { id: params.employeePk } }
  );

  return row.get({ plain: true });
}

export async function markUnderInvestigation(params: {
  caseId: string;
  actorUserId: string;
  reason?: string;
}) {
  const row = await EmployeeAbandonmentCase.findByPk(params.caseId);
  if (!row) {
    const err = new Error('Abandonment case not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const before = row.get({ plain: true });
  const now = new Date().toISOString();
  await row.update({
    caseStatus: 'UNDER_INVESTIGATION',
    underInvestigationAt: now,
  });
  await Employee.update(
    { investigation_status: 'UNDER_INVESTIGATION' },
    { where: { id: row.get('employee_id') } }
  );
  await writePayrollAuditLog({
    entityType: 'abandonment_case',
    entityId: params.caseId,
    actionType: 'UNDER_INVESTIGATION',
    userId: params.actorUserId,
    oldValue: before,
    newValue: row.get({ plain: true }),
    metadata: { reason: params.reason },
  });
  return row.get({ plain: true });
}

export async function appendInvestigationEntry(params: {
  caseId: string;
  actorUserId: string;
  note: string;
  type: InvestigationNote['type'];
}) {
  const row = await EmployeeAbandonmentCase.findByPk(params.caseId);
  if (!row) {
    const err = new Error('Abandonment case not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const entry: InvestigationNote = {
    at: new Date().toISOString(),
    by: params.actorUserId,
    note: params.note,
    type: params.type,
  };
  const field =
    params.type === 'contact' ? 'contactAttemptsJson' : 'investigationJson';
  const current = parseJsonArray<InvestigationNote>(row.get(field));
  current.push(entry);
  await row.update({ [field]: JSON.stringify(current) });
  await writePayrollAuditLog({
    entityType: 'abandonment_case',
    entityId: params.caseId,
    actionType: 'INVESTIGATION_NOTE',
    userId: params.actorUserId,
    newValue: entry,
  });
  return row.get({ plain: true });
}

export async function confirmAbsconded(params: {
  caseId: string;
  actorUserId: string;
  reason: string;
}) {
  const reason = String(params.reason || '').trim();
  if (!reason) {
    const err = new Error('Reason is required to mark absconded') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  return sequelize.transaction(async (transaction) => {
    const row = await EmployeeAbandonmentCase.findByPk(params.caseId, { transaction });
    if (!row) {
      const err = new Error('Abandonment case not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const before = row.get({ plain: true });
    const employeePk = String(row.get('employee_id'));
    const employee = await Employee.findByPk(employeePk, { transaction });
    if (!employee) {
      const err = new Error('Employee not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const displayId =
      toCanonicalEmployeeDisplayId(employee.get('employee_id')) || String(employee.get('employee_id') ?? '');
    const userId = (await findUserIdByEmployeePk(employeePk)) ?? '';

    const { date: lvd, source } = await computeLastValidWorkingDate({
      userId,
      employee: employee.get({ plain: true }),
    });
    const lastDate =
      lvd ?? String(employee.get('last_working_date') ?? new Date().toISOString().slice(0, 10));

    const { archiveEmployeeSnapshot } = await import('../employeeLifecycle.js');
    await archiveEmployeeSnapshot({
      employee,
      reason,
      archivedBy: params.actorUserId ?? null,
      transaction,
    });

    const now = new Date().toISOString();
    await row.update(
      {
        caseStatus: 'ABSCONDED_CONFIRMED',
        abscondedAt: now,
        abscondedBy: params.actorUserId,
        lastValidWorkingDate: lastDate,
      },
      { transaction }
    );

    await employee.update(
      {
        status: 'absconded',
        separation_type: 'absconded',
        investigation_status: 'ABSCONDED',
        last_valid_working_date: lastDate,
        last_working_date: lastDate,
        terminated_at: new Date(),
        termination_reason: reason,
        offboard_type: 'absconded',
      },
      { transaction }
    );

    await syncPortalUserActiveForEmployee(employee, false, transaction, {
      forceFrozen: true,
    });

    const policy = await getAbandonmentPolicy();
    await notifyRoles(policy.notifyRoles, {
      title: 'Employee marked absconded',
      message: `${displayId} confirmed absconded. Last valid working date: ${lastDate}. Initiate final settlement.`,
      type: 'WARNING',
      link: '/payroll/final-settlement',
      idPrefix: `absconded-${displayId}`,
    });

    await writePayrollAuditLog({
      entityType: 'abandonment_case',
      entityId: params.caseId,
      actionType: 'ABSCONDED_CONFIRMED',
      userId: params.actorUserId,
      oldValue: before,
      newValue: row.get({ plain: true }),
      metadata: { reason, lastValidWorkingDate: lastDate },
    });

    return row.get({ plain: true });
  });
}

export async function offboardWithSeparationType(params: {
  displayEmployeeId: string;
  separationType: SeparationType;
  reason: string;
  offboardedBy?: string | null;
  lastWorkingDate?: string | null;
  skipResignationLetter?: boolean;
}) {
  const rules = rulesForSeparation(params.separationType);
  const reason = String(params.reason || '').trim();
  if (!reason) {
    const err = new Error('Separation reason is required') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findOne({
      where: employeeLookupWhere(params.displayEmployeeId) as never,
      transaction,
    });
    if (!employee) {
      const err = new Error('Employee not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }

    const userId = employee.get('email')
      ? (
          await import('../db.js').then(({ User }) =>
            User.findOne({ where: { email: String(employee.get('email')) }, transaction })
          )
        )?.get('id')
      : null;

    let lwd = params.lastWorkingDate?.slice(0, 10) ?? null;
    if (!lwd && userId) {
      const computed = await computeLastValidWorkingDate({
        userId: String(userId),
        employee: employee.get({ plain: true }),
      });
      lwd = computed.date;
    }
    if (!lwd) lwd = new Date().toISOString().slice(0, 10);

    const { archiveEmployeeSnapshot } = await import('../employeeLifecycle.js');
    await archiveEmployeeSnapshot({
      employee,
      reason,
      archivedBy: params.offboardedBy ?? null,
      transaction,
    });

    const now = new Date();
    await employee.update(
      {
        status: rules.targetStatus,
        separation_type: params.separationType,
        terminated_at: now,
        termination_reason: reason,
        offboard_type: params.separationType,
        offboard_source: 'abandonment',
        last_working_date: lwd,
        last_valid_working_date: lwd,
        investigation_status: null,
        updated_at: now,
      },
      { transaction }
    );

    await syncPortalUserActiveForEmployee(employee, false, transaction, {
      forceFrozen: true,
    });

    await writePayrollAuditLog({
      entityType: 'employee',
      entityId: String(employee.get('id')),
      actionType: 'SEPARATION_OFFBOARD',
      userId: params.offboardedBy ?? null,
      newValue: {
        separationType: params.separationType,
        status: rules.targetStatus,
        lastWorkingDate: lwd,
      },
      metadata: { reason },
    });

    return {
      message: `Employee ${rules.label} processed and archived to history.`,
      lastWorkingDate: lwd,
      separationType: params.separationType,
    };
  });
}
