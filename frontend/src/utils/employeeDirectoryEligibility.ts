import { isDraftEmployeeStatus, isPlaceholderDraftEmail } from './employeeDraft';

/** HR badge code assigned — excludes draft rows and @pending.iroc placeholders. */
export function hasAssignedEmployeeDisplayId(row: {
  employee_id?: string | null;
  employeeId?: string | null;
  status?: string | null;
  email?: string | null;
}): boolean {
  const code = String(row.employee_id ?? row.employeeId ?? '').trim();
  if (!code) return false;
  if (isDraftEmployeeStatus(row.status)) return false;
  if (isPlaceholderDraftEmail(row.email)) return false;
  return true;
}

export function filterEmployeesWithAssignedDisplayId<
  T extends {
    employee_id?: string | null;
    employeeId?: string | null;
    status?: string | null;
    email?: string | null;
  },
>(rows: T[]): T[] {
  return rows.filter((row) => hasAssignedEmployeeDisplayId(row));
}
