import { Department, Employee, Position } from './db.js';
import { employeeLookupWhere } from './employeeIdFormat.js';
import { joinEmployeeNameParts } from './employeeDisplayName.js';
import { isEmployeeAllowedSystemAccess } from './employeePortalStatus.js';
import { loadPortalBrandingPublic } from './organizationSettingsService.js';

export type StaffVerifyPublicDto = {
  verified: boolean;
  employeeId: string;
  nameEn: string;
  nameKh: string;
  positionTitle: string;
  departmentName: string;
  avatarUrl: string | null;
  status: string;
  isActiveStaff: boolean;
  companyName: string;
  companyLogo: string;
};

/**
 * Public-safe staff verification payload for ID-card QR scans.
 * Never includes phone, email, salary, or other PII beyond workplace identity.
 */
export async function loadStaffVerifyPublic(
  rawEmployeeId: string
): Promise<StaffVerifyPublicDto | null> {
  const key = String(rawEmployeeId ?? '').trim();
  if (!key) return null;

  const emp: any = await Employee.findOne({
    where: employeeLookupWhere(key) as any,
    attributes: [
      'id',
      'employee_id',
      'first_name',
      'last_name',
      'first_name_kh',
      'last_name_kh',
      'avatar_url',
      'status',
      'job_position',
    ],
    include: [
      { model: Department, as: 'department', attributes: ['id', 'name', 'name_kh'], required: false },
      { model: Position, as: 'position', attributes: ['id', 'title', 'title_kh'], required: false },
    ],
  });

  if (!emp) return null;

  const status = String(emp.status ?? '').trim().toLowerCase();
  // Hide incomplete onboarding profiles from public scanners
  if (status === 'draft' || status === 'profile_incomplete') return null;

  const branding = await loadPortalBrandingPublic();
  const nameEn =
    joinEmployeeNameParts(emp.first_name, emp.last_name).toUpperCase() || '—';
  const nameKh = joinEmployeeNameParts(emp.first_name_kh, emp.last_name_kh) || '';
  const positionTitle =
    String(emp.position?.title ?? emp.job_position ?? '').trim() || '—';
  const departmentName =
    String(emp.department?.name ?? emp.department?.name_kh ?? '').trim() || '—';
  const isActiveStaff = isEmployeeAllowedSystemAccess(status);

  return {
    verified: isActiveStaff,
    employeeId: String(emp.employee_id ?? key).trim(),
    nameEn,
    nameKh,
    positionTitle,
    departmentName,
    avatarUrl: emp.avatar_url ? String(emp.avatar_url).trim() : null,
    status: status || 'unknown',
    isActiveStaff,
    companyName: branding.companyName || 'Company',
    companyLogo: branding.logo || '',
  };
}
