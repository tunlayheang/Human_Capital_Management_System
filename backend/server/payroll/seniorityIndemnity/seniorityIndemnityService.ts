import type {
  SeniorityIndemnityCalculationInput,
  SeniorityIndemnityCalculationResult,
  SeniorityIndemnityConfig,
  SeniorityIndemnityEligibility,
  SeniorityIndemnitySemester,
  SeniorityIndemnitySemesterMonthInput,
  ServiceLengthBreakdown,
} from './seniorityIndemnityTypes.js';
import {
  inferContractTypeFromEmployment,
  normalizeContractTypeToken,
} from './seniorityIndemnityConfig.js';
import {
  analyzeSemesterWages,
  buildSyntheticSemesterMonths,
  parseDateOnly,
  resolveRegularSemesterPayoutDays,
  resolveSeniorityStartDate,
  resolveSettlementPayoutDays,
  resolveWorkingDaysDivisor,
  roundDays,
  roundUsd,
  semesterBounds,
  semesterForMonth,
  startOfDayUtc,
} from './seniorityIndemnitySemesterEngine.js';

function monthsBetweenInclusive(start: Date, end: Date): number {
  if (end < start) return 0;
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1;
  if (end.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** Continuous service from join → cutoff (payroll calendar end). */
export function computeServiceLength(
  joinDate: string | Date | null | undefined,
  cutoffDate: string | Date
): ServiceLengthBreakdown | null {
  const join = parseDateOnly(joinDate);
  const cutoff = parseDateOnly(cutoffDate);
  if (!join || !cutoff || cutoff < join) return null;

  let years = cutoff.getUTCFullYear() - join.getUTCFullYear();
  let months = cutoff.getUTCMonth() - join.getUTCMonth();
  let days = cutoff.getUTCDate() - join.getUTCDate();

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalMonths = monthsBetweenInclusive(startOfDayUtc(join), startOfDayUtc(cutoff));
  const label = `${years} yr${years === 1 ? '' : 's'} ${months} mo ${days} day${days === 1 ? '' : 's'}`;

  return { years, months, days, totalMonths, label };
}

export function evaluateSeniorityIndemnityEligibility(
  input: Pick<
    SeniorityIndemnityCalculationInput,
    | 'joinDate'
    | 'contractType'
    | 'employmentType'
    | 'probationPeriodMonths'
    | 'payrollPeriodEnd'
    | 'config'
  >
): SeniorityIndemnityEligibility {
  const { config } = input;
  if (!config.enabled) return { eligible: false, reason: 'disabled' };

  const join = parseDateOnly(input.joinDate);
  const cutoff = parseDateOnly(input.payrollPeriodEnd);
  if (!join || !cutoff || cutoff < join) {
    return { eligible: false, reason: 'no_service' };
  }

  const employmentType = String(input.employmentType ?? '').trim();
  const contract = inferContractTypeFromEmployment(input.contractType, input.employmentType);

  if (contract === 'FDC') {
    return {
      eligible: false,
      reason: 'fdc_severance_required',
      fdcSeveranceRequired: config.fdcSeveranceRuleEnabled !== false,
    };
  }

  const eligibleContracts = config.eligibleContractTypes
    .map((c) => normalizeContractTypeToken(c) || String(c).trim().toUpperCase())
    .filter(Boolean);
  if (eligibleContracts.length && !eligibleContracts.includes(contract)) {
    return { eligible: false, reason: 'contract_type_ineligible' };
  }

  if (
    employmentType &&
    config.excludedEmploymentTypes.some(
      (t) => t.toLowerCase() === employmentType.toLowerCase()
    )
  ) {
    return { eligible: false, reason: 'employment_type_excluded' };
  }

  const seniorityStart = resolveSeniorityStartDate(
    join,
    input.probationPeriodMonths,
    input.probationConfirmedAt,
    input.workerType,
    { inclusionRule: config.inclusionRule, inclusionMonths: config.inclusionMonths }
  );
  if (cutoff < seniorityStart) {
    return { eligible: false, reason: 'inclusion_waiting_period' };
  }

  return { eligible: true, reason: null };
}

function resolveSemesterMonthlyInputs(
  input: SeniorityIndemnityCalculationInput,
  calendarYear: number,
  semester: SeniorityIndemnitySemester,
  join: Date,
  seniorityStart: Date,
  cutoff: Date
): SeniorityIndemnitySemesterMonthInput[] {
  if (input.semesterMonthlyInputs?.length) {
    return input.semesterMonthlyInputs;
  }
  return buildSyntheticSemesterMonths({
    calendarYear,
    semester,
    joinDate: join,
    seniorityStart,
    cutoffDate: cutoff,
    monthlyGrossWagesUsd: input.salaryBasisUsd,
    daysWorkedPerMonth: 26,
  });
}

function buildResult(
  input: SeniorityIndemnityCalculationInput,
  params: {
    eligible: boolean;
    ineligibleReason: string | null;
    payoutUsd: number;
    payoutDays: number;
    dailyRateUsd: number;
    avgMonthlyUsd: number;
    serviceLength: ServiceLengthBreakdown | null;
    formula: string;
    paymentKind: SeniorityIndemnityCalculationResult['paymentKind'];
    semester: SeniorityIndemnitySemester | null;
    pre2019BackPayUsd?: number;
    audit?: Record<string, unknown>;
  }
): SeniorityIndemnityCalculationResult {
  return {
    eligible: params.eligible,
    ineligibleReason: params.ineligibleReason,
    payoutUsd: params.payoutUsd,
    payoutDays: params.payoutDays,
    dailyRateUsd: params.dailyRateUsd,
    salaryBasisUsd: roundUsd(input.salaryBasisUsd),
    avgMonthlyUsd: params.avgMonthlyUsd,
    serviceLength: params.serviceLength,
    calendarYearEntitlementDays: input.config.daysPerYear,
    formula: params.formula,
    paymentKind: params.paymentKind,
    semester: params.semester,
    pre2019BackPayUsd: roundUsd(params.pre2019BackPayUsd ?? 0),
    audit: params.audit ?? {},
  };
}

export function calculateSeniorityIndemnity(
  input: SeniorityIndemnityCalculationInput
): SeniorityIndemnityCalculationResult {
  const empty = (
    reason: string,
    audit: Record<string, unknown> = {}
  ): SeniorityIndemnityCalculationResult =>
    buildResult(input, {
      eligible: false,
      ineligibleReason: reason,
      payoutUsd: 0,
      payoutDays: 0,
      dailyRateUsd: 0,
      avgMonthlyUsd: 0,
      serviceLength: computeServiceLength(input.joinDate, input.payrollPeriodEnd),
      formula: '',
      paymentKind: 'none',
      semester: null,
      audit,
    });

  const eligibility = evaluateSeniorityIndemnityEligibility(input);
  if (!eligibility.eligible) {
    return empty(eligibility.reason ?? 'ineligible', {
      fdcSeveranceRequired: eligibility.fdcSeveranceRequired ?? false,
    });
  }

  const join = parseDateOnly(input.joinDate)!;
  const cutoff = parseDateOnly(input.payrollPeriodEnd)!;
  const monthNum = parseInt(input.payrollMonth.slice(5, 7), 10);
  const calendarYear = parseInt(input.payrollMonth.slice(0, 4), 10);
  const serviceLength = computeServiceLength(join, cutoff)!;
  const seniorityStart = resolveSeniorityStartDate(
    join,
    input.probationPeriodMonths,
    input.probationConfirmedAt,
    input.workerType,
    { inclusionRule: input.config.inclusionRule, inclusionMonths: input.config.inclusionMonths }
  );

  const semester = input.isFinalSettlement
    ? monthNum <= 6
      ? 'S1'
      : 'S2'
    : semesterForMonth(monthNum);

  if (!semester) {
    if (!input.isFinalSettlement) return empty('not_payout_month');
    return empty('settlement_semester_unresolved');
  }

  const monthlyInputs = resolveSemesterMonthlyInputs(
    input,
    calendarYear,
    semester,
    join,
    seniorityStart,
    cutoff
  );

  const analysis = analyzeSemesterWages({
    calendarYear,
    semester,
    joinDate: join,
    seniorityStart,
    cutoffDate: cutoff,
    config: input.config,
    scheduledWorkingDays: input.scheduledWorkingDays,
    actualWorkingDays: input.actualWorkingDays,
    monthlyInputs,
    employedOnPayoutDate: input.employedOnPayoutDate ?? !input.isFinalSettlement,
  });

  const workingDivisor = resolveWorkingDaysDivisor(
    input.config,
    input.scheduledWorkingDays,
    input.actualWorkingDays
  );

  if (input.isFinalSettlement && input.termination) {
    const settlement = resolveSettlementPayoutDays({
      postProbationSeniorityMonths: analysis.postProbationSeniorityMonths,
      termination: input.termination,
      config: input.config,
      semester,
      alreadyPaidThisSemester: Boolean(input.alreadyPaidThisSemester),
    });

    if (settlement.payoutDays <= 0 && !(settlement.pre2019BackPayUsd && settlement.pre2019BackPayUsd > 0)) {
      return buildResult(input, {
        eligible: true,
        ineligibleReason: settlement.reason,
        payoutUsd: 0,
        payoutDays: 0,
        dailyRateUsd: analysis.dailyRateUsd,
        avgMonthlyUsd: analysis.avgMonthlyUsd,
        serviceLength,
        formula: `Settlement: ${settlement.reason ?? 'no payout'}`,
        paymentKind: 'settlement',
        semester,
        pre2019BackPayUsd: settlement.pre2019BackPayUsd ?? 0,
        audit: { ...analysis, settlementReason: settlement.reason },
      });
    }

    const indemnityUsd = roundUsd((analysis.avgMonthlyUsd / workingDivisor) * settlement.payoutDays);
    const pre2019 = roundUsd(settlement.pre2019BackPayUsd ?? 0);
    const total = roundUsd(indemnityUsd + pre2019);
    const formula = `Settlement: avg ${analysis.avgMonthlyUsd} ÷ ${workingDivisor} × ${settlement.payoutDays} days = ${indemnityUsd}${
      pre2019 > 0 ? ` + pre-2019 back pay ${pre2019}` : ''
    } = ${total}`;

    return buildResult(input, {
      eligible: true,
      ineligibleReason: null,
      payoutUsd: total,
      payoutDays: settlement.payoutDays,
      dailyRateUsd: analysis.dailyRateUsd,
      avgMonthlyUsd: analysis.avgMonthlyUsd,
      serviceLength,
      formula,
      paymentKind: 'settlement',
      semester,
      pre2019BackPayUsd: pre2019,
      audit: {
        ...analysis,
        terminationReason: input.termination.reason,
        seriousMisconduct: input.termination.seriousMisconduct ?? false,
        workingDivisor,
      },
    });
  }

  const regular = resolveRegularSemesterPayoutDays({
    postProbationSeniorityMonths: analysis.postProbationSeniorityMonths,
    employedOnPayoutDate: input.employedOnPayoutDate ?? true,
    config: input.config,
    semester,
  });

  if (regular.payoutDays <= 0) {
    return empty(regular.reason ?? 'zero_payout_days', { ...analysis, semester });
  }

  if (input.alreadyPaidThisSemester) {
    return empty('semester_already_paid', { ...analysis, semester });
  }

  const payoutUsd = roundUsd((analysis.avgMonthlyUsd / workingDivisor) * regular.payoutDays);
  const paymentKind = semester === 'S1' ? 'june' : 'december';
  const formula = `avg ${analysis.avgMonthlyUsd} (${analysis.semesterWageSumUsd} ÷ ${analysis.monthsWorked} mo) ÷ ${workingDivisor} × ${regular.payoutDays} days = ${payoutUsd}`;

  return buildResult(input, {
    eligible: true,
    ineligibleReason: null,
    payoutUsd,
    payoutDays: regular.payoutDays,
    dailyRateUsd: analysis.dailyRateUsd,
    avgMonthlyUsd: analysis.avgMonthlyUsd,
    serviceLength,
    formula,
    paymentKind,
    semester,
    audit: {
      payrollMonth: input.payrollMonth,
      payrollPeriodEnd: input.payrollPeriodEnd,
      contractType: inferContractTypeFromEmployment(input.contractType, input.employmentType),
      employmentType: input.employmentType,
      semester,
      workingDivisor,
      seniorityStart: seniorityStart.toISOString().slice(0, 10),
      ...analysis,
      payoutDaysFormula: `full ${regular.payoutDays} days (Art. 89 semester model)`,
    },
  });
}

/** @deprecated Use calculateSeniorityIndemnity — thin wrapper for legacy callers. */
export function computeSeniorityIndemnityUsdLegacy(
  baseSalary: number,
  month: string,
  scheduledWorkingDays: number,
  config: SeniorityIndemnityConfig
): number {
  const monthPrefix = month.slice(0, 7);
  const [y, m] = monthPrefix.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const result = calculateSeniorityIndemnity({
    payrollMonth: monthPrefix,
    payrollPeriodEnd: `${monthPrefix}-${String(lastDay).padStart(2, '0')}`,
    joinDate: '2000-01-01',
    contractType: 'UDC',
    employmentType: 'Full-Time',
    probationPeriodMonths: 0,
    salaryBasisUsd: baseSalary,
    scheduledWorkingDays,
    config,
    employedOnPayoutDate: true,
  });
  return result.payoutUsd;
}
