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

/** Draft / incomplete onboarding — not yet an Active employee. */
export function isEmployeeDraftStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'draft' || s === 'profile_incomplete';
}

/**
 * Only Active employees may use the system (login) and appear in operational features.
 * Join date alone never grants access while status is still Draft.
 */
export function isEmployeeAllowedSystemAccess(status: string | null | undefined): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'active';
}

/**
 * Only Active employees appear on admin attendance rosters.
 * Draft, pending approval, inactive, and separated statuses are excluded.
 */
export function isEmployeeEligibleForAttendanceRoster(
  status: string | null | undefined
): boolean {
  // Missing status must not default to Active.
  if (status == null || String(status).trim() === '') return false;
  return isEmployeeAllowedSystemAccess(status);
}

/** Whether the employee record allows an active portal user (draft / inactive / terminated do not). */
export function isEmployeeActiveForPortal(status: string | null | undefined): boolean {
  return isEmployeeAllowedSystemAccess(status);
}

/** Chat directory / messaging — only employees with Active HR status. */
export function isEmployeeActiveForChat(status: string | null | undefined): boolean {
  return isEmployeeAllowedSystemAccess(status);
}
