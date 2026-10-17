/**
 * Org-wide project list (management view). Admin/HR only.
 * Managers see their own (lead/assigned); staff see assigned projects — both via the API.
 */
export function canViewAllProjects(role: string | undefined): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'ADMIN' || r === 'HR' || r === 'SUPER_ADMIN';
}
