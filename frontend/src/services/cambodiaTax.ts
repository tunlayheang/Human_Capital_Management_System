import {
  AttendanceRecord,
  AttendanceStatus,
  LeaveRequest,
  LeaveStatus,
  User,
  SalaryBreakdown,
} from '../types';
import {
  calculateEmployeeNssfDeductionParts,
  employeeNssfDeductionUsd,
  type NssfWageBracket,
} from '../utils/nssfAssumedWage';
import { workHoursFromAttendanceRecord } from '../utils/payrollOvertime';
import {
  DEFAULT_PAYROLL_ENGINE_CONFIG,
  type PayrollEngineConfig,
} from '../utils/payrollEngineConfig';

import { computeTaxOnSalary } from '../utils/payrollTaxRate';
import type { PayrollTaxBracket } from '../types';
import { usdToKhr } from '../utils/payrollRulesCurrency';

const WORK_DAYS_PER_MONTH = 26;

function isPresentForBonus(status: AttendanceStatus | string): boolean {
  const st = String(status).toUpperCase();
  return st === AttendanceStatus.PRESENT || st === 'LATE';
}

export function computeSeniorityIndemnityUsd(
  baseSalary: number,
  monthPrefix: string,
  compliance: PayrollEngineConfig
): number {
  if (baseSalary <= 0) return 0;
  const monthNum = parseInt(monthPrefix.slice(5, 7), 10);
  const dailyRate = baseSalary / WORK_DAYS_PER_MONTH;
  if (monthNum === 6) {
    return Math.round(dailyRate * (compliance.seniorityPayoutJuneDays ?? 7.5) * 100) / 100;
  }
  if (monthNum === 12) {
    return Math.round(dailyRate * (compliance.seniorityPayoutDecemberDays ?? 7.5) * 100) / 100;
  }
  return 0;
}

