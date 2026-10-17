import type { PayrollEngineConfig } from './payrollEngineConfig';

/** Human-readable employee NSSF rates from Payroll Rules (deducted from pay). */
export function buildEmployeeNssfRateParts(config: PayrollEngineConfig): string[] {
  const parts: string[] = [];
  if (config.nssfPensionEmployeePct > 0) {
    parts.push(`pension ${config.nssfPensionEmployeePct}%`);
  }
  if (config.nssfHealthcareEmployeePct > 0) {
    parts.push(`health care ${config.nssfHealthcareEmployeePct}%`);
  }
  if (config.nssfOccupationalRiskEmployeePct > 0) {
    parts.push(`occupational risk ${config.nssfOccupationalRiskEmployeePct}%`);
  }
  return parts;
}

/** Human-readable employer NSSF rates (company cost, not deducted from net pay). */
export function buildEmployerNssfRateParts(config: PayrollEngineConfig): string[] {
  const parts: string[] = [];
  if (config.nssfOccupationalRiskEmployerPct > 0) {
    parts.push(`${config.nssfOccupationalRiskEmployerPct}% occupational risk`);
  }
  if (config.nssfHealthcareEmployerPct > 0) {
    parts.push(`${config.nssfHealthcareEmployerPct}% health care`);
  }
  if (config.nssfPensionEmployerPct > 0) {
    parts.push(`${config.nssfPensionEmployerPct}% pension`);
  }
  return parts;
}
