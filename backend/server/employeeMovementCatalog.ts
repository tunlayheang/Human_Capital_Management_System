/** Canonical movement lifecycle (API / UI). */
export type MovementCanonicalStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'applied'
  | 'cancelled'
  | 'returned'
  | 'rejected';

/** Stored in DB — legacy values remain readable. */
export type MovementStoredStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'approved'
  | 'completed'
  | 'applied'
  | 'cancelled'
  | 'returned'
  | 'rejected';

export const MOVEMENT_CANONICAL_STATUSES: MovementCanonicalStatus[] = [
  'draft',
  'pending',
  'approved',
  'applied',
  'cancelled',
  'returned',
  'rejected',
];

export const MOVEMENT_TYPES = [
  'transfer',
  'promotion',
  'demotion',
  'salary_increase',
  'salary_adjustment',
  'salary_update',
  'employment_status_change',
  'contract_type_change',
  'department_change',
  'position_change',
  'branch_change',
] as const;

export type MovementTypeCode = (typeof MOVEMENT_TYPES)[number];

export const CONTRACT_TYPES = [
  'Permanent',
  'Fixed-Term Contract',
  'Probation',
  'Intern',
  'Part-Time',
  'Temporary',
  'Consultant',
  // legacy payroll codes
  'UDC',
  'FDC',
] as const;

export type ContractTypeCode = (typeof CONTRACT_TYPES)[number];

export const EMPLOYMENT_STATUSES = [
  'Probation',
  'Active',
  'Resigned',
  'Terminated',
  'Suspended',
  'Retired',
  'Inactive',
] as const;

export type EmploymentStatusCode = (typeof EMPLOYMENT_STATUSES)[number];

export function normalizeMovementType(raw: unknown): MovementTypeCode {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (v === 'promotion') return 'promotion';
  if (v === 'demotion') return 'demotion';
  if (v === 'salary_increase' || v === 'pay_increase') return 'salary_increase';
  if (v === 'salary_adjustment' || v === 'salary_update' || v === 'update_salary' || v === 'salary') {
    return 'salary_adjustment';
  }
  if (v === 'employment_status_change' || v === 'status_change') return 'employment_status_change';
  if (v === 'contract_type_change' || v === 'contract_change') return 'contract_type_change';
  if (v === 'department_change') return 'department_change';
  if (v === 'position_change') return 'position_change';
  if (v === 'branch_change') return 'branch_change';
  return 'transfer';
}

export function isSalaryMovementType(type: MovementTypeCode): boolean {
  return type === 'salary_adjustment' || type === 'salary_increase' || type === 'salary_update';
}

export function isPlacementMovementType(type: MovementTypeCode): boolean {
  return (
    type === 'transfer' ||
    type === 'promotion' ||
    type === 'demotion' ||
    type === 'department_change' ||
    type === 'position_change' ||
    type === 'branch_change'
  );
}

export function isMetadataMovementType(type: MovementTypeCode): boolean {
  return type === 'contract_type_change' || type === 'employment_status_change';
}

export function movementTypeLabel(type: MovementTypeCode | string): string {
  const map: Record<string, string> = {
    transfer: 'Transfer',
    promotion: 'Promotion',
    demotion: 'Demotion',
    salary_increase: 'Salary increase',
    salary_adjustment: 'Salary adjustment',
    salary_update: 'Pay change',
    employment_status_change: 'Employment status change',
    contract_type_change: 'Contract type change',
    department_change: 'Department change',
    position_change: 'Position change',
    branch_change: 'Branch change',
  };
  const key = normalizeMovementType(type);
  return map[key] ?? key;
}

/** Map DB row → canonical status for API consumers. */
export function isCanonicalMovementStatus(raw: string): raw is MovementCanonicalStatus {
  return MOVEMENT_CANONICAL_STATUSES.includes(raw as MovementCanonicalStatus);
}

/** When filtering by canonical status, match after DTO mapping (handles legacy DB rows). */
export function parseMovementStatusFilter(
  raw?: string
): { canonical?: MovementCanonicalStatus; dbStatus?: string } {
  if (!raw?.trim()) return {};
  const normalized = raw.trim().toLowerCase();
  if (isCanonicalMovementStatus(normalized)) {
    return { canonical: normalized };
  }
  return { dbStatus: raw.trim() };
}

export function toCanonicalMovementStatus(
  stored: string | null | undefined,
  appliedAt?: string | null
): MovementCanonicalStatus {
  const s = String(stored ?? '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'rejected') return 'rejected';
  if (s === 'returned') return 'returned';
  if (s === 'draft') return 'draft';
  if (s === 'pending' || s === 'pending_approval') return 'pending';
  if (s === 'applied' || (s === 'completed' && appliedAt)) return 'applied';
  if (s === 'approved' || s === 'scheduled') return 'approved';
  if (s === 'completed' && !appliedAt) return 'approved';
  return 'pending';
}

/** Status written when movement is approved but not yet effective. */
export const MOVEMENT_STATUS_APPROVED: MovementStoredStatus = 'approved';

/** Status written after profile application on effective date. */
export const MOVEMENT_STATUS_APPLIED: MovementStoredStatus = 'applied';

export function employmentStatusToEmployeeStatus(status: EmploymentStatusCode): string {
  const map: Record<EmploymentStatusCode, string> = {
    Probation: 'probation',
    Active: 'active',
    Resigned: 'resigned',
    Terminated: 'terminated',
    Suspended: 'suspended',
    Retired: 'retired',
    Inactive: 'inactive',
  };
  return map[status] ?? 'active';
}

export function employeeStatusToEmploymentStatus(status: string | null | undefined): EmploymentStatusCode {
  const s = String(status ?? '').toLowerCase();
  if (s === 'probation') return 'Probation';
  if (s === 'active' || s === 'pending_approval') return 'Active';
  if (s === 'draft' || s === 'profile_incomplete') return 'Inactive';
  if (s === 'resigned') return 'Resigned';
  if (s === 'terminated' || s === 'absconded') return 'Terminated';
  if (s === 'suspended') return 'Suspended';
  if (s === 'retired') return 'Retired';
  return 'Inactive';
}
