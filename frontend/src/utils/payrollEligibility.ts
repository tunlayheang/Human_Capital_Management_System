/** System portal accounts are not included in payroll (employee list only). */
export function isPortalUserExcludedFromPayroll(role: unknown): boolean {
  const r = String(role ?? '')
    .trim()
    .toUpperCase();
  return r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'OWNER';
}

export function isEmployeeStatusPayrollEligible(status: unknown): boolean {
  const s = String(status ?? 'active').toLowerCase();
  return s === 'active' || s === 'pending_approval';
}
