import { Employee } from './db.js';
import { employeeLookupWhere } from './employeeIdFormat.js';
import {
  CONTRACT_TYPES,
  EMPLOYMENT_STATUSES,
  type ContractTypeCode,
  type EmploymentStatusCode,
  employmentStatusToEmployeeStatus,
  employeeStatusToEmploymentStatus,
} from './employeeMovementCatalog.js';
import { recordFieldCorrection } from './employeeSensitiveChangeService.js';

const MOVEMENT_ONLY_FIELDS = new Set(['contract_type', 'employment_status']);

export function canUseEmployeeCorrectionMode(role?: string, hasPermission?: (key: string) => boolean): boolean {
  const r = String(role ?? '').toUpperCase();
  if (r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'HR') return true;
  if (hasPermission?.('hr.employee.edit.personal')) return true;
  if (hasPermission?.('hr.employee.correction')) return true;
  if (hasPermission?.('employee.correction')) return true;
  return false;
}

export function assertMovementOnlyFieldsNotDirectlyEdited(params: {
  existing: Record<string, unknown>;
  payload: Record<string, unknown>;
  correctionMode?: boolean;
  actorRole?: string;
  hasPermission?: (key: string) => boolean;
}): void {
  if (params.correctionMode && canUseEmployeeCorrectionMode(params.actorRole, params.hasPermission)) {
    return;
  }

  for (const field of MOVEMENT_ONLY_FIELDS) {
    if (!(field in params.payload)) continue;
    const next = params.payload[field];
    if (next === undefined) continue;
    const prev = existing[field];
    if (String(prev ?? '') === String(next ?? '')) continue;
    throw Object.assign(
      new Error(
        `${field === 'contract_type' ? 'Contract type' : 'Employment status'} can only be changed through an employee movement. Use Correction Mode if you need to fix data.`
      ),
      { status: 403, code: 'MOVEMENT_ONLY_FIELD' }
    );
  }
}

export async function recordEmployeeFieldCorrection(input: {
  employeePk: string;
  employeeId: string;
  fieldName: string;
  previousValue: string | null;
  correctedValue: string | null;
  correctedBy: string | null;
  reason: string;
}): Promise<void> {
  await recordFieldCorrection(input);
}

export function normalizeContractType(raw: unknown): ContractTypeCode | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const match = CONTRACT_TYPES.find((c) => c.toLowerCase() === v.toLowerCase());
  return match ?? (v as ContractTypeCode);
}

export function normalizeEmploymentStatus(raw: unknown): EmploymentStatusCode | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const match = EMPLOYMENT_STATUSES.find((c) => c.toLowerCase() === v.toLowerCase());
  return match ?? (v as EmploymentStatusCode);
}

export async function readEmployeeMetadata(emp: { get?: (o: { plain: boolean }) => unknown }) {
  const plain = (emp.get ? emp.get({ plain: true }) : emp) as Record<string, unknown>;
  const contractType = plain.contract_type ? String(plain.contract_type) : null;
  const employmentStatus =
    plain.employment_status != null && String(plain.employment_status).trim()
      ? String(plain.employment_status)
      : employeeStatusToEmploymentStatus(String(plain.status ?? ''));
  return { contractType, employmentStatus, plain };
}

export async function applyEmploymentStatusToEmployee(
  emp: { update: (v: Record<string, unknown>) => Promise<unknown> },
  status: EmploymentStatusCode
): Promise<void> {
  await emp.update({
    employment_status: status,
    status: employmentStatusToEmployeeStatus(status),
    updated_at: new Date(),
  });
}

export async function applyContractTypeToEmployee(
  emp: { update: (v: Record<string, unknown>) => Promise<unknown> },
  contractType: ContractTypeCode
): Promise<void> {
  await emp.update({
    contract_type: contractType,
    updated_at: new Date(),
  });
}

export async function applyEmployeeMetadataCorrection(input: {
  employeeId: string;
  fieldName: 'contract_type' | 'employment_status';
  correctedValue: string;
  reason: string;
  correctedBy: string | null;
}): Promise<void> {
  const emp: any = await Employee.findOne({ where: employeeLookupWhere(input.employeeId) as never });
  if (!emp) {
    throw Object.assign(new Error('Employee not found'), { status: 404 });
  }
  const { contractType, employmentStatus } = await readEmployeeMetadata(emp);
  const prev =
    input.fieldName === 'contract_type' ? contractType : employmentStatus;

  if (input.fieldName === 'contract_type') {
    const next = normalizeContractType(input.correctedValue);
    if (!next) throw Object.assign(new Error('Invalid contract type'), { status: 400 });
    await applyContractTypeToEmployee(emp, next);
  } else {
    const next = normalizeEmploymentStatus(input.correctedValue);
    if (!next) throw Object.assign(new Error('Invalid employment status'), { status: 400 });
    await applyEmploymentStatusToEmployee(emp, next);
  }

  await recordEmployeeFieldCorrection({
    employeePk: String(emp.id),
    employeeId: input.employeeId,
    fieldName: input.fieldName,
    previousValue: prev,
    correctedValue: input.correctedValue,
    correctedBy: input.correctedBy,
    reason: input.reason,
  });
}
