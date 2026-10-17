import type { Payslip, PayrollReviewSnapshot, User } from '../../types';
import { isPortalUserExcludedFromPayroll } from '../../utils/payrollEligibility';
import { joinPersonNameParts, resolveEmployeeRecordDisplayName } from '../../utils/personDisplayName';
import { normalizeEmployeeDisplayId } from '../../utils';
import type { Language } from '../../i18n/types';

export type PayrollEmployeeProfile = {
  userId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  firstNameKh?: string;
  lastNameKh?: string;
  email: string;
  phone: string;
  avatarUrl?: string | null;
  displayName: string;
  positionTitle: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  paymentMethod: string;
  departmentId: string;
  departmentName: string;
  taxId: string;
  nssfId: string;
};

type EmployeeRecord = {
  employee_id?: string;
  id?: string;
  first_name?: string;
  last_name?: string;
  first_name_kh?: string;
  last_name_kh?: string;
  email?: string;
  phone?: string;
  avatar_url?: string | null;
  job_position?: string | null;
  position_title?: string | null;
  position_id?: string | null;
  position?: { title?: string | null } | null;
  department_id?: string | null;
  department_name?: string | null;
  department?: { id?: string; name?: string | null } | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  payment_method?: string | null;
  tax_id?: string | null;
  nssf_id?: string | null;
};

