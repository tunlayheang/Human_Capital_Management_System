import { Api } from '../services/api';
import type { AppraisalMovementPrefill } from '../components/appraisal/appraisalMovementUtils';
import { isCreatableMovementType, type EmployeeMovementType } from '../types/employeeMovement';
import { Department, Position } from '../types';
import {
  contractAmountsEqual,
  normalizeContractCurrency,
} from '../utils/contractMoney';
import { resolveExchangeRateKhrPerUsd } from '../utils/payrollExchangeRateCache';
import {
  hasPositionSalaryRange,
  positionSalaryBounds,
  validateSalaryInPositionRange,
} from '../utils/positionSalary';
import { clampIsoDateNotBeforeToday, localTodayIsoDate } from '../utils/leaveCalendar';
import { filterEmployeesWithAssignedDisplayId } from '../utils/employeeDirectoryEligibility';

export type ActiveEmployee = {
  employee_id: string;
  first_name: string;
  last_name: string;
  first_name_kh?: string | null;
  last_name_kh?: string | null;
  full_name?: string | null;
  full_name_kh?: string | null;
  email?: string;
  phone?: string;
  department_id: string;
  position_id: string;
  department?: { name?: string; name_kh?: string; nameKh?: string };
  position?: { title?: string; title_kh?: string; titleKh?: string };
  base_salary?: number;
  currency?: string;
  contract_type?: string;
  employment_status?: string;
  salary_structure?: { base_salary?: number; currency?: string };
};

/** Resolve pay from list/detail row — salary may live on nested salary_structure. */
export function resolveActiveEmployeeCompensation(
  row: Record<string, unknown> | ActiveEmployee | null | undefined
): { base_salary: number; currency: string } {
  if (!row) return { base_salary: 0, currency: 'USD' };
  const plain = row as Record<string, unknown>;
  const structure = plain.salary_structure as Record<string, unknown> | undefined;
  const raw =
    plain.base_salary ?? plain.baseSalary ?? structure?.base_salary ?? structure?.baseSalary;
  const base = Number(raw);
  const currency = String(plain.currency ?? structure?.currency ?? 'USD').trim() || 'USD';
  return {
    base_salary: Number.isFinite(base) && base > 0 ? base : 0,
    currency,
  };
}

export function normalizeActiveEmployee(row: Record<string, unknown>): ActiveEmployee {
  const comp = resolveActiveEmployeeCompensation(row);
  const first = String(row.first_name ?? '').trim();
  const last = String(row.last_name ?? '').trim();
  const firstKh = String(row.first_name_kh ?? '').trim();
  const lastKh = String(row.last_name_kh ?? '').trim();
  return {
    employee_id: String(row.employee_id ?? ''),
    first_name: first,
    last_name: last,
    first_name_kh: firstKh || null,
    last_name_kh: lastKh || null,
    full_name: `${last} ${first}`.trim() || String(row.full_name ?? '').trim() || null,
    full_name_kh: `${lastKh} ${firstKh}`.trim() || null,
    email: row.email != null ? String(row.email) : undefined,
    phone: row.phone != null ? String(row.phone) : undefined,
    department_id: String(row.department_id ?? ''),
    position_id: String(row.position_id ?? ''),
    department: row.department as ActiveEmployee['department'],
    position: row.position as ActiveEmployee['position'],
    base_salary: comp.base_salary,
    currency: comp.currency,
    contract_type: row.contract_type != null ? String(row.contract_type) : undefined,
    employment_status:
      row.employment_status != null ? String(row.employment_status) : undefined,
    salary_structure: row.salary_structure as ActiveEmployee['salary_structure'],
  };
}

export type MovementFormState = {
  employeeId: string;
  movementType: EmployeeMovementType;
  effectiveDate: string;
  toDepartmentId: string;
  toPositionId: string;
  toBaseSalary: string;
  toCurrency: string;
  notes: string;
  newContractType: string;
  newEmploymentStatus: string;
  assignedApproverUserIds: string[];
};

