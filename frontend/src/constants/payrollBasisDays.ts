/** Contractual payroll divisor options — keep aligned with backend payrollBasisDaysService. */
export const PAYROLL_BASIS_DAY_OPTIONS = [22, 24, 26] as const;
export type PayrollBasisDaysValue = (typeof PAYROLL_BASIS_DAY_OPTIONS)[number];

export type PayrollWorkDayMethod = 'fixed_employee_basis' | 'fixed_company_basis';

export const PAYROLL_WORK_DAY_METHOD_OPTIONS: Array<{
  value: PayrollWorkDayMethod;
  label: string;
  description: string;
}> = [
  {
    value: 'fixed_employee_basis',
    label: 'Fixed Employee Basis',
    description:
      'Each employee’s payroll basis days (22, 24, or 26) determine the daily salary rate. Attendance metrics come from attendance records only.',
  },
  {
    value: 'fixed_company_basis',
    label: 'Fixed Company Basis',
    description:
      'One company-wide payroll basis applies to all employees. Attendance metrics come from attendance records only.',
  },
];

export const DEFAULT_PAYROLL_BASIS_DAYS: PayrollBasisDaysValue = 26;

export function normalizePayrollBasisDays(raw: unknown): PayrollBasisDaysValue {
  const n = Math.round(Number(raw));
  if (PAYROLL_BASIS_DAY_OPTIONS.includes(n as PayrollBasisDaysValue)) {
    return n as PayrollBasisDaysValue;
  }
  return DEFAULT_PAYROLL_BASIS_DAYS;
}

export function payrollBasisDaysLabel(days: number): string {
  return `${days} Days`;
}
