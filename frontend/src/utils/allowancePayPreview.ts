import type { AllowanceTemplate, AllowanceType, SalaryBreakdown } from '../types';
import { computeTaxOnSalary } from './payrollTaxRate';
import {
  calculateEmployeeNssfDeductionParts,
  employeeNssfDeductionUsd,
} from './nssfAssumedWage';
import type { PayrollEngineConfig } from './payrollEngineConfig';
import type { PayrollTaxBracket } from '../types';
import { usdToKhr } from './payrollRulesCurrency';

export type AllowanceEngineLegacy = {
  transport: number;
  attendance: number;
  meal: number;
  seniority: number;
  position: number;
  commission: number;
  otMeal: number;
};

export type AllowancePreviewLine = {
  code: string;
  name: string;
  amount: number;
};

/**
 * One row per catalog type.
 * - `packageTypeIds === null`: show engine amounts (same as payroll preview / auto-resolve).
 * - empty Set: force all $0 (explicit “No allowance”).
 * - non-empty Set: only listed types keep engine amounts (UI package filter).
 */
export function buildAllowanceOverviewLines(
  allTypes: AllowanceType[],
  engineLines: AllowancePreviewLine[],
  packageTypeIds: Set<string> | null
): AllowancePreviewLine[] {
  const amountByCode = new Map(
    engineLines.map((l) => [String(l.code).toUpperCase(), l.amount])
  );
  const sorted = [...allTypes]
    .filter((t) => t.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));

  return sorted.map((type) => {
    const code = String(type.code).toUpperCase();
    const engineAmt = amountByCode.get(code) ?? 0;
    let amount = 0;
    if (packageTypeIds == null) {
      amount = engineAmt;
    } else if (packageTypeIds.size > 0 && packageTypeIds.has(type.id)) {
      amount = engineAmt;
    }
    return {
      code,
      name: type.name,
      amount,
    };
  });
}

/**
 * Packages are assigned explicitly on the employee — never auto-matched by
 * department or portal role.
 */
export function pickBestAllowanceTemplate(
  _templates: AllowanceTemplate[],
  _departmentId?: string | null
): AllowanceTemplate | null {
  return null;
}

export function zeroAllowanceOverviewLines(allTypes: AllowanceType[]): AllowancePreviewLine[] {
  return buildAllowanceOverviewLines(allTypes, [], new Set());
}

