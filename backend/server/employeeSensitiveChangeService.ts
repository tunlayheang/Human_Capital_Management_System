import { QueryTypes } from 'sequelize';
import {
  AuditLog,
  Department,
  Employee,
  Position,
  sequelize,
} from './db.js';
import { SALARY_PAYLOAD_KEYS } from './salaryStructureService.js';
import {
  employeeSensitiveChangeId,
  ensureEmployeeSensitiveChangeSchema,
  type EmployeeSensitiveChangeRow,
} from './employeeSensitiveChangeSchema.js';
import { findDisplayIdByEmployeePk, resolveEmployeePk } from './employeeIdentity.js';

export const SENSITIVE_EMPLOYEE_FIELDS = [
  'department_id',
  'position_id',
  'job_position',
  'work_location',
] as const;

export type SensitiveFieldChange = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  beforeDisplay?: string | null;
  afterDisplay?: string | null;
};

export type SensitiveEmployeeState = {
  employee: Record<string, unknown>;
  compensation: Record<string, unknown>;
};

export function canApplySensitiveChangesDirectly(role: unknown): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'HR' || r === 'ADMIN' || r === 'SUPER_ADMIN';
}

function normalizeComparable(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim();
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < 0.005;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

const FIELD_LABELS: Record<string, string> = {
  department_id: 'Department',
  position_id: 'Position',
  job_position: 'Job position',
  work_location: 'Work location',
  contract_type: 'Contract type',
  employment_status: 'Employment status',
  phone: 'Phone',
  base_salary: 'Base salary',
  currency: 'Currency',
  salary_type: 'Salary type',
  payment_day: 'Payment day',
  bank_name: 'Bank name',
  bank_account_number: 'Bank account',
  payment_method: 'Payment method',
  tax_id: 'Tax ID',
  nssf_id: 'NSSF ID',
  tax_dependents: 'Tax dependents',
  nssf_enrolled: 'NSSF enrolled',
};

export function buildSensitiveEmployeeState(
  employeePlain: Record<string, unknown>,
  compensationPlain?: Record<string, unknown> | null
): SensitiveEmployeeState {
  const employee: Record<string, unknown> = {};
  for (const key of SENSITIVE_EMPLOYEE_FIELDS) {
    employee[key] = employeePlain[key] ?? null;
  }
  const compensation: Record<string, unknown> = {};
  for (const key of SALARY_PAYLOAD_KEYS) {
    compensation[key] = compensationPlain?.[key] ?? employeePlain[key] ?? null;
  }
  return { employee, compensation };
}

export function computeSensitiveFieldChanges(
  before: SensitiveEmployeeState,
  after: SensitiveEmployeeState
): SensitiveFieldChange[] {
  const changes: SensitiveFieldChange[] = [];
  for (const key of SENSITIVE_EMPLOYEE_FIELDS) {
    const prev = before.employee[key];
    const next = after.employee[key];
    if (!valuesEqual(prev, next)) {
      changes.push({
        field: key,
        label: FIELD_LABELS[key] ?? key,
        before: prev ?? null,
        after: next ?? null,
      });
    }
  }
  for (const key of SALARY_PAYLOAD_KEYS) {
    const prev = before.compensation[key];
    const next = after.compensation[key];
    if (!valuesEqual(prev, next)) {
      changes.push({
        field: key,
        label: FIELD_LABELS[key] ?? key,
        before: prev ?? null,
        after: next ?? null,
      });
    }
  }
  return changes;
}

async function enrichDisplayNames(changes: SensitiveFieldChange[]): Promise<SensitiveFieldChange[]> {
  const deptIds = new Set<string>();
  const posIds = new Set<string>();
  for (const c of changes) {
    if (c.field === 'department_id') {
      if (c.before) deptIds.add(String(c.before));
      if (c.after) deptIds.add(String(c.after));
    }
    if (c.field === 'position_id') {
      if (c.before) posIds.add(String(c.before));
      if (c.after) posIds.add(String(c.after));
    }
  }

  const deptMap = new Map<string, string>();
  const posMap = new Map<string, string>();
  if (deptIds.size) {
    const rows = await Department.findAll({
      where: { id: [...deptIds] },
      attributes: ['id', 'name'],
    });
    for (const r of rows) {
      deptMap.set(String(r.get('id')), String(r.get('name') ?? ''));
    }
  }
  if (posIds.size) {
    const rows = await Position.findAll({
      where: { id: [...posIds] },
      attributes: ['id', 'title'],
    });
    for (const r of rows) {
      posMap.set(String(r.get('id')), String(r.get('title') ?? ''));
    }
  }

  return changes.map((c) => {
    if (c.field === 'department_id') {
      return {
        ...c,
        beforeDisplay: c.before ? deptMap.get(String(c.before)) ?? String(c.before) : null,
        afterDisplay: c.after ? deptMap.get(String(c.after)) ?? String(c.after) : null,
      };
    }
    if (c.field === 'position_id') {
      return {
        ...c,
        beforeDisplay: c.before ? posMap.get(String(c.before)) ?? String(c.before) : null,
        afterDisplay: c.after ? posMap.get(String(c.after)) ?? String(c.after) : null,
      };
    }
    return c;
  });
}

async function rowFromDb(r: Record<string, unknown>): Promise<EmployeeSensitiveChangeRow> {
  const parseJson = (raw: unknown) => {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(String(raw));
    } catch {
      return null;
    }
  };
  const employeePk = String(r.employee_pk);
  const displayId =
    r.employee_id != null && String(r.employee_id).trim()
      ? String(r.employee_id)
      : (await findDisplayIdByEmployeePk(employeePk)) ?? employeePk;
  return {
    id: String(r.id),
    employee_pk: employeePk,
    employee_id: displayId,
    change_source: String(r.change_source) as EmployeeSensitiveChangeRow['change_source'],
    source_ref_id: r.source_ref_id != null ? String(r.source_ref_id) : null,
    status: String(r.status) as EmployeeSensitiveChangeRow['status'],
    change_reason: String(r.change_reason ?? ''),
    effective_date: r.effective_date ? String(r.effective_date).slice(0, 10) : null,
    before_state: parseJson(r.before_state),
    after_state: parseJson(r.after_state),
    field_changes: parseJson(r.field_changes),
    submitted_by: r.submitted_by != null ? String(r.submitted_by) : null,
    reviewed_by: r.reviewed_by != null ? String(r.reviewed_by) : null,
    reviewed_at: r.reviewed_at ? String(r.reviewed_at) : null,
    review_notes: r.review_notes != null ? String(r.review_notes) : null,
    created_at: String(r.created_at),
    applied_at: r.applied_at ? String(r.applied_at) : null,
  };
}

