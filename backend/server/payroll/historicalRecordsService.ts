import { Op } from 'sequelize';
import { Employee, HistoryEmployee, User } from '../db.js';
import { findDisplayIdByEmployeePk } from '../employeeIdentity.js';
import { FinalSettlementRun } from './finalSettlementSchema.js';
import { PayrollAttendancePeriod } from './payrollHybridSchema.js';
import { countPayrollAuditLogsFromAudit, listPayrollAuditLogsFromAudit } from '../auditLogConsolidationService.js';
import { SalaryStructureHistory } from '../salaryStructureHistoryService.js';
import { serializeUserForClient, USER_ACCOUNT_ATTRIBUTES } from '../userAccountService.js';
import { joinEmployeeNameParts } from '../employeeDisplayName.js';

const RECORD_AUDIT_ACTIONS = [
  'PAYROLL_INPUTS_FROZEN',
  'STATUS_APPROVED',
  'STATUS_LOCKED',
  'STATUS_PAID',
  'PAYROLL_CALCULATED',
  'PAYROLL_RECALCULATED',
  'ATTENDANCE_LOCKED',
  'ATTENDANCE_FINALIZED',
  'FINAL_SETTLEMENT_CREATED',
  'FINAL_SETTLEMENT_UPDATED',
];

function parseJsonSafe(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikePortalUserId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^u-[\w-]+$/i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  return false;
}

async function loadUserDisplayNameMap(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) return new Map();

  const portalIds = unique.filter(looksLikePortalUserId);
  const map = new Map<string, string>();
  if (!portalIds.length) return map;

  const users: any[] = await User.findAll({
    where: { id: { [Op.in]: portalIds } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });

  await Promise.all(
    users.map(async (user) => {
      const id = String(user.id);
      try {
        const profile = await serializeUserForClient(user.get({ plain: true }));
        map.set(id, profile.name || profile.email || id);
      } catch {
        map.set(id, String(user.email || id));
      }
    })
  );
  return map;
}

function resolveRecordedByName(
  actorId: string | null | undefined,
  nameMap: Map<string, string>
): string {
  const raw = String(actorId ?? '').trim();
  if (!raw) return 'Unknown';
  if (nameMap.has(raw)) return nameMap.get(raw)!;
  if (!looksLikePortalUserId(raw)) return raw;
  return 'Unknown';
}

type RecordedMeta = {
  recordedBy: string | null;
  recordedByName: string;
  recordedAt: string | null;
};

async function attachRecordedMeta<T extends Record<string, unknown>>(
  rows: T[],
  pickUserId: (row: T) => string | null | undefined,
  pickAt: (row: T) => string | null | undefined
): Promise<Array<T & RecordedMeta>> {
  const userIds = rows.map((r) => pickUserId(r)).filter(Boolean) as string[];
  const nameMap = await loadUserDisplayNameMap(userIds);
  return rows.map((row) => {
    const recordedBy = pickUserId(row) ? String(pickUserId(row)) : null;
    return {
      ...row,
      recordedBy,
      recordedByName: resolveRecordedByName(recordedBy, nameMap),
      recordedAt: pickAt(row) ? String(pickAt(row)) : null,
    };
  });
}

type EmployeeContact = {
  name: string;
  email?: string;
  phone?: string;
};

async function employeeContactByDisplayId(ids: string[]): Promise<Map<string, EmployeeContact>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, EmployeeContact>();
  if (!unique.length) return map;
  const rows = await Employee.findAll({
    where: { employee_id: { [Op.in]: unique } },
    attributes: ['employee_id', 'first_name', 'last_name', 'email', 'phone'],
  });
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      employee_id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
    };
    map.set(String(p.employee_id), {
      name:
        joinEmployeeNameParts(p.first_name, p.last_name) || String(p.employee_id),
      email: String(p.email ?? '').trim() || undefined,
      phone: String(p.phone ?? '').trim() || undefined,
    });
  }
  return map;
}

async function employeeContactByPk(ids: string[]): Promise<Map<string, EmployeeContact>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, EmployeeContact>();
  if (!unique.length) return map;
  const rows = await Employee.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ['id', 'employee_id', 'first_name', 'last_name', 'email', 'phone'],
  });
  for (const row of rows) {
    const p = row.get({ plain: true }) as {
      id?: string;
      employee_id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
    };
    const name = joinEmployeeNameParts(p.first_name, p.last_name);
    map.set(String(p.id), {
      name: name || String(p.employee_id ?? p.id),
      email: String(p.email ?? '').trim() || undefined,
      phone: String(p.phone ?? '').trim() || undefined,
    });
  }
  return map;
}

