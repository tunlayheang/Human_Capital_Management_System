import type { PayrollComplianceEngineConfig } from './payrollComplianceRuleService.js';
import { getPayrollComplianceEngineConfig } from './payrollComplianceRuleService.js';
import { getPayrollExchangeRateKhrPerUsd } from './payrollExchangeRateService.js';
import { getNssfAssumedWageBrackets } from './nssfAssumedWageService.js';
import { getTaxBracketsForPayroll } from './taxBracketService.js';
import type { SalaryTaxBracketUsd } from './cambodiaSalaryTax.js';
import type { NssfWageBracket } from './nssfAssumedWage.js';

export type PayrollEngineInputs = {
  compliance: PayrollComplianceEngineConfig;
  nssfBrackets: NssfWageBracket[];
  taxBrackets: SalaryTaxBracketUsd[];
};

/** Load Rules-tab config + NSSF table + GDT tax brackets for a payroll run. */
export async function loadPayrollEngineInputs(month?: string): Promise<PayrollEngineInputs> {
  const monthKey = (month ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
  const compliance = await getPayrollComplianceEngineConfig(monthKey);
  const exchangeRate = await getPayrollExchangeRateKhrPerUsd(monthKey);
  const complianceWithFx: PayrollComplianceEngineConfig = { ...compliance, exchangeRate };

  const [nssfBrackets, taxBrackets] = await Promise.all([
    getNssfAssumedWageBrackets(monthKey),
    getTaxBracketsForPayroll(exchangeRate, monthKey),
  ]);

  return {
    compliance: complianceWithFx,
    nssfBrackets,
    taxBrackets,
  };
}