/** Approved unpaid leave days overlapping a payroll month (mock / preview). */
export function countUnpaidLeaveDaysForMonth(
  leaves: LeaveRequest[],
  userId: string,
  monthPrefix: string
): number {
  const prefix = monthPrefix.slice(0, 7);
  const [y, m] = prefix.split('-').map(Number);
  if (!y || !m) return 0;
  const monthStart = `${prefix}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${prefix}-${String(lastDay).padStart(2, '0')}`;

  const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T12:00:00`);
  const overlap = (start: string, end: string) => {
    const from = parseDay(start) > parseDay(monthStart) ? parseDay(start) : parseDay(monthStart);
    const to = parseDay(end) < parseDay(monthEnd) ? parseDay(end) : parseDay(monthEnd);
    if (to < from) return 0;
    return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  };

  let total = 0;
  for (const row of leaves) {
    if (row.userId !== userId || row.status !== LeaveStatus.APPROVED) continue;
    const type = String(row.type ?? '').toLowerCase();
    if (type !== 'unpaid' && !type.includes('unpaid')) continue;
    total += overlap(row.startDate, row.endDate);
  }
  return total;
}

export const calculatePayrollForUser = (
  user: User,
  options?: {
    attendanceRecords?: AttendanceRecord[];
    monthPrefix?: string;
    nssfEnrolled?: boolean;
    nssfBrackets?: NssfWageBracket[];
    compliance?: PayrollEngineConfig;
    /** Approved overtime hours from Overtime module (only source for OT pay). */
    approvedOvertime?: { hours150: number; hours200: number };
    standardDailyHours?: number;
    taxBrackets?: PayrollTaxBracket[];
    unpaidLeaveDays?: number;
    /** Service seniority from Seniority Rules engine (0 when no active policy). */
    seniorityEntitlement?: number;
    /** Pre-computed Jun/Dec indemnity (Labor Law Art. 89). */
    seniorityIndemnityUsd?: number;
    /** @deprecated Use seniorityIndemnityUsd */
    applySeniorityIndemnity?: boolean;
  }
): SalaryBreakdown => {
  const compliance = options?.compliance ?? DEFAULT_PAYROLL_ENGINE_CONFIG;
  const exchangeRate = compliance.exchangeRate;
  const nssfEnrolled = options?.nssfEnrolled !== false;
  const nssfBrackets = options?.nssfBrackets;
  let baseSalary = user.salary || 0;
  const minimumWage = compliance.minimumWageUsd ?? 0;
  if (baseSalary > 0 && minimumWage > 0 && baseSalary < minimumWage) {
    baseSalary = minimumWage;
  }
  const standardDailyHours = options?.standardDailyHours ?? 8;
  const monthPrefix = options?.monthPrefix ?? new Date().toISOString().slice(0, 7);
  const records =
    options?.attendanceRecords?.filter((r) =>
      monthPrefix ? r.date.startsWith(monthPrefix) : true
    ) ?? [];

  const transport = baseSalary > 0 ? 30 : 0;
  const meal = baseSalary > 0 ? 50 : 0;
  const attendanceBonus =
    records.filter((r) => isPresentForBonus(r.status)).length >= 10 ? 70 : 0;
  const applySeniorityIndemnity = options?.applySeniorityIndemnity === true;
  const seniorityEntitlement = Math.max(0, Number(options?.seniorityEntitlement ?? 0));
  const seniorityIndemnity =
    options?.seniorityIndemnityUsd != null
      ? Math.max(0, Number(options.seniorityIndemnityUsd))
      : applySeniorityIndemnity
        ? computeSeniorityIndemnityUsd(baseSalary, monthPrefix, compliance)
        : 0;

  const hours150 = options?.approvedOvertime?.hours150 ?? 0;
  const hours200 = options?.approvedOvertime?.hours200 ?? 0;

  const hourlyRate =
    baseSalary > 0 && standardDailyHours > 0
      ? baseSalary / (WORK_DAYS_PER_MONTH * standardDailyHours)
      : 0;
  const amount150 =
    Math.round(hours150 * hourlyRate * compliance.otMultiplierNormal * 100) / 100;
  const amount200 =
    Math.round(hours200 * hourlyRate * compliance.otMultiplierPremium * 100) / 100;
  const overtimeTotal = amount150 + amount200;

  const allowances = { transport, attendance: attendanceBonus, meal, seniority: 0 };
  const grossSalary =
    baseSalary +
    seniorityIndemnity +
    seniorityEntitlement +
    allowances.transport +
    allowances.attendance +
    allowances.meal +
    overtimeTotal;

  const unpaidLeaveDays = options?.unpaidLeaveDays ?? 0;
  const dailyRate = baseSalary > 0 ? baseSalary / WORK_DAYS_PER_MONTH : 0;
  const absenceDeduction =
    unpaidLeaveDays > 0 && dailyRate > 0
      ? Math.round(dailyRate * unpaidLeaveDays * 100) / 100
      : 0;

  const monthlyWageKhr = usdToKhr(grossSalary, exchangeRate);
  const employeeNssf = nssfEnrolled
    ? calculateEmployeeNssfDeductionParts(monthlyWageKhr, {
        occupationalEmployeePct: compliance.nssfOccupationalRiskEmployeePct,
        healthcareEmployeePct: compliance.nssfHealthcareEmployeePct,
        pensionEmployeePct: compliance.nssfPensionEmployeePct,
        pensionEmployeeCapKhr: compliance.nssfPensionEmployeeCapKhr,
        brackets: nssfBrackets,
      })
    : null;
  const nssf = nssfEnrolled
    ? employeeNssfDeductionUsd(grossSalary, exchangeRate, {
        occupationalEmployeePct: compliance.nssfOccupationalRiskEmployeePct,
        healthcareEmployeePct: compliance.nssfHealthcareEmployeePct,
        pensionEmployeePct: compliance.nssfPensionEmployeePct,
        pensionEmployeeCapKhr: compliance.nssfPensionEmployeeCapKhr,
        brackets: nssfBrackets,
      })
    : 0;
  const nssfDetail = nssfEnrolled && employeeNssf
    ? {
        monthlyWageKhr,
        assumedWageKhr: employeeNssf.assumedWageKhr,
        employeeOccupationalRiskKhr: employeeNssf.employeeOccupationalRiskKhr,
        employeeHealthcareKhr: employeeNssf.employeeHealthcareKhr,
        employeePensionKhr: employeeNssf.employeePensionKhr,
        employeeTotalKhr: employeeNssf.employeeTotalKhr,
      }
    : undefined;
  const taxOnSalary = computeTaxOnSalary(grossSalary, user.dependents || 0, {
    exchangeRateKhrPerUsd: exchangeRate,
    brackets: options?.taxBrackets,
  });
  const deductions = {
    nssf,
    taxOnSalary: Math.round(taxOnSalary * 100) / 100,
    absences: absenceDeduction,
    advances: 0,
    total: 0,
  };
  deductions.total =
    deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;

  const netSalary = Math.max(0, Math.round((grossSalary - deductions.total) * 100) / 100);

  const presentDays = records.filter((r) => isPresentForBonus(r.status)).length;
  const totalWorkHours =
    Math.round(records.reduce((sum, rec) => sum + workHoursFromAttendanceRecord(rec), 0) * 100) /
    100;
  const proratedDays = Math.min(
    WORK_DAYS_PER_MONTH,
    Math.max(presentDays, WORK_DAYS_PER_MONTH - unpaidLeaveDays)
  );

  return {
    baseSalary,
    seniorityIndemnity: seniorityIndemnity > 0 ? seniorityIndemnity : undefined,
    seniorityEntitlement: seniorityEntitlement > 0 ? seniorityEntitlement : undefined,
    proratedDays,
    attendanceSummary: {
      recordsInPeriod: records.length,
      presentDays,
      totalWorkHours,
      standardHoursPerDay: standardDailyHours,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      dependents: user.dependents || 0,
    },
    allowances,
    overtime: {
      hours150: Math.round(hours150 * 100) / 100,
      amount150,
      hours200: Math.round(hours200 * 100) / 100,
      amount200,
      total: overtimeTotal,
    },
    grossSalary: Math.round(grossSalary * 100) / 100,
    deductions,
    netSalary,
    exchangeRate,
    netSalaryKHR: usdToKhr(netSalary, exchangeRate),
    nssfDetail,
  };
};
