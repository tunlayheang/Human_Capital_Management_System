import {
  isOffboardingAwaitingPayroll,
  isOffboardingWorkflowComplete,
  resolveHubPrimaryBadge,
} from './offboardingHubStatus';
import { isOffboardedStatus, normalizeSettlementStatus } from './offboardingWizardSteps';

export type OffboardingWorkflowFilter =
  | ''
  | 'in_progress'
  | 'awaiting_payroll'
  | 'complete'
  | 'draft';

export type OffboardingPayPathFilter = '' | 'no_pay' | 'paid' | 'awaiting_payroll';

export type OffboardingExitTypeFilter = '' | 'resignation' | 'termination';

export type OffboardingHubFilterState = {
  workflowStatus: OffboardingWorkflowFilter;
  department: string;
  payPath: OffboardingPayPathFilter;
  exitType: OffboardingExitTypeFilter;
  lastWorkingFrom: string;
  lastWorkingTo: string;
};

export const EMPTY_OFFBOARDING_HUB_FILTERS: OffboardingHubFilterState = {
  workflowStatus: '',
  department: '',
  payPath: '',
  exitType: '',
  lastWorkingFrom: '',
  lastWorkingTo: '',
};

type EmployeeLike = {
  employee_id: string;
  status?: string;
  offboard_type?: string | null;
  department?: { name?: string };
  last_working_date?: string | null;
};

type SettlementLike = {
  status?: string;
  lastWorkingDate?: string;
} | null | undefined;

function resolveLastWorkingDate(employee: EmployeeLike, settlement: SettlementLike): string {
  const raw = employee.last_working_date ?? settlement?.lastWorkingDate ?? '';
  return String(raw).slice(0, 10);
}

function isResignation(employee: EmployeeLike): boolean {
  const status = String(employee.status ?? '').toLowerCase();
  const offboardType = String(employee.offboard_type ?? '').toLowerCase();
  return status === 'resigned' || offboardType === 'resign';
}

export function matchesOffboardingHubFilters(params: {
  employee: EmployeeLike;
  settlement: SettlementLike;
  hubInProgress: boolean;
  filters: OffboardingHubFilterState;
}): boolean {
  const { employee, settlement, hubInProgress, filters } = params;
  const st = settlement ? normalizeSettlementStatus(settlement.status) : '';

  if (filters.workflowStatus) {
    const badge = resolveHubPrimaryBadge({
      settlementStatus: st,
      employeeStatus: employee.status,
      offboardType: employee.offboard_type,
      hubInProgress,
    });
    if (filters.workflowStatus === 'draft' && st !== 'DRAFT') return false;
    if (filters.workflowStatus === 'awaiting_payroll' && badge.kind !== 'awaiting_payroll') {
      return false;
    }
    if (filters.workflowStatus === 'complete' && badge.kind !== 'complete') return false;
    if (filters.workflowStatus === 'in_progress' && badge.kind !== 'in_progress') return false;
  }

  if (filters.department) {
    const dept = String(employee.department?.name ?? '').trim();
    if (dept !== filters.department) return false;
  }

  if (filters.payPath) {
    if (filters.payPath === 'no_pay' && st !== 'LOCKED') return false;
    if (filters.payPath === 'paid' && st !== 'PAID') return false;
    if (filters.payPath === 'awaiting_payroll' && !isOffboardingAwaitingPayroll(st)) return false;
  }

  if (filters.exitType) {
    if (!isOffboardedStatus(employee.status) && !isOffboardingWorkflowComplete(st, employee.status)) {
      return false;
    }
    if (filters.exitType === 'resignation' && !isResignation(employee)) return false;
    if (filters.exitType === 'termination' && isResignation(employee)) return false;
  }

  const lwd = resolveLastWorkingDate(employee, settlement);
  if (filters.lastWorkingFrom && (!lwd || lwd < filters.lastWorkingFrom)) return false;
  if (filters.lastWorkingTo && (!lwd || lwd > filters.lastWorkingTo)) return false;

  return true;
}
