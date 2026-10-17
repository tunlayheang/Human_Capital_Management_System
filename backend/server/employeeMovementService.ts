import { Op, QueryTypes } from 'sequelize';
import {
  Department,
  Employee,
  EmployeeMovement,
  EmployeeReview,
  Position,
  User,
  sequelize,
} from './db.js';
import { resolveJobPositionTitle, syncEmployeeJobPosition } from './employeeJobPosition.js';
import { validateEmployeeSalaryForPosition } from './departmentApi.js';
import { writeWorkflowStatusAudit } from './domainAuditService.js';
import { getUserDisplayName } from './notificationService.js';
import { serializeUserForClient, USER_ACCOUNT_ATTRIBUTES } from './userAccountService.js';
import {
  loadSalaryStructureForEmployeeId,
  upsertSalaryStructure,
} from './salaryStructureService.js';
import {
  MOVEMENT_STATUS_APPLIED,
  MOVEMENT_STATUS_APPROVED,
  isMetadataMovementType,
  isPlacementMovementType,
  isSalaryMovementType,
  normalizeMovementType,
  parseMovementStatusFilter,
  toCanonicalMovementStatus,
  type MovementTypeCode,
} from './employeeMovementCatalog.js';
import {
  applyContractTypeToEmployee,
  applyEmploymentStatusToEmployee,
  normalizeContractType,
  normalizeEmploymentStatus,
  readEmployeeMetadata,
} from './employeeProfileMetadataService.js';
import {
  isBlankPersonName,
  resolveEmployeeRecordName,
} from './employeeDisplayName.js';
import {
  employeeLookupWhere,
  toCanonicalEmployeeDisplayId,
} from './employeeIdFormat.js';

export type MovementType = MovementTypeCode;

function requireWorkflowComment(raw: string | null | undefined, label = 'comment'): string | null {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length < 3) return null;
  return trimmed;
}

export type EmployeeMovementDto = {
  id: string;
  employeePk: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  employeePhone?: string | null;
  employeeAvatarUrl?: string | null;
  movementType: MovementType;
  effectiveDate: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  fromPositionId: string;
  toPositionId: string;
  fromJobPosition: string | null;
  toJobPosition: string | null;
  fromReportingManagerId: string | null;
  toReportingManagerId: string | null;
  fromDepartmentName: string;
  toDepartmentName: string;
  fromPositionTitle: string;
  toPositionTitle: string;
  fromBaseSalary: number | null;
  toBaseSalary: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
  notes: string | null;
  sourceAppraisalId: string | null;
  sourceAppraisalPeriodName: string | null;
  sourceProbationReviewId: string | null;
  status: string;
  canonicalStatus: string;
  fieldKey: string | null;
  currentValue: string | null;
  newValue: string | null;
  remark: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  assignedApproverUserId: string | null;
  assignedApproverName: string | null;
  assignedApproverUserIds: string[];
  assignedApprovers: {
    userId: string;
    name: string | null;
    status: 'pending' | 'approved';
    approvedAt: string | null;
    sortOrder?: number;
    phase?: 'approved' | 'current' | 'queued';
  }[];
  approvalProgress: { approved: number; total: number } | null;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  rejectedBy: string | null;
  rejectedByName: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  returnedBy: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnNotes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  appliedAt: string | null;
  appliedBy?: string | null;
  modifiedBy?: string | null;
  modifiedAt?: string | null;
  isActive?: boolean;
  isDeleted?: boolean;
};

function movementTypeNorm(raw: unknown): MovementTypeCode {
  return normalizeMovementType(raw);
}

function isApprovedAwaitingApply(status: string): boolean {
  const s = String(status).toLowerCase();
  return s === 'scheduled' || s === 'approved' || s === 'completed';
}

function isPendingMovementStatus(status: string): boolean {
  const s = String(status).toLowerCase();
  return s === 'pending_approval' || s === 'pending' || s === 'draft';
}

function parseSalary(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function endOfDayIso(dateStr: string): string {
  const d = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(`${d}T23:59:59.999`).toISOString();
  }
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('Invalid effective date'), { status: 400 });
  }
  return parsed.toISOString();
}

function calendarDayFromEffective(raw: string): string {
  const d = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function todayCalendarDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Effective on or before today (calendar day), not end-of-day timestamp. */
function isEffectiveDue(effectiveDate: string): boolean {
  const effDay = calendarDayFromEffective(effectiveDate);
  if (!effDay) return false;
  return effDay <= todayCalendarDay();
}

async function loadDeptMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows: any[] = await Department.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ['id', 'name'],
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    const plain = r.get ? r.get({ plain: true }) : r;
    map.set(String(plain.id), String(plain.name || ''));
  }
  return map;
}

async function loadCreatedByNameMap(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) return new Map();

  const users: any[] = await User.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: [...USER_ACCOUNT_ATTRIBUTES],
  });

  const map = new Map<string, string>();
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

