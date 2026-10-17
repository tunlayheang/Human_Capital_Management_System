import type { PayrollComplianceRule } from '../../types';
import type { PreferredCurrency } from '../../utils/payrollCurrencyDisplay';
import {
  formatRulesAmountFromKhr,
  formatRulesAmountFromUsd,
  khrFieldLabel,
} from '../../utils/payrollRulesCurrency';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';

export type ComplianceFieldMeta = {
  key: string;
  label: string;
  type?: 'number' | 'text';
  step?: string;
  /** Amount storage currency for KHR/USD toggle. */
  money?: 'khr' | 'usd';
};

export const COMPLIANCE_RULE_FIELDS: Record<string, ComplianceFieldMeta[]> = {
  minimum_wage: [
    { key: 'amountUsd', label: 'Amount', type: 'number', money: 'usd' },
    { key: 'period', label: 'Period', type: 'text' },
  ],
  nssf_occupational_risk: [
    { key: 'employeePct', label: 'Employee % (deduction)', type: 'number', step: '0.1' },
    { key: 'employerPct', label: 'Employer %', type: 'number', step: '0.1' },
  ],
  nssf_healthcare: [
    { key: 'employeePct', label: 'Employee % (deduction)', type: 'number', step: '0.1' },
    { key: 'employerPct', label: 'Employer %', type: 'number', step: '0.1' },
  ],
  nssf_pension: [
    { key: 'employeePct', label: 'Employee % (deducted from pay)', type: 'number', step: '0.1' },
    { key: 'employerPct', label: 'Employer %', type: 'number', step: '0.1' },
    { key: 'employeeCapKhr', label: 'Employee max deduction / month', type: 'number', money: 'khr' },
    { key: 'assumedWageCapKhr', label: 'Assumed wage cap', type: 'number', money: 'khr' },
  ],
  seniority_indemnity: [
    { key: 'enabled', label: 'Enabled', type: 'text' },
    { key: 'daysPerYear', label: 'Days per year', type: 'number', step: '0.5' },
    { key: 'payoutJuneDays', label: 'June payout (days)', type: 'number', step: '0.5' },
    { key: 'payoutDecemberDays', label: 'December payout (days)', type: 'number', step: '0.5' },
    { key: 'dailyRateMethod', label: 'Daily rate method (scheduled_26 | actual_working_days)', type: 'text' },
    { key: 'salaryBasis', label: 'Salary basis (JSON array)', type: 'text' },
    { key: 'eligibleContractTypes', label: 'Eligible contract types (JSON array)', type: 'text' },
    { key: 'excludedEmploymentTypes', label: 'Excluded employment types (JSON array)', type: 'text' },
    { key: 'inclusionRule', label: 'Inclusion (immediate | after_probation | after_months)', type: 'text' },
    { key: 'inclusionMonths', label: 'Inclusion wait (months)', type: 'number' },
  ],
  overtime_multipliers: [
    { key: 'multiplierNormal', label: 'Normal OT multiplier', type: 'number', step: '0.1' },
    { key: 'multiplierPremium', label: 'Premium OT multiplier', type: 'number', step: '0.1' },
  ],
};

export function complianceFieldLabel(
  field: ComplianceFieldMeta,
  currency: PreferredCurrency
): string {
  if (field.money === 'khr') return khrFieldLabel(field.label, currency);
  if (field.money === 'usd') return `${field.label} (${currency})`;
  return field.label;
}

export function formatComplianceDisplayValue(
  rule: PayrollComplianceRule,
  options?: { currency?: PreferredCurrency; exchangeRateKhrPerUsd?: number }
): string {
  const c = rule.config;
  const currency = options?.currency ?? 'KHR';
  const rate = resolveExchangeRateKhrPerUsd(options?.exchangeRateKhrPerUsd, 'configured');
  switch (rule.ruleKey) {
    case 'minimum_wage':
      return `${formatRulesAmountFromUsd(Number(c.amountUsd ?? 0), currency, rate)}/${c.period ?? 'month'}`;
    case 'nssf_occupational_risk':
    case 'nssf_healthcare': {
      const emp = Number(c.employeePct) || 0;
      const empr = Number(c.employerPct) || 0;
      const total = Math.round((emp + empr) * 10) / 10;
      if (emp <= 0) {
        return `${total}% employer-only (0% Emp / ${empr}% Empr)`;
      }
      return `${total}% total (${emp}% Emp / ${empr}% Empr) — ${emp}% from pay`;
    }
    case 'nssf_pension': {
      const emp = Number(c.employeePct) || 0;
      const empr = Number(c.employerPct) || 0;
      const cap = Number(c.employeeCapKhr) || 24_000;
      return `${emp + empr}% total — ${emp}% from pay (max ${formatRulesAmountFromKhr(cap, currency, rate)})`;
    }
    case 'seniority_indemnity':
      return `${c.daysPerYear ?? 0} days/year`;
    case 'overtime_multipliers':
      return `${c.multiplierNormal ?? 1.5}x - ${c.multiplierPremium ?? 2}x`;
    default:
      return rule.displayValue;
  }
}

export function sortComplianceRules(rules: PayrollComplianceRule[]): PayrollComplianceRule[] {
  return [...rules]
    .filter((r) => r.ruleKey !== 'nssf_health')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
