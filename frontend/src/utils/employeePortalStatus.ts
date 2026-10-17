/** Employee HR statuses that block portal sign-in and user-account activation. */
export function isEmployeeInactiveForPortal(status: string | null | undefined): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return (
    s === 'inactive' ||
    s === 'terminated' ||
    s === 'resigned' ||
    s === 'absconded' ||
    s === 'retired'
  );
}

export function isEmployeeDraftStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'draft' || s === 'profile_incomplete';
}

/** Only Active employees may use the system. */
export function isEmployeeAllowedSystemAccess(status: string | null | undefined): boolean {
  return (
    String(status ?? '')
      .trim()
      .toLowerCase() === 'active'
  );
}

export function effectiveUserIsActive(
  userIsActive: boolean | undefined,
  employeeStatus: string | null | undefined,
  userStatus?: string | null
): boolean {
  const portalStatus = String(userStatus ?? '')
    .trim()
    .toUpperCase();
  if (
    portalStatus === 'FROZEN' ||
    portalStatus === 'INACTIVE' ||
    portalStatus === 'DISABLED'
  ) {
    return false;
  }
  if (isEmployeeInactiveForPortal(employeeStatus)) return false;
  if (isEmployeeDraftStatus(employeeStatus)) return false;
  // Linked employee records must be Active; unlinked system accounts keep portal flag.
  if (employeeStatus != null && String(employeeStatus).trim() !== '') {
    if (!isEmployeeAllowedSystemAccess(employeeStatus)) return false;
  }
  return userIsActive !== false;
}
