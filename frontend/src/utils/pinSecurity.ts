import { Role } from '../types';

/** All portal roles — PIN lock is mandatory (including Admin). */
export const PIN_PORTAL_ROLES: string[] = [
  Role.ADMIN,
  Role.HR,
  Role.MANAGER,
  Role.EMPLOYEE,
  'SUPER_ADMIN',
  'APPLICANT',
];

export const PIN_REQUIRED_ROLES = PIN_PORTAL_ROLES;

export const isPinMandatoryRole = (role?: Role | string) => {
  if (!role) return false;
  const r = String(role).trim().toUpperCase();
  return PIN_PORTAL_ROLES.map((x) => String(x).toUpperCase()).includes(r);
};
