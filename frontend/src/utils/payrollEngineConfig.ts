import type { PayrollComplianceRule } from '../types';
import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../constants/payrollExchangeRate';
import { getConfiguredExchangeRateKhrPerUsd } from './payrollExchangeRateCache';

const LEGACY_NSSF_HEALTH = 'nssf_health';

export type PayrollEngineConfig = {
  minimumWageUsd: number;
  nssfOccupationalRiskEmployeePct: number;
  nssfOccupationalRiskEmployerPct: number;
  nssfHealthcareEmployeePct: number;
  nssfHealthcareEmployerPct: number;
  nssfPensionEmployeePct: number;
  nssfPensionEmployerPct: number;
  nssfPensionEmployeeCapKhr: number;
  seniorityDaysPerYear: number;
  seniorityPayoutJuneDays: number;
  seniorityPayoutDecemberDays: number;
  otMultiplierNormal: number;
  otMultiplierPremium: number;
  exchangeRate: number;
};

export const DEFAULT_PAYROLL_ENGINE_CONFIG: PayrollEngineConfig = {
  minimumWageUsd: 204,
  nssfOccupationalRiskEmployeePct: 0,
  nssfOccupationalRiskEmployerPct: 0.8,
  nssfHealthcareEmployeePct: 0,
  nssfHealthcareEmployerPct: 2.6,
  nssfPensionEmployeePct: 2,
  nssfPensionEmployerPct: 2,
  nssfPensionEmployeeCapKhr: 24_000,
  seniorityDaysPerYear: 15,
  seniorityPayoutJuneDays: 7.5,
  seniorityPayoutDecemberDays: 7.5,
  otMultiplierNormal: 1.5,
  otMultiplierPremium: 2,
  exchangeRate: PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD,
};

function numConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const n = Number(config[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function complianceRulesToEngineConfig(
  rules: PayrollComplianceRule[]
): PayrollEngineConfig {
  const active = rules.filter((r) => r.ruleKey !== LEGACY_NSSF_HEALTH);
  const byKey = new Map(active.map((r) => [r.ruleKey, r.config ?? {}]));

  const min = byKey.get('minimum_wage') ?? {};
  const occupational = byKey.get('nssf_occupational_risk') ?? {};
  const healthcare = byKey.get('nssf_healthcare') ?? byKey.get(LEGACY_NSSF_HEALTH) ?? {};
  const pension = byKey.get('nssf_pension') ?? {};
  const seniority = byKey.get('seniority_indemnity') ?? {};
  const ot = byKey.get('overtime_multipliers') ?? {};

  return {
    minimumWageUsd: numConfig(min, 'amountUsd', DEFAULT_PAYROLL_ENGINE_CONFIG.minimumWageUsd),
    nssfOccupationalRiskEmployeePct: numConfig(
      occupational,
      'employeePct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfOccupationalRiskEmployeePct
    ),
    nssfOccupationalRiskEmployerPct: numConfig(
      occupational,
      'employerPct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfOccupationalRiskEmployerPct
    ),
    nssfHealthcareEmployeePct: numConfig(
      healthcare,
      'employeePct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfHealthcareEmployeePct
    ),
    nssfHealthcareEmployerPct: numConfig(
      healthcare,
      'employerPct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfHealthcareEmployerPct
    ),
    nssfPensionEmployeePct: numConfig(
      pension,
      'employeePct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfPensionEmployeePct
    ),
    nssfPensionEmployerPct: numConfig(
      pension,
      'employerPct',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfPensionEmployerPct
    ),
    nssfPensionEmployeeCapKhr: numConfig(
      pension,
      'employeeCapKhr',
      DEFAULT_PAYROLL_ENGINE_CONFIG.nssfPensionEmployeeCapKhr
    ),
    seniorityDaysPerYear: numConfig(
      seniority,
      'daysPerYear',
      DEFAULT_PAYROLL_ENGINE_CONFIG.seniorityDaysPerYear
    ),
    seniorityPayoutJuneDays: numConfig(
      seniority,
      'payoutJuneDays',
      DEFAULT_PAYROLL_ENGINE_CONFIG.seniorityPayoutJuneDays
    ),
    seniorityPayoutDecemberDays: numConfig(
      seniority,
      'payoutDecemberDays',
      DEFAULT_PAYROLL_ENGINE_CONFIG.seniorityPayoutDecemberDays
    ),
    otMultiplierNormal: numConfig(ot, 'multiplierNormal', DEFAULT_PAYROLL_ENGINE_CONFIG.otMultiplierNormal),
    otMultiplierPremium: numConfig(ot, 'multiplierPremium', DEFAULT_PAYROLL_ENGINE_CONFIG.otMultiplierPremium),
    exchangeRate: getConfiguredExchangeRateKhrPerUsd(),
  };
}
