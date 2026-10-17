import { normalizeMovementType } from './employeeMovementCatalog.js';

const LABELS: Record<string, string> = {
  transfer: 'Transfer',
  promotion: 'Promotion',
  demotion: 'Demotion',
  salary_increase: 'Salary increase',
  salary_adjustment: 'Salary adjustment',
  salary_update: 'Pay change',
  employment_status_change: 'Employment status change',
  contract_type_change: 'Contract type change',
  department_change: 'Department change',
  position_change: 'Position change',
  branch_change: 'Branch change',
};

export function movementTypeLabelForNotify(type: string): string {
  const code = normalizeMovementType(type);
  return LABELS[code] ?? code.replace(/_/g, ' ');
}
