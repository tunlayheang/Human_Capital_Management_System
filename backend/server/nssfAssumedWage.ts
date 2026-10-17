/**
 * NSSF contributory wage table (assumed wage by monthly wage band in KHR).
 * Level 22 caps assumed wage at 1,200,000 KHR (pension employee max deduction 24,000 KHR at 2%).
 */

import { usdToKhr } from './usdToKhr.js';

export type NssfWageBracket = {
  level: number;
  wageMinKhr: number;
  wageMaxKhr: number | null;
  assumedWageKhr: number;
};

/** Levels 2–21: bands of 50,000 KHR; assumed wage = upper bound − 25,000 KHR. */
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

export const NSSF_ASSUMED_WAGE_BRACKETS: NssfWageBracket[] = [
  { level: 1, wageMinKhr: 0, wageMaxKhr: 200_000, assumedWageKhr: 200_000 },
  ...buildMidBrackets(),
  { level: 22, wageMinKhr: 1_200_001, wageMaxKhr: null, assumedWageKhr: 1_200_000 },
];

export function resolveAssumedWageKhr(
  monthlyWageKhr: number,
  brackets: NssfWageBracket[] = NSSF_ASSUMED_WAGE_BRACKETS
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

/** Employee share of an NSSF component (% of assumed wage, optional cap). */
export function calculateEmployeeContributionKhr(
  monthlyWageKhr: number,
  employeePct: number,
  brackets: NssfWageBracket[] = NSSF_ASSUMED_WAGE_BRACKETS,
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

/** Employee pension deduction (KHR): 2% of assumed wage, capped (default 24,000 KHR). */
export function calculateEmployeePensionDeductionKhr(
  monthlyWageKhr: number,
  employeePct: number,
  employeeCapKhr: number,
  brackets: NssfWageBracket[] = NSSF_ASSUMED_WAGE_BRACKETS
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
  const brackets = params.brackets ?? NSSF_ASSUMED_WAGE_BRACKETS;
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
  brackets: NssfWageBracket[] = NSSF_ASSUMED_WAGE_BRACKETS
): number {
  const assumed = resolveAssumedWageKhr(monthlyWageKhr, brackets);
  return Math.round((assumed * employerPct) / 100);
}

export type NssfDetailSnapshot = EmployeeNssfDeductionParts & {
  employerOccupationalRiskKhr: number;
  employerHealthcareKhr: number;
  employerPensionKhr: number;
  employerTotalKhr: number;
  employerNssfUsd: number;
};

export type NssfDualResult = {
  nssfSalaryKhr: number;
  nssfSalaryUsd: number;
  employeeContributionKhr: number;
  employeeContributionUsd: number;
  employerContributionKhr: number;
  employerContributionUsd: number;
  exchangeRateUsed: number;
  nssfDetail?: NssfDetailSnapshot;
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
  const ex = Math.max(1, Number(params.exchangeRateKhrPerUsd) || 4100);
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

  const brackets = params.brackets ?? NSSF_ASSUMED_WAGE_BRACKETS;
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
    nssfDetail: {
      ...employeeNssf,
      employerOccupationalRiskKhr,
      employerHealthcareKhr,
      employerPensionKhr,
      employerTotalKhr: employerContributionKhr,
      employerNssfUsd: Math.round((employerContributionKhr / ex) * 100) / 100,
    },
  };
}