type MovementEmployeeIdentity = {
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

const EMPLOYEE_IDENTITY_ATTRIBUTES = [
  'id',
  'employee_id',
  'first_name',
  'last_name',
  'first_name_kh',
  'last_name_kh',
  'email',
  'phone',
  'avatar_url',
] as const;

function identityFromEmployeePlain(ep: Record<string, unknown> | null | undefined): MovementEmployeeIdentity {
  if (!ep) {
    return { name: '', email: null, phone: null, avatarUrl: null };
  }
  return {
    name: resolveEmployeeRecordName({
      first_name: ep.first_name as string | null | undefined,
      last_name: ep.last_name as string | null | undefined,
      first_name_kh: ep.first_name_kh as string | null | undefined,
      last_name_kh: ep.last_name_kh as string | null | undefined,
      email: ep.email as string | null | undefined,
    }),
    email: ep.email ? String(ep.email).trim() : null,
    phone: ep.phone ? String(ep.phone).trim() : null,
    avatarUrl: ep.avatar_url ? String(ep.avatar_url).trim() : null,
  };
}

/** Resolve employee by PK first, then badge code — matches applyMovementRecord. */
async function loadEmployeeIdentityForMovement(plain: {
  employee_pk?: string | null;
  employee_id?: string | null;
}): Promise<MovementEmployeeIdentity> {
  const pk = String(plain.employee_pk ?? '').trim();
  const code = String(plain.employee_id ?? '').trim();

  let emp: any = null;
  if (pk) {
    emp = await Employee.findByPk(pk, { attributes: [...EMPLOYEE_IDENTITY_ATTRIBUTES] });
  }
  if (!emp && code) {
    emp = await Employee.findOne({
      where: { employee_id: code },
      attributes: [...EMPLOYEE_IDENTITY_ATTRIBUTES],
    });
  }

  const identity = identityFromEmployeePlain(emp?.get ? emp.get({ plain: true }) : emp);
  if (!isBlankPersonName(identity.name)) return identity;

  const linkPk = pk || (emp ? String(emp.get ? emp.get('id') : emp.id) : '');
  if (linkPk) {
    const user: any = await User.findOne({
      where: { employeeId: linkPk },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    if (user) {
      try {
        const profile = await serializeUserForClient(user.get({ plain: true }));
        const fromUser = String(profile.name ?? '').trim();
        if (!isBlankPersonName(fromUser)) {
          return {
            ...identity,
            name: fromUser,
            email: identity.email || (profile.email ? String(profile.email).trim() : null),
          };
        }
      } catch {
        const display = String(user.display_name ?? '').trim();
        if (!isBlankPersonName(display)) {
          return { ...identity, name: display };
        }
      }
    }
  }

  return identity;
}

async function loadEmployeeIdentityMap(
  movements: Array<{ employee_pk?: string | null; employee_id?: string | null }>
): Promise<Map<string, MovementEmployeeIdentity>> {
  const pks = [
    ...new Set(movements.map((m) => String(m.employee_pk ?? '').trim()).filter(Boolean)),
  ];
  const codes = [
    ...new Set(movements.map((m) => String(m.employee_id ?? '').trim()).filter(Boolean)),
  ];
  const map = new Map<string, MovementEmployeeIdentity>();
  if (!pks.length && !codes.length) return map;

  const orClauses: Record<string, unknown>[] = [];
  if (pks.length) orClauses.push({ id: { [Op.in]: pks } });
  if (codes.length) orClauses.push({ employee_id: { [Op.in]: codes } });

  const employees: any[] = await Employee.findAll({
    where: { [Op.or]: orClauses },
    attributes: [...EMPLOYEE_IDENTITY_ATTRIBUTES],
  });

  const byPk = new Map<string, MovementEmployeeIdentity>();
  const byCode = new Map<string, MovementEmployeeIdentity>();
  const pkToCode = new Map<string, string>();
  const emptyNamePks: string[] = [];

  for (const emp of employees) {
    const ep = emp.get ? emp.get({ plain: true }) : emp;
    const identity = identityFromEmployeePlain(ep);
    const id = String(ep.id ?? '').trim();
    const code = String(ep.employee_id ?? '').trim();
    if (id) {
      byPk.set(id, identity);
      if (code) pkToCode.set(id, code);
      if (isBlankPersonName(identity.name)) emptyNamePks.push(id);
    }
    if (code) byCode.set(code, identity);
  }

  if (emptyNamePks.length) {
    const users: any[] = await User.findAll({
      where: { employeeId: { [Op.in]: emptyNamePks } },
      attributes: [...USER_ACCOUNT_ATTRIBUTES],
    });
    await Promise.all(
      users.map(async (user) => {
        const linkPk = String(user.employeeId ?? '').trim();
        if (!linkPk) return;
        const current = byPk.get(linkPk);
        if (!current || !isBlankPersonName(current.name)) return;
        let nextName = '';
        let nextEmail = current.email;
        try {
          const profile = await serializeUserForClient(user.get({ plain: true }));
          nextName = String(profile.name ?? '').trim();
          if (!nextEmail && profile.email) nextEmail = String(profile.email).trim();
        } catch {
          nextName = String(user.display_name ?? '').trim();
        }
        if (isBlankPersonName(nextName)) return;
        const next = { ...current, name: nextName, email: nextEmail };
        byPk.set(linkPk, next);
        const code = pkToCode.get(linkPk);
        if (code) byCode.set(code, next);
      })
    );
  }

  for (const m of movements) {
    const pk = String(m.employee_pk ?? '').trim();
    const code = String(m.employee_id ?? '').trim();
    const identity =
      (pk ? byPk.get(pk) : undefined) ||
      (code ? byCode.get(code) : undefined) || {
        name: '',
        email: null,
        phone: null,
        avatarUrl: null,
      };
    if (pk) map.set(pk, identity);
    if (code) map.set(code, identity);
  }

  return map;
}

async function loadPositionMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows: any[] = await Position.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ['id', 'title'],
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    const plain = r.get ? r.get({ plain: true }) : r;
    map.set(String(plain.id), String(plain.title || ''));
  }
  return map;
}

async function loadProbationReviewIdByMovementIds(
  movementIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(movementIds.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const reviews: any[] = await EmployeeReview.findAll({
    where: {
      reviewType: 'PROBATION',
      outcomePayloadJson: { [Op.ne]: null },
    },
    attributes: ['id', 'outcomePayloadJson'],
  });

  const idSet = new Set(unique);
  for (const review of reviews) {
    const plain = review.get ? review.get({ plain: true }) : review;
    try {
      const payload = JSON.parse(String(plain.outcomePayloadJson ?? '{}'));
      const movementId = payload?.passResult?.movementId
        ? String(payload.passResult.movementId).trim()
        : '';
      if (movementId && idSet.has(movementId)) {
        map.set(movementId, String(plain.id));
      }
    } catch {
      /* ignore malformed outcome payload */
    }
  }
  return map;
}

async function serializeMovement(
  row: any,
  extras?: {
    employeeName?: string;
    employeeEmail?: string | null;
    employeePhone?: string | null;
    employeeAvatarUrl?: string | null;
    createdByName?: string;
    sourceAppraisalPeriodName?: string;
    sourceProbationReviewId?: string | null;
  }
) {
  const plain = row.get ? row.get({ plain: true }) : row;
  const deptIds = [plain.from_department_id, plain.to_department_id].map(String);
  const posIds = [plain.from_position_id, plain.to_position_id].map(String);
  const [depts, positions] = await Promise.all([loadDeptMap(deptIds), loadPositionMap(posIds)]);

  let employeeName = extras?.employeeName || '';
  let employeeEmail: string | null =
    extras?.employeeEmail !== undefined ? extras.employeeEmail : null;
  let employeePhone: string | null =
    extras?.employeePhone !== undefined ? extras.employeePhone : null;
  let employeeAvatarUrl: string | null =
    extras?.employeeAvatarUrl !== undefined ? extras.employeeAvatarUrl : null;

  const needsIdentityLookup =
    extras?.employeeEmail === undefined ||
    extras?.employeePhone === undefined ||
    extras?.employeeAvatarUrl === undefined ||
    isBlankPersonName(employeeName);

  if (needsIdentityLookup) {
    try {
      const identity = await loadEmployeeIdentityForMovement(plain);
      if (isBlankPersonName(employeeName)) employeeName = identity.name;
      if (extras?.employeeEmail === undefined) employeeEmail = identity.email;
      if (extras?.employeePhone === undefined) employeePhone = identity.phone;
      if (extras?.employeeAvatarUrl === undefined) employeeAvatarUrl = identity.avatarUrl;
    } catch (err) {
      console.warn(
        '[employeeMovement] identity lookup failed:',
        String(plain.id ?? ''),
        (err as Error)?.message || err
      );
    }
  }

  let createdByName = extras?.createdByName ?? null;
  if (!createdByName && plain.created_by) {
    createdByName = await getUserDisplayName(String(plain.created_by)).catch(() => null);
  }

  const { loadMovementApprovers, serializeMovementApproversForDto } = await import(
    './workflowMovementApproverService.js'
  );
  const approverRows = await loadMovementApprovers(String(plain.id));
  const approverFields = serializeMovementApproversForDto(approverRows);

  return {
    id: String(plain.id),
    employeePk: String(plain.employee_pk),
    employeeId: toCanonicalEmployeeDisplayId(plain.employee_id) || String(plain.employee_id),
    employeeName: isBlankPersonName(employeeName) ? '' : employeeName,
    employeeEmail,
    employeePhone,
    employeeAvatarUrl,
    movementType: movementTypeNorm(plain.movement_type),
    effectiveDate: String(plain.effective_date),
    fromDepartmentId: String(plain.from_department_id),
    toDepartmentId: String(plain.to_department_id),
    fromPositionId: String(plain.from_position_id),
    toPositionId: String(plain.to_position_id),
    fromJobPosition: plain.from_job_position ? String(plain.from_job_position) : null,
    toJobPosition: plain.to_job_position ? String(plain.to_job_position) : null,
    fromReportingManagerId: plain.from_reporting_manager_id
      ? String(plain.from_reporting_manager_id)
      : null,
    toReportingManagerId: plain.to_reporting_manager_id
      ? String(plain.to_reporting_manager_id)
      : null,
    fromDepartmentName: depts.get(String(plain.from_department_id)) || '',
    toDepartmentName: depts.get(String(plain.to_department_id)) || '',
    fromPositionTitle: positions.get(String(plain.from_position_id)) || plain.from_job_position || '',
    toPositionTitle: positions.get(String(plain.to_position_id)) || plain.to_job_position || '',
    fromBaseSalary: parseSalary(plain.from_base_salary),
    toBaseSalary: parseSalary(plain.to_base_salary),
    fromCurrency: plain.from_currency ? String(plain.from_currency) : null,
    toCurrency: plain.to_currency ? String(plain.to_currency) : null,
    notes: plain.notes ? String(plain.notes) : null,
    sourceAppraisalId: plain.source_appraisal_id ? String(plain.source_appraisal_id) : null,
    sourceAppraisalPeriodName: extras?.sourceAppraisalPeriodName ?? null,
    sourceProbationReviewId:
      extras?.sourceProbationReviewId ??
      (plain.source_probation_review_id ? String(plain.source_probation_review_id) : null),
    status: String(plain.status || 'completed'),
    canonicalStatus: toCanonicalMovementStatus(
      String(plain.status || ''),
      plain.applied_at ? String(plain.applied_at) : null
    ),
    fieldKey: plain.field_key ? String(plain.field_key) : null,
    currentValue: plain.current_value != null ? String(plain.current_value) : null,
    newValue: plain.new_value != null ? String(plain.new_value) : null,
    remark: plain.notes ? String(plain.notes) : null,
    approvedBy: plain.approved_by ? String(plain.approved_by) : null,
    approvedByName: plain.approved_by
      ? await getUserDisplayName(String(plain.approved_by)).catch(() => null)
      : null,
    approvedAt: plain.approved_at ? String(plain.approved_at) : null,
    ...approverFields,
    rejectedBy: plain.rejected_by ? String(plain.rejected_by) : null,
    rejectedByName: plain.rejected_by
      ? await getUserDisplayName(String(plain.rejected_by)).catch(() => null)
      : null,
    rejectedAt: plain.rejected_at ? String(plain.rejected_at) : null,
    rejectionReason: plain.rejection_reason ? String(plain.rejection_reason) : null,
    returnedBy: plain.returned_by ? String(plain.returned_by) : null,
    returnedByName: plain.returned_by
      ? await getUserDisplayName(String(plain.returned_by)).catch(() => null)
      : null,
    returnedAt: plain.returned_at ? String(plain.returned_at) : null,
    returnNotes: plain.return_notes ? String(plain.return_notes) : null,
    createdBy: plain.created_by ? String(plain.created_by) : null,
    createdByName,
    createdAt: String(plain.created_at || ''),
    appliedAt: plain.applied_at ? String(plain.applied_at) : null,
    appliedBy: plain.applied_by ? String(plain.applied_by) : null,
    modifiedBy: plain.modified_by ? String(plain.modified_by) : null,
    modifiedAt: plain.modified_at ? String(plain.modified_at) : null,
    isActive: plain.is_active !== false && plain.is_active !== 0,
    isDeleted: plain.is_deleted === true || plain.is_deleted === 1,
  } satisfies EmployeeMovementDto;
}

async function assertPositionInDepartment(positionId: string, departmentId: string) {
  const pos: any = await Position.findByPk(positionId);
  if (!pos) {
    throw Object.assign(new Error('Position not found'), { status: 400 });
  }
  const plain = pos.get({ plain: true });
  const dept = String(plain.departmentId || plain.department_id || '');
  if (dept && dept !== departmentId) {
    throw Object.assign(
      new Error('Selected position does not belong to the target department'),
      { status: 400 }
    );
  }
}

function assertActiveEmployeeStatus(emp: any) {
  const status = String(emp.status || '').toLowerCase();
  if (status !== 'active' && status !== 'probation') {
    throw Object.assign(
      new Error('Only active employees can receive transfers, promotions, or salary updates'),
      { status: 400 }
    );
  }
}

const movementNotDeletedWhere = {
  [Op.or]: [{ is_deleted: false }, { is_deleted: { [Op.is]: null } }],
};

export async function applyDueScheduledMovements(options?: {
  appliedBy?: string | null;
}): Promise<number> {
  const scheduledRows: any[] = await EmployeeMovement.findAll({
    where: {
      status: { [Op.in]: ['scheduled', 'approved', 'completed'] },
      applied_at: { [Op.is]: null },
      ...movementNotDeletedWhere,
    },
    order: [
      ['effective_date', 'ASC'],
      ['created_at', 'ASC'],
    ],
    limit: 200,
  });
  const due = scheduledRows.filter((row) => {
    const plain = row.get ? row.get({ plain: true }) : row;
    if (plain.is_deleted === true || plain.is_deleted === 1) return false;
    if (isPendingMovementStatus(String(plain.status || ''))) return false;
    if (String(plain.status).toLowerCase() === 'cancelled') return false;
    if (!isApprovedAwaitingApply(String(plain.status || ''))) return false;
    return isEffectiveDue(String(plain.effective_date || ''));
  });

  const stuckCompleted: any[] = [];

  let applied = 0;
  for (const row of [...due, ...stuckCompleted]) {
    try {
      await applyMovementRecord(row, options?.appliedBy ?? null);
      applied += 1;
    } catch (err) {
      console.warn(
        '[movements] Could not apply movement',
        row?.id,
        (err as Error)?.message || err
      );
    }
  }
  return applied;
}

type PlacementOverlay = {
  department_id?: string;
  position_id?: string;
  departmentName?: string;
  positionTitle?: string;
  job_position?: string | null;
  base_salary?: number | null;
  currency?: string | null;
  placement_pending: boolean;
  placement_effective_date?: string | null;
  placement_movement_type?: string | null;
};

async function loadDeptPositionMaps(deptIds: string[], posIds: string[]) {
  const [depts, positions] = await Promise.all([loadDeptMap(deptIds), loadPositionMap(posIds)]);
  return { depts, positions };
}

function buildPlacementOverlay(
  plain: Record<string, unknown>,
  maps: { depts: Map<string, string>; positions: Map<string, string> },
  pending: boolean
): PlacementOverlay {
  const type = movementTypeNorm(plain.movement_type);
  const overlay: PlacementOverlay = {
    placement_pending: pending,
    placement_effective_date: plain.effective_date ? String(plain.effective_date) : null,
    placement_movement_type: type,
  };
  if (isSalaryMovementType(type)) {
    overlay.base_salary = parseSalary(plain.to_base_salary);
    overlay.currency = plain.to_currency ? String(plain.to_currency) : null;
    return overlay;
  }
  overlay.department_id = String(plain.to_department_id || '');
  overlay.position_id = String(plain.to_position_id || '');
  overlay.departmentName = maps.depts.get(overlay.department_id) || '';
  overlay.positionTitle =
    maps.positions.get(overlay.position_id) || String(plain.to_job_position || '');
  overlay.job_position = plain.to_job_position ? String(plain.to_job_position) : null;
  const pendingSalary = parseSalary(plain.to_base_salary);
  if (pendingSalary != null && pendingSalary > 0) {
    overlay.base_salary = pendingSalary;
    overlay.currency = plain.to_currency ? String(plain.to_currency) : null;
  }
  return overlay;
}

function mergePlacementOverlay(
  row: Record<string, unknown>,
  overlay: PlacementOverlay
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...row,
    placement_pending: overlay.placement_pending,
    placement_effective_date: overlay.placement_effective_date ?? null,
    placement_movement_type: overlay.placement_movement_type ?? null,
  };

  if (overlay.base_salary != null) {
    next.base_salary = overlay.base_salary;
    if (overlay.currency) next.currency = overlay.currency;
  }

  if (overlay.department_id) {
    next.department_id = overlay.department_id;
    const prevDept = (row.department as Record<string, unknown> | undefined) || {};
    next.department = {
      ...prevDept,
      id: overlay.department_id,
      name: overlay.departmentName || prevDept.name || '',
    };
  }

  if (overlay.position_id) {
    next.position_id = overlay.position_id;
    const prevPos = (row.position as Record<string, unknown> | undefined) || {};
    next.position = {
      ...prevPos,
      id: overlay.position_id,
      title: overlay.positionTitle || prevPos.title || '',
    };
  }

  if (overlay.job_position) {
    next.job_position = overlay.job_position;
  }

  return next;
}

async function loadPlacementSnapshotByPk(
  employeePks: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!employeePks.length) return map;

  const rows: any[] = await Employee.findAll({
    where: { id: { [Op.in]: employeePks } },
    attributes: ['id', 'employee_id', 'department_id', 'position_id', 'job_position'],
    include: [
      {
        model: Department,
        as: 'department',
        attributes: ['id', 'name', 'office_location_id'],
      },
      { model: Position, as: 'position', attributes: ['id', 'title'] },
    ],
  });

  for (const row of rows) {
    const plain = row.get ? row.get({ plain: true }) : row;
    map.set(String(plain.id), {
      department_id: plain.department_id,
      position_id: plain.position_id,
      job_position: plain.job_position,
      department: plain.department,
      position: plain.position,
    });
  }
  return map;
}

