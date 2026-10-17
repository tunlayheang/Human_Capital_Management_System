const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/** When true, the user who calculated a run cannot approve or lock it (unless bypassed). */
export function isPayrollMakerCheckerEnforced(): boolean {
  const explicit = process.env.PAYROLL_MAKER_CHECKER;
  if (explicit === 'false' || explicit === '0') return false;
  if (explicit === 'true' || explicit === '1') return true;
  return process.env.NODE_ENV === 'production';
}

export function isPayrollSelfApprovalBlocked(params: {
  calculatedBy: string | null | undefined;
  actorUserId: string;
  actorRole?: string | null;
}): boolean {
  if (!isPayrollMakerCheckerEnforced()) return false;
  const role = String(params.actorRole ?? '').toUpperCase();
  if (ADMIN_ROLES.has(role)) return false;
  const calculatedBy = params.calculatedBy ?? null;
  if (!calculatedBy) return false;
  return String(calculatedBy) === String(params.actorUserId);
}

export const PAYROLL_MAKER_CHECKER_MESSAGE =
  'Maker-checker: the user who calculated payroll cannot approve or lock the same run.';
