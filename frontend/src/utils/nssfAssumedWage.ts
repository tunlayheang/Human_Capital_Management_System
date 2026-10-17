/**
 * NSSF contributory wage table (assumed wage by monthly wage band in KHR).
 * Mirrors backend/server/nssfAssumedWage.ts; editable via Payroll Rules.
 */

import { getConfiguredExchangeRateKhrPerUsd, resolveExchangeRateKhrPerUsd } from './payrollExchangeRateCache';
import { usdToKhr } from './payrollRulesCurrency';

export type NssfWageBracket = {
  level: number;
  wageMinKhr: number;
  wageMaxKhr: number | null;
  assumedWageKhr: number;
};

export type PayrollNssfWageBracket = NssfWageBracket & { range: string };

function buildMidBrackets(): NssfWageBracket[] {
  const rows: NssfWageBracket[] = [];
  for (let level = 2; level <= 21; level += 1) {
    const wageMinKhr = 200_000 + (level - 2) * 50_000 + 1;
    const wageMaxKhr = 200_000 + (level - 1) * 50_000;
    const assumedWageKhr = wageMaxKhr - 25_000;
    rows.push({ level, wageMinKhr, wageMaxKhr, assumedWageKhr });
  }
  return rows;
}

export const CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS: NssfWageBracket[] = [
  { level: 1, wageMinKhr: 0, wageMaxKhr: 200_000, assumedWageKhr: 200_000 },
  ...buildMidBrackets(),
  { level: 22, wageMinKhr: 1_200_001, wageMaxKhr: null, assumedWageKhr: 1_200_000 },
];

export function formatNssfWageRange(wageMinKhr: number, wageMaxKhr: number | null): string {
  if (wageMaxKhr == null || wageMaxKhr >= 9_999_999_999) {
    return `${wageMinKhr.toLocaleString()} Up`;
  }
  if (wageMinKhr <= 0) {
    return `Below ${wageMaxKhr.toLocaleString()}`;
  }
  return `${wageMinKhr.toLocaleString()} - ${wageMaxKhr.toLocaleString()}`;
}

export function nssfBracketsToDisplayRows(brackets: NssfWageBracket[]): PayrollNssfWageBracket[] {
  return [...brackets]
    .sort((a, b) => a.level - b.level)
    .map((b) => ({
      ...b,
      range: formatNssfWageRange(b.wageMinKhr, b.wageMaxKhr),
    }));
}

export function resolveAssumedWageKhr(
  monthlyWageKhr: number,
  brackets: NssfWageBracket[] = CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
): number {
  const wage = Math.max(0, Math.round(monthlyWageKhr));
  const sorted = [...brackets].sort((a, b) => a.level - b.level);
  if (sorted.length === 0) return 200_000;

  for (const row of sorted) {
    const max = row.wageMaxKhr;
    const min = row.wageMinKhr;
    if (max == null) {
      if (wage >= min) return row.assumedWageKhr;
      continue;
    }
    if (min <= 0 || row.level === 1) {
      if (wage <= max) return row.assumedWageKhr;
    } else if (wage >= min && wage <= max) {
      return row.assumedWageKhr;
    }
  }

  const open = sorted.find((r) => r.wageMaxKhr == null);
  return open?.assumedWageKhr ?? sorted[sorted.length - 1]?.assumedWageKhr ?? 200_000;
}

export function calculateEmployeeContributionKhr(
  monthlyWageKhr: number,
  employeePct: number,
  brackets: NssfWageBracket[] = CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS,
  employeeCapKhr?: number | null
): number {
  const pct = Number(employeePct);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  const assumed = resolveAssumedWageKhr(monthlyWageKhr, brackets);
  const raw = Math.round((assumed * pct) / 100);
  if (employeeCapKhr != null && employeeCapKhr > 0) {
    return Math.min(raw, Math.round(employeeCapKhr));
  }
  return raw;
}

export function calculateEmployeePensionDeductionKhr(
  monthlyWageKhr: number,
  employeePct = 2,
  employeeCapKhr = 24_000,
  brackets: NssfWageBracket[] = CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
): number {
  return calculateEmployeeContributionKhr(
    monthlyWageKhr,
    employeePct,
    brackets,
    employeeCapKhr
  );
}

export type EmployeeNssfDeductionParts = {
  assumedWageKhr: number;
  employeeOccupationalRiskKhr: number;
  employeeHealthcareKhr: number;
  employeePensionKhr: number;
  employeeTotalKhr: number;
};

export function calculateEmployeeNssfDeductionParts(
  monthlyWageKhr: number,
  params: {
    occupationalEmployeePct: number;
    healthcareEmployeePct: number;
    pensionEmployeePct: number;
    pensionEmployeeCapKhr: number;
    brackets?: NssfWageBracket[];
  }
): EmployeeNssfDeductionParts {
  const brackets = params.brackets ?? CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS;
  const assumedWageKhr = resolveAssumedWageKhr(monthlyWageKhr, brackets);
  const employeeOccupationalRiskKhr = calculateEmployeeContributionKhr(
    monthlyWageKhr,
    params.occupationalEmployeePct,
    brackets
  );
  const employeeHealthcareKhr = calculateEmployeeContributionKhr(
    monthlyWageKhr,
    params.healthcareEmployeePct,
    brackets
  );
  const employeePensionKhr = calculateEmployeeContributionKhr(
    monthlyWageKhr,
    params.pensionEmployeePct,
    brackets,
    params.pensionEmployeeCapKhr
  );
  return {
    assumedWageKhr,
    employeeOccupationalRiskKhr,
    employeeHealthcareKhr,
    employeePensionKhr,
    employeeTotalKhr:
      employeeOccupationalRiskKhr + employeeHealthcareKhr + employeePensionKhr,
  };
}