export async function getHistoricalRecordsSummary() {
  const [finalSettlements, salaryHistory, attendancePeriods, offboarding, audit] =
    await Promise.all([
      FinalSettlementRun.count({
        where: { status: { [Op.notIn]: ['DRAFT', 'REJECTED'] } },
      }),
      SalaryStructureHistory.count().catch(() => 0),
      PayrollAttendancePeriod.count({
        where: { status: { [Op.in]: ['FINALIZED', 'LOCKED'] } },
      }),
      HistoryEmployee.count(),
      countPayrollAuditLogsFromAudit(RECORD_AUDIT_ACTIONS),
    ]);

  return {
    finalSettlements,
    salaryHistory,
    attendancePeriods,
    offboarding,
    payrollAudit: audit,
  };
}

export async function listHistoricalFinalSettlements(limit = 100) {
  const rows = await FinalSettlementRun.findAll({
    where: { status: { [Op.notIn]: ['DRAFT', 'REJECTED'] } },
    order: [['updatedAt', 'DESC']],
    limit: Math.min(limit, 500),
  });
  const pks = rows.map((r) => String(r.get('employee_id')));
  const displayIds = (
    await Promise.all(pks.map((pk) => findDisplayIdByEmployeePk(pk)))
  ).map((id, i) => id ?? pks[i]);
  const contacts = await employeeContactByDisplayId(displayIds);

  const mapped = rows.map((row, index) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const employeeId = displayIds[index] ?? '';
    const contact = contacts.get(employeeId);
    const status = String(plain.status ?? '');
    const updatedAt = plain.updatedAt ?? plain.updated_at;
    return {
      id: plain.id,
      employeeId,
      employeeName: contact?.name ?? '',
      employeeEmail: contact?.email ?? '',
      employeePhone: contact?.phone ?? '',
      month: plain.month,
      status,
      lastWorkingDate: plain.lastWorkingDate,
      netUsd: plain.netUsd,
      grossUsd: plain.grossUsd,
      paymentDate: plain.paymentDate,
      createdAt: plain.createdAt,
      updatedAt,
      managementApprovedBy: plain.managementApprovedBy,
      financeReviewedBy: plain.financeReviewedBy,
      hrReviewedBy: plain.hrReviewedBy,
      createdBy: plain.createdBy,
      readOnly: !['DRAFT', 'HR_REVIEW'].includes(status),
      hasBreakdownSnapshot: Boolean(plain.breakdownSnapshotJson),
    };
  });

  return attachRecordedMeta(
    mapped,
    (r) =>
      (r.managementApprovedBy as string) ||
      (r.financeReviewedBy as string) ||
      (r.hrReviewedBy as string) ||
      (r.createdBy as string) ||
      null,
    (r) => (r.updatedAt as string) ?? (r.createdAt as string) ?? null
  );
}

export async function listHistoricalSalaryChanges(limit = 100) {
  await import('../salaryStructureHistoryService.js').then((m) => m.ensureSalaryStructureHistorySchema());
  const rows = await SalaryStructureHistory.findAll({
    order: [['effective_from', 'DESC']],
    limit: Math.min(limit, 500),
  });
  const pks = rows.map((r) => String(r.get('employee_id')));
  const contacts = await employeeContactByPk(pks);
  const displayIds = await Employee.findAll({
    where: { id: { [Op.in]: pks } },
    attributes: ['id', 'employee_id'],
  });
  const codeByPk = new Map<string, string>();
  for (const e of displayIds) {
    codeByPk.set(String(e.get('id')), String(e.get('employee_id') ?? ''));
  }

  const mapped = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const pk = String(plain.employee_id ?? '');
    const contact = contacts.get(pk);
    const snap = parseJsonSafe(plain.snapshot_json);
    const prev = parseJsonSafe(plain.previous_snapshot_json);
    return {
      id: plain.id,
      employeePk: pk,
      employeeId: codeByPk.get(pk) ?? pk,
      employeeName: contact?.name ?? '',
      employeeEmail: contact?.email ?? '',
      employeePhone: contact?.phone ?? '',
      effectiveFrom: plain.effective_from,
      baseSalary: snap?.base_salary ?? snap?.baseSalary,
      previousBaseSalary: prev?.base_salary ?? prev?.baseSalary,
      currency: snap?.currency ?? 'USD',
      changedBy: plain.changed_by,
      changeReason: plain.change_reason,
      createdAt: plain.created_at,
      readOnly: true,
    };
  });

  return attachRecordedMeta(
    mapped,
    (r) => (r.changedBy as string) ?? null,
    (r) => (r.createdAt as string) ?? null
  );
}

