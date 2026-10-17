import type { SpouseHasWork } from '../utils/taxDependents';

export type EmployeeChildFormRow = {
  name: string;
  nameKh: string;
  age: string;
  gender: string;
  occupation: string;
  hasJob: SpouseHasWork;
};

export type EmployeeChildDto = {
  id?: number;
  childNumber?: number;
  name: string;
  nameKh?: string | null;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  hasJob: SpouseHasWork;
  isTaxDependent?: boolean;
};

export const EMPTY_CHILD_ROW: EmployeeChildFormRow = {
  name: '',
  nameKh: '',
  age: '',
  gender: '',
  occupation: '',
  hasJob: 'no',
};

/**
 * @deprecated Do not synthesize child rows from stale `tax_dependents` — that inflated payroll relief.
 * Load real children from the API only; dependents are derived from spouse/child job flags.
 */
export function emptyChildRowsForLegacyTaxCount(
  _totalTaxDependents: number,
  _spouseHasWork?: SpouseHasWork
): EmployeeChildFormRow[] {
  return [];
}