async function loadFutureScheduledOverlays(
  employeeCodes: string[]
): Promise<Map<string, PlacementOverlay>> {
  const map = new Map<string, PlacementOverlay>();
  if (!employeeCodes.length) return map;

  const scheduled: any[] = await EmployeeMovement.findAll({
    where: {
      employee_id: { [Op.in]: employeeCodes },
      status: { [Op.in]: ['scheduled', 'approved'] },
      applied_at: { [Op.is]: null },
    },
    order: [
      ['effective_date', 'DESC'],
      ['created_at', 'DESC'],
    ],
  });

  const deptIds: string[] = [];
  const posIds: string[] = [];
  const pendingRows: { code: string; plain: Record<string, unknown> }[] = [];

  for (const row of scheduled) {
    const plain = row.get ? row.get({ plain: true }) : row;
    const code = String(plain.employee_id || '');
    if (!code || map.has(code)) continue;
    if (isEffectiveDue(String(plain.effective_date))) continue;
    pendingRows.push({ code, plain });
    const type = movementTypeNorm(plain.movement_type);
    if (!isSalaryMovementType(type)) {
      deptIds.push(String(plain.to_department_id), String(plain.from_department_id));
      posIds.push(String(plain.to_position_id), String(plain.from_position_id));
    }
  }

  const maps = await loadDeptPositionMaps(deptIds, posIds);
  for (const { code, plain } of pendingRows) {
    map.set(code, buildPlacementOverlay(plain, maps, true));
  }
  return map;
}

/**
 * Overlay future scheduled placement on employee rows.
 * When `applyDue` is true, due movements are applied and placement is re-read from DB.
 * List endpoints should pass `{ applyDue: false }` — rows already have dept/position; only pending badges are needed.
 */
export async function attachPlacementFromMovements(
  rows: Record<string, unknown>[],
  options?: { applyDue?: boolean }
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return rows;

  const applyDue = options?.applyDue === true;
  if (applyDue) {
    await applyDueScheduledMovements();
  }

  const employeeCodes = rows.map((r) => String(r.employee_id || '')).filter(Boolean);
  const futureOverlays = await loadFutureScheduledOverlays(employeeCodes);

  if (!applyDue) {
    return rows.map((row) => {
      const code = String(row.employee_id || '');
      const overlay = futureOverlays.get(code);
      return overlay ? mergePlacementOverlay({ ...row }, overlay) : row;
    });
  }

  const employeePks = rows.map((r) => String(r.id || '')).filter(Boolean);
  const snapshotByPk = await loadPlacementSnapshotByPk(employeePks);

  return rows.map((row) => {
    const pk = String(row.id || '');
    const code = String(row.employee_id || '');
    const snap = snapshotByPk.get(pk);
    let merged = snap ? { ...row, ...snap } : { ...row };
    const overlay = futureOverlays.get(code);
    if (overlay) merged = mergePlacementOverlay(merged, overlay);
    return merged;
  });
}

async function softDeleteMovementRow(row: any, deletedBy?: string | null): Promise<void> {
  const plain = row.get ? row.get({ plain: true }) : row;
  const now = new Date().toISOString();
  await row.update({
    is_deleted: true,
    is_active: false,
    modified_by: deletedBy ?? plain.modified_by ?? null,
    modified_at: now,
  });
  const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
  await recordSensitiveAudit({
    module: 'movement',
    entityId: String(plain.id),
    action: 'SOFT_DELETE',
    oldValue: plain,
    createdBy: deletedBy ?? null,
    modifiedBy: deletedBy ?? null,
  });
}

async function applyMovementRecord(row: any, appliedBy?: string | null) {
  const plain = row.get ? row.get({ plain: true }) : row;
  if (plain.is_deleted === true || plain.is_deleted === 1) return;
  if (plain.status === 'cancelled') return;
  if (isPendingMovementStatus(String(plain.status || ''))) return;
  if (plain.applied_at) return;
  if (!isEffectiveDue(String(plain.effective_date || ''))) return;

  const effectiveIso = String(plain.effective_date || '').slice(0, 10);
  const { assertPayrollMasterDataEditableForEffectiveDate } = await import(
    './payroll/payrollMasterDataGuard.js'
  );
  await assertPayrollMasterDataEditableForEffectiveDate(effectiveIso);

  const emp: any = await Employee.findByPk(plain.employee_pk);
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }

  const movementType = movementTypeNorm(plain.movement_type);

  if (isMetadataMovementType(movementType)) {
    const newValue = plain.new_value ? String(plain.new_value) : '';
    if (movementType === 'contract_type_change') {
      const next = normalizeContractType(newValue);
      if (!next) throw Object.assign(new Error('Invalid contract type on movement'), { status: 400 });
      await applyContractTypeToEmployee(emp, next);
    } else {
      const next = normalizeEmploymentStatus(newValue);
      if (!next) {
        throw Object.assign(new Error('Invalid employment status on movement'), { status: 400 });
      }
      await applyEmploymentStatusToEmployee(emp, next);
    }
  } else if (isSalaryMovementType(movementType)) {
    const toSalary = parseSalary(plain.to_base_salary);
    if (toSalary === null || toSalary <= 0) {
      throw Object.assign(new Error('Invalid target salary on movement record'), { status: 400 });
    }
    await upsertSalaryStructure(String(emp.id), {
      base_salary: toSalary,
      currency: String(plain.to_currency || plain.from_currency || 'USD'),
    }, { effectiveFrom: effectiveIso, changeReason: `Movement ${plain.id}` });
  } else if (isPlacementMovementType(movementType)) {
    assertActiveEmployeeStatus(emp);
    await emp.update({
      department_id: plain.to_department_id,
      position_id: plain.to_position_id,
      updated_at: new Date(),
    });
    await syncEmployeeJobPosition(String(emp.id), plain.to_position_id, plain.to_job_position);
    const toSalary = parseSalary(plain.to_base_salary);
    if (toSalary !== null && toSalary > 0) {
      await upsertSalaryStructure(String(emp.id), {
        base_salary: toSalary,
        currency: String(plain.to_currency || plain.from_currency || 'USD'),
      }, { effectiveFrom: effectiveIso, changeReason: `Movement ${plain.id}` });
    }
  } else {
    return;
  }

  const now = new Date().toISOString();
  await row.update({
    status: MOVEMENT_STATUS_APPLIED,
    applied_at: now,
    applied_by: appliedBy ?? plain.applied_by ?? 'system-scheduler',
  });
  const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
  await recordSensitiveAudit({
    module: 'movement',
    entityId: String(plain.id),
    action: 'APPLY',
    newValue: { status: MOVEMENT_STATUS_APPLIED, applied_at: now },
    appliedBy: appliedBy ?? 'system-scheduler',
  });

  try {
    const { notifyMovementApplied } = await import('./notificationService.js');
    void notifyMovementApplied({
      movementId: String(plain.id),
      employeePk: String(emp.id),
      movementType: movementType,
      effectiveDate: effectiveIso,
    });
  } catch (err) {
    console.warn('[movements] apply notification failed:', err);
  }
}

