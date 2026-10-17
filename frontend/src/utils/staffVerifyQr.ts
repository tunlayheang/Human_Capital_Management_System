/** Build hash-router URL for staff ID verification (opened by scanning the employee card QR). */
export function buildStaffVerifyUrl(employeeDisplayId: string, origin = window.location.origin): string {
  const id = String(employeeDisplayId ?? '').trim();
  const base = origin.replace(/\/$/, '');
  const basePath = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const prefix = basePath && basePath !== '/' ? `${base}${basePath}` : base;
  return `${prefix}/#/verify/${encodeURIComponent(id)}`;
}