export async function listHistoricalAttendancePeriods(limit = 100) {
  const rows = await PayrollAttendancePeriod.findAll({
    where: { status: { [Op.in]: ['FINALIZED', 'LOCKED'] } },
    order: [['month', 'DESC']],
    limit: Math.min(limit, 500),
  });

  const mapped = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    return {
      id: plain.id,
      month: plain.month,
      status: plain.status,
      payrollGroupId: plain.payrollGroupId,
      payPeriodStart: plain.payPeriodStart,
      payPeriodEnd: plain.payPeriodEnd,
      attendanceCutoffDate: plain.attendanceCutoffDate,
      freezeTrigger: plain.freezeTrigger,
      finalizedBy: plain.finalizedBy,
      finalizedAt: plain.finalizedAt,
      notes: plain.notes,
      readOnly: plain.status === 'LOCKED' || plain.freezeTrigger === 'PAYROLL_APPROVED',
    };
  });

  return attachRecordedMeta(
    mapped,
    (r) => (r.finalizedBy as string) ?? null,
    (r) => (r.finalizedAt as string) ?? null
  );
}

export async function listHistoricalOffboarding(limit = 100) {
  const rows = await HistoryEmployee.findAll({
    order: [['terminated_at', 'DESC']],
    limit: Math.min(limit, 500),
  });

  const displayIds = rows.map((r) => String(r.get('employee_id')));
  const contacts = await employeeContactByDisplayId(displayIds);

  const mapped = rows.map((row) => {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const employeeId = String(plain.employee_id ?? '');
    let snapshotName = '';
    let snapshotEmail = '';
    let snapshotPhone = '';
    const snap = parseJsonSafe(plain.employee_snapshot);
    if (snap) {
      snapshotName = joinEmployeeNameParts(
        (snap.first_name ?? snap.firstName) as string | undefined,
        (snap.last_name ?? snap.lastName) as string | undefined
      );
      snapshotEmail = String(snap.email ?? '').trim();
      snapshotPhone = String(snap.phone ?? '').trim();
    }
    const contact = contacts.get(employeeId);
    const terminatedAt = plain.terminated_at;
    const terminatedAtIso =
      terminatedAt instanceof Date
        ? terminatedAt.toISOString()
        : terminatedAt
          ? String(terminatedAt)
          : null;
    return {
      id: plain.id,
      employeeId,
      employeeName: contact?.name || snapshotName,
      employeeEmail: contact?.email || snapshotEmail || '',
      employeePhone: contact?.phone || snapshotPhone || '',
      terminatedAt: terminatedAtIso,
      terminationReason: plain.termination_reason,
      terminatedBy: plain.terminated_by,
      hasSnapshot: Boolean(plain.employee_snapshot),
      readOnly: true,
    };
  });

  return attachRecordedMeta(
    mapped,
    (r) => (r.terminatedBy as string) ?? null,
    (r) => (r.terminatedAt as string) ?? null
  );
}

export async function listHistoricalPayrollAudit(limit = 100) {
  const rows = await listPayrollAuditLogsFromAudit({
    actions: RECORD_AUDIT_ACTIONS,
    limit: Math.min(limit, 500),
  });

  const mapped = rows.map((row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    actionType: row.actionType,
    userId: row.userId,
    createdAt: row.createdAt,
    metadata: parseJsonSafe(row.metadataJson),
    readOnly: true,
  }));

  const enriched = await attachRecordedMeta(
    mapped,
    (r) => (r.userId as string) ?? null,
    (r) => (r.createdAt as string) ?? null
  );
  return enriched.map((r) => ({
    ...r,
    recordedByName: r.recordedBy ? r.recordedByName : 'System',
  }));
}
