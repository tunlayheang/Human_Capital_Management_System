import type { SeniorityIndemnitySalaryComponent } from './seniorityIndemnityTypes.js';

export type SalaryBasisInput = {
  baseSalary: number;
  positionAllowance?: number;
  responsibilityAllowance?: number;
  fixedAllowance?: number;
  commission?: number;
  otherRecurring?: number;
};

export function resolveSeniorityIndemnitySalaryBasisUsd(
  components: SeniorityIndemnitySalaryComponent[],
  input: SalaryBasisInput
): number {
  let total = 0;
  for (const c of components) {
    switch (c) {
      case 'base_salary':
        total += Number(input.baseSalary) || 0;
        break;
      case 'position_allowance':
        total += Number(input.positionAllowance) || 0;
        break;
      case 'responsibility_allowance':
        total += Number(input.responsibilityAllowance) || 0;
        break;
      case 'fixed_allowance':
        total += Number(input.fixedAllowance) || 0;
        break;
      case 'commission':
        total += Number(input.commission) || 0;
        break;
      case 'other_recurring':
        total += Number(input.otherRecurring) || 0;
        break;
      default:
        break;
    }
  }
  return Math.round(total * 100) / 100;
}

export function salaryBasisFromAllowanceLegacy(
  legacy: {
    transport?: number;
    meal?: number;
    attendance?: number;
    position?: number;
    commission?: number;
    otMeal?: number;
  } | undefined,
  baseSalary: number
): SalaryBasisInput {
  const transport = Number(legacy?.transport) || 0;
  const meal = Number(legacy?.meal) || 0;
  const attendance = Number(legacy?.attendance) || 0;
  const position = Number(legacy?.position) || 0;
  const commission = Number(legacy?.commission) || 0;
  return {
    baseSalary,
    positionAllowance: position,
    commission,
    // OT meal retired — no longer part of fixed allowance basis for indemnity.
    fixedAllowance: transport + meal + attendance,
  };
}