function normalizePhone(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

function resolvePositionTitle(employee?: EmployeeRecord | null): string {
  if (!employee) return '—';
  const job = String(employee.job_position ?? '').trim();
  if (job) return job;
  const fromPos = employee.position?.title;
  if (fromPos) return String(fromPos).trim();
  const placement = String(employee.position_title ?? '').trim();
  if (placement) return placement;
  return '—';
}

function resolveBankFields(employee?: EmployeeRecord | null): {
  bankName: string | null;
  bankAccountNumber: string | null;
  paymentMethod: string;
} {
  const bankName = String(employee?.bank_name ?? '').trim() || null;
  const bankAccountNumber = String(employee?.bank_account_number ?? '').trim() || null;
  const paymentMethod = String(employee?.payment_method ?? 'bank').trim() || 'bank';
  return { bankName, bankAccountNumber, paymentMethod };
}

function profileFromUser(user: User, employee?: EmployeeRecord | null): PayrollEmployeeProfile {
  const parts = (user.name || '').trim().split(/\s+/).filter(Boolean);
  // user.name is Khmer order (Last First) when structured fields are missing
  const firstName = employee?.first_name || parts.slice(1).join(' ') || user.name || user.id;
  const lastName = employee?.last_name || parts[0] || '';
  const firstNameKh = String(employee?.first_name_kh ?? '').trim();
  const lastNameKh = String(employee?.last_name_kh ?? '').trim();
  const displayName = joinPersonNameParts(firstName, lastName) || user.id;
  const bank = resolveBankFields(employee);

  return {
    userId: user.id,
    employeeId: normalizeEmployeeDisplayId(employee?.employee_id || employee?.id || user.id),
    firstName,
    lastName,
    firstNameKh: firstNameKh || undefined,
    lastNameKh: lastNameKh || undefined,
    email: employee?.email || user.email || '',
    phone: String(employee?.phone ?? (user as { phone?: string }).phone ?? '').trim(),
    avatarUrl: employee?.avatar_url ?? user.avatarUrl ?? null,
    displayName,
    positionTitle: resolvePositionTitle(employee),
    departmentId: String(employee?.department_id ?? employee?.department?.id ?? '').trim(),
    departmentName:
      String(employee?.department_name ?? employee?.department?.name ?? '').trim() || '—',
    taxId: String(employee?.tax_id ?? '').trim() || '—',
    nssfId: String(employee?.nssf_id ?? '').trim() || '—',
    ...bank,
  };
}

function matchEmployee(user: User, employees: EmployeeRecord[]): EmployeeRecord | null {
  const email = user.email?.toLowerCase().trim();
  const phone = normalizePhone(user.phone);

  for (const emp of employees) {
    const empEmail = String(emp.email || '').toLowerCase().trim();
    const empPhone = normalizePhone(emp.phone);
    if (email && empEmail && email === empEmail) return emp;
    if (phone && empPhone && phone === empPhone) return emp;
    if (emp.employee_id === user.id || emp.id === user.id) return emp;
  }
  return null;
}

export function buildPayrollEmployeeProfiles(
  users: User[],
  employeesResponse: unknown
): Record<string, PayrollEmployeeProfile> {
  const employees: EmployeeRecord[] = Array.isArray(employeesResponse)
    ? (employeesResponse as EmployeeRecord[])
    : (employeesResponse as { employees?: EmployeeRecord[] })?.employees ?? [];

  const map: Record<string, PayrollEmployeeProfile> = {};
  for (const user of users) {
    if (isPortalUserExcludedFromPayroll(user.role)) continue;
    const emp = matchEmployee(user, employees);
    if (!emp) continue;
    map[user.id] = profileFromUser(user, emp);
  }
  return map;
}

/** Profiles only for employees returned by payroll preview / run (engine cohort). */
export function buildPayrollEmployeeProfilesForItems(
  items: Payslip[],
  users: User[],
  employeesResponse: unknown
): Record<string, PayrollEmployeeProfile> {
  const all = buildPayrollEmployeeProfiles(users, employeesResponse);
  const map: Record<string, PayrollEmployeeProfile> = {};
  for (const item of items) {
    const uid = String(item.userId ?? '');
    if (!uid) continue;
    const base = all[uid];
    const snapshot = item.breakdown?.reviewSnapshot;
    if (base) {
      map[uid] = {
        ...base,
        employeeId: normalizeEmployeeDisplayId(item.employeeId || base.employeeId),
        positionTitle: snapshot?.positionTitle || base.positionTitle,
        bankName: snapshot?.bankName ?? base.bankName,
        bankAccountNumber: snapshot?.bankAccountNumber ?? base.bankAccountNumber,
        paymentMethod: snapshot?.paymentMethod ?? base.paymentMethod,
        departmentId: item.breakdown?.reviewContext?.departmentId ?? base.departmentId,
        departmentName:
          item.breakdown?.reviewContext?.departmentName ?? base.departmentName,
        taxId: item.breakdown?.reviewContext?.taxId ?? base.taxId,
        nssfId: item.breakdown?.reviewContext?.nssfId ?? base.nssfId,
      };
    } else {
      map[uid] = getPayrollEmployeeProfile(uid, all, item.employeeId, item.breakdown?.reviewSnapshot);
    }
  }
  return map;
}

export function formatBankDisplay(profile: Pick<
  PayrollEmployeeProfile,
  'bankName' | 'bankAccountNumber' | 'paymentMethod'
>): string {
  if (profile.paymentMethod && profile.paymentMethod !== 'bank') {
    return profile.paymentMethod.replace(/_/g, ' ');
  }
  if (profile.bankName && profile.bankAccountNumber) {
    return `${profile.bankName} · ${profile.bankAccountNumber}`;
  }
  if (profile.bankAccountNumber) return profile.bankAccountNumber;
  if (profile.bankName) return profile.bankName;
  return '—';
}

export function getPayrollEmployeeProfile(
  userId: string,
  profiles: Record<string, PayrollEmployeeProfile>,
  employeeIdHint?: string,
  reviewSnapshot?: PayrollReviewSnapshot
): PayrollEmployeeProfile {
  const fromUser = profiles[userId];
  if (fromUser) {
    const merged = employeeIdHint
      ? {
          ...fromUser,
          employeeId: normalizeEmployeeDisplayId(employeeIdHint || fromUser.employeeId),
        }
      : { ...fromUser };
    if (reviewSnapshot) {
      merged.positionTitle = reviewSnapshot.positionTitle || merged.positionTitle;
      merged.bankName = reviewSnapshot.bankName ?? merged.bankName;
      merged.bankAccountNumber = reviewSnapshot.bankAccountNumber ?? merged.bankAccountNumber;
      merged.paymentMethod = reviewSnapshot.paymentMethod ?? merged.paymentMethod;
    }
    return merged;
  }
  return {
    userId,
    employeeId: normalizeEmployeeDisplayId(employeeIdHint || userId),
    firstName: userId,
    lastName: '',
    email: '',
    phone: '',
    displayName: userId,
    positionTitle: reviewSnapshot?.positionTitle ?? '—',
    bankName: reviewSnapshot?.bankName ?? null,
    bankAccountNumber: reviewSnapshot?.bankAccountNumber ?? null,
    paymentMethod: reviewSnapshot?.paymentMethod ?? 'bank',
    departmentId: '',
    departmentName: '—',
    taxId: '—',
    nssfId: '—',
  };
}

export function payrollEmployeeLocalizedName(
  profile: Pick<
    PayrollEmployeeProfile,
    'firstName' | 'lastName' | 'firstNameKh' | 'lastNameKh' | 'displayName'
  >,
  language: Language = 'en'
): string {
  return resolveEmployeeRecordDisplayName(profile, language);
}