export function defaultMovementFormState(
  prefill?: Partial<MovementFormState>
): MovementFormState {
  return {
    employeeId: '',
    movementType: 'transfer',
    effectiveDate: localTodayIsoDate(),
    toDepartmentId: '',
    toPositionId: '',
    toBaseSalary: '',
    toCurrency: 'USD',
    notes: '',
    newContractType: '',
    newEmploymentStatus: '',
    assignedApproverUserIds: [],
    ...prefill,
  };
}

export function movementFormFromAppraisalPrefill(
  prefill: AppraisalMovementPrefill
): Partial<MovementFormState> {
  const suggested = prefill.suggestedMovementType ?? 'transfer';
  const movementType: EmployeeMovementType =
    suggested === 'salary_update' ? 'salary_increase' : suggested;
  return {
    employeeId: prefill.employeeId,
    movementType,
    effectiveDate: clampIsoDateNotBeforeToday(prefill.periodEndDate),
  };
}

export function movementFormFromRow(row: {
  employeeId: string;
  movementType: EmployeeMovementType;
  effectiveDate?: string | null;
  toDepartmentId?: string | null;
  toPositionId?: string | null;
  toBaseSalary?: number | null;
  toCurrency?: string | null;
  notes?: string | null;
  remark?: string | null;
  fieldKey?: string | null;
  newValue?: string | null;
  assignedApproverUserIds?: string[];
  assignedApprovers?: { userId: string }[];
}): MovementFormState {
  return defaultMovementFormState({
    employeeId: row.employeeId,
    movementType: row.movementType,
    effectiveDate: String(row.effectiveDate ?? '').slice(0, 10),
    toDepartmentId: String(row.toDepartmentId ?? ''),
    toPositionId: String(row.toPositionId ?? ''),
    toBaseSalary: row.toBaseSalary != null ? String(row.toBaseSalary) : '',
    toCurrency: String(row.toCurrency ?? 'USD'),
    notes: String(row.notes ?? row.remark ?? '').trim(),
    newContractType: row.fieldKey === 'contract_type' ? String(row.newValue ?? '') : '',
    newEmploymentStatus: row.fieldKey === 'employment_status' ? String(row.newValue ?? '') : '',
    assignedApproverUserIds:
      row.assignedApproverUserIds ??
      row.assignedApprovers?.map((entry) => entry.userId) ??
      [],
  });
}

export function parseSalaryInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function isSalaryMovementType(type: EmployeeMovementType): boolean {
  return type === 'salary_update' || type === 'salary_adjustment' || type === 'salary_increase';
}

export function isContractMovementType(type: EmployeeMovementType): boolean {
  return type === 'contract_type_change';
}

export function isStatusMovementType(type: EmployeeMovementType): boolean {
  return type === 'employment_status_change';
}

export function isMetadataMovementType(type: EmployeeMovementType): boolean {
  return isContractMovementType(type) || isStatusMovementType(type);
}

export function isPlacementMovementType(type: EmployeeMovementType): boolean {
  return !isSalaryMovementType(type) && !isMetadataMovementType(type);
}

export function validateMovementEmployeeStep(state: MovementFormState): string | null {
  if (!state.employeeId.trim()) return 'Employee is required.';
  return null;
}

