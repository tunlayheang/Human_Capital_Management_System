import type { MovementCanonicalStatus, EmployeeMovementRow, EmployeeMovementType } from '../types/employeeMovement';
import {
  movementTypeLabel,
  resolveMovementOrigin,
  type MovementOriginKind,
} from '../components/employee/employeeMovementDisplay';

export type MovementStatusFilter = '' | MovementCanonicalStatus;

export type MovementOriginFilter = '' | MovementOriginKind;

export type MovementListFilterState = {
  movementType: '' | EmployeeMovementType;
  status: MovementStatusFilter;
  department: string;
  origin: MovementOriginFilter;
  effectiveFrom: string;
  effectiveTo: string;
};

export const EMPTY_MOVEMENT_LIST_FILTERS: MovementListFilterState = {
  movementType: '',
  status: '',
  department: '',
  origin: '',
  effectiveFrom: '',
  effectiveTo: '',
};

/** All movement types — stable filter list (not limited to current page). */
export const MOVEMENT_TYPE_CODES: EmployeeMovementType[] = [
  'transfer',
  'promotion',
  'demotion',
  'salary_increase',
  'salary_adjustment',
  'salary_update',
  'employment_status_change',
  'contract_type_change',
  'department_change',
  'position_change',
  'branch_change',
];

export const MOVEMENT_STATUS_FILTER_OPTIONS: { value: MovementStatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending approval' },
  { value: 'approved', label: 'Approved (awaiting effective date)' },
  { value: 'applied', label: 'Applied' },
  { value: 'returned', label: 'Returned' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const MOVEMENT_ORIGIN_FILTER_OPTIONS: { value: MovementOriginFilter; label: string }[] = [
  { value: '', label: 'All sources' },
  { value: 'manual', label: 'Manual entry' },
  { value: 'appraisal', label: 'KPI appraisal' },
  { value: 'probation', label: 'Probation review' },
];

export function movementStatusFilterLabel(status: MovementStatusFilter): string {
  return MOVEMENT_STATUS_FILTER_OPTIONS.find((o) => o.value === status)?.label ?? 'All statuses';
}

export function movementOriginFilterLabel(origin: MovementOriginFilter): string {
  return MOVEMENT_ORIGIN_FILTER_OPTIONS.find((o) => o.value === origin)?.label ?? 'All sources';
}

export function collectMovementDepartmentOptions(rows: EmployeeMovementRow[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    const from = String(row.fromDepartmentName ?? '').trim();
    const to = String(row.toDepartmentName ?? '').trim();
    if (from) names.add(from);
    if (to) names.add(to);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function buildMovementTypeFilterOptions(
  catalogRows: EmployeeMovementRow[],
  selectedType: MovementListFilterState['movementType']
) {
  const types = new Set<EmployeeMovementType>(MOVEMENT_TYPE_CODES);
  for (const row of catalogRows) {
    if (row.movementType) types.add(row.movementType);
  }
  if (selectedType) types.add(selectedType);
  const sorted = [...types].sort((a, b) => movementTypeLabel(a).localeCompare(movementTypeLabel(b)));
  return [
    { value: '', label: 'All types' },
    ...sorted.map((type) => ({ value: type, label: movementTypeLabel(type) })),
  ];
}

function effectiveDateYmd(row: EmployeeMovementRow): string {
  return String(row.effectiveDate ?? '').slice(0, 10);
}

/** Client-side filters applied after the API list fetch. */
export function matchesMovementClientFilters(
  row: EmployeeMovementRow,
  filters: MovementListFilterState
): boolean {
  if (filters.department) {
    const dept = filters.department.trim();
    const from = String(row.fromDepartmentName ?? '').trim();
    const to = String(row.toDepartmentName ?? '').trim();
    if (from !== dept && to !== dept) return false;
  }

  if (filters.origin) {
    if (resolveMovementOrigin(row) !== filters.origin) return false;
  }

  const lwd = effectiveDateYmd(row);
  if (filters.effectiveFrom && (!lwd || lwd < filters.effectiveFrom)) return false;
  if (filters.effectiveTo && (!lwd || lwd > filters.effectiveTo)) return false;

  return true;
}

export function matchesMovementSearch(row: EmployeeMovementRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parts = [
    row.employeeId,
    row.employeeName,
    row.employeeEmail,
    row.employeePhone,
    row.movementType,
    movementTypeLabel(row.movementType),
    row.fromDepartmentName,
    row.toDepartmentName,
    row.fromPositionTitle,
    row.toPositionTitle,
    row.createdByName,
    row.status,
    row.canonicalStatus,
  ];
  return parts.some((p) => String(p ?? '').toLowerCase().includes(q));
}

export function hasMovementListConstraints(
  search: string,
  filters: MovementListFilterState
): boolean {
  return (
    search.trim().length > 0 ||
    Boolean(filters.movementType) ||
    Boolean(filters.status) ||
    Boolean(filters.department) ||
    Boolean(filters.origin) ||
    Boolean(filters.effectiveFrom) ||
    Boolean(filters.effectiveTo)
  );
}
