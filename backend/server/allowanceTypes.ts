/** Canonical allowance type codes used by the payroll allowance engine. */
export const ALLOWANCE_TYPE_CODES = {
  ATTENDANCE: 'ATTENDANCE',
  MEAL: 'MEAL',
  TRANSPORT: 'TRANSPORT',
  POSITION: 'POSITION',
  SENIORITY: 'SENIORITY',
  COMMISSION: 'COMMISSION',
  OT_MEAL: 'OT_MEAL',
  OTHER: 'OTHER',
} as const;

export type AllowanceTypeCode = (typeof ALLOWANCE_TYPE_CODES)[keyof typeof ALLOWANCE_TYPE_CODES];

/** Legacy allowance catalog code — payroll uses Seniority Rules engine instead. */
export function isLegacySeniorityAllowanceCode(code: string | null | undefined): boolean {
  return String(code ?? '').toUpperCase() === ALLOWANCE_TYPE_CODES.SENIORITY;
}

/** Retired — organizations provide OT meals physically; not a payroll allowance. */
export function isRetiredOtMealAllowanceCode(code: string | null | undefined): boolean {
  return String(code ?? '').toUpperCase() === ALLOWANCE_TYPE_CODES.OT_MEAL;
}

export const ALLOWANCE_CALCULATION_TYPES = [
  'fixed',
  'conditional',
  'formula',
  'percentage',
  'attendance_based',
  'overtime_based',
  'seniority_based',
  'commission_based',
] as const;

export type AllowanceCalculationType = (typeof ALLOWANCE_CALCULATION_TYPES)[number];

export const ALLOWANCE_CATEGORIES = [
  'fixed',
  'attendance',
  'position',
  'seniority',
  'overtime',
  'commission',
] as const;

export type AllowanceCategory = (typeof ALLOWANCE_CATEGORIES)[number];

/** Maps type code → legacy payslip breakdown allowance field. */
export const LEGACY_ALLOWANCE_FIELD_BY_CODE: Record<
  string,
  'transport' | 'attendance' | 'meal' | 'seniority' | 'position' | 'commission' | 'otMeal'
> = {
  TRANSPORT: 'transport',
  MEAL: 'meal',
  ATTENDANCE: 'attendance',
  SENIORITY: 'seniority',
  POSITION: 'position',
  COMMISSION: 'commission',
  OT_MEAL: 'otMeal',
};