export async function writeSensitiveChangeAudit(params: {
  employeeId: string;
  employeePk: string;
  action: 'APPLIED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  reason: string;
  fieldChanges: SensitiveFieldChange[];
  performedBy: string;
  changeRequestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const fieldChanges = (await enrichDisplayNames(params.fieldChanges)).map((f) => {
    const field = String(f.field ?? '').trim();
    const label =
      String(f.label ?? '').trim() ||
      FIELD_LABELS[field] ||
      field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
      'Field';
    return { ...f, field: field || f.field, label };
  });
  await AuditLog.create({
    id: `audit-esc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    entityType: 'employee_sensitive_change',
    entityId: params.changeRequestId ?? params.employeeId,
    action: params.action,
    oldValue: {
      employeeId: params.employeeId,
      fields: fieldChanges.map((f) => ({
        field: f.field,
        label: f.label,
        value: f.before,
        display: f.beforeDisplay ?? f.before,
      })),
    },
    newValue: {
      employeeId: params.employeeId,
      fields: fieldChanges.map((f) => ({
        field: f.field,
        label: f.label,
        value: f.after,
        display: f.afterDisplay ?? f.after,
      })),
    },
    performedBy: params.performedBy,
    reason: params.reason,
    metadata: params.metadata ?? null,
  });
}

export async function submitSensitiveChangeRequest(params: {
  employeePk: string;
  employeeId?: string;
  changeSource: 'profile_update' | 'movement' | 'field_correction';
  sourceRefId?: string | null;
  changeReason: string;
  effectiveDate: string;
  beforeState: SensitiveEmployeeState;
  afterState: SensitiveEmployeeState;
  fieldChanges: SensitiveFieldChange[];
  submittedBy?: string | null;
}): Promise<EmployeeSensitiveChangeRow> {
  await ensureEmployeeSensitiveChangeSchema();
  const reason = String(params.changeReason || '').trim();
  if (!reason) {
    throw Object.assign(new Error('Change reason is required for placement or compensation updates.'), {
      statusCode: 400,
      code: 'CHANGE_REASON_REQUIRED',
    });
  }
  const { assertPayrollMasterDataEditableForEffectiveDate, parseMasterDataEffectiveFrom } =
    await import('./payroll/payrollMasterDataGuard.js');
  const effectiveDate = parseMasterDataEffectiveFrom(params.effectiveDate);
  await assertPayrollMasterDataEditableForEffectiveDate(effectiveDate);
  if (!params.fieldChanges.length) {
    throw Object.assign(new Error('No sensitive field changes detected.'), { statusCode: 400 });
  }

  const enriched = await enrichDisplayNames(params.fieldChanges);
  const id = employeeSensitiveChangeId();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const displayId =
    params.employeeId?.trim() ||
    (await findDisplayIdByEmployeePk(params.employeePk)) ||
    params.employeePk;

  await sequelize.query(
    `INSERT INTO employee_sensitive_changes
      (id, employee_pk, change_source, source_ref_id, status, change_reason, effective_date,
       before_state, after_state, field_changes, submitted_by, created_at)
     VALUES
      (:id, :employeePk, :changeSource, :sourceRefId, 'pending', :changeReason, :effectiveDate,
       :beforeState, :afterState, :fieldChanges, :submittedBy, :createdAt)`,
    {
      replacements: {
        id,
        employeePk: params.employeePk,
        changeSource: params.changeSource,
        sourceRefId: params.sourceRefId ?? null,
        changeReason: reason,
        effectiveDate,
        beforeState: JSON.stringify(params.beforeState),
        afterState: JSON.stringify(params.afterState),
        fieldChanges: JSON.stringify(enriched),
        submittedBy: params.submittedBy ?? null,
        createdAt: now,
      },
      type: QueryTypes.INSERT,
    }
  );

  if (params.submittedBy) {
    await writeSensitiveChangeAudit({
      employeeId: displayId,
      employeePk: params.employeePk,
      action: 'SUBMITTED',
      reason,
      fieldChanges: enriched,
      performedBy: params.submittedBy,
      changeRequestId: id,
      metadata: { changeSource: params.changeSource, sourceRefId: params.sourceRefId ?? null },
    });
  }

  try {
    const { notifyRoles, getUserDisplayName } = await import('./notificationService.js');
    const submitter = params.submittedBy
      ? await getUserDisplayName(params.submittedBy)
      : 'A team member';
    await notifyRoles(['HR', 'ADMIN', 'SUPER_ADMIN'], {
      idPrefix: `sensitive-pending-${id}`,
      title: 'Sensitive change request pending',
      message: `${submitter} submitted placement/pay changes for ${displayId} (effective ${effectiveDate}). Review in Employees.`,
      type: 'WARNING',
      link: '/employees?tab=list',
    });
  } catch (notifyErr) {
    console.error('[sensitive-change] notify submit failed:', notifyErr);
  }

  const rows = (await sequelize.query(
    `SELECT * FROM employee_sensitive_changes WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rowFromDb(rows[0]);
}

export async function listSensitiveChangeRequests(params?: {
  status?: string;
  employeeId?: string;
  limit?: number;
}): Promise<EmployeeSensitiveChangeRow[]> {
  await ensureEmployeeSensitiveChangeSchema();
  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 500);
  const employeePk = params?.employeeId
    ? await resolveEmployeePk(params.employeeId)
    : null;
  const rows = (await sequelize.query(
    `SELECT * FROM employee_sensitive_changes
     WHERE (:status IS NULL OR status = :status)
       AND (:employeePk IS NULL OR employee_pk = :employeePk)
     ORDER BY created_at DESC
     LIMIT :limit`,
    {
      replacements: {
        status: params?.status ?? null,
        employeePk,
        limit,
      },
      type: QueryTypes.SELECT,
    }
  )) as Record<string, unknown>[];
  return Promise.all(rows.map(rowFromDb));
}

export async function getSensitiveChangeRequest(id: string): Promise<EmployeeSensitiveChangeRow | null> {
  await ensureEmployeeSensitiveChangeSchema();
  const rows = (await sequelize.query(
    `SELECT * FROM employee_sensitive_changes WHERE id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as Record<string, unknown>[];
  return rows[0] ? rowFromDb(rows[0]) : null;
}

export async function applySensitiveProfileState(
  employeePk: string,
  afterState: SensitiveEmployeeState,
  options: {
    changedBy?: string | null;
    changeReason?: string | null;
    effectiveFrom: string;
  }
): Promise<void> {
  const { assertPayrollMasterDataEditableForEffectiveDate, parseMasterDataEffectiveFrom } =
    await import('./payroll/payrollMasterDataGuard.js');
  const effectiveFrom = parseMasterDataEffectiveFrom(options.effectiveFrom);
  await assertPayrollMasterDataEditableForEffectiveDate(effectiveFrom);

  const employee = await Employee.findByPk(employeePk);
  if (!employee) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });

  const employeePatch: Record<string, unknown> = {};
  for (const key of SENSITIVE_EMPLOYEE_FIELDS) {
    if (afterState.employee[key] !== undefined) {
      employeePatch[key] = afterState.employee[key];
    }
  }
  if (Object.keys(employeePatch).length) {
    await employee.update({ ...employeePatch, updated_at: new Date() });
  }

  const { upsertSalaryStructure } = await import('./salaryStructureService.js');
  const compKeys = Object.keys(afterState.compensation).filter(
    (k) => afterState.compensation[k] !== undefined
  );
  if (compKeys.length) {
    const salaryPayload: Record<string, unknown> = {};
    for (const key of compKeys) {
      salaryPayload[key] = afterState.compensation[key];
    }
    await upsertSalaryStructure(employeePk, salaryPayload as never, {
      changedBy: options.changedBy ?? null,
      changeReason: options.changeReason ?? null,
      effectiveFrom,
    });
  }

  if (employeePatch.position_id || employeePatch.job_position) {
    try {
      const { syncEmployeeJobPosition } = await import('./employeeJobPosition.js');
      await syncEmployeeJobPosition(
        employeePk,
        String(employeePatch.position_id ?? employee.get('position_id') ?? ''),
        employeePatch.job_position != null ? String(employeePatch.job_position) : null
      );
    } catch {
      /* non-fatal */
    }
  }
}

export async function approveSensitiveChangeRequest(params: {
  id: string;
  reviewedBy: string;
  reviewNotes?: string | null;
}): Promise<EmployeeSensitiveChangeRow> {
  const row = await getSensitiveChangeRequest(params.id);
  if (!row) throw Object.assign(new Error('Change request not found'), { statusCode: 404 });
  if (row.status !== 'pending') {
    throw Object.assign(new Error('Change request is not pending approval'), { statusCode: 409 });
  }
  if (row.change_source === 'field_correction') {
    throw Object.assign(new Error('Field corrections are applied immediately and cannot be approved.'), {
      statusCode: 409,
    });
  }

  const fieldChanges = (Array.isArray(row.field_changes)
    ? row.field_changes
    : []) as SensitiveFieldChange[];
  const afterState = (row.after_state ?? { employee: {}, compensation: {} }) as SensitiveEmployeeState;

  if (row.change_source === 'profile_update') {
    const effectiveFrom =
      row.effective_date ??
      new Date().toISOString().slice(0, 10);
    await applySensitiveProfileState(row.employee_pk, afterState, {
      changedBy: params.reviewedBy,
      changeReason: row.change_reason,
      effectiveFrom,
    });
  } else if (row.change_source === 'movement' && row.source_ref_id) {
    const { approvePendingEmployeeMovement } = await import('./employeeMovementService.js');
    await approvePendingEmployeeMovement(row.source_ref_id, params.reviewedBy);
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(
    `UPDATE employee_sensitive_changes
     SET status = 'applied', reviewed_by = :reviewedBy, reviewed_at = :reviewedAt,
         review_notes = :reviewNotes, applied_at = :appliedAt
     WHERE id = :id`,
    {
      replacements: {
        id: params.id,
        reviewedBy: params.reviewedBy,
        reviewedAt: now,
        reviewNotes: params.reviewNotes ?? null,
        appliedAt: now,
      },
      type: QueryTypes.UPDATE,
    }
  );

  await writeSensitiveChangeAudit({
    employeeId: row.employee_id,
    employeePk: row.employee_pk,
    action: 'APPROVED',
    reason: row.change_reason,
    fieldChanges,
    performedBy: params.reviewedBy,
    changeRequestId: row.id,
    metadata: {
      changeSource: row.change_source,
      sourceRefId: row.source_ref_id ?? null,
      reviewNotes: params.reviewNotes ?? null,
    },
  });

  if (row.submitted_by) {
    try {
      const { createNotification } = await import('./notificationService.js');
      await createNotification({
        id: `sensitive-approved-${row.id}-${row.submitted_by}`,
        userId: String(row.submitted_by),
        title: 'Sensitive change approved',
        message: `Your placement/pay change for ${row.employee_id} was approved and applied.`,
        type: 'SUCCESS',
        link: '/employees?tab=list',
      });
    } catch {
      /* non-blocking */
    }
  }

  try {
    const { notifyEmployeeProfileChanged } = await import('./notificationService.js');
    const changes = Array.isArray(row.field_changes)
      ? (row.field_changes as Array<{ field?: string }>)
      : [];
    const fields = changes.map((change) => String(change.field || '')).filter(Boolean);
    const compensationChanged = fields.some((field) =>
      (SALARY_PAYLOAD_KEYS as readonly string[]).includes(field)
    );
    await notifyEmployeeProfileChanged({
      employeePk: row.employee_pk,
      employeeDisplayId: row.employee_id,
      actorUserId: params.reviewedBy,
      changedFields: fields.length ? fields : ['placement or compensation'],
      compensationChanged,
      revision: row.id,
    });
  } catch {
    /* non-blocking */
  }

  const updated = await getSensitiveChangeRequest(params.id);
  if (!updated) throw new Error('Failed to load updated change request');
  return updated;
}

export async function rejectSensitiveChangeRequest(params: {
  id: string;
  reviewedBy: string;
  reviewNotes?: string | null;
}): Promise<EmployeeSensitiveChangeRow> {
  const row = await getSensitiveChangeRequest(params.id);
  if (!row) throw Object.assign(new Error('Change request not found'), { statusCode: 404 });
  if (row.status !== 'pending') {
    throw Object.assign(new Error('Change request is not pending approval'), { statusCode: 409 });
  }
  if (row.change_source === 'field_correction') {
    throw Object.assign(new Error('Field corrections are applied immediately and cannot be rejected.'), {
      statusCode: 409,
    });
  }

  if (row.change_source === 'movement' && row.source_ref_id) {
    const { cancelEmployeeMovement } = await import('./employeeMovementService.js');
    await cancelEmployeeMovement(row.source_ref_id);
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await sequelize.query(
    `UPDATE employee_sensitive_changes
     SET status = 'rejected', reviewed_by = :reviewedBy, reviewed_at = :reviewedAt,
         review_notes = :reviewNotes
     WHERE id = :id`,
    {
      replacements: {
        id: params.id,
        reviewedBy: params.reviewedBy,
        reviewedAt: now,
        reviewNotes: params.reviewNotes ?? null,
      },
      type: QueryTypes.UPDATE,
    }
  );

  const fieldChanges = (Array.isArray(row.field_changes)
    ? row.field_changes
    : []) as SensitiveFieldChange[];
  await writeSensitiveChangeAudit({
    employeeId: row.employee_id,
    employeePk: row.employee_pk,
    action: 'REJECTED',
    reason: row.change_reason,
    fieldChanges,
    performedBy: params.reviewedBy,
    changeRequestId: row.id,
    metadata: {
      changeSource: row.change_source,
      sourceRefId: row.source_ref_id ?? null,
      reviewNotes: params.reviewNotes ?? null,
    },
  });

  if (row.submitted_by) {
    try {
      const { createNotification } = await import('./notificationService.js');
      const notes = params.reviewNotes ? ` Notes: ${params.reviewNotes}` : '';
      await createNotification({
        id: `sensitive-rejected-${row.id}-${row.submitted_by}`,
        userId: String(row.submitted_by),
        title: 'Sensitive change rejected',
        message: `Your placement/pay change for ${row.employee_id} was rejected.${notes}`,
        type: 'WARNING',
        link: '/employees?tab=list',
      });
    } catch {
      /* non-blocking */
    }
  }

  const updated = await getSensitiveChangeRequest(params.id);
  if (!updated) throw new Error('Failed to load updated change request');
  return updated;
}

export class SensitiveChangeRequiredError extends Error {
  statusCode = 400;
  code = 'CHANGE_REASON_REQUIRED';
  constructor() {
    super('Change reason is required for placement or compensation updates.');
    this.name = 'SensitiveChangeRequiredError';
  }
}

export class SensitiveChangePendingError extends Error {
  statusCode = 202;
  code = 'SENSITIVE_CHANGE_PENDING';
  pendingRequestId: string;
  constructor(pendingRequestId: string, message?: string) {
    super(message ?? 'Sensitive changes submitted for HR Manager approval.');
    this.name = 'SensitiveChangePendingError';
    this.pendingRequestId = pendingRequestId;
  }
}

function toMysqlDatetime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const s = String(value ?? '').trim();
  if (!s) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const parsed = Date.parse(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
  return s.slice(0, 19);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = (await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table }, type: QueryTypes.SELECT }
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

/** Record an HR metadata correction (movement-only field bypass) in the unified change log. */
export async function recordFieldCorrection(input: {
  id?: string;
  employeePk: string;
  employeeId?: string;
  fieldName: string;
  previousValue: string | null;
  correctedValue: string | null;
  correctedBy: string | null;
  reason: string;
  correctionDate?: string | Date;
}): Promise<void> {
  await ensureEmployeeSensitiveChangeSchema();
  const fieldName = String(input.fieldName).trim();
  const fieldLabel =
    FIELD_LABELS[fieldName] ||
    fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
    'Field';
  const fieldChanges: SensitiveFieldChange[] = [
    {
      field: fieldName,
      label: fieldLabel,
      before: input.previousValue,
      after: input.correctedValue,
    },
  ];
  const beforeState = { [fieldName]: input.previousValue };
  const afterState = { [fieldName]: input.correctedValue };
  const id = input.id ?? `efc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appliedAt = toMysqlDatetime(input.correctionDate ?? new Date());
  const effectiveDate = appliedAt.slice(0, 10);
  const displayId =
    input.employeeId?.trim() ||
    (await findDisplayIdByEmployeePk(input.employeePk)) ||
    input.employeePk;

  await sequelize.query(
    `INSERT INTO employee_sensitive_changes
      (id, employee_pk, change_source, source_ref_id, status, change_reason, effective_date,
       before_state, after_state, field_changes, submitted_by, reviewed_by, reviewed_at,
       created_at, applied_at)
     VALUES
      (:id, :employeePk, 'field_correction', NULL, 'applied', :changeReason, :effectiveDate,
       :beforeState, :afterState, :fieldChanges, :correctedBy, :correctedBy, :appliedAt,
       :appliedAt, :appliedAt)`,
    {
      replacements: {
        id,
        employeePk: input.employeePk,
        changeReason: input.reason,
        effectiveDate,
        beforeState: JSON.stringify(beforeState),
        afterState: JSON.stringify(afterState),
        fieldChanges: JSON.stringify(fieldChanges),
        correctedBy: input.correctedBy,
        appliedAt,
      },
      type: QueryTypes.INSERT,
    }
  );

  if (input.correctedBy) {
    await writeSensitiveChangeAudit({
      employeeId: displayId,
      employeePk: input.employeePk,
      action: 'APPLIED',
      reason: input.reason,
      fieldChanges,
      performedBy: input.correctedBy,
      changeRequestId: id,
      metadata: { changeSource: 'field_correction', fieldName },
    });
  }
}

type LegacyFieldCorrectionRow = {
  id: string;
  employee_pk: string;
  employee_id: string;
  field_name: string;
  previous_value?: string | null;
  corrected_value?: string | null;
  corrected_by?: string | null;
  correction_date: string | Date;
  reason: string;
};

/** Migrate `employee_field_corrections` rows into `employee_sensitive_changes`, then drop the legacy table. */
export async function ensureFieldCorrectionsConsolidated(): Promise<void> {
  if (!(await tableExists('employee_field_corrections'))) {
    return;
  }

  const legacyRows = (await sequelize.query(
    `SELECT id, employee_pk, employee_id, field_name, previous_value, corrected_value,
            corrected_by, correction_date, reason
     FROM employee_field_corrections
     ORDER BY correction_date ASC`,
    { type: QueryTypes.SELECT }
  )) as LegacyFieldCorrectionRow[];

  let migrated = 0;
  for (const row of legacyRows) {
    const existing = await getSensitiveChangeRequest(String(row.id));
    if (existing) continue;

    await recordFieldCorrection({
      id: String(row.id),
      employeePk: String(row.employee_pk),
      employeeId: String(row.employee_id),
      fieldName: String(row.field_name),
      previousValue: row.previous_value ?? null,
      correctedValue: row.corrected_value ?? null,
      correctedBy: row.corrected_by ?? 'system',
      reason: String(row.reason),
      correctionDate: row.correction_date,
    });
    migrated += 1;
  }

  await sequelize.query('DROP TABLE IF EXISTS `employee_field_corrections`', { raw: true });
  console.log(
    `[db] Consolidated employee_field_corrections into employee_sensitive_changes` +
      (migrated ? ` (${migrated} row(s)).` : '.') +
      ' Legacy table dropped.'
  );
}
