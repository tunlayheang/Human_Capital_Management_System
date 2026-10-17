import type { EmployeeFormValues } from '../pages/EmployeeInput';
import type { ActivationCheckOptions } from './employeeActivation';
import {
  activationBlockersExtended,
  collectActivationIssueDetails,
  isEmployeeProfileReadyForActive,
} from './employeeActivation';
export type { ActivationFieldErrors, ActivationIssueDetails } from './employeeActivation';
export { collectActivationIssueDetails };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlaceholderDraftEmail(email: unknown): boolean {
  return String(email ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@pending.iroc');
}

export function hasValidWorkEmail(email: unknown): boolean {
  const value = String(email ?? '').trim();
  if (!value || isPlaceholderDraftEmail(value)) return false;
  return EMAIL_RE.test(value);
}

export function hasValidEmployeePhone(phone: unknown): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 8;
}

/** Phones auto-filled for draft rows (9 + last 8 digits of employee id). */
export function isLikelyDraftPlaceholderPhone(phone: unknown, employeeId?: unknown): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!/^9\d{8}$/.test(digits)) return false;
  const slug = String(employeeId ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const fromId = slug.replace(/\D/g, '').slice(-8).padStart(8, '0');
  return digits === `9${fromId}`;
}

export function isEmployeeFormComplete(
  values: EmployeeFormValues,
  options?: ActivationCheckOptions
): boolean {
  return isEmployeeProfileReadyForActive(values, options);
}

export function activationBlockers(
  values: EmployeeFormValues,
  options?: ActivationCheckOptions
): string[] {
  return activationBlockersExtended(values, options);
}

export function canSaveDraft(values: Pick<EmployeeFormValues, 'firstName' | 'lastName' | 'id'>): boolean {
  const hasName =
    String(values.firstName ?? '').trim().length > 0 ||
    String(values.lastName ?? '').trim().length > 0;
  const hasId = String(values.id ?? '').trim().length > 0;
  return hasName || hasId;
}

export function isDraftEmployeeStatus(status: string | undefined | null): boolean {
  const normalized = normalizeEmployeeLifecycleStatus(status);
  return normalized === 'draft';
}

/** @deprecated Use isDraftEmployeeStatus — legacy profile_incomplete is treated as draft. */
export function isIncompleteProfileStatus(status: string | undefined | null): boolean {
  return isDraftEmployeeStatus(status);
}

/** Draft onboarding progress that is not yet activatable. */
export function isOnboardingInProgressStatus(status: string | undefined | null): boolean {
  return isDraftEmployeeStatus(status);
}

export function normalizeEmployeeLifecycleStatus(status: unknown): string {
  const normalized = String(status ?? 'active')
    .trim()
    .toLowerCase();
  if (normalized === 'profile_incomplete') return 'draft';
  return normalized || 'active';
}

/** UI badge: use stored lifecycle status from the server (no client-side completeness override). */
export function effectiveEmployeeStatus(
  dbStatus: string | undefined | null,
  _email?: unknown
): string {
  const normalized = normalizeEmployeeLifecycleStatus(dbStatus);
  return normalized || 'active';
}

const OFFBOARDED_EMPLOYEE_STATUSES = new Set([
  'inactive',
  'terminated',
  'resigned',
  'absconded',
  'retired',
  'suspended',
]);

export function isOffboardedEmployeeStatus(status: string | undefined | null): boolean {
  return OFFBOARDED_EMPLOYEE_STATUSES.has(normalizeEmployeeLifecycleStatus(status));
}