/** HR code (e.g. IROC00001) for the user’s linked employee row. */
export async function resolveEmployeePublicIdForUserAccount(user: {
  employeeId?: string | null;
}): Promise<string | null> {
  const rowId = String(user?.employeeId ?? '').trim();
  if (!rowId) return null;
  const emp: any = await Employee.findByPk(rowId, { attributes: ['employee_id'] });
  if (!emp) return null;
  const plain = emp.get ? emp.get({ plain: true }) : emp;
  const code = String(plain.employee_id ?? '').trim();
  return code || null;
}

export type EmployeeMovementListFilters = {
  departmentId?: string;
  employeeId?: string;
  movementType?: string;
  status?: string;
  limit?: number;
};

const MOVEMENT_LIST_ROLES = new Set(['HR', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']);

/** HR/manager/admin: any filter. Employee: own history only. */
export async function listEmployeeMovementsForViewer(
  viewer: { role?: string; employeeId?: string | null },
  filters: EmployeeMovementListFilters
): Promise<EmployeeMovementDto[]> {
  const role = String(viewer?.role || '').toUpperCase();

  if (role === 'EMPLOYEE') {
    const ownCode = await resolveEmployeePublicIdForUserAccount(viewer);
    if (!ownCode) {
      throw Object.assign(new Error('No employee profile linked to your account'), { status: 403 });
    }
    const requested = filters.employeeId ? String(filters.employeeId).trim() : '';
    if (requested && requested !== ownCode) {
      throw Object.assign(
        new Error('You can only view your own movement history'),
        { status: 403 }
      );
    }
    return listEmployeeMovements({
      employeeId: ownCode,
      movementType: filters.movementType,
      status: filters.status,
      limit: filters.limit,
    });
  }

  if (!MOVEMENT_LIST_ROLES.has(role)) {
    throw Object.assign(new Error('Forbidden: insufficient role permissions'), { status: 403 });
  }

  return listEmployeeMovements(filters);
}

/** Movements in the viewer's approval queue (Leave-style: keep after approve/reject/return). */
export async function listPendingMovementsForCurrentApprover(
  viewer: {
    id?: string;
    role?: string;
  },
  options?: { includeHistory?: boolean }
): Promise<Array<EmployeeMovementDto & { canApproverReview?: boolean }>> {
  const actorId = String(viewer?.id ?? '').trim();
  if (!actorId) return [];
  const includeHistory = Boolean(options?.includeHistory);

  const rows = await listEmployeeMovements({
    status: includeHistory ? undefined : 'pending',
    limit: 200,
  });

  return rows
    .filter((row) => {
      const assignedIds = [
        ...(row.assignedApproverUserIds ?? []),
        ...((row.assignedApprovers ?? []).map((a) => String(a.userId ?? '').trim())),
        String(row.assignedApproverUserId ?? '').trim(),
        String(row.currentApproverUserId ?? '').trim(),
      ].filter(Boolean);
      return assignedIds.includes(actorId);
    })
    .map((row) => {
      const status = String(row.status ?? '').toLowerCase();
      const currentId = String(row.currentApproverUserId ?? '').trim();
      const legacyId = String(row.assignedApproverUserId ?? '').trim();
      const isOpen = status === 'pending_approval' || status === 'pending';
      const canApproverReview = includeHistory
        ? isOpen && (currentId ? currentId === actorId : legacyId === actorId)
        : isOpen && (currentId ? currentId === actorId : legacyId === actorId);
      return { ...row, canApproverReview };
    })
    .filter((row) => {
      if (includeHistory) return true;
      return Boolean(row.canApproverReview);
    })
    .sort((a, b) => {
      const aAction = a.canApproverReview ? 0 : 1;
      const bAction = b.canApproverReview ? 0 : 1;
      if (aAction !== bAction) return aAction - bAction;
      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });
}

/** Which of the given HR employee codes have at least one movement record. */
export async function getEmployeeIdsWithMovementHistory(
  viewer: { role?: string; employeeId?: string | null },
  employeeIds: string[]
): Promise<string[]> {
  const unique = [...new Set(employeeIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!unique.length) return [];

  const role = String(viewer?.role || '').toUpperCase();
  let allowedIds = unique;

  if (role === 'EMPLOYEE') {
    const ownCode = await resolveEmployeePublicIdForUserAccount(viewer);
    if (!ownCode) return [];
    const forbidden = unique.some((id) => id !== ownCode);
    if (forbidden) {
      throw Object.assign(
        new Error('You can only view movement flags for your own employee record'),
        { status: 403 }
      );
    }
    allowedIds = [ownCode];
  } else if (!MOVEMENT_LIST_ROLES.has(role)) {
    throw Object.assign(new Error('Forbidden: insufficient role permissions'), { status: 403 });
  }

  const rows: any[] = await EmployeeMovement.findAll({
    where: { employee_id: { [Op.in]: allowedIds } },
    attributes: ['employee_id'],
    group: ['employee_id'],
    raw: true,
  });

  return rows
    .map((r) => String(r.employee_id ?? '').trim())
    .filter(Boolean);
}

export async function listEmployeeMovements(filters: EmployeeMovementListFilters): Promise<EmployeeMovementDto[]> {
  await applyDueScheduledMovements();

  const where: Record<string, unknown> = { ...movementNotDeletedWhere };
  if (filters.employeeId) {
    where.employee_id = String(filters.employeeId);
  }
  if (filters.movementType) {
    where.movement_type = movementTypeNorm(filters.movementType);
  }
  const statusFilter = parseMovementStatusFilter(filters.status);
  if (statusFilter.dbStatus) {
    where.status = statusFilter.dbStatus;
  }
  if (filters.departmentId) {
    const deptId = String(filters.departmentId);
    Object.assign(where, {
      [Op.or]: [{ from_department_id: deptId }, { to_department_id: deptId }],
    });
  }

  const rows: any[] = await EmployeeMovement.findAll({
    where,
    order: [
      ['effective_date', 'DESC'],
      ['created_at', 'DESC'],
    ],
    limit: Math.min(filters.limit ?? 100, 200),
  });

  const createdByIds = rows
    .map((r) => {
      const plain = r.get ? r.get({ plain: true }) : r;
      return plain.created_by ? String(plain.created_by) : '';
    })
    .filter(Boolean);
  const createdByNames = await loadCreatedByNameMap(createdByIds);

  const movementPlains = rows.map((r) => {
    const plain = r.get ? r.get({ plain: true }) : r;
    return {
      employee_pk: plain.employee_pk ? String(plain.employee_pk) : null,
      employee_id: plain.employee_id ? String(plain.employee_id) : null,
    };
  });
  const employeeIdentities = await loadEmployeeIdentityMap(movementPlains);

  const appraisalIds = [
    ...new Set(
      rows
        .map((r) => {
          const plain = r.get ? r.get({ plain: true }) : r;
          return plain.source_appraisal_id ? String(plain.source_appraisal_id) : '';
        })
        .filter(Boolean)
    ),
  ];
  const appraisalPeriodNames = new Map<string, string>();
  if (appraisalIds.length) {
    const linked = (await sequelize.query(
      `SELECT ea.id, ap.name
       FROM employee_appraisals ea
       LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
       WHERE ea.id IN (:ids)`,
      { replacements: { ids: appraisalIds }, type: QueryTypes.SELECT }
    )) as Array<{ id?: string; name?: string }>;
    for (const row of linked) {
      if (row.id && row.name) appraisalPeriodNames.set(String(row.id), String(row.name));
    }
  }

  const probationReviewByMovementId = await loadProbationReviewIdByMovementIds(
    rows
      .map((r) => {
        const plain = r.get ? r.get({ plain: true }) : r;
        if (plain.source_probation_review_id) return '';
        return String(plain.id ?? '');
      })
      .filter(Boolean)
  );

  const dtos = await Promise.all(
    rows.map((r) => {
      const plain = r.get ? r.get({ plain: true }) : r;
      const createdByName = plain.created_by
        ? createdByNames.get(String(plain.created_by)) ?? null
        : null;
      const sourceId = plain.source_appraisal_id ? String(plain.source_appraisal_id) : '';
      const movementId = String(plain.id ?? '');
      const inferredProbationReviewId =
        plain.source_probation_review_id
          ? String(plain.source_probation_review_id)
          : probationReviewByMovementId.get(movementId) ?? null;
      const pk = plain.employee_pk ? String(plain.employee_pk) : '';
      const code = plain.employee_id ? String(plain.employee_id) : '';
      const identity =
        (pk ? employeeIdentities.get(pk) : undefined) ||
        (code ? employeeIdentities.get(code) : undefined);
      return serializeMovement(r, {
        employeeName: identity?.name || undefined,
        employeeEmail: identity?.email ?? null,
        employeePhone: identity?.phone ?? null,
        employeeAvatarUrl: identity?.avatarUrl ?? null,
        createdByName: createdByName ?? undefined,
        sourceAppraisalPeriodName: sourceId
          ? appraisalPeriodNames.get(sourceId) ?? undefined
          : undefined,
        sourceProbationReviewId: inferredProbationReviewId,
      });
    })
  );

  if (statusFilter.canonical) {
    return dtos.filter((d) => d.canonicalStatus === statusFilter.canonical);
  }
  return dtos;
}

async function assertAppraisalMovementLink(sourceAppraisalId: string, employeeId: string): Promise<void> {
  const rows = (await sequelize.query(
    `SELECT ea.workflow_status, e.employee_id
     FROM employee_appraisals ea
     JOIN users u ON u.id = ea.user_id
     LEFT JOIN employees e ON e.id = u.employeeId OR e.id = u.id
     WHERE ea.id = :id LIMIT 1`,
    { replacements: { id: sourceAppraisalId }, type: QueryTypes.SELECT }
  )) as Array<{ workflow_status?: string; employee_id?: string }>;

  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error('Linked appraisal not found'), { status: 404 });
  }
  const status = String(row.workflow_status || '').toUpperCase();
  if (status !== 'APPROVED' && status !== 'CLOSED') {
    throw Object.assign(
      new Error('Only final-approved appraisals can be linked to employee movements'),
      { status: 400 }
    );
  }
  const linkedCode = row.employee_id ? String(row.employee_id).trim() : '';
  if (!linkedCode || linkedCode !== String(employeeId).trim()) {
    throw Object.assign(
      new Error('Movement employee does not match the linked appraisal'),
      { status: 400 }
    );
  }
}

async function assertProbationMovementLink(
  sourceProbationReviewId: string,
  employeeId: string
): Promise<void> {
  const review: any = await EmployeeReview.findByPk(sourceProbationReviewId);
  if (!review) {
    throw Object.assign(new Error('Linked probation review not found'), { status: 404 });
  }
  const plain = review.get ? review.get({ plain: true }) : review;
  if (String(plain.reviewType ?? '').toUpperCase() !== 'PROBATION') {
    throw Object.assign(new Error('Linked review is not a probation review'), { status: 400 });
  }
  const user: any = await User.findByPk(String(plain.userId ?? ''), {
    attributes: ['employeeId'],
  });
  if (!user?.employeeId) {
    throw Object.assign(new Error('Probation review employee not found'), { status: 400 });
  }
  const emp: any = await Employee.findByPk(String(user.employeeId), {
    attributes: ['employee_id'],
  });
  const linkedCode = emp?.employee_id ? String(emp.employee_id).trim() : '';
  if (!linkedCode || linkedCode !== String(employeeId).trim()) {
    throw Object.assign(
      new Error('Movement employee does not match the linked probation review'),
      { status: 400 }
    );
  }
}

export async function listMovementsForAppraisal(appraisalId: string): Promise<EmployeeMovementDto[]> {
  const id = String(appraisalId).trim();
  if (!id) return [];
  const rows: any[] = await EmployeeMovement.findAll({
    where: { source_appraisal_id: id },
    order: [
      ['created_at', 'DESC'],
    ],
    limit: 20,
  });
  if (!rows.length) return [];

  let periodName: string | null = null;
  const periodRows = (await sequelize.query(
    `SELECT ap.name FROM employee_appraisals ea
     LEFT JOIN appraisal_periods ap ON ap.id = ea.period_id
     WHERE ea.id = :id LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT }
  )) as Array<{ name?: string }>;
  periodName = periodRows[0]?.name ? String(periodRows[0].name) : null;

  return Promise.all(
    rows.map((r) =>
      serializeMovement(r, { sourceAppraisalPeriodName: periodName ?? undefined })
    )
  );
}

async function queueMovementApprovalIfNeeded(params: {
  emp: any;
  movementRow: any;
  submitterRole?: string;
  changeReason?: string | null;
  createdBy?: string | null;
}): Promise<EmployeeMovementDto | null> {
  const {
    buildSensitiveEmployeeState,
    canApplySensitiveChangesDirectly,
    computeSensitiveFieldChanges,
    submitSensitiveChangeRequest,
  } = await import('./employeeSensitiveChangeService.js');

  if (canApplySensitiveChangesDirectly(params.submitterRole)) {
    return null;
  }

  const reason = String(params.changeReason ?? params.movementRow.get('notes') ?? '').trim();
  if (!reason) {
    await softDeleteMovementRow(params.movementRow, params.createdBy ?? null);
    throw Object.assign(
      new Error('Change reason is required for placement or compensation updates.'),
      { status: 400, code: 'CHANGE_REASON_REQUIRED' }
    );
  }

  const plain = params.movementRow.get({ plain: true });
  const structure = await loadSalaryStructureForEmployeeId(String(params.emp.id));
  const empPlain = params.emp.get({ plain: true });
  const beforeState = buildSensitiveEmployeeState(empPlain, structure);
  const afterState = buildSensitiveEmployeeState(
    {
      ...empPlain,
      department_id: plain.to_department_id,
      position_id: plain.to_position_id,
      job_position: plain.to_job_position,
    },
    {
      ...(structure ?? {}),
      base_salary: plain.to_base_salary ?? structure?.base_salary,
      currency: plain.to_currency ?? structure?.currency,
    }
  );
  const fieldChanges = computeSensitiveFieldChanges(beforeState, afterState);
  await submitSensitiveChangeRequest({
    employeePk: String(params.emp.id),
    employeeId: toCanonicalEmployeeDisplayId(plain.employee_id) || String(plain.employee_id),
    changeSource: 'movement',
    sourceRefId: String(plain.id),
    changeReason: reason,
    effectiveDate: String(plain.effective_date).slice(0, 10),
    beforeState,
    afterState,
    fieldChanges,
    submittedBy: params.createdBy ?? null,
  });

  const name = resolveEmployeeRecordName(params.emp);
  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(String(plain.id));
  return serializeMovement(params.movementRow, { employeeName: name });
}

export async function approvePendingEmployeeMovement(
  movementId: string,
  reviewedBy: string,
  actor?: { id?: string; role?: string },
  notes?: string | null
): Promise<EmployeeMovementDto> {
  const approveComment = requireWorkflowComment(notes, 'Approval comment');
  if (!approveComment) {
    throw Object.assign(new Error('Approval comment is required (min 3 characters).'), { status: 400 });
  }

  const row: any = await EmployeeMovement.findByPk(movementId);
  if (!row) {
    throw Object.assign(new Error('Movement not found'), { status: 404 });
  }
  const plain = row.get({ plain: true });
  if (String(plain.status) !== 'pending_approval') {
    throw Object.assign(new Error('Movement is not pending approval'), { status: 409 });
  }

  const {
    loadMovementApprovers,
    markMovementApproverApproved,
    allMovementApproversApproved,
    movementRequiresActorApproval,
    getCurrentPendingApprover,
    notifyMovementWorkflowFinished,
  } = await import('./workflowMovementApproverService.js');
  const { canActAsMovementApprover } = await import('./workflowApproverService.js');
  const { movementTypeLabelForNotify } = await import('./employeeMovementNotify.js');

  const approvers = await loadMovementApprovers(movementId);
  const approverIds = approvers.map((entry) => entry.userId);
  const approverStatuses = new Map(approvers.map((entry) => [entry.userId, entry.status]));
  const role = String(actor?.role ?? '').toUpperCase();
  const isHrAdmin = ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(role);
  const actorId = String(reviewedBy);

  if (approvers.length) {
    if (!movementRequiresActorApproval(approvers, actorId)) {
      throw Object.assign(
        new Error(
          isHrAdmin
            ? 'This movement is waiting on another approver in the chain. Only the current approver can sign off.'
            : 'It is not your turn to approve this movement yet.'
        ),
        { status: 403 }
      );
    }
    const mine = approvers.find((entry) => entry.userId === actorId);
    if (mine?.status === 'approved') {
      throw Object.assign(new Error('You have already approved this movement.'), { status: 409 });
    }
    await markMovementApproverApproved(movementId, actorId);
    const refreshed = await loadMovementApprovers(movementId);
    if (!allMovementApproversApproved(refreshed)) {
      const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
      await recordSensitiveAudit({
        module: 'movement',
        entityId: movementId,
        action: 'APPROVE_STEP',
        newValue: { approverUserId: actorId, notes: approveComment },
        approvedBy: reviewedBy,
      });
      const next = getCurrentPendingApprover(refreshed);
      if (next) {
        const emp: any = await Employee.findOne({
          where: { employee_id: String(plain.employee_id) },
          attributes: ['first_name', 'last_name'],
          raw: true,
        });
        const employeeName = emp
          ? resolveEmployeeRecordName(emp) || 'Employee'
          : 'Employee';
        const { notifyNextMovementApproverTurn } = await import('./workflowMovementApproverService.js');
        await notifyNextMovementApproverTurn(movementId, refreshed, {
          employeeName,
          movementTypeLabel: movementTypeLabelForNotify(String(plain.movement_type)),
        });
      }
      return serializeMovement(row);
    }
  } else if (
    actor &&
    !canActAsMovementApprover(actor, plain, {
      assignedApproverUserIds: approverIds.length ? approverIds : undefined,
      pendingOnly: true,
      approverStatuses,
    })
  ) {
    throw Object.assign(new Error('You are not authorized to approve this movement.'), { status: 403 });
  }

  const effectiveIso = String(plain.effective_date || '');
  const scheduled = !isEffectiveDue(effectiveIso);
  const now = new Date().toISOString();
  if (!scheduled) {
    await row.update({
      status: MOVEMENT_STATUS_APPLIED,
      approved_by: reviewedBy,
      approved_at: now,
    });
    await applyMovementRecord(row, reviewedBy);
    await row.reload();
  } else {
    await row.update({
      status: MOVEMENT_STATUS_APPROVED,
      approved_by: reviewedBy,
      approved_at: now,
    });
    const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
    await recordSensitiveAudit({
      module: 'movement',
      entityId: String(plain.id),
      action: 'APPROVE',
      newValue: { status: MOVEMENT_STATUS_APPROVED },
      approvedBy: reviewedBy,
    });
  }

  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(movementId);

  {
    const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
    await recordSensitiveAudit({
      module: 'movement',
      entityId: movementId,
      action: 'APPROVE',
      newValue: { notes: approveComment },
      approvedBy: reviewedBy,
    });
  }

  await notifyMovementWorkflowFinished({
    movementId,
    outcome: 'approved',
    approvers: await loadMovementApprovers(movementId),
    appliedImmediately: !scheduled,
  });

  return serializeMovement(row);
}

export async function rejectPendingEmployeeMovement(
  movementId: string,
  reviewedBy: string,
  reason?: string | null,
  actor?: { id?: string; role?: string }
): Promise<EmployeeMovementDto> {
  const rejectComment = requireWorkflowComment(reason, 'Rejection comment');
  if (!rejectComment) {
    throw Object.assign(new Error('Rejection comment is required (min 3 characters).'), { status: 400 });
  }

  const row: any = await EmployeeMovement.findByPk(movementId);
  if (!row) {
    throw Object.assign(new Error('Movement not found'), { status: 404 });
  }
  const plain = row.get({ plain: true });
  if (String(plain.status) !== 'pending_approval') {
    throw Object.assign(new Error('Movement is not pending approval'), { status: 409 });
  }
  const { loadMovementApprovers, getCurrentPendingApprover } = await import(
    './workflowMovementApproverService.js'
  );
  const { canActAsMovementApprover } = await import('./workflowApproverService.js');
  const approvers = await loadMovementApprovers(movementId);
  const approverIds = approvers.map((entry) => entry.userId);
  const current = getCurrentPendingApprover(approvers);
  if (
    actor &&
    !canActAsMovementApprover(actor, plain, {
      assignedApproverUserIds: approverIds.length ? approverIds : undefined,
      sequential: approvers.length > 0,
      currentApproverUserId: current?.userId ?? null,
    })
  ) {
    throw Object.assign(new Error('You are not authorized to reject this movement.'), { status: 403 });
  }

  const now = new Date().toISOString();
  await row.update({
    status: 'rejected',
    rejected_by: reviewedBy,
    rejected_at: now,
    rejection_reason: rejectComment,
  });
  const { notifyMovementWorkflowFinished } = await import('./workflowMovementApproverService.js');
  await notifyMovementWorkflowFinished({
    movementId,
    outcome: 'rejected',
    approvers,
  });
  await writeWorkflowStatusAudit({
    entityType: 'employee_movement',
    entityId: movementId,
    previousStatus: 'pending_approval',
    nextStatus: 'rejected',
    performedBy: reviewedBy,
    reason: rejectComment,
  });
  return serializeMovement(row);
}

export async function returnPendingEmployeeMovement(
  movementId: string,
  reviewedBy: string,
  notes?: string | null,
  actor?: { id?: string; role?: string }
): Promise<EmployeeMovementDto> {
  const row: any = await EmployeeMovement.findByPk(movementId);
  if (!row) {
    throw Object.assign(new Error('Movement not found'), { status: 404 });
  }
  const plain = row.get({ plain: true });
  if (String(plain.status) !== 'pending_approval') {
    throw Object.assign(new Error('Movement is not pending approval'), { status: 409 });
  }
  const { loadMovementApprovers, getCurrentPendingApprover } = await import(
    './workflowMovementApproverService.js'
  );
  const { canActAsMovementApprover } = await import('./workflowApproverService.js');
  const approvers = await loadMovementApprovers(movementId);
  const approverIds = approvers.map((entry) => entry.userId);
  const current = getCurrentPendingApprover(approvers);
  if (
    actor &&
    !canActAsMovementApprover(actor, plain, {
      assignedApproverUserIds: approverIds.length ? approverIds : undefined,
      sequential: approvers.length > 0,
      currentApproverUserId: current?.userId ?? null,
    })
  ) {
    throw Object.assign(new Error('You are not authorized to return this movement.'), { status: 403 });
  }

  const trimmed = String(notes ?? '').trim();
  if (trimmed.length < 3) {
    throw Object.assign(new Error('Return notes are required (min 3 characters).'), { status: 400 });
  }

  const now = new Date().toISOString();
  await row.update({
    status: 'returned',
    returned_by: reviewedBy,
    returned_at: now,
    return_notes: trimmed,
  });
  const { notifyMovementWorkflowFinished } = await import('./workflowMovementApproverService.js');
  await notifyMovementWorkflowFinished({
    movementId,
    outcome: 'returned',
    approvers,
  });
  await writeWorkflowStatusAudit({
    entityType: 'employee_movement',
    entityId: movementId,
    previousStatus: 'pending_approval',
    nextStatus: 'returned',
    performedBy: reviewedBy,
    reason: trimmed,
  });
  return serializeMovement(row);
}

/**
 * Submitter (actor) updates a returned movement and resubmits into pending_approval
 * with a fresh approver chain. Approvers and other HR users cannot edit.
 */
export async function resubmitReturnedEmployeeMovement(
  movementId: string,
  input: {
    effectiveDate?: string;
    toDepartmentId?: string;
    toPositionId?: string;
    toBaseSalary?: number;
    toCurrency?: string;
    newContractType?: string;
    newEmploymentStatus?: string;
    notes?: string;
    changeReason?: string;
    assignedApproverUserId?: string | null;
    assignedApproverUserIds?: string[] | null;
  },
  actor: { id?: string; role?: string }
): Promise<EmployeeMovementDto> {
  const row: any = await EmployeeMovement.findByPk(movementId);
  if (!row) {
    throw Object.assign(new Error('Movement not found'), { status: 404 });
  }
  const plain = row.get({ plain: true });
  if (String(plain.status).toLowerCase() !== 'returned') {
    throw Object.assign(
      new Error('Only returned movements can be edited and resubmitted.'),
      { status: 400 }
    );
  }

  const actorId = String(actor?.id ?? '').trim();
  const createdBy = String(plain.created_by ?? '').trim();
  if (!actorId || !createdBy || createdBy !== actorId) {
    throw Object.assign(
      new Error('Only the person who submitted this movement can edit and resubmit it.'),
      { status: 403 }
    );
  }

  const emp: any = await Employee.findOne({
    where: employeeLookupWhere(String(plain.employee_id)) as never,
  });
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }
  assertActiveEmployeeStatus(emp);

  const movementType = movementTypeNorm(plain.movement_type);
  const effectiveIso = endOfDayIso(
    String(input.effectiveDate ?? plain.effective_date ?? '').slice(0, 10)
  );
  const { assertPayrollDateInputsEditable, PayrollPeriodFrozenError } = await import(
    './payroll/payrollPeriodFreezeService.js'
  );
  if (isEffectiveDue(effectiveIso)) {
    try {
      await assertPayrollDateInputsEditable(effectiveIso);
    } catch (e) {
      if (e instanceof PayrollPeriodFrozenError) {
        throw Object.assign(new Error(e.message), { status: 409, code: e.code });
      }
      throw e;
    }
  }

  const notes =
    input.notes != null || input.changeReason != null
      ? String(input.notes ?? input.changeReason ?? '').trim() || null
      : plain.notes
        ? String(plain.notes)
        : null;

  const patch: Record<string, unknown> = {
    effective_date: effectiveIso,
    notes,
    status: 'pending_approval',
    returned_by: null,
    returned_at: null,
    return_notes: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    approved_by: null,
    approved_at: null,
    applied_at: null,
  };

  if (isMetadataMovementType(movementType)) {
    const fieldKey =
      movementType === 'contract_type_change' ? 'contract_type' : 'employment_status';
    const meta = await readEmployeeMetadata(emp);
    const currentValue =
      fieldKey === 'contract_type' ? meta.contractType : meta.employmentStatus;
    const rawNew =
      fieldKey === 'contract_type'
        ? input.newContractType ?? plain.new_value
        : input.newEmploymentStatus ?? plain.new_value;
    const normalizedNew =
      fieldKey === 'contract_type'
        ? normalizeContractType(rawNew)
        : normalizeEmploymentStatus(rawNew);
    if (!normalizedNew) {
      throw Object.assign(new Error(`New ${fieldKey.replace('_', ' ')} is required`), {
        status: 400,
      });
    }
    if (String(currentValue ?? '') === String(normalizedNew)) {
      throw Object.assign(new Error('New value must differ from the current value'), {
        status: 400,
      });
    }
    patch.field_key = fieldKey;
    patch.current_value = currentValue;
    patch.new_value = normalizedNew;
  } else if (isSalaryMovementType(movementType)) {
    const structure = await loadSalaryStructureForEmployeeId(String(emp.id));
    const fromBaseSalary = parseSalary(structure?.base_salary) ?? 0;
    const fromCurrency = String(structure?.currency || 'USD').toUpperCase();
    const salaryChange = resolveOptionalSalaryChange({
      fromBaseSalary,
      fromCurrency,
      toBaseSalary: input.toBaseSalary ?? plain.to_base_salary,
      toCurrency: input.toCurrency ?? plain.to_currency,
      requireChange: true,
    });
    if (salaryChange.toBaseSalary === null || salaryChange.toCurrency === null) {
      throw Object.assign(new Error('New base salary must be greater than zero'), {
        status: 400,
      });
    }
    await assertSalaryWithinPositionRange(
      String(emp.position_id),
      salaryChange.toBaseSalary,
      salaryChange.toCurrency
    );
    patch.from_base_salary = salaryChange.fromBaseSalary;
    patch.to_base_salary = salaryChange.toBaseSalary;
    patch.from_currency = salaryChange.fromCurrency;
    patch.to_currency = salaryChange.toCurrency;
  } else {
    const toDepartmentId = String(input.toDepartmentId ?? plain.to_department_id ?? '').trim();
    const toPositionId = String(input.toPositionId ?? plain.to_position_id ?? '').trim();
    if (!toDepartmentId || !toPositionId) {
      throw Object.assign(new Error('Target department and position are required'), {
        status: 400,
      });
    }
    await assertPositionInDepartment(toPositionId, toDepartmentId);
    const toJob = await resolveJobPositionTitle(toPositionId);
    const fromDepartmentId = String(emp.department_id);
    const fromPositionId = String(emp.position_id);
    const structure = await loadSalaryStructureForEmployeeId(String(emp.id));
    const fromBaseSalary = parseSalary(structure?.base_salary);
    const fromCurrency = String(structure?.currency || 'USD').toUpperCase();
    const salaryChange = resolveOptionalSalaryChange({
      fromBaseSalary,
      fromCurrency,
      toBaseSalary: input.toBaseSalary,
      toCurrency: input.toCurrency,
      requireChange: false,
    });
    if (salaryChange.toBaseSalary != null) {
      await assertSalaryWithinPositionRange(
        toPositionId,
        salaryChange.toBaseSalary,
        input.toCurrency
      );
    }
    patch.to_department_id = toDepartmentId;
    patch.to_position_id = toPositionId;
    patch.to_job_position = toJob;
    patch.from_department_id = fromDepartmentId;
    patch.from_position_id = fromPositionId;
    patch.from_base_salary = salaryChange.fromBaseSalary;
    patch.to_base_salary = salaryChange.toBaseSalary;
    patch.from_currency = salaryChange.fromCurrency;
    patch.to_currency = salaryChange.toCurrency;
  }

  const assignedApprovers = await resolveAssignedApproversForCreate({
    assignedApproverUserIds: input.assignedApproverUserIds,
    assignedApproverUserId: input.assignedApproverUserId,
    saveAsDraft: false,
    createdBy: actorId || createdBy || null,
  });
  if (!assignedApprovers.length) {
    throw Object.assign(
      new Error('Select at least one approver to resubmit this movement.'),
      { status: 400 }
    );
  }
  patch.assigned_approver_user_id = assignedApprovers[0] ?? null;

  await row.update(patch);
  await persistMovementApproversOnCreate(movementId, assignedApprovers);

  await writeWorkflowStatusAudit({
    entityType: 'employee_movement',
    entityId: movementId,
    previousStatus: 'returned',
    nextStatus: 'pending_approval',
    performedBy: actorId || null,
    reason: 'Resubmitted after return',
  });

  return serializeMovement(row);
}

async function resolveAssignedApproversForCreate(input: {
  assignedApproverUserIds?: string[] | null;
  assignedApproverUserId?: string | null;
  saveAsDraft?: boolean;
  createdBy?: string | null;
}): Promise<string[]> {
  const { resolveAssignedApproversForCreate } = await import('./workflowMovementApproverService.js');
  return resolveAssignedApproversForCreate(input);
}

async function persistMovementApproversOnCreate(movementId: string, approverIds: string[]): Promise<void> {
  if (!approverIds.length) return;
  const { replaceMovementApprovers, loadMovementApprovers, notifyMovementApproversOnSubmit } =
    await import('./workflowMovementApproverService.js');
  await replaceMovementApprovers(movementId, approverIds);
  const approvers = await loadMovementApprovers(movementId);
  if (!approvers.length) return;
  const movement: any = await EmployeeMovement.findByPk(movementId, {
    attributes: ['movement_type', 'employee_id'],
    raw: true,
  });
  if (!movement) return;
  const emp: any = await Employee.findOne({
    where: { employee_id: String(movement.employee_id) },
    attributes: ['first_name', 'last_name'],
    raw: true,
  });
  const employeeName = emp
    ? resolveEmployeeRecordName(emp) || 'Employee'
    : 'Employee';
  const { movementTypeLabelForNotify } = await import('./employeeMovementNotify.js');
  await notifyMovementApproversOnSubmit(movementId, approvers, {
    employeeName,
    movementTypeLabel: movementTypeLabelForNotify(String(movement.movement_type)),
  });
  const employeePk = String(movement.employee_id ?? '').trim();
  if (employeePk) {
    const movementRow: any = await EmployeeMovement.findByPk(movementId, {
      attributes: ['effective_date'],
      raw: true,
    });
    const { notifyMovementSubmitted } = await import('./notificationService.js');
    void notifyMovementSubmitted({
      movementId,
      employeePk,
      movementType: String(movement.movement_type),
      effectiveDate: String(movementRow?.effective_date ?? ''),
    });
  }
}

async function finalizeCreatedMovement(
  row: any,
  emp: any,
  canApplyDirect: boolean,
  scheduled: boolean,
  createdBy?: string | null
): Promise<EmployeeMovementDto> {
  if (canApplyDirect && !scheduled) {
    const now = new Date().toISOString();
    await row.update({
      status: MOVEMENT_STATUS_APPLIED,
      approved_by: createdBy ?? null,
      approved_at: now,
    });
    await applyMovementRecord(row, createdBy ?? null);
    await row.reload();
  } else if (canApplyDirect && scheduled) {
    await row.update({
      status: MOVEMENT_STATUS_APPROVED,
      approved_by: createdBy ?? null,
      approved_at: new Date().toISOString(),
    });
  }
  const plain = row.get ? row.get({ plain: true }) : row;
  const { recordSensitiveAudit } = await import('./sensitiveAuditService.js');
  await recordSensitiveAudit({
    module: 'movement',
    entityId: String(plain.id),
    action: 'CREATE',
    newValue: { movementType: plain.movement_type, effectiveDate: plain.effective_date },
    createdBy: createdBy ?? null,
  });
  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(String(plain.id));
  const name = resolveEmployeeRecordName(emp);
  return serializeMovement(row, { employeeName: name });
}

async function createMetadataMovement(
  emp: any,
  employeeId: string,
  movementType: MovementTypeCode,
  input: {
    effectiveDate: string;
    newContractType?: string;
    newEmploymentStatus?: string;
    newValue?: string;
    notes?: string;
    changeReason?: string;
    createdBy?: string;
    submitterRole?: string;
    saveAsDraft?: boolean;
    assignedApproverUserId?: string | null;
    assignedApproverUserIds?: string[] | null;
  }
): Promise<EmployeeMovementDto> {
  const meta = await readEmployeeMetadata(emp);
  const fieldKey =
    movementType === 'contract_type_change' ? 'contract_type' : 'employment_status';
  const currentValue =
    fieldKey === 'contract_type' ? meta.contractType : meta.employmentStatus;
  const rawNew =
    fieldKey === 'contract_type'
      ? input.newContractType ?? input.newValue
      : input.newEmploymentStatus ?? input.newValue;
  const normalizedNew =
    fieldKey === 'contract_type'
      ? normalizeContractType(rawNew)
      : normalizeEmploymentStatus(rawNew);
  if (!normalizedNew) {
    throw Object.assign(new Error(`New ${fieldKey.replace('_', ' ')} is required`), { status: 400 });
  }
  if (String(currentValue ?? '') === String(normalizedNew)) {
    throw Object.assign(new Error('New value must differ from the current value'), { status: 400 });
  }

  const effectiveIso = endOfDayIso(input.effectiveDate);
  const assignedApprovers = await resolveAssignedApproversForCreate({
    assignedApproverUserIds: input.assignedApproverUserIds,
    assignedApproverUserId: input.assignedApproverUserId,
    saveAsDraft: input.saveAsDraft,
    createdBy: input.createdBy ?? null,
  });
  const now = new Date().toISOString();
  const id = `mov-${Date.now()}`;
  const fromDept = String(emp.department_id || '');
  const fromPos = String(emp.position_id || '');

  const row = await EmployeeMovement.create({
    id,
    employee_pk: String(emp.id),
    employee_id: employeeId,
    movement_type: movementType,
    effective_date: effectiveIso,
    from_department_id: fromDept,
    to_department_id: fromDept,
    from_position_id: fromPos,
    to_position_id: fromPos,
    from_job_position: emp.job_position || null,
    to_job_position: emp.job_position || null,
    from_reporting_manager_id: null,
    to_reporting_manager_id: null,
    field_key: fieldKey,
    current_value: currentValue,
    new_value: normalizedNew,
    notes: input.notes ? String(input.notes).trim() : null,
    status: input.saveAsDraft ? 'draft' : 'pending_approval',
    assigned_approver_user_id: assignedApprovers[0] ?? null,
    created_by: input.createdBy || null,
    created_at: now,
    applied_at: null,
  });

  await persistMovementApproversOnCreate(id, assignedApprovers);

  if (input.saveAsDraft) {
    return serializeMovement(row, {
      employeeName: resolveEmployeeRecordName(emp),
    });
  }

  const name = resolveEmployeeRecordName(emp);
  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(String(row.get('id')));
  return serializeMovement(row, { employeeName: name });
}

export async function createEmployeeMovement(input: {
  employeeId: string;
  movementType: MovementType | string;
  effectiveDate: string;
  toDepartmentId?: string;
  toPositionId?: string;
  toBaseSalary?: number;
  toCurrency?: string;
  newContractType?: string;
  newEmploymentStatus?: string;
  newValue?: string;
  notes?: string;
  changeReason?: string;
  sourceAppraisalId?: string | null;
  sourceProbationReviewId?: string | null;
  assignedApproverUserId?: string | null;
  assignedApproverUserIds?: string[] | null;
  createdBy?: string;
  submitterRole?: string;
  saveAsDraft?: boolean;
}): Promise<EmployeeMovementDto> {
  const employeeId = String(input.employeeId).trim();
  const sourceAppraisalId = input.sourceAppraisalId?.trim() || null;
  const sourceProbationReviewId = input.sourceProbationReviewId?.trim() || null;
  if (sourceAppraisalId) {
    await assertAppraisalMovementLink(sourceAppraisalId, employeeId);
    const existingLinked = await EmployeeMovement.count({
      where: {
        source_appraisal_id: sourceAppraisalId,
        status: { [Op.notIn]: ['draft', 'rejected', 'cancelled'] },
        ...movementNotDeletedWhere,
      },
    });
    if (existingLinked > 0) {
      throw Object.assign(
        new Error(
          'A movement is already linked to this appraisal. View it under Employee movements or refresh the appraisal list.'
        ),
        { status: 409, code: 'APPRAISAL_MOVEMENT_EXISTS' }
      );
    }
  }
  if (sourceProbationReviewId) {
    await assertProbationMovementLink(sourceProbationReviewId, employeeId);
  }
  const emp: any = await Employee.findOne({ where: employeeLookupWhere(employeeId) as never });
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }
  assertActiveEmployeeStatus(emp);
  const canonicalEmployeeId =
    toCanonicalEmployeeDisplayId(emp.employee_id) || String(emp.employee_id);

  const effectiveIso = endOfDayIso(input.effectiveDate);
  const { assertPayrollDateInputsEditable, PayrollPeriodFrozenError } = await import(
    './payroll/payrollPeriodFreezeService.js'
  );
  // Scheduled movements apply on the effective date — only block immediate/retroactive
  // changes in a frozen payroll month (same rule as attendance/leave inputs).
  if (isEffectiveDue(effectiveIso)) {
    try {
      await assertPayrollDateInputsEditable(effectiveIso);
    } catch (e) {
      if (e instanceof PayrollPeriodFrozenError) {
        throw Object.assign(new Error(e.message), { status: 409, code: e.code });
      }
      throw e;
    }
  }

  const movementType = movementTypeNorm(input.movementType);

  if (isMetadataMovementType(movementType)) {
    return createMetadataMovement(emp, canonicalEmployeeId, movementType, input);
  }

  const fromDepartmentId = String(emp.department_id);
  const fromPositionId = String(emp.position_id);
  const fromJob = await resolveJobPositionTitle(fromPositionId);

  if (isSalaryMovementType(movementType)) {
    return createSalaryUpdateMovement(emp, canonicalEmployeeId, fromDepartmentId, fromPositionId, fromJob, {
      ...input,
      sourceAppraisalId,
      sourceProbationReviewId,
      submitterRole: input.submitterRole,
      changeReason: input.changeReason,
    });
  }

  const toDepartmentId = String(input.toDepartmentId ?? '').trim();
  const toPositionId = String(input.toPositionId ?? '').trim();

  if (!toDepartmentId || !toPositionId) {
    throw Object.assign(new Error('Target department and position are required'), { status: 400 });
  }

  await assertPositionInDepartment(toPositionId, toDepartmentId);

  const targetDept: any = await Department.findByPk(toDepartmentId, { attributes: ['id', 'isActive', 'name'] });
  if (!targetDept) {
    throw Object.assign(new Error('Target department not found'), { status: 400 });
  }
  const targetActive = targetDept.get('isActive');
  if (targetActive === false || targetActive === 0 || targetActive === '0') {
    throw Object.assign(
      new Error('Target department is inactive and cannot receive new employee assignments.'),
      { status: 400 }
    );
  }

  const targetPos: any = await Position.findByPk(toPositionId, {
    attributes: ['id', 'isActive', 'title'],
  });
  if (!targetPos) {
    throw Object.assign(new Error('Target position not found'), { status: 400 });
  }
  const targetPosActive = targetPos.get('isActive');
  if (targetPosActive === false || targetPosActive === 0 || targetPosActive === '0') {
    throw Object.assign(
      new Error('Target position is inactive and cannot receive new employee assignments.'),
      { status: 400 }
    );
  }

  const toJob = await resolveJobPositionTitle(toPositionId);

  const placementType =
    movementType === 'department_change' || movementType === 'branch_change'
      ? 'transfer'
      : movementType === 'position_change'
        ? 'promotion'
        : movementType;

  if (placementType === 'transfer' && fromDepartmentId === toDepartmentId) {
    throw Object.assign(
      new Error('Transfer requires a different department. Use position change for same-department role updates.'),
      { status: 400 }
    );
  }
  if (placementType === 'promotion' || movementType === 'demotion') {
    if (fromDepartmentId === toDepartmentId && fromPositionId === toPositionId) {
      throw Object.assign(new Error('Role change requires a new position or department'), { status: 400 });
    }
  }

  const structure = await loadSalaryStructureForEmployeeId(String(emp.id));
  const fromBaseSalary = parseSalary(structure?.base_salary);
  const fromCurrency = String(structure?.currency || 'USD').toUpperCase();
  const salaryChange = resolveOptionalSalaryChange({
    fromBaseSalary,
    fromCurrency,
    toBaseSalary: input.toBaseSalary,
    toCurrency: input.toCurrency,
    requireChange: false,
  });

  if (salaryChange.toBaseSalary != null) {
    await assertSalaryWithinPositionRange(
      toPositionId,
      salaryChange.toBaseSalary,
      input.toCurrency
    );
  }

  const assignedApprovers = await resolveAssignedApproversForCreate({
    assignedApproverUserIds: input.assignedApproverUserIds,
    assignedApproverUserId: input.assignedApproverUserId,
    saveAsDraft: input.saveAsDraft,
    createdBy: input.createdBy ?? null,
  });
  const now = new Date().toISOString();
  const id = `mov-${Date.now()}`;

  const row = await EmployeeMovement.create({
    id,
    employee_pk: String(emp.id),
    employee_id: canonicalEmployeeId,
    movement_type: movementType,
    effective_date: effectiveIso,
    from_department_id: fromDepartmentId,
    to_department_id: toDepartmentId,
    from_position_id: fromPositionId,
    to_position_id: toPositionId,
    from_job_position: fromJob,
    to_job_position: toJob,
    from_reporting_manager_id: null,
    to_reporting_manager_id: null,
    from_base_salary: salaryChange.fromBaseSalary,
    to_base_salary: salaryChange.toBaseSalary,
    from_currency: salaryChange.fromCurrency,
    to_currency: salaryChange.toCurrency,
    notes: input.notes ? String(input.notes).trim() : null,
    source_appraisal_id: sourceAppraisalId,
    source_probation_review_id: sourceProbationReviewId,
    status: input.saveAsDraft ? 'draft' : 'pending_approval',
    assigned_approver_user_id: assignedApprovers[0] ?? null,
    created_by: input.createdBy || null,
    created_at: now,
    applied_at: null,
  });

  await persistMovementApproversOnCreate(id, assignedApprovers);

  if (input.saveAsDraft) {
    const name = resolveEmployeeRecordName(emp);
    return serializeMovement(row, { employeeName: name });
  }

  const name = resolveEmployeeRecordName(emp);
  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(String(row.get('id')));
  return serializeMovement(row, { employeeName: name });
}

type ResolvedSalaryChange = {
  fromBaseSalary: number | null;
  toBaseSalary: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
};

function resolveOptionalSalaryChange(input: {
  fromBaseSalary: number | null;
  fromCurrency: string;
  toBaseSalary?: number | null;
  toCurrency?: string;
  requireChange: boolean;
}): ResolvedSalaryChange {
  const fromBaseSalary = input.fromBaseSalary;
  const fromCurrency = input.fromCurrency;
  const rawTarget = input.toBaseSalary;
  if (rawTarget === null || rawTarget === undefined || rawTarget === ('' as unknown)) {
    if (input.requireChange) {
      throw Object.assign(new Error('New base salary must be greater than zero'), { status: 400 });
    }
    return { fromBaseSalary: null, toBaseSalary: null, fromCurrency: null, toCurrency: null };
  }

  const toBaseSalary = parseSalary(rawTarget);
  if (toBaseSalary === null || toBaseSalary <= 0) {
    throw Object.assign(new Error('New base salary must be greater than zero'), { status: 400 });
  }

  const current = fromBaseSalary ?? 0;
  if (Math.abs(toBaseSalary - current) < 0.005) {
    if (input.requireChange) {
      throw Object.assign(
        new Error('New salary must differ from the current base salary'),
        { status: 400 }
      );
    }
    return { fromBaseSalary: null, toBaseSalary: null, fromCurrency: null, toCurrency: null };
  }

  const toCurrency = String(input.toCurrency || fromCurrency).toUpperCase();
  if (!['USD', 'KHR'].includes(toCurrency)) {
    throw Object.assign(new Error('Currency must be USD or KHR'), { status: 400 });
  }

  return {
    fromBaseSalary: fromBaseSalary,
    toBaseSalary,
    fromCurrency,
    toCurrency,
  };
}

async function assertSalaryWithinPositionRange(
  positionId: string | null | undefined,
  baseSalary: number,
  currency?: string | null
): Promise<void> {
  let amountUsd = Number(baseSalary);
  if (String(currency || 'USD').toUpperCase() === 'KHR') {
    const { getPayrollExchangeRateKhrPerUsd } = await import('./payrollExchangeRateService.js');
    const rate = await getPayrollExchangeRateKhrPerUsd();
    amountUsd = Math.round((amountUsd / rate) * 100) / 100;
  }
  const err = await validateEmployeeSalaryForPosition(positionId, amountUsd);
  if (err) throw Object.assign(new Error(err), { status: 400 });
}

async function createSalaryUpdateMovement(
  emp: any,
  employeeId: string,
  fromDepartmentId: string,
  fromPositionId: string,
  fromJob: string | null,
  input: {
    effectiveDate: string;
    toBaseSalary?: number;
    toCurrency?: string;
    notes?: string;
    changeReason?: string;
    sourceAppraisalId?: string | null;
    sourceProbationReviewId?: string | null;
    createdBy?: string;
    submitterRole?: string;
    saveAsDraft?: boolean;
    assignedApproverUserId?: string | null;
    assignedApproverUserIds?: string[] | null;
  }
): Promise<EmployeeMovementDto> {
  const structure = await loadSalaryStructureForEmployeeId(String(emp.id));
  const fromBaseSalary = parseSalary(structure?.base_salary) ?? 0;
  const fromCurrency = String(structure?.currency || 'USD').toUpperCase();

  const salaryChange = resolveOptionalSalaryChange({
    fromBaseSalary,
    fromCurrency,
    toBaseSalary: input.toBaseSalary,
    toCurrency: input.toCurrency,
    requireChange: true,
  });
  const { toBaseSalary, toCurrency } = salaryChange;
  if (toBaseSalary === null || toCurrency === null) {
    throw Object.assign(new Error('New base salary must be greater than zero'), { status: 400 });
  }

  await assertSalaryWithinPositionRange(fromPositionId, toBaseSalary, input.toCurrency);

  const assignedApprovers = await resolveAssignedApproversForCreate({
    assignedApproverUserIds: input.assignedApproverUserIds,
    assignedApproverUserId: input.assignedApproverUserId,
    saveAsDraft: input.saveAsDraft,
    createdBy: input.createdBy ?? null,
  });
  const effectiveIso = endOfDayIso(input.effectiveDate);
  const now = new Date().toISOString();
  const id = `mov-${Date.now()}`;

  const row = await EmployeeMovement.create({
    id,
    employee_pk: String(emp.id),
    employee_id: employeeId,
    movement_type: 'salary_update',
    effective_date: effectiveIso,
    from_department_id: fromDepartmentId,
    to_department_id: fromDepartmentId,
    from_position_id: fromPositionId,
    to_position_id: fromPositionId,
    from_job_position: fromJob,
    to_job_position: fromJob,
    from_reporting_manager_id: null,
    to_reporting_manager_id: null,
    from_base_salary: salaryChange.fromBaseSalary,
    to_base_salary: salaryChange.toBaseSalary,
    from_currency: salaryChange.fromCurrency,
    to_currency: salaryChange.toCurrency,
    notes: input.notes ? String(input.notes).trim() : null,
    source_appraisal_id: input.sourceAppraisalId?.trim() || null,
    source_probation_review_id: input.sourceProbationReviewId?.trim() || null,
    status: input.saveAsDraft ? 'draft' : 'pending_approval',
    assigned_approver_user_id: assignedApprovers[0] ?? null,
    created_by: input.createdBy || null,
    created_at: now,
    applied_at: null,
  });

  await persistMovementApproversOnCreate(id, assignedApprovers);

  if (input.saveAsDraft) {
    const name = resolveEmployeeRecordName(emp);
    return serializeMovement(row, { employeeName: name });
  }

  const name = resolveEmployeeRecordName(emp);
  const { tryAutoLinkMovementToAppraisal } = await import('./appraisal/appraisalMovementLinkService.js');
  await tryAutoLinkMovementToAppraisal(String(row.get('id')));
  return serializeMovement(row, { employeeName: name });
}

export async function cancelEmployeeMovement(id: string): Promise<EmployeeMovementDto> {
  const row: any = await EmployeeMovement.findByPk(id);
  if (!row) {
    throw Object.assign(new Error('Movement not found'), { status: 404 });
  }
  const plain = row.get({ plain: true });
  if (
    plain.applied_at ||
    String(plain.status).toLowerCase() === 'applied' ||
    (String(plain.status).toLowerCase() === 'completed' && plain.applied_at)
  ) {
    throw Object.assign(
      new Error('Cannot cancel a movement that has already been applied'),
      { status: 400 }
    );
  }
  await row.update({ status: 'cancelled' });
  await writeWorkflowStatusAudit({
    entityType: 'employee_movement',
    entityId: id,
    previousStatus: String(plain.status ?? 'unknown'),
    nextStatus: 'cancelled',
    reason: 'Movement cancelled',
  });
  return serializeMovement(row);
}
