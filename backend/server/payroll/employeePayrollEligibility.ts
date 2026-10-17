import { findEmployeeByUserId } from '../employeeAttendanceSchedule.js';
import { normalizeAccessRole } from '../accessRole.js';
import { toDateKey } from './dateKey.js';

/** Portal roles that are system accounts only — never on payroll runs. */
const PAYROLL_EXCLUDED_PORTAL_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

export function isPortalUserExcludedFromPayroll(role: unknown): boolean {
  return PAYROLL_EXCLUDED_PORTAL_ROLES.has(String(role ?? '').trim().toUpperCase());
}

/** Employee HR records with system access role Admin are not payroll staff. */
export function isEmployeeRecordExcludedFromPayroll(
  employee: Record<string, unknown>
): boolean {
  return normalizeAccessRole(employee.access_role ?? employee.accessRole) === 'ADMIN';
}

/**
 * Payroll cohort = active employees in the employee list with a portal login,
 * excluding system administrator accounts (user-only admins).
 */
export function isEligibleForPayrollRun(params: {
  employee: Record<string, unknown>;
  portalUser?: { role?: unknown } | null;
}): boolean {
  const status = normalizeEmployeeStatus(params.employee.status);
  if (status !== 'active' && status !== 'pending_approval') return false;
  if (isEmployeeRecordExcludedFromPayroll(params.employee)) return false;
  if (params.portalUser && isPortalUserExcludedFromPayroll(params.portalUser.role)) {
    return false;
  }
  return true;
}

export type EmployeeLifecycleStatus =
  | 'active'
  | 'draft'
  | 'profile_incomplete'
  | 'resigned'
  | 'terminated'
  | 'suspended'
  | 'inactive'
  | 'pending_approval'
  | 'absconded'
  | 'retired';

export type InvestigationStatus =
  | 'POTENTIAL_ABANDONMENT'
  | 'UNDER_INVESTIGATION'
  | 'ABSCONDED'
  | null;

export class EmployeePayrollBoundaryError extends Error {
  statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'EmployeePayrollBoundaryError';
  }
}

export function normalizeEmployeeStatus(status: unknown): EmployeeLifecycleStatus {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  if (
    s === 'draft' ||
    s === 'profile_incomplete' ||
    s === 'resigned' ||
    s === 'terminated' ||
    s === 'suspended' ||
    s === 'inactive' ||
    s === 'pending_approval' ||
    s === 'absconded' ||
    s === 'retired' ||
    s === 'active'
  ) {
    return s as EmployeeLifecycleStatus;
  }
  // Unknown / missing status must not be treated as Active (drafts must stay out of payroll).
  if (!s) return 'draft';
  return 'inactive';
}

export function normalizeInvestigationStatus(raw: unknown): InvestigationStatus {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'POTENTIAL_ABANDONMENT' || s === 'UNDER_INVESTIGATION' || s === 'ABSCONDED') {
    return s as InvestigationStatus;
  }
  return null;
}

/** Payroll boundary — last valid working date preferred over last working date. */
export function resolveLastWorkingDate(employee: Record<string, unknown> | null): string | null {
  if (!employee) return null;
  return (
    toDateKey(employee.last_valid_working_date ?? employee.lastValidWorkingDate) ??
    toDateKey(employee.last_working_date ?? employee.lastWorkingDate) ??
    toDateKey(employee.terminated_at ?? employee.terminatedAt)
  );
}

export function isOffboardedStatus(status: unknown): boolean {
  const s = normalizeEmployeeStatus(status);
  return (
    s === 'resigned' ||
    s === 'terminated' ||
    s === 'inactive' ||
    s === 'absconded' ||
    s === 'retired'
  );
}

export function isAbscondedStatus(status: unknown): boolean {
  return normalizeEmployeeStatus(status) === 'absconded';
}

/** Active employees under abandonment review — OT / attendance allowance paused until resolved. */
export function blocksOtAndAllowances(employee: Record<string, unknown> | null): boolean {
  if (!employee) return false;
  if (normalizeEmployeeStatus(employee.status) !== 'active') return false;
  const inv = normalizeInvestigationStatus(
    employee.investigation_status ?? employee.investigationStatus
  );
  return inv === 'POTENTIAL_ABANDONMENT' || inv === 'UNDER_INVESTIGATION';
}

export async function getEmployeeByPortalUserId(userId: string) {
  const row = await findEmployeeByUserId(userId);
  if (!row) return null;
  return row.get ? row.get({ plain: true }) : row;
}

/** Attendance must not be recorded after absconded/offboard or after last working date. */
export async function assertEligibleForAttendanceOnDate(
  userId: string,
  workDate: string
): Promise<void> {
  const employee = await getEmployeeByPortalUserId(userId);
  if (!employee) return;

  const status = normalizeEmployeeStatus(employee.status);
  if (status !== 'active') {
    if (status === 'draft' || status === 'profile_incomplete') {
      throw new EmployeePayrollBoundaryError(
        'Draft employees cannot record attendance until activated.'
      );
    }
    if (status === 'pending_approval') {
      throw new EmployeePayrollBoundaryError(
        'Only Active employees can record attendance.'
      );
    }
    if (status === 'suspended') {
      throw new EmployeePayrollBoundaryError('Employee is suspended — attendance is not allowed.');
    }
    if (isOffboardedStatus(status)) {
      throw new EmployeePayrollBoundaryError(
        'Employee is separated — attendance cannot be recorded.'
      );
    }
    throw new EmployeePayrollBoundaryError(
      'Only Active employees can record attendance.'
    );
  }

  const lwd = resolveLastWorkingDate(employee);
  const date = workDate.slice(0, 10);
  if (lwd && date > lwd) {
    throw new EmployeePayrollBoundaryError(
      `Attendance cannot be recorded after last valid working date (${lwd}).`
    );
  }
}

export async function assertEligibleForOvertime(userId: string): Promise<void> {
  const employee = await getEmployeeByPortalUserId(userId);
  if (!employee) return;
  const status = normalizeEmployeeStatus(employee.status);
  if (status === 'draft' || status === 'profile_incomplete') {
    throw new EmployeePayrollBoundaryError(
      'Overtime is not allowed for draft employees until activated.'
    );
  }
  if (blocksOtAndAllowances(employee)) {
    throw new EmployeePayrollBoundaryError(
      'Overtime is not allowed while employee is under abandonment review or separated.'
    );
  }
}

export async function assertEligibleForLeaveRequest(userId: string): Promise<void> {
  const employee = await getEmployeeByPortalUserId(userId);
  if (!employee) return;
  const status = normalizeEmployeeStatus(employee.status);
  if (status === 'draft' || status === 'profile_incomplete') {
    throw new EmployeePayrollBoundaryError(
      'Leave requests are not allowed for draft employees until activated.'
    );
  }
  if (isOffboardedStatus(status)) {
    throw new EmployeePayrollBoundaryError('Leave requests are not allowed for separated employees.');
  }
  if (isAbscondedStatus(status)) {
    throw new EmployeePayrollBoundaryError('Leave requests are not allowed for absconded employees.');
  }
}

export function filterRecordsThroughLastWorkingDate<T extends { date?: string }>(
  records: T[],
  lastWorkingDate: string | null
): T[] {
  if (!lastWorkingDate) return records;
  const lwd = lastWorkingDate.slice(0, 10);
  return records.filter((r) => String(r.date ?? '').slice(0, 10) <= lwd);
}
