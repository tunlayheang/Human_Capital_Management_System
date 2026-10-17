export type MovementCanonicalStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'applied'
  | 'cancelled'
  | 'returned'
  | 'rejected';

export type EmployeeMovementType =
  | 'transfer'
  | 'promotion'
  | 'demotion'
  | 'salary_increase'
  | 'salary_adjustment'
  | 'salary_update'
  | 'employment_status_change'
  | 'contract_type_change'
  | 'department_change'
  | 'position_change'
  | 'branch_change';

/** Movement types available when creating a new movement in the wizard. */
export const CREATABLE_MOVEMENT_TYPE_OPTIONS = [
  { value: 'promotion' as const, label: 'Promotion' },
  { value: 'transfer' as const, label: 'Transfer' },
  { value: 'salary_increase' as const, label: 'Salary increase' },
];

export type CreatableEmployeeMovementType =
  (typeof CREATABLE_MOVEMENT_TYPE_OPTIONS)[number]['value'];

export function isCreatableMovementType(
  type: EmployeeMovementType
): type is CreatableEmployeeMovementType {
  return CREATABLE_MOVEMENT_TYPE_OPTIONS.some((option) => option.value === type);
}

export type EmployeeMovementRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail?: string | null;
  employeePhone?: string | null;
  employeeAvatarUrl?: string | null;
  movementType: EmployeeMovementType;
  effectiveDate: string;
  fromDepartmentId?: string;
  toDepartmentId?: string;
  fromDepartmentName: string;
  toDepartmentName: string;
  fromPositionTitle: string;
  toPositionTitle: string;
  fromBaseSalary: number | null;
  toBaseSalary: number | null;
  fromCurrency: string | null;
  toCurrency: string | null;
  status: string;
  canonicalStatus?: MovementCanonicalStatus;
  fieldKey?: string | null;
  currentValue?: string | null;
  newValue?: string | null;
  remark?: string | null;
  approvedBy?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  assignedApproverUserId?: string | null;
  assignedApproverName?: string | null;
  assignedApproverUserIds?: string[];
  assignedApprovers?: {
    userId: string;
    name: string | null;
    status: 'pending' | 'approved';
    approvedAt?: string | null;
    sortOrder?: number;
    phase?: 'approved' | 'current' | 'queued';
  }[];
  approvalProgress?: { approved: number; total: number } | null;
  currentApproverUserId?: string | null;
  currentApproverName?: string | null;
  rejectedBy?: string | null;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  returnedBy?: string | null;
  returnedByName?: string | null;
  returnedAt?: string | null;
  returnNotes?: string | null;
  canApproverReview?: boolean;
  createdBy?: string | null;
  createdByName: string | null;
  notes: string | null;
  createdAt: string;
  appliedAt?: string | null;
  sourceAppraisalId?: string | null;
  sourceAppraisalPeriodName?: string | null;
  sourceProbationReviewId?: string | null;
};

export const CONTRACT_TYPE_OPTIONS = [
  'Permanent',
  'Fixed-Term Contract',
  'Probation',
  'Intern',
  'Part-Time',
  'Temporary',
  'Consultant',
  'UDC',
  'FDC',
] as const;

export const EMPLOYMENT_STATUS_OPTIONS = [
  'Probation',
  'Active',
  'Resigned',
  'Terminated',
  'Suspended',
  'Retired',
  'Inactive',
] as const;