/** Merge allowance engine output into a payroll preview breakdown and recalc gross/tax/net. */
export function applyAllowanceEngineToBreakdown(
  breakdown: SalaryBreakdown,
  engine: { legacy: AllowanceEngineLegacy; lines: AllowancePreviewLine[] },
  options: {
    taxDependents: number;
    taxBrackets?: PayrollTaxBracket[];
    compliance: PayrollEngineConfig;
    nssfEnrolled: boolean;
    nssfBrackets?: import('./nssfAssumedWage').NssfWageBracket[];
    allowancePackageName?: string;
    allAllowanceTypes?: AllowanceType[];
    packageTypeIds?: Set<string> | null;
  }
): SalaryBreakdown {
  const { legacy, lines } = engine;
  const overviewLines = (
    options.allAllowanceTypes?.length
      ? buildAllowanceOverviewLines(
          options.allAllowanceTypes,
          lines,
          options.packageTypeIds ?? null
        )
      : lines.length > 0
        ? lines
        : buildLinesFromLegacy(legacy)
  ).filter((l) => String(l.code).toUpperCase() !== 'OT_MEAL');

  const allowanceTotal = overviewLines.reduce((sum, l) => sum + l.amount, 0);

  const allowances = {
    transport: 0,
    attendance: 0,
    meal: 0,
    seniority: 0,
    position: 0,
    commission: 0,
    otMeal: 0,
  };
  for (const line of overviewLines) {
    const code = line.code.toUpperCase();
    if (code === 'TRANSPORT') allowances.transport = line.amount;
    else if (code === 'MEAL') allowances.meal = line.amount;
    else if (code === 'ATTENDANCE') allowances.attendance = line.amount;
    else if (code === 'SENIORITY') allowances.seniority = line.amount;
    else if (code === 'POSITION') allowances.position = line.amount;
    else if (code === 'COMMISSION') allowances.commission = line.amount;
    // OT_MEAL retired — ignore if present on legacy lines
  }

  const grossSalary =
    breakdown.baseSalary +
    (breakdown.seniorityIndemnity ?? 0) +
    (breakdown.seniorityEntitlement ?? 0) +
    allowanceTotal +
    breakdown.overtime.total;

  const exchangeRate = breakdown.exchangeRate;
  const monthlyWageKhr = usdToKhr(grossSalary, exchangeRate);
  const nssfEnrolled = options.nssfEnrolled;
  const employeeNssf = nssfEnrolled
    ? calculateEmployeeNssfDeductionParts(monthlyWageKhr, {
        occupationalEmployeePct: options.compliance.nssfOccupationalRiskEmployeePct,
        healthcareEmployeePct: options.compliance.nssfHealthcareEmployeePct,
        pensionEmployeePct: options.compliance.nssfPensionEmployeePct,
        pensionEmployeeCapKhr: options.compliance.nssfPensionEmployeeCapKhr,
        brackets: options.nssfBrackets,
      })
    : null;
  const nssf = nssfEnrolled
    ? employeeNssfDeductionUsd(grossSalary, exchangeRate, {
        occupationalEmployeePct: options.compliance.nssfOccupationalRiskEmployeePct,
        healthcareEmployeePct: options.compliance.nssfHealthcareEmployeePct,
        pensionEmployeePct: options.compliance.nssfPensionEmployeePct,
        pensionEmployeeCapKhr: options.compliance.nssfPensionEmployeeCapKhr,
        brackets: options.nssfBrackets,
      })
    : 0;

  const taxOnSalary = computeTaxOnSalary(grossSalary, options.taxDependents, {
    exchangeRateKhrPerUsd: exchangeRate,
    brackets: options.taxBrackets,
  });

  const deductions = {
    ...breakdown.deductions,
    nssf,
    taxOnSalary: Math.round(taxOnSalary * 100) / 100,
  };
  deductions.total =
    deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;

  const netSalary = Math.max(0, Math.round((grossSalary - deductions.total) * 100) / 100);

  return {
    ...breakdown,
    allowances,
    allowanceLines: overviewLines,
    allowancePackageName: options.allowancePackageName,
    grossSalary: Math.round(grossSalary * 100) / 100,
    deductions,
    netSalary,
    netSalaryKHR: usdToKhr(netSalary, exchangeRate),
    nssfDetail:
      nssfEnrolled && employeeNssf
        ? {
            monthlyWageKhr,
            assumedWageKhr: employeeNssf.assumedWageKhr,
            employeeOccupationalRiskKhr: employeeNssf.employeeOccupationalRiskKhr,
            employeeHealthcareKhr: employeeNssf.employeeHealthcareKhr,
            employeePensionKhr: employeeNssf.employeePensionKhr,
            employeeTotalKhr: employeeNssf.employeeTotalKhr,
          }
        : undefined,
  };
}

function buildLinesFromLegacy(allowances: AllowanceEngineLegacy): AllowancePreviewLine[] {
  const map: Array<[string, string, number]> = [
    ['TRANSPORT', 'Transport', allowances.transport],
    ['MEAL', 'Meal', allowances.meal],
    ['ATTENDANCE', 'Attendance', allowances.attendance],
    ['SENIORITY', 'Seniority', allowances.seniority],
    ['POSITION', 'Position', allowances.position],
    ['COMMISSION', 'Commission', allowances.commission],
  ];
  return map
    .filter(([, , amt]) => amt > 0)
    .map(([code, name, amount]) => ({ code, name, amount }));
}
