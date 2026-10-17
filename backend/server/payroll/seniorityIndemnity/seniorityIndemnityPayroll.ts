import {
  loadSeniorityIndemnityConfigForMonth,
  resolveSeniorityIndemnityPolicyForMonth,
} from './seniorityIndemnityPolicyService.js';
import {
  calculateSeniorityIndemnity,
  type SeniorityIndemnityCalculationResult,
} from './seniorityIndemnityService.js';
import {
  resolveSeniorityIndemnitySalaryBasisUsd,
  salaryBasisFromAllowanceLegacy,
} from './seniorityIndemnitySalaryBasis.js';
import {
  findApprovedIndemnityPayment,
} from './seniorityIndemnityLedger.js';
import type { SeniorityIndemnityConfig } from './seniorityIndemnityTypes.js';

/** Active company indemnity policy for the payroll month (inactive templates are ignored). */
export async function loadSeniorityIndemnityConfig(month?: string): Promise<SeniorityIndemnityConfig> {
  const monthPrefix = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  return loadSeniorityIndemnityConfigForMonth(monthPrefix);
}

export type ResolveSeniorityIndemnityParams = {
  employee: {
    id?: string;
    join_date?: string | Date | null;
    contract_type?: string | null;
    employment_type?: string | null;
    probation_period_months?: number | null;
    base_salary?: number;
    salary_structure?: { base_salary?: number };
  } | null;
  user?: { salary?: number };
  month: string;
  payrollPeriodEnd: string;
  scheduledWorkingDays: number;
  actualWorkingDays?: number;
  allowanceLegacy?: {
    transport?: number;
    meal?: number;
    attendance?: number;
    position?: number;
    commission?: number;
    otMeal?: number;
  };
  isFinalSettlement?: boolean;
  skipDuplicateCheck?: boolean;
  policyId?: string;
  termination?: import('./seniorityIndemnityTypes.js').SeniorityIndemnityTerminationContext;
  semesterMonthlyInputs?: import('./seniorityIndemnityTypes.js').SeniorityIndemnitySemesterMonthInput[];
};

export type PreviewSeniorityIndemnityBody = {
  baseSalary?: number;
  joinDate?: string | null;
  contractType?: string | null;
  employmentType?: string | null;
  probationPeriodMonths?: number | null;
  month?: string;
  payrollPeriodEnd?: string;
  scheduledWorkingDays?: number;
  actualWorkingDays?: number;
  allowanceLegacy?: ResolveSeniorityIndemnityParams['allowanceLegacy'];
  policyId?: string;
};

