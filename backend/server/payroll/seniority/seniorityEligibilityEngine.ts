import { isInProbation } from '../../probationService.js';
import type { SeniorityApplicableGroups, SeniorityEligibilityRules } from './seniorityTypes.js';
import { serviceDaysFromJoin } from './seniorityAccrualEngine.js';

export type SeniorityEligibilityContext = {
  employeeStatus?: string;
  employmentType?: string;
  departmentId?: string | null;
  accessRole?: string;
  joinDate?: string | Date | null;
  probationPeriodMonths?: number;
  probationConfirmedAt?: string | Date | null;
  workerType?: string | null;
  presentDays?: number;
  unpaidLeaveDays?: number;
  suspended?: boolean;
  asOf?: number;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function ruleAppliesToEmployee(
  groups: SeniorityApplicableGroups,
  ctx: SeniorityEligibilityContext
): boolean {
  if (groups.allEmployees !== false && !groups.departmentIds?.length && !groups.accessRoles?.length) {
    return true;
  }
  if (groups.allEmployees) return true;
  if (groups.departmentIds?.length && ctx.departmentId) {
    if (groups.departmentIds.includes(String(ctx.departmentId))) return true;
  }
  if (groups.accessRoles?.length && ctx.accessRole) {
    if (groups.accessRoles.map(norm).includes(norm(ctx.accessRole))) return true;
  }
  return false;
}

export function evaluateSeniorityEligibility(
  rules: SeniorityEligibilityRules,
  ctx: SeniorityEligibilityContext
): { eligible: boolean; reason: string | null } {
  const status = norm(ctx.employeeStatus ?? 'active');
  const allowedStatuses = (rules.employeeStatuses ?? ['active']).map(norm);
  if (!allowedStatuses.includes(status)) {
    return { eligible: false, reason: `status_${status}` };
  }

  if (rules.employmentTypes?.length) {
    const et = norm(ctx.employmentType ?? '');
    const allowed = rules.employmentTypes.map(norm);
    if (!allowed.some((a) => et.includes(a) || a.includes(et))) {
      return { eligible: false, reason: 'employment_type' };
    }
  }

  if (rules.excludeProbation) {
    const asOf =
      ctx.asOf != null
        ? new Date(ctx.asOf)
        : new Date();
    if (
      isInProbation(
        {
          status: ctx.employeeStatus,
          join_date: ctx.joinDate,
          probation_period_months: ctx.probationPeriodMonths,
          probation_confirmed_at: ctx.probationConfirmedAt,
          worker_type: ctx.workerType,
        },
        asOf
      )
    ) {
      return { eligible: false, reason: 'probation' };
    }
  }

  const minService = Number(rules.minServiceDays ?? 0);
  if (minService > 0) {
    const days = serviceDaysFromJoin(ctx.joinDate, ctx.asOf);
    if (days < minService) return { eligible: false, reason: 'min_service' };
  }

  const minWorking = Number(rules.minWorkingDaysInMonth ?? 0);
  if (minWorking > 0 && (ctx.presentDays ?? 0) < minWorking) {
    return { eligible: false, reason: 'min_working_days' };
  }

  if (rules.excludeUnpaidLeaveDays && (ctx.unpaidLeaveDays ?? 0) > 0) {
    const threshold = 5;
    if ((ctx.unpaidLeaveDays ?? 0) >= threshold) {
      return { eligible: false, reason: 'unpaid_leave' };
    }
  }

  if (rules.excludeSuspension && ctx.suspended) {
    return { eligible: false, reason: 'suspended' };
  }

  return { eligible: true, reason: null };
}