export function calculateEmployerContributionKhr(
  monthlyWageKhr: number,
  employerPct: number,
  brackets: NssfWageBracket[] = CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
): number {
  const assumed = resolveAssumedWageKhr(monthlyWageKhr, brackets);
  return Math.round((assumed * employerPct) / 100);
}

export type NssfDualResult = {
  nssfSalaryKhr: number;
  nssfSalaryUsd: number;
  employeeContributionKhr: number;
  employeeContributionUsd: number;
  employerContributionKhr: number;
  employerContributionUsd: number;
  exchangeRateUsed: number;
};

/** Primary NSSF calculation — always in KHR, stores both currencies. */
export function computeNssfDual(params: {
  monthlyGrossUsd: number;
  exchangeRateKhrPerUsd: number;
  nssfEnrolled?: boolean;
  occupationalEmployeePct: number;
  healthcareEmployeePct: number;
  pensionEmployeePct: number;
  pensionEmployeeCapKhr: number;
  occupationalEmployerPct: number;
  healthcareEmployerPct: number;
  pensionEmployerPct: number;
  brackets?: NssfWageBracket[];
}): NssfDualResult {
  const ex = resolveExchangeRateKhrPerUsd(params.exchangeRateKhrPerUsd, 'configured');
  const grossUsd = Math.max(0, Number(params.monthlyGrossUsd) || 0);
  const nssfSalaryKhr = usdToKhr(grossUsd, ex);
  const nssfSalaryUsd = Math.round(grossUsd * 100) / 100;

  if (params.nssfEnrolled === false) {
    return {
      nssfSalaryKhr,
      nssfSalaryUsd,
      employeeContributionKhr: 0,
      employeeContributionUsd: 0,
      employerContributionKhr: 0,
      employerContributionUsd: 0,
      exchangeRateUsed: ex,
    };
  }

  const brackets = params.brackets ?? CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS;
  const employeeNssf = calculateEmployeeNssfDeductionParts(nssfSalaryKhr, {
    occupationalEmployeePct: params.occupationalEmployeePct,
    healthcareEmployeePct: params.healthcareEmployeePct,
    pensionEmployeePct: params.pensionEmployeePct,
    pensionEmployeeCapKhr: params.pensionEmployeeCapKhr,
    brackets,
  });
  const employerOccupationalRiskKhr = calculateEmployerContributionKhr(
    nssfSalaryKhr,
    params.occupationalEmployerPct,
    brackets
  );
  const employerHealthcareKhr = calculateEmployerContributionKhr(
    nssfSalaryKhr,
    params.healthcareEmployerPct,
    brackets
  );
  const employerPensionKhr = calculateEmployerContributionKhr(
    nssfSalaryKhr,
    params.pensionEmployerPct,
    brackets
  );
  const employerContributionKhr =
    employerOccupationalRiskKhr + employerHealthcareKhr + employerPensionKhr;
  const employeeContributionKhr = employeeNssf.employeeTotalKhr;

  return {
    nssfSalaryKhr,
    nssfSalaryUsd,
    employeeContributionKhr,
    employeeContributionUsd: Math.round((employeeContributionKhr / ex) * 100) / 100,
    employerContributionKhr,
    employerContributionUsd: Math.round((employerContributionKhr / ex) * 100) / 100,
    exchangeRateUsed: ex,
  };
}

export function employeeNssfDeductionUsd(
  grossSalaryUsd: number,
  exchangeRate = getConfiguredExchangeRateKhrPerUsd(),
  params: {
    occupationalEmployeePct: number;
    healthcareEmployeePct: number;
    pensionEmployeePct: number;
    pensionEmployeeCapKhr: number;
    brackets?: NssfWageBracket[];
  }
): number {
  const monthlyWageKhr = usdToKhr(grossSalaryUsd, exchangeRate);
  const parts = calculateEmployeeNssfDeductionParts(monthlyWageKhr, params);
  return Math.round((parts.employeeTotalKhr / exchangeRate) * 100) / 100;
}

export function employeePensionDeductionUsd(
  grossSalaryUsd: number,
  exchangeRate = getConfiguredExchangeRateKhrPerUsd(),
  employeePct = 2,
  employeeCapKhr = 24_000,
  brackets: NssfWageBracket[] = CANONICAL_NSSF_ASSUMED_WAGE_BRACKETS
): number {
  return employeeNssfDeductionUsd(grossSalaryUsd, exchangeRate, {
    occupationalEmployeePct: 0,
    healthcareEmployeePct: 0,
    pensionEmployeePct: employeePct,
    pensionEmployeeCapKhr: employeeCapKhr,
    brackets,
  });
}