export async function previewSeniorityIndemnity(
  body: PreviewSeniorityIndemnityBody
): Promise<SeniorityIndemnityCalculationResult> {
  const monthPrefix = String(body.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  let payrollPeriodEnd = body.payrollPeriodEnd?.slice(0, 10) ?? '';
  if (!payrollPeriodEnd) {
    try {
      const { resolvePayrollPeriod } = await import('../payrollPeriodService.js');
      const period = await resolvePayrollPeriod(monthPrefix);
      payrollPeriodEnd = period.payPeriodEnd.slice(0, 10);
    } catch {
      const [y, m] = monthPrefix.split('-').map(Number);
      const lastDay = y && m ? new Date(y, m, 0).getDate() : 30;
      payrollPeriodEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  return resolveSeniorityIndemnityForPayroll({
    employee: {
      join_date: body.joinDate,
      contract_type: body.contractType,
      employment_type: body.employmentType,
      probation_period_months: body.probationPeriodMonths,
      base_salary: Number(body.baseSalary ?? 0),
    },
    month: monthPrefix,
    payrollPeriodEnd,
    scheduledWorkingDays: Number(body.scheduledWorkingDays) || 26,
    actualWorkingDays: body.actualWorkingDays,
    allowanceLegacy: body.allowanceLegacy,
    skipDuplicateCheck: true,
    policyId: body.policyId,
  });
}

export async function resolveSeniorityIndemnityForPayroll(
  params: ResolveSeniorityIndemnityParams & { policyId?: string }
): Promise<SeniorityIndemnityCalculationResult> {
  const monthPrefix = params.month.slice(0, 7);
  let config: SeniorityIndemnityConfig;
  let policyName: string | null = null;

  if (params.policyId) {
    const { getSeniorityIndemnityPolicy, policyRowToConfig } = await import(
      './seniorityIndemnityPolicyService.js'
    );
    const policy = await getSeniorityIndemnityPolicy(params.policyId);
    if (!policy) {
      return {
        eligible: false,
        ineligibleReason: 'policy_not_found',
        payoutUsd: 0,
        payoutDays: 0,
        dailyRateUsd: 0,
        salaryBasisUsd: 0,
        serviceLength: null,
        calendarYearEntitlementDays: 0,
        formula: '',
        paymentKind: 'none',
        audit: { policyId: params.policyId },
      };
    }
    config = policyRowToConfig(policy);
    policyName = policy.name;
  } else {
    const policy = await resolveSeniorityIndemnityPolicyForMonth(monthPrefix);
    if (!policy) {
      return {
        eligible: false,
        ineligibleReason: 'no_active_policy',
        payoutUsd: 0,
        payoutDays: 0,
        dailyRateUsd: 0,
        salaryBasisUsd: 0,
        serviceLength: null,
        calendarYearEntitlementDays: 0,
        formula: '',
        paymentKind: 'none',
        audit: { reason: 'no_active_seniority_indemnity_policy' },
      };
    }
    const { policyRowToConfig } = await import('./seniorityIndemnityPolicyService.js');
    config = policyRowToConfig(policy);
    policyName = policy.name;
  }

  if (!config.enabled) {
    return {
      eligible: false,
      ineligibleReason: 'disabled',
      payoutUsd: 0,
      payoutDays: 0,
      dailyRateUsd: 0,
      salaryBasisUsd: 0,
      serviceLength: null,
      calendarYearEntitlementDays: 0,
      formula: '',
      paymentKind: 'none',
      audit: { reason: 'seniority_indemnity_policy_inactive', policyName },
    };
  }

  const calendarYear = parseInt(monthPrefix.slice(0, 4), 10);
  void calendarYear;

  const baseSalary = Number(
    params.employee?.base_salary ??
      params.employee?.salary_structure?.base_salary ??
      params.user?.salary ??
      0
  );
  const basisInput = salaryBasisFromAllowanceLegacy(params.allowanceLegacy, baseSalary);
  const salaryBasisUsd = resolveSeniorityIndemnitySalaryBasisUsd(config.salaryBasis, basisInput);

  let alreadyPaidThisSemester = false;
  const employeeId = params.employee?.id ? String(params.employee.id) : '';
  if (employeeId && !params.skipDuplicateCheck) {
    const monthNum = parseInt(monthPrefix.slice(5, 7), 10);
    const kind = monthNum === 6 ? 'june' : monthNum === 12 ? 'december' : null;
    if (kind) {
      const approved = await findApprovedIndemnityPayment(employeeId, monthPrefix, kind);
      if (approved) {
        return {
          eligible: true,
          ineligibleReason: null,
          payoutUsd: Number(approved.amount_usd),
          payoutDays: Number(approved.payout_days),
          dailyRateUsd: Number(approved.daily_rate_usd),
          salaryBasisUsd: Number(approved.salary_basis_usd),
          serviceLength: null,
          calendarYearEntitlementDays: 0,
          avgMonthlyUsd: 0,
          formula: String(approved.formula ?? 'Previously approved payment'),
          paymentKind: kind,
          pre2019BackPayUsd: 0,
          audit: { reusedApprovedPaymentId: approved.id, policyName },
        };
      }
      alreadyPaidThisSemester = false;
    }
  }

  let termination = params.isFinalSettlement ? params.termination : undefined;
  if (params.isFinalSettlement && termination && employeeId) {
    const join = params.employee?.join_date;
    const joinStr = join ? String(join).slice(0, 10) : '';
    if (
      (termination.reason === 'retirement' || termination.reason === 'death') &&
      joinStr &&
      joinStr < '2019-01-01'
    ) {
      const { sumOutstandingPre2019BackPayUsd } = await import('./seniorityIndemnityPre2019Ledger.js');
      const pre2019 = await sumOutstandingPre2019BackPayUsd(employeeId);
      termination = { ...termination, pre2019BackPayUsd: pre2019 };
    }
  }

  const result = calculateSeniorityIndemnity({
    payrollMonth: monthPrefix,
    payrollPeriodEnd: params.payrollPeriodEnd,
    joinDate: params.employee?.join_date,
    contractType: params.employee?.contract_type,
    employmentType: params.employee?.employment_type,
    probationPeriodMonths: params.employee?.probation_period_months,
    probationConfirmedAt: params.employee?.probation_confirmed_at,
    workerType: params.employee?.worker_type,
    salaryBasisUsd,
    scheduledWorkingDays: params.scheduledWorkingDays,
    actualWorkingDays: params.actualWorkingDays,
    config,
    alreadyPaidThisSemester,
    isFinalSettlement: params.isFinalSettlement,
    termination,
    employedOnPayoutDate: params.isFinalSettlement ? false : true,
    semesterMonthlyInputs: params.semesterMonthlyInputs,
  });

  return {
    ...result,
    audit: { ...result.audit, policyName },
  };
}