export function validateMovementDetailsStep(
  state: MovementFormState,
  employee: ActiveEmployee | undefined,
  salaryRangePosition: Position | undefined
): string | null {
  if (!isCreatableMovementType(state.movementType)) {
    return 'Select a valid movement type.';
  }
  const today = localTodayIsoDate();
  if (!state.effectiveDate.trim() || state.effectiveDate.slice(0, 10) < today) {
    return 'Effective date cannot be before today.';
  }
  if (isMetadataMovementType(state.movementType)) {
    if (isContractMovementType(state.movementType) && !state.newContractType) {
      return 'Select the new contract type.';
    }
    if (isStatusMovementType(state.movementType) && !state.newEmploymentStatus) {
      return 'Select the new employment status.';
    }
    return null;
  }

  const currentComp = resolveActiveEmployeeCompensation(employee);
  const currentSalary = currentComp.base_salary;
  const currentCurrency = currentComp.currency;
  const exchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');

  if (isSalaryMovementType(state.movementType)) {
    const amount = parseSalaryInput(state.toBaseSalary);
    if (amount === null || amount <= 0) {
      return 'Enter a valid new base salary greater than zero.';
    }
    if (
      contractAmountsEqual(
        amount,
        'USD',
        currentSalary,
        normalizeContractCurrency(currentCurrency),
        exchangeRate
      )
    ) {
      return 'New salary must differ from the current base salary.';
    }
    if (salaryRangePosition) {
      const rangeError = validateSalaryInPositionRange(amount, salaryRangePosition);
      if (rangeError) return rangeError;
    }
    return null;
  }

  if (!state.toDepartmentId || !state.toPositionId) {
    return 'Department and position are required.';
  }

  if (!state.toBaseSalary.trim()) return null;
  const amount = parseSalaryInput(state.toBaseSalary);
  if (amount === null || amount <= 0) {
    return 'Enter a valid new base salary or leave blank to keep the current pay.';
  }
  if (
    contractAmountsEqual(
      amount,
      'USD',
      currentSalary,
      normalizeContractCurrency(currentCurrency),
      exchangeRate
    )
  ) {
    return 'New salary matches the current pay — leave blank to keep salary unchanged.';
  }
  if (salaryRangePosition) {
    const rangeError = validateSalaryInPositionRange(amount, salaryRangePosition);
    if (rangeError) return rangeError;
  }
  return null;
}

export function validateMovementReviewStep(state: MovementFormState): string | null {
  if (!state.notes.trim()) {
    return 'Change reason is required for placement or compensation updates.';
  }
  if (!state.assignedApproverUserIds.length) {
    return 'Select at least one approver before submitting.';
  }
  return null;
}

function buildSalaryPayload(state: MovementFormState, employee: ActiveEmployee) {
  const { base_salary: currentSalary, currency: currentCurrency } =
    resolveActiveEmployeeCompensation(employee);
  const exchangeRate = resolveExchangeRateKhrPerUsd(undefined, 'configured');
  const amount = parseSalaryInput(state.toBaseSalary);
  if (amount === null || amount <= 0) return {};
  if (
    contractAmountsEqual(
      amount,
      'USD',
      currentSalary,
      normalizeContractCurrency(currentCurrency),
      exchangeRate
    )
  ) {
    return {};
  }
  return { toBaseSalary: amount, toCurrency: 'USD' };
}

function buildMovementWritePayload(
  state: MovementFormState,
  employee: ActiveEmployee,
  appraisalPrefill?: AppraisalMovementPrefill | null
) {
  const changeReason = state.notes.trim();

  if (isMetadataMovementType(state.movementType)) {
    return {
      effectiveDate: state.effectiveDate,
      newContractType: isContractMovementType(state.movementType)
        ? state.newContractType
        : undefined,
      newEmploymentStatus: isStatusMovementType(state.movementType)
        ? state.newEmploymentStatus
        : undefined,
      notes: changeReason,
      changeReason,
      assignedApproverUserIds: state.assignedApproverUserIds,
    };
  }

  if (isSalaryMovementType(state.movementType)) {
    const amount = parseSalaryInput(state.toBaseSalary);
    if (amount === null) throw new Error('Invalid salary amount.');
    return {
      effectiveDate: state.effectiveDate,
      toBaseSalary: amount,
      toCurrency: 'USD',
      notes: changeReason,
      changeReason,
      sourceAppraisalId: appraisalPrefill?.appraisalId ?? null,
      assignedApproverUserIds: state.assignedApproverUserIds,
    };
  }

  return {
    effectiveDate: state.effectiveDate,
    toDepartmentId: state.toDepartmentId,
    toPositionId: state.toPositionId,
    ...buildSalaryPayload(state, employee),
    notes: changeReason,
    changeReason,
    sourceAppraisalId: appraisalPrefill?.appraisalId ?? null,
    assignedApproverUserIds: state.assignedApproverUserIds,
  };
}

