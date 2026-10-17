/** Statuses that may be reactivated via Admin restore (matches backend RESTORABLE_STATUSES). */
export const RESTORABLE_EMPLOYEE_STATUSES = [
  'terminated',
  'resigned',
  'absconded',
  'retired',
  'inactive',
  'suspended',
] as const;

export function isRestorableEmployeeStatus(status: string | undefined): boolean {
  const normalized = String(status || '').toLowerCase();
  return (RESTORABLE_EMPLOYEE_STATUSES as readonly string[]).includes(normalized);
}
