import { resolveProbationAccrualStartDate } from '../../probationService.js';
import type {
  SeniorityIndemnityConfig,
  SeniorityIndemnitySemester,
  SeniorityIndemnitySemesterMonthInput,
  SeniorityIndemnityTerminationContext,
} from './seniorityIndemnityTypes.js';

export function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundDays(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? new Date(value) : new Date(String(value).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addMonthsUtc(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function semesterForMonth(monthNum: number): SeniorityIndemnitySemester | null {
  if (monthNum === 6) return 'S1';
  if (monthNum === 12) return 'S2';
  return null;
}

export function semesterBounds(
  calendarYear: number,
  semester: SeniorityIndemnitySemester
): { start: Date; end: Date; payoutDate: Date } {
  if (semester === 'S1') {
    return {
      start: new Date(Date.UTC(calendarYear, 0, 1)),
      end: new Date(Date.UTC(calendarYear, 5, 30)),
      payoutDate: new Date(Date.UTC(calendarYear, 5, 30)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 6, 1)),
    end: new Date(Date.UTC(calendarYear, 11, 31)),
    payoutDate: new Date(Date.UTC(calendarYear, 11, 31)),
  };
}

export function enumerateSemesterMonths(
  calendarYear: number,
  semester: SeniorityIndemnitySemester
): string[] {
  const startMonth = semester === 'S1' ? 0 : 6;
  const endMonth = semester === 'S1' ? 5 : 11;
  const out: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    out.push(`${calendarYear}-${String(m + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Seniority accrual start:
 * - after_probation (default): confirmation or computed probation end
 * - after_months: join date + inclusionMonths
 */
export function resolveSeniorityStartDate(
  joinDate: Date,
  probationPeriodMonths: number | null | undefined,
  probationConfirmedAt?: string | Date | null,
  workerType?: string | null,
  inclusion?: Pick<SeniorityIndemnityConfig, 'inclusionRule' | 'inclusionMonths'> | null
): Date {
  if (inclusion?.inclusionRule === 'after_months') {
    const months = Math.max(0, Math.floor(Number(inclusion.inclusionMonths) || 0));
    return startOfDayUtc(addMonthsUtc(joinDate, months));
  }
  const startIso = resolveProbationAccrualStartDate({
    join_date: joinDate,
    probation_period_months: probationPeriodMonths,
    probation_confirmed_at: probationConfirmedAt,
    worker_type: workerType,
  });
  const parsed = parseDateOnly(startIso) ?? joinDate;
  return startOfDayUtc(parsed);
}

export function resolveWorkingDaysDivisor(
  config: SeniorityIndemnityConfig,
  scheduledWorkingDays?: number,
  actualWorkingDays?: number
): number {
  if (config.dailyRateMethod === 'actual_working_days') {
    const actual = Number(actualWorkingDays);
    if (Number.isFinite(actual) && actual > 0) return Math.max(1, Math.floor(actual));
    const scheduled = Number(scheduledWorkingDays);
    if (Number.isFinite(scheduled) && scheduled > 0) return Math.max(1, Math.floor(scheduled));
  }
  if (
    config.workingDaysDivisor === 22 ||
    config.workingDaysDivisor === 24 ||
    config.workingDaysDivisor === 26
  ) {
    return config.workingDaysDivisor;
  }
  return 26;
}

export type SemesterWageAnalysis = {
  semesterMonths: string[];
  monthsWorked: number;
  postProbationSeniorityMonths: number;
  semesterWageSumUsd: number;
  avgMonthlyUsd: number;
  dailyRateUsd: number;
  monthDetails: Array<{
    month: string;
    grossWagesUsd: number;
    daysWorked: number;
    countsAsWorkedMonth: boolean;
    countsAsSeniorityMonth: boolean;
  }>;
};

export function analyzeSemesterWages(params: {
  calendarYear: number;
  semester: SeniorityIndemnitySemester;
  joinDate: Date;
  seniorityStart: Date;
  cutoffDate: Date;
  config: SeniorityIndemnityConfig;
  scheduledWorkingDays?: number;
  actualWorkingDays?: number;
  monthlyInputs: SeniorityIndemnitySemesterMonthInput[];
  /** When false, months after separation are excluded. */
  employedOnPayoutDate?: boolean;
}): SemesterWageAnalysis {
  const minDays = Math.max(1, Math.floor(params.config.semesterMinDaysForFullMonth ?? 21));
  const semesterMonths = enumerateSemesterMonths(params.calendarYear, params.semester);
  const { end: semesterEnd } = semesterBounds(params.calendarYear, params.semester);
  const effectiveCutoff =
    params.cutoffDate < semesterEnd ? params.cutoffDate : semesterEnd;

  const byMonth = new Map(params.monthlyInputs.map((m) => [m.month.slice(0, 7), m]));

  let semesterWageSumUsd = 0;
  let monthsWorked = 0;
  let postProbationSeniorityMonths = 0;
  const monthDetails: SemesterWageAnalysis['monthDetails'] = [];

  for (const mk of semesterMonths) {
    const monthStart = new Date(Date.UTC(parseInt(mk.slice(0, 4), 10), parseInt(mk.slice(5, 7), 10) - 1, 1));
    if (monthStart > effectiveCutoff) continue;
    if (monthStart < params.joinDate) continue;

    const row = byMonth.get(mk);
    const daysWorked = Math.max(0, Math.floor(Number(row?.daysWorked ?? 0)));
    const grossWagesUsd = Math.max(0, Number(row?.grossWagesUsd ?? 0));
    const excludeFromBasis = row?.excludeOccupationalBenefitsFromBasis === true;
    const basisWages = excludeFromBasis
      ? Math.max(0, Number(row?.basisWagesUsd ?? grossWagesUsd))
      : grossWagesUsd;

    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
    );
    const seniorityActiveInMonth = monthEnd >= params.seniorityStart;

    const countsAsWorkedMonth = daysWorked >= minDays;
    const countsAsSeniorityMonth = countsAsWorkedMonth && seniorityActiveInMonth;

    if (countsAsSeniorityMonth) {
      monthsWorked += 1;
      semesterWageSumUsd += basisWages;
      postProbationSeniorityMonths += 1;
    }

    monthDetails.push({
      month: mk,
      grossWagesUsd: basisWages,
      daysWorked,
      countsAsWorkedMonth,
      countsAsSeniorityMonth,
    });
  }

  const divisorMonths = Math.max(1, Math.min(6, monthsWorked));
  const avgMonthlyUsd = semesterWageSumUsd / divisorMonths;
  const workingDivisor = resolveWorkingDaysDivisor(
    params.config,
    params.scheduledWorkingDays,
    params.actualWorkingDays
  );
  const dailyRateUsd = avgMonthlyUsd / workingDivisor;

  return {
    semesterMonths,
    monthsWorked,
    postProbationSeniorityMonths,
    semesterWageSumUsd: roundUsd(semesterWageSumUsd),
    avgMonthlyUsd: roundUsd(avgMonthlyUsd),
    dailyRateUsd: roundUsd(dailyRateUsd),
    monthDetails,
  };
}

export function resolveRegularSemesterPayoutDays(params: {
  postProbationSeniorityMonths: number;
  employedOnPayoutDate: boolean;
  config: SeniorityIndemnityConfig;
  semester: SeniorityIndemnitySemester;
}): { payoutDays: number; reason: string | null } {
  if (!params.employedOnPayoutDate) {
    return { payoutDays: 0, reason: 'not_employed_on_payout_date' };
  }
  if (params.postProbationSeniorityMonths < 1) {
    return { payoutDays: 0, reason: 'insufficient_post_probation_seniority_months' };
  }
  const days =
    params.semester === 'S1'
      ? params.config.payoutJuneDays
      : params.config.payoutDecemberDays;
  return { payoutDays: days, reason: null };
}

export function resolveSettlementPayoutDays(params: {
  postProbationSeniorityMonths: number;
  termination: SeniorityIndemnityTerminationContext;
  config: SeniorityIndemnityConfig;
  semester: SeniorityIndemnitySemester;
  alreadyPaidThisSemester: boolean;
}): { payoutDays: number; reason: string | null; pre2019BackPayUsd?: number } {
  const { termination, config } = params;
  const partialDays = config.terminationPartialSemesterDays ?? 7;
  const fullDays =
    params.semester === 'S1' ? config.payoutJuneDays : config.payoutDecemberDays;

  if (termination.seriousMisconduct) {
    return { payoutDays: 0, reason: 'serious_misconduct' };
  }

  if (termination.reason === 'resignation') {
    const policy = config.resignationIndemnityPolicy ?? 'none';
    if (policy === 'none') return { payoutDays: 0, reason: 'resignation_excluded' };
    if (policy === 'employer_parity') {
      return resolveEmployerTerminationDays(
        params.postProbationSeniorityMonths,
        partialDays,
        fullDays,
        params.alreadyPaidThisSemester
      );
    }
    return { payoutDays: 0, reason: 'resignation_excluded' };
  }

  if (termination.reason === 'retirement' || termination.reason === 'death') {
    const base = resolveEmployerTerminationDays(
      params.postProbationSeniorityMonths,
      partialDays,
      fullDays,
      params.alreadyPaidThisSemester
    );
    return {
      ...base,
      pre2019BackPayUsd: termination.pre2019BackPayUsd ?? 0,
    };
  }

  if (termination.reason === 'employer' || termination.reason === 'contract_end') {
    return resolveEmployerTerminationDays(
      params.postProbationSeniorityMonths,
      partialDays,
      fullDays,
      params.alreadyPaidThisSemester
    );
  }

  return { payoutDays: 0, reason: 'termination_ineligible' };
}

function resolveEmployerTerminationDays(
  postProbationSeniorityMonths: number,
  partialDays: number,
  fullDays: number,
  alreadyPaidThisSemester: boolean
): { payoutDays: number; reason: string | null } {
  if (alreadyPaidThisSemester) {
    return { payoutDays: 0, reason: 'semester_already_paid' };
  }
  if (postProbationSeniorityMonths < 1) {
    return { payoutDays: 0, reason: 'insufficient_post_probation_seniority_months' };
  }
  if (postProbationSeniorityMonths >= 6) {
    return { payoutDays: fullDays, reason: null };
  }
  return { payoutDays: partialDays, reason: null };
}

/** Synthesize semester month rows from a flat monthly wage when history is unavailable. */
export function buildSyntheticSemesterMonths(params: {
  calendarYear: number;
  semester: SeniorityIndemnitySemester;
  joinDate: Date;
  seniorityStart: Date;
  cutoffDate: Date;
  monthlyGrossWagesUsd: number;
  daysWorkedPerMonth?: number;
}): SeniorityIndemnitySemesterMonthInput[] {
  const semesterMonths = enumerateSemesterMonths(params.calendarYear, params.semester);
  const days = params.daysWorkedPerMonth ?? 26;
  const { end: semesterEnd } = semesterBounds(params.calendarYear, params.semester);
  const effectiveCutoff =
    params.cutoffDate < semesterEnd ? params.cutoffDate : semesterEnd;

  return semesterMonths
    .filter((mk) => {
      const monthStart = new Date(
        Date.UTC(parseInt(mk.slice(0, 4), 10), parseInt(mk.slice(5, 7), 10) - 1, 1)
      );
      return monthStart >= params.joinDate && monthStart <= effectiveCutoff;
    })
    .map((month) => ({
      month,
      grossWagesUsd: params.monthlyGrossWagesUsd,
      basisWagesUsd: params.monthlyGrossWagesUsd,
      daysWorked: days,
    }));
}