export async function submitMovement(params: {
  state: MovementFormState;
  employee: ActiveEmployee;
  appraisalPrefill?: AppraisalMovementPrefill | null;
}): Promise<{ pendingApproval?: boolean }> {
  const { state, employee, appraisalPrefill } = params;
  const payload = buildMovementWritePayload(state, employee, appraisalPrefill);

  if (isMetadataMovementType(state.movementType)) {
    return Api.employeeMovements.create({
      employeeId: state.employeeId,
      movementType: state.movementType,
      ...payload,
    }) as Promise<{ pendingApproval?: boolean }>;
  }

  if (isSalaryMovementType(state.movementType)) {
    return Api.employeeMovements.create({
      employeeId: state.employeeId,
      movementType: state.movementType,
      ...payload,
    }) as Promise<{ pendingApproval?: boolean }>;
  }

  return Api.employeeMovements.create({
    employeeId: state.employeeId,
    movementType: state.movementType,
    ...payload,
  }) as Promise<{ pendingApproval?: boolean }>;
}

/** Update a returned movement and resubmit for approval. */
export async function resubmitMovement(params: {
  movementId: string;
  state: MovementFormState;
  employee: ActiveEmployee;
}): Promise<unknown> {
  const { movementId, state, employee } = params;
  const payload = buildMovementWritePayload(state, employee);
  return Api.employeeMovements.update(movementId, payload);
}

export function resolveMovementSalaryRangePosition(
  state: MovementFormState,
  employee: ActiveEmployee | undefined,
  positions: Position[],
  toPosition?: Position
): Position | undefined {
  if (isSalaryMovementType(state.movementType)) {
    const posId = String(employee?.position_id ?? '').trim();
    if (!posId) return undefined;
    return positions.find((p) => p.id === posId);
  }
  if (isPlacementMovementType(state.movementType) && toPosition) {
    return toPosition;
  }
  return undefined;
}

export function suggestSalaryFromPosition(
  selectedPosition: Position | undefined,
  currentSalary: number,
  currentValue: string
): string | null {
  if (currentValue.trim()) return null;
  if (!selectedPosition || currentSalary <= 0) return null;
  return String(currentSalary);
}

export function suggestSalaryFromAppraisal(
  employee: ActiveEmployee | undefined,
  appraisalPrefill: AppraisalMovementPrefill | undefined,
  movementType: EmployeeMovementType,
  currentValue: string
): string | null {
  if (!employee || !appraisalPrefill?.suggestedSalaryIncreasePercent) return null;
  if (movementType !== 'salary_update' && movementType !== 'salary_increase' && movementType !== 'promotion') {
    return null;
  }
  if (currentValue.trim()) return null;
  const base = resolveActiveEmployeeCompensation(employee).base_salary;
  if (base <= 0) return null;
  return String(Math.round(base * (1 + appraisalPrefill.suggestedSalaryIncreasePercent / 100)));
}

export function filterPositionsForDepartment(
  positions: Position[],
  departmentId: string
): Position[] {
  return positions.filter(
    (p) =>
      p.isActive !== false &&
      String(p.departmentId || (p as { department_id?: string }).department_id) === departmentId
  );
}

export async function loadMovementWizardCatalog(): Promise<{
  employees: ActiveEmployee[];
  departments: Department[];
  positions: Position[];
}> {
  const [empRes, depts, pos] = await Promise.all([
    Api.employees.getAll({
      page: 1,
      limit: 500,
      status: 'active',
      assigned_id_only: '1',
    }),
    Api.departments.getAll({ activeOnly: true }),
    Api.positions.getAll({ activeOnly: true }),
  ]);
  return {
    employees: filterEmployeesWithAssignedDisplayId(
      ((empRes?.employees ?? []) as Record<string, unknown>[]).map(normalizeActiveEmployee)
    ),
    departments: Array.isArray(depts) ? depts : [],
    positions: Array.isArray(pos) ? pos : [],
  };
}
