import { User } from './db.js';
import { findEmployeeByUserId } from './employeeAttendanceSchedule.js';
import { findEmployeeWithCompensation } from './salaryStructureService.js';
import { computeNssfDual, type NssfWageBracket } from './nssfAssumedWage.js';
import type { PayrollComplianceEngineConfig } from './payrollComplianceRuleService.js';
import {
  computeSalaryTaxDual,
  usdBracketsToKhr,
  dependentDeductionUsd,
  type SalaryTaxBracketUsd,
} from './cambodiaSalaryTax.js';
import { workHoursFromAttendanceRecord } from './payrollOvertime.js';
import { computeOvertimePayUsd } from './payroll/payrollOvertimePay.js';
import {
  isPayableAttendanceStatus,
  isExcusedAttendanceStatus,
} from './payrollStatusClassificationConfig.js';
import { usdToKhr } from './usdToKhr.js';

/** Resolve display employee id (IROC00001) from portal userId. */
export async function resolvePayslipEmployeeId(userId: string): Promise<string> {
  const employee = await findEmployeeByUserId(userId);
  const plain = employee?.get ? employee.get({ plain: true }) : employee;
  return plain?.employee_id ?? userId;
}

export type PayrollAttendanceSummary = {
  recordsInPeriod: number;
  presentDays: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  /** Unexcused ABSENT only (excludes unpaid leave days). */
  absentDays?: number;
  /** Present + paid leave — informational only (salary uses basis days + absence deductions). */
  paidDays?: number;
  /** Payroll basis days (salary divisor) — independent of roster planning. */
  payrollBasisDays?: number;
  /** @deprecated Use payrollBasisDays — kept for stored payslip snapshots. */
  scheduledWorkDays?: number;
  lateCount?: number;
  overtimeHours?: number;
  /** Attendance metrics source label for audit display. */
  attendanceSource?: 'attendance_records';
  totalWorkHours: number;
  standardHoursPerDay: number;
  hourlyRate: number;
  /** Contract base ÷ payroll basis days — leave/absence daily deduction rate. */
  dailyRate?: number;
  dependents: number;
};

import type {
  HybridPayrollComponents,
  PayrollCalculationAudit,
} from './payroll/hybridPayrollTypes.js';
import { LEGACY_WORK_DAYS_PER_MONTH } from './payroll/payrollPeriodService.js';

export type PayrollBreakdown = {
  baseSalary: number;
  /** Full contract base before hire/resign proration (hybrid model). */
  contractBaseSalary?: number;
  hybrid?: HybridPayrollComponents;
  proratedDays: number;
  attendanceSummary?: PayrollAttendanceSummary;
  /** Semi-annual indemnity (June / December) per Labor Law Art. 89 — compliance config. */
  seniorityIndemnity?: number;
  seniorityIndemnitySnapshot?: import('./payroll/seniorityIndemnity/seniorityIndemnityTypes.js').SeniorityIndemnityCalculationResult;
  /** Service-based seniority entitlement (Seniority Engine — not allowance). */
  seniorityEntitlement?: number;
  senioritySnapshot?: import('./payroll/seniority/seniorityTypes.js').SeniorityCalculationSnapshot;
  allowances: {
    transport: number;
    attendance: number;
    meal: number;
    seniority: number;
    position?: number;
    commission?: number;
    otMeal?: number;
  };
  /** Rule engine snapshot (stored on payslip for audit / historical accuracy). */
  allowanceSnapshot?: {
    lines: Array<{
      code: string;
      name: string;
      amount: number;
      ruleId: string;
      ruleName: string;
      appliedConditions: Record<string, unknown>;
    }>;
    total: number;
    calculatedAt: string;
  };
  /** Simplified lines (for UI) derived from allowanceSnapshot. */
  allowanceLines?: Array<{ code: string; name: string; amount: number }>;
  /** Optional display label (when an allowance package was used). */
  allowancePackageName?: string;
  overtime: {
    hours100?: number;
    amount100?: number;
    hours150: number;
    amount150: number;
    hours200: number;
    amount200: number;
    total: number;
  };
  grossSalary: number;
  deductions: {
    /** Total employee NSSF deducted from pay (pension + configured occupational/healthcare shares). */
    nssf: number;
    taxOnSalary: number;
    absences: number;
    advances: number;
    total: number;
  };
  nssfDetail?: {
    assumedWageKhr: number;
    employeeOccupationalRiskKhr: number;
    employeeHealthcareKhr: number;
    employeePensionKhr: number;
    employeeTotalKhr: number;
    employerOccupationalRiskKhr: number;
    employerHealthcareKhr: number;
    employerPensionKhr: number;
    employerTotalKhr?: number;
    employerNssfUsd?: number;
  };
  netSalary: number;
  exchangeRate: number;
  netSalaryKHR: number;
  /** GDT dependent allowance applied before ToS (USD) — same as Employee Pay step. */
  taxDependentReliefUsd?: number;
  /** Gross minus dependent relief — taxable base for salary tax. */
  taxableBaseUsd?: number;
  taxableIncomeKhr?: number;
  taxableIncomeUsd?: number;
  taxAmountKhr?: number;
  taxAmountUsd?: number;
  exchangeRateUsed?: number;
  nssfSalaryKhr?: number;
  nssfSalaryUsd?: number;
  employeeContributionKhr?: number;
  employeeContributionUsd?: number;
  employerContributionKhr?: number;
  employerContributionUsd?: number;
  /** Marginal GDT bracket rate (%) for taxable base this period. */
  taxMarginalRatePct?: number;
  /** Roll-up of fixed allowances + seniority + indemnity + back pay (excludes base & OT). */
  allowanceTotalUsd?: number;
  /** Absence + advance deductions (excludes NSSF and tax). */
  otherDeductionsUsd?: number;
  /** HR / payment snapshot for payroll register review. */
  reviewSnapshot?: import('./payroll/payrollReviewContext.js').PayrollReviewSnapshot;
  /** Extended review context (department, proration, comparisons, flags). */
  reviewContext?: import('./payroll/payrollReviewContext.js').PayrollReviewContext;
  /** Prior-month approved adjustments rolled into this period. */
  backPayment?: number;
  backPaymentSourceMonth?: string;
  /** Calendar payroll audit — stored on new payslip snapshots only. */
  payrollAudit?: PayrollCalculationAudit;
};

const DEFAULT_EXCHANGE_RATE = 4100;

function isPresentForBonus(status: unknown): boolean {
  return isPayableAttendanceStatus(status);
}

/** Rest days and approved/planned leave are not unexcused absences for payroll. */
export function isPayrollExcusedAbsence(status: unknown): boolean {
  return isExcusedAttendanceStatus(status);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function workHoursFromRecord(rec: any): number {
  return workHoursFromAttendanceRecord(rec);
}


/** Normalize breakdown from DB (camelCase or legacy snake_case). */
export function normalizePayrollBreakdown(raw: unknown): PayrollBreakdown | null {
  if (raw == null) return null;
  let b: Record<string, unknown>;
  try {
    b = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;

  const allowancesRaw = (b.allowances ?? {}) as Record<string, unknown>;
  const overtimeRaw = (b.overtime ?? {}) as Record<string, unknown>;
  const deductionsRaw = (b.deductions ?? {}) as Record<string, unknown>;

  const baseSalary = num(b.baseSalary ?? b.base_salary ?? b.basicSalary);
  const seniorityIndemnity = num(b.seniorityIndemnity ?? b.seniority_indemnity);
  const grossSalary = num(b.grossSalary ?? b.gross_salary);
  let netSalary = num(b.netSalary ?? b.net_salary);

  if (baseSalary === 0 && grossSalary === 0 && netSalary === 0) {
    return null;
  }

  const allowances =
    typeof b.allowances === 'number'
      ? {
          transport: num(b.allowances),
          attendance: 0,
          meal: 0,
          seniority: 0,
        }
      : {
          transport: num(allowancesRaw.transport),
          attendance: num(allowancesRaw.attendance),
          meal: num(allowancesRaw.meal),
          seniority: num(allowancesRaw.seniority),
          position: num(allowancesRaw.position),
          commission: num(allowancesRaw.commission),
          otMeal: num(allowancesRaw.otMeal ?? allowancesRaw.ot_meal),
        };

  const overtime = {
    hours150: num(overtimeRaw.hours150 ?? overtimeRaw.hours_150),
    amount150: num(overtimeRaw.amount150 ?? overtimeRaw.amount_150),
    hours200: num(overtimeRaw.hours200 ?? overtimeRaw.hours_200),
    amount200: num(overtimeRaw.amount200 ?? overtimeRaw.amount_200),
    total: num(overtimeRaw.total),
  };

  const deductions = {
    nssf: num(deductionsRaw.nssf ?? deductionsRaw.social),
    taxOnSalary: num(
      deductionsRaw.taxOnSalary ?? deductionsRaw.tax_on_salary ?? deductionsRaw.tax
    ),
    absences: num(deductionsRaw.absences),
    advances: num(deductionsRaw.advances),
    total: num(deductionsRaw.total),
  };

  const resolvedGross =
    grossSalary ||
    baseSalary +
      seniorityIndemnity +
      allowances.transport +
      allowances.attendance +
      allowances.meal +
      allowances.seniority +
      num(allowances.position) +
      num(allowances.commission) +
      num(allowances.otMeal) +
      (overtime.total || overtime.amount150 + overtime.amount200);

  const dedTotal =
    deductions.total ||
    deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;
  const resolvedNet = netSalary || Math.max(0, resolvedGross - dedTotal);

  const summaryRaw = (b.attendanceSummary ?? b.attendance_summary) as Record<string, unknown> | undefined;

  const allowanceSnapshotRaw = (b.allowanceSnapshot ?? b.allowance_snapshot) as
    | Record<string, unknown>
    | undefined;
  const allowanceLines = (() => {
    const rawLines =
      (allowanceSnapshotRaw?.lines as Array<Record<string, unknown>> | undefined) ??
      (b.allowanceLines as Array<Record<string, unknown>> | undefined) ??
      (b.allowance_lines as Array<Record<string, unknown>> | undefined);
    if (!Array.isArray(rawLines)) return undefined;
    return rawLines
      .map((l) => ({
        code: String(l.code ?? '').toUpperCase(),
        name: String(l.name ?? ''),
        amount: num(l.amount),
      }))
      .filter((l) => l.code && (l.amount !== 0 || l.name));
  })();

  const hybridRaw = b.hybrid ?? b.hybrid_components;
  const hybridParsed =
    typeof hybridRaw === 'string'
      ? (() => {
          try {
            return JSON.parse(hybridRaw) as HybridPayrollComponents;
          } catch {
            return undefined;
          }
        })()
      : (hybridRaw as HybridPayrollComponents | undefined);

  const contractBaseSalary = (() => {
    const explicit = num(b.contractBaseSalary ?? b.contract_base_salary);
    if (explicit > 0) return explicit;
    const fromHybrid = num(hybridParsed?.fixed?.contractBaseSalary);
    if (fromHybrid > 0) return fromHybrid;
    const factor = num(hybridParsed?.fixed?.prorationFactor);
    if (baseSalary > 0 && factor > 0 && factor < 1) {
      return Math.round((baseSalary / factor) * 100) / 100;
    }
    return baseSalary > 0 ? baseSalary : undefined;
  })();

  const reviewRaw = (b.reviewSnapshot ?? b.review_snapshot) as Record<string, unknown> | undefined;
  const reviewContextRaw = b.reviewContext ?? b.review_context ?? b.reviewContextJson ?? b.review_context_json;

  const nssfDetailRaw = (b.nssfDetail ?? b.nssf_detail) as Record<string, unknown> | undefined;
  const nssfDetail = nssfDetailRaw
    ? {
        assumedWageKhr: num(nssfDetailRaw.assumedWageKhr ?? nssfDetailRaw.assumed_wage_khr),
        employeeOccupationalRiskKhr: num(
          nssfDetailRaw.employeeOccupationalRiskKhr ?? nssfDetailRaw.employee_occupational_risk_khr
        ),
        employeeHealthcareKhr: num(
          nssfDetailRaw.employeeHealthcareKhr ?? nssfDetailRaw.employee_healthcare_khr
        ),
        employeePensionKhr: num(
          nssfDetailRaw.employeePensionKhr ?? nssfDetailRaw.employee_pension_khr
        ),
        employeeTotalKhr: num(
          nssfDetailRaw.employeeTotalKhr ?? nssfDetailRaw.employee_total_khr
        ),
        employerOccupationalRiskKhr: num(
          nssfDetailRaw.employerOccupationalRiskKhr ?? nssfDetailRaw.employer_occupational_risk_khr
        ),
        employerHealthcareKhr: num(
          nssfDetailRaw.employerHealthcareKhr ?? nssfDetailRaw.employer_healthcare_khr
        ),
        employerPensionKhr: num(
          nssfDetailRaw.employerPensionKhr ?? nssfDetailRaw.employer_pension_khr
        ),
        employerTotalKhr: num(
          nssfDetailRaw.employerTotalKhr ?? nssfDetailRaw.employer_total_khr
        ),
        employerNssfUsd: num(nssfDetailRaw.employerNssfUsd ?? nssfDetailRaw.employer_nssf_usd),
      }
    : undefined;

  return reconcilePayrollBreakdown({
    baseSalary,
    contractBaseSalary,
    hybrid: hybridParsed,
    seniorityIndemnity: seniorityIndemnity || undefined,
    seniorityIndemnitySnapshot: (b.seniorityIndemnitySnapshot ??
      b.seniority_indemnity_snapshot) as PayrollBreakdown['seniorityIndemnitySnapshot'],
    proratedDays: num(b.proratedDays ?? b.prorated_days, 0),
    payrollAudit: (b.payrollAudit ?? b.payroll_audit) as PayrollCalculationAudit | undefined,
    attendanceSummary: summaryRaw
      ? {
          recordsInPeriod: num(summaryRaw.recordsInPeriod ?? summaryRaw.records_in_period),
          presentDays: num(summaryRaw.presentDays ?? summaryRaw.present_days),
          paidLeaveDays: num(summaryRaw.paidLeaveDays ?? summaryRaw.paid_leave_days),
          unpaidLeaveDays: num(summaryRaw.unpaidLeaveDays ?? summaryRaw.unpaid_leave_days),
          absentDays: num(summaryRaw.absentDays ?? summaryRaw.absent_days),
          scheduledWorkDays: (() => {
            const n = num(summaryRaw.scheduledWorkDays ?? summaryRaw.scheduled_work_days, 0);
            return n > 0 ? n : undefined;
          })(),
          paidDays: num(summaryRaw.paidDays ?? summaryRaw.paid_days),
          totalWorkHours: num(summaryRaw.totalWorkHours ?? summaryRaw.total_work_hours),
          standardHoursPerDay: num(
            summaryRaw.standardHoursPerDay ?? summaryRaw.standard_hours_per_day,
            8
          ),
          hourlyRate: num(summaryRaw.hourlyRate ?? summaryRaw.hourly_rate),
          dependents: num(summaryRaw.dependents),
        }
      : undefined,
    allowances,
    allowanceLines,
    allowancePackageName: (b.allowancePackageName ?? b.allowance_package_name) as string | undefined,
    overtime: {
      ...overtime,
      total: overtime.total || overtime.amount150 + overtime.amount200,
    },
    grossSalary: resolvedGross,
    taxDependentReliefUsd: num(b.taxDependentReliefUsd ?? b.tax_dependent_relief_usd) || undefined,
    taxableBaseUsd: num(b.taxableBaseUsd ?? b.taxable_base_usd) || undefined,
    taxMarginalRatePct: num(b.taxMarginalRatePct ?? b.tax_marginal_rate_pct) || undefined,
    allowanceTotalUsd: num(b.allowanceTotalUsd ?? b.allowance_total_usd) || undefined,
    otherDeductionsUsd: num(b.otherDeductionsUsd ?? b.other_deductions_usd) || undefined,
    seniorityEntitlement: num(b.seniorityEntitlement ?? b.seniority_entitlement) || undefined,
    backPayment: (() => {
      const raw = b.backPayment ?? b.back_payment;
      if (raw == null || raw === '') return undefined;
      const n = num(raw);
      return Number.isFinite(n) ? n : undefined;
    })(),
    backPaymentSourceMonth: (b.backPaymentSourceMonth ?? b.back_payment_source_month) as
      | string
      | undefined,
    nssfDetail,
    nssfSalaryKhr: num(b.nssfSalaryKhr ?? b.nssf_salary_khr) || undefined,
    nssfSalaryUsd: num(b.nssfSalaryUsd ?? b.nssf_salary_usd) || undefined,
    employeeContributionKhr:
      num(b.employeeContributionKhr ?? b.employee_contribution_khr) || undefined,
    employeeContributionUsd:
      num(b.employeeContributionUsd ?? b.employee_contribution_usd) || undefined,
    employerContributionKhr:
      num(b.employerContributionKhr ?? b.employer_contribution_khr) || undefined,
    employerContributionUsd:
      num(b.employerContributionUsd ?? b.employer_contribution_usd) || undefined,
    taxableIncomeKhr: num(b.taxableIncomeKhr ?? b.taxable_income_khr) || undefined,
    taxableIncomeUsd: num(b.taxableIncomeUsd ?? b.taxable_income_usd) || undefined,
    taxAmountKhr: num(b.taxAmountKhr ?? b.tax_amount_khr) || undefined,
    taxAmountUsd: num(b.taxAmountUsd ?? b.tax_amount_usd) || undefined,
    exchangeRateUsed: num(b.exchangeRateUsed ?? b.exchange_rate_used) || undefined,
    reviewSnapshot: reviewRaw
      ? {
          positionTitle: String(
            reviewRaw.positionTitle ?? reviewRaw.position_title ?? '—'
          ),
          bankName:
            reviewRaw.bankName != null || reviewRaw.bank_name != null
              ? String(reviewRaw.bankName ?? reviewRaw.bank_name ?? '').trim() || null
              : null,
          bankAccountNumber:
            reviewRaw.bankAccountNumber != null || reviewRaw.bank_account_number != null
              ? String(
                  reviewRaw.bankAccountNumber ?? reviewRaw.bank_account_number ?? ''
                ).trim() || null
              : null,
          paymentMethod: String(
            reviewRaw.paymentMethod ?? reviewRaw.payment_method ?? 'bank'
          ),
        }
      : undefined,
    reviewContext: (() => {
      if (reviewContextRaw == null) return undefined;
      if (typeof reviewContextRaw === 'object') {
        return reviewContextRaw as PayrollBreakdown['reviewContext'];
      }
      if (typeof reviewContextRaw === 'string' && reviewContextRaw.trim()) {
        try {
          return JSON.parse(reviewContextRaw) as PayrollBreakdown['reviewContext'];
        } catch {
          return undefined;
        }
      }
      return undefined;
    })(),
    deductions: {
      ...deductions,
      total: dedTotal,
    },
    netSalary: resolvedNet,
    exchangeRate: num(b.exchangeRate ?? b.exchange_rate, DEFAULT_EXCHANGE_RATE),
    netSalaryKHR: num(b.netSalaryKHR ?? b.net_salary_khr, usdToKhr(resolvedNet, DEFAULT_EXCHANGE_RATE)),
  });
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Monthly amounts at/above this are treated as KHR stored in a USD field. */
const PAYROLL_USD_KHR_MIX_THRESHOLD = 25_000;

function coercePayrollUsdAmount(amount: number, exchangeRate: number): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return 0;
  const ex = exchangeRate > 0 ? exchangeRate : DEFAULT_EXCHANGE_RATE;
  if (Math.abs(n) >= PAYROLL_USD_KHR_MIX_THRESHOLD) {
    return roundUsd(n / ex);
  }
  return roundUsd(n);
}

function preferUsdWhenKhrStored(
  usdSlot: number,
  canonicalUsd: number | null | undefined,
  companionKhr: number | null | undefined,
  exchangeRate: number
): number {
  const slot = Number(usdSlot) || 0;
  const usd = canonicalUsd != null ? Number(canonicalUsd) : NaN;
  const khr = companionKhr != null ? Number(companionKhr) : NaN;
  if (Number.isFinite(usd) && usd >= 0) {
    const slotLooksLikeKhr =
      Math.abs(slot) >= PAYROLL_USD_KHR_MIX_THRESHOLD ||
      (Number.isFinite(khr) && khr > 0 && Math.abs(slot - khr) < 1);
    if (slotLooksLikeKhr) return coercePayrollUsdAmount(usd, exchangeRate);
  }
  return coercePayrollUsdAmount(slot, exchangeRate);
}

/** Fix USD/KHR mix-ups; ensure net = gross − deductions. */
export function reconcilePayrollBreakdown(b: PayrollBreakdown): PayrollBreakdown {
  const exchangeRate = b.exchangeRate || DEFAULT_EXCHANGE_RATE;
  const gross = coercePayrollUsdAmount(Number(b.grossSalary) || 0, exchangeRate);
  const d = b.deductions;
  const nssf = preferUsdWhenKhrStored(
    Number(d.nssf) || 0,
    b.employeeContributionUsd,
    b.employeeContributionKhr,
    exchangeRate
  );
  const taxOnSalary = preferUsdWhenKhrStored(
    Number(d.taxOnSalary) || 0,
    b.taxAmountUsd,
    b.taxAmountKhr,
    exchangeRate
  );
  let absences = coercePayrollUsdAmount(Number(d.absences) || 0, exchangeRate);
  if (gross > 0 && absences > gross * 2 && exchangeRate > 0) {
    absences = roundUsd(absences / exchangeRate);
  }
  const advances = coercePayrollUsdAmount(Number(d.advances) || 0, exchangeRate);
  const dedTotal = roundUsd(nssf + taxOnSalary + absences + advances);

  let netUsd = coercePayrollUsdAmount(Number(b.netSalary) || 0, exchangeRate);
  let netKhr = Number(b.netSalaryKHR) || 0;

  if (netUsd > Math.max(gross * 1.5, PAYROLL_USD_KHR_MIX_THRESHOLD) && exchangeRate > 0) {
    if (netKhr <= netUsd) netKhr = netUsd;
    netUsd = roundUsd(netKhr / exchangeRate);
  }

  if (netKhr > 0 && netKhr < gross * 2 && netUsd > gross * 3 && exchangeRate > 0) {
    const usdFromKhr = roundUsd(netKhr);
    netKhr = Math.round(netUsd);
    netUsd = usdFromKhr;
  }

  const expectedNet = roundUsd(Math.max(0, gross - dedTotal));
  // After coercing USD fields, net must follow gross − deductions.
  if (Math.abs(netUsd - expectedNet) > 0.05) {
    netUsd = expectedNet;
  }

  if (netKhr <= 0 && netUsd > 0) {
    netKhr = usdToKhr(netUsd, exchangeRate);
  } else if (
    netUsd > 0 &&
    exchangeRate > 0 &&
    Math.abs(netKhr - netUsd * exchangeRate) > exchangeRate * 2
  ) {
    netKhr = usdToKhr(netUsd, exchangeRate);
  }

  return {
    ...b,
    baseSalary: coercePayrollUsdAmount(Number(b.baseSalary) || 0, exchangeRate),
    deductions: {
      ...d,
      nssf,
      taxOnSalary,
      absences,
      advances,
      total: dedTotal,
    },
    grossSalary: gross,
    netSalary: netUsd,
    netSalaryKHR: netKhr,
    exchangeRate,
    taxDependentReliefUsd:
      b.taxDependentReliefUsd != null
        ? coercePayrollUsdAmount(Number(b.taxDependentReliefUsd) || 0, exchangeRate)
        : b.taxDependentReliefUsd,
    taxableBaseUsd:
      b.taxableBaseUsd != null
        ? coercePayrollUsdAmount(Number(b.taxableBaseUsd) || 0, exchangeRate)
        : b.taxableBaseUsd,
  };
}

function computeSeniorityIndemnityUsd(
  baseSalary: number,
  month: string,
  compliance?: PayrollComplianceEngineConfig,
  scheduledWorkingDays = LEGACY_WORK_DAYS_PER_MONTH
): number {
  if (baseSalary <= 0 || !compliance) return 0;
  const monthNum = parseInt(month.slice(5, 7), 10);
  const divisor = scheduledWorkingDays > 0 ? scheduledWorkingDays : LEGACY_WORK_DAYS_PER_MONTH;
  const dailyRate = baseSalary / divisor;
  if (monthNum === 6) {
    return Math.round(dailyRate * (compliance.seniorityPayoutJuneDays ?? 7.5) * 100) / 100;
  }
  if (monthNum === 12) {
    return Math.round(dailyRate * (compliance.seniorityPayoutDecemberDays ?? 7.5) * 100) / 100;
  }
  return 0;
}

export function calculatePayrollForPortalUser(params: {
  user: any;
  employee: any | null;
  attendance: any[];
  month: string;
  compliance?: PayrollComplianceEngineConfig;
  nssfBrackets?: NssfWageBracket[];
  /** Approved overtime hours from Overtime module (only source for OT pay). */
  approvedOvertime?: { hours100?: number; hours150: number; hours200: number };
  taxBrackets?: SalaryTaxBracketUsd[];
  /** Approved unpaid leave days in month (deducted from pay). */
  unpaidLeaveDays?: number;
  /** Pre-computed allowance engine output (Payroll → Rules). */
  allowanceEngine?: import('./allowanceRuleEngine.js').AllowanceEngineResult;
  /** Scheduled working days in pay period (calendar engine divisor). */
  scheduledWorkingDaysPerMonth?: number;
  /** Inclusive payroll period window (cutoff-to-cutoff). When set, attendance is filtered by range. */
  periodStart?: string;
  periodEnd?: string;
  /** From Seniority Rules Engine (separate from allowances). */
  seniorityEntitlement?: import('./payroll/seniority/seniorityEngineService.js').SeniorityPayrollResult;
  /** Pre-resolved Jun/Dec indemnity (Labor Law Art. 89). */
  seniorityIndemnityResult?: import('./payroll/seniorityIndemnity/seniorityIndemnityTypes.js').SeniorityIndemnityCalculationResult;
  /** @deprecated Use seniorityIndemnityResult — kept for legacy direct calls. */
  applySeniorityIndemnity?: boolean;
}): PayrollBreakdown {
  const {
    user,
    employee,
    attendance,
    month,
    compliance,
    nssfBrackets,
    approvedOvertime,
    taxBrackets,
    unpaidLeaveDays = 0,
    allowanceEngine,
    scheduledWorkingDaysPerMonth,
    periodStart: periodStartBound,
    periodEnd: periodEndBound,
    seniorityEntitlement: seniorityPayroll,
    seniorityIndemnityResult,
    applySeniorityIndemnity = true,
  } = params;
  const monthPrefix = month.slice(0, 7);
  const workingDaysDivisor =
    scheduledWorkingDaysPerMonth && scheduledWorkingDaysPerMonth > 0
      ? scheduledWorkingDaysPerMonth
      : LEGACY_WORK_DAYS_PER_MONTH;
  const exchangeRate = compliance?.exchangeRate ?? DEFAULT_EXCHANGE_RATE;
  const otNormal = compliance?.otMultiplierNormal ?? 1.5;
  const otPremium = compliance?.otMultiplierPremium ?? 2;
  const pensionEmployeePct = compliance?.nssfPensionEmployeePct ?? 2;
  const pensionEmployeeCapKhr = compliance?.nssfPensionEmployeeCapKhr ?? 24_000;
  const occupationalEmployeePct = compliance?.nssfOccupationalRiskEmployeePct ?? 0;
  const occupationalEmployerPct = compliance?.nssfOccupationalRiskEmployerPct ?? 0.8;
  const healthcareEmployeePct = compliance?.nssfHealthcareEmployeePct ?? 0;
  const healthcareEmployerPct = compliance?.nssfHealthcareEmployerPct ?? 2.6;
  const pensionEmployerPct = compliance?.nssfPensionEmployerPct ?? 2;
  let baseSalary = num(
    employee?.base_salary ??
      employee?.salary_structure?.base_salary ??
      user?.salary
  );
  const minimumWage = compliance?.minimumWageUsd ?? 0;
  if (baseSalary > 0 && minimumWage > 0 && baseSalary < minimumWage) {
    baseSalary = minimumWage;
  }
  const standardDailyHours = num(employee?.work_hours, 8);
  const workDays = num(employee?.work_days, 5);
  const nssfEnrolled = employee?.nssf_enrolled !== false;
  const dependents = Math.max(
    0,
    Math.floor(num(employee?.tax_dependents ?? user?.dependents))
  );

  const legacyFromEngine = allowanceEngine?.legacy;
  const transportAllowance =
    legacyFromEngine?.transport ?? (baseSalary > 0 ? 30 : 0);
  const mealAllowance = legacyFromEngine?.meal ?? (baseSalary > 0 ? 50 : 0);
  const attendanceBonus =
    legacyFromEngine?.attendance ??
    (attendance.filter((r) => isPresentForBonus(r.status)).length >= 10 ? 70 : 0);
  const seniorityFromEngine = roundUsd(seniorityPayroll?.payoutUsd ?? 0);
  const seniority = seniorityFromEngine;
  const positionAllowance = legacyFromEngine?.position ?? 0;
  const commissionAllowance = legacyFromEngine?.commission ?? 0;
  /** OT meal allowance retired — organizations provide meals physically. */
  const otMealAllowance = 0;
  const seniorityIndemnity = seniorityIndemnityResult
    ? seniorityIndemnityResult.eligible
      ? seniorityIndemnityResult.payoutUsd
      : 0
    : applySeniorityIndemnity
      ? computeSeniorityIndemnityUsd(baseSalary, month, compliance, workingDaysDivisor)
      : 0;

  const allowanceSnapshot = allowanceEngine
    ? {
        lines: allowanceEngine.audit.map((l) => ({
          code: l.code,
          name: l.name,
          amount: l.amount,
          ruleId: l.ruleId,
          ruleName: l.ruleName,
          appliedConditions: l.appliedConditions,
        })),
        total: allowanceEngine.total,
        calculatedAt: new Date().toISOString(),
      }
    : undefined;
  const allowanceLines = allowanceSnapshot
    ? allowanceSnapshot.lines.map((l) => ({ code: l.code, name: l.name, amount: l.amount }))
    : undefined;

  const otPay = computeOvertimePayUsd({
    hours100: approvedOvertime?.hours100 ?? 0,
    hours150: approvedOvertime?.hours150 ?? 0,
    hours200: approvedOvertime?.hours200 ?? 0,
    contractBaseSalary: baseSalary,
    scheduledWorkingDays: workingDaysDivisor,
    standardHoursPerDay: standardDailyHours,
    multiplier150: otNormal,
    multiplier200: otPremium,
  });
  const {
    hours100,
    hours150,
    hours200,
    amount100,
    amount150,
    amount200,
    total: overtimeTotal,
    hourlyRate,
  } = otPay;

  const allowances = {
    transport: transportAllowance,
    attendance: attendanceBonus,
    meal: mealAllowance,
    seniority: 0,
    position: positionAllowance,
    commission: commissionAllowance,
    otMeal: otMealAllowance,
  };

  const grossSalary =
    baseSalary +
    seniorityIndemnity +
    seniorityFromEngine +
    allowances.transport +
    allowances.attendance +
    allowances.meal +
    num(allowances.position) +
    num(allowances.commission) +
    num(allowances.otMeal) +
    overtimeTotal;

  const dailyRate = baseSalary > 0 ? baseSalary / workingDaysDivisor : 0;
  const absenceDeduction =
    unpaidLeaveDays > 0 && dailyRate > 0
      ? Math.round(dailyRate * unpaidLeaveDays * 100) / 100
      : 0;

  const nssfDual = computeNssfDual({
    monthlyGrossUsd: grossSalary,
    exchangeRateKhrPerUsd: exchangeRate,
    nssfEnrolled,
    occupationalEmployeePct,
    healthcareEmployeePct,
    pensionEmployeePct,
    pensionEmployeeCapKhr,
    occupationalEmployerPct,
    healthcareEmployerPct,
    pensionEmployerPct,
    brackets: nssfBrackets,
  });
  const nssf = nssfDual.employeeContributionUsd;
  const nssfDetail = nssfDual.nssfDetail;
  const taxDependentReliefUsd = dependentDeductionUsd(dependents, exchangeRate);
  const taxDual = computeSalaryTaxDual({
    monthlyGrossUsd: grossSalary,
    taxDependents: dependents,
    exchangeRateKhrPerUsd: exchangeRate,
    bracketsKhr: taxBrackets?.length ? usdBracketsToKhr(taxBrackets, exchangeRate) : undefined,
  });
  const taxableBaseUsd = taxDual.taxableIncomeUsd;
  const deductions = {
    nssf,
    taxOnSalary: taxDual.taxOnSalaryUsd,
    absences: absenceDeduction,
    advances: 0,
    total: 0,
  };
  deductions.total = deductions.nssf + deductions.taxOnSalary + deductions.absences + deductions.advances;

  const netSalary = Math.max(0, Math.round((grossSalary - deductions.total) * 100) / 100);

  const periodStart = periodStartBound?.slice(0, 10) || '';
  const periodEnd = periodEndBound?.slice(0, 10) || '';
  const monthRecords = attendance.filter((r) => {
    const d = String(r.date || '').slice(0, 10);
    if (!d) return false;
    if (periodStart && periodEnd) return d >= periodStart && d <= periodEnd;
    return d.startsWith(monthPrefix);
  });
  const presentDates = new Set<string>();
  for (const r of monthRecords) {
    if (!isPresentForBonus(r.status)) continue;
    const d = String(r.date ?? '').slice(0, 10);
    if (d) presentDates.add(d);
  }
  const presentDays = presentDates.size;
  /** Paid days for proration — hybrid engine overwrites with present + paid leave count. */
  const proratedDays = 0;
  const totalWorkHours =
    Math.round(monthRecords.reduce((sum, r) => sum + workHoursFromRecord(r), 0) * 100) / 100;

  return reconcilePayrollBreakdown({
    baseSalary,
    seniorityIndemnity: seniorityIndemnity > 0 ? seniorityIndemnity : undefined,
    seniorityIndemnitySnapshot: seniorityIndemnityResult ?? undefined,
    seniorityEntitlement: seniorityFromEngine > 0 ? seniorityFromEngine : undefined,
    senioritySnapshot: seniorityPayroll?.snapshot,
    taxDependentReliefUsd,
    taxableBaseUsd,
    taxableIncomeKhr: taxDual.taxableIncomeKhr,
    taxableIncomeUsd: taxDual.taxableIncomeUsd,
    taxAmountKhr: taxDual.taxAmountKhr,
    taxAmountUsd: taxDual.taxAmountUsd,
    exchangeRateUsed: taxDual.exchangeRateUsed,
    nssfSalaryKhr: nssfDual.nssfSalaryKhr,
    nssfSalaryUsd: nssfDual.nssfSalaryUsd,
    employeeContributionKhr: nssfDual.employeeContributionKhr,
    employeeContributionUsd: nssfDual.employeeContributionUsd,
    employerContributionKhr: nssfDual.employerContributionKhr,
    employerContributionUsd: nssfDual.employerContributionUsd,
    proratedDays,
    attendanceSummary: {
      recordsInPeriod: monthRecords.length,
      presentDays,
      totalWorkHours,
      standardHoursPerDay: standardDailyHours,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      dependents,
    },
    allowances,
    allowanceSnapshot,
    allowanceLines,
    overtime: {
      hours100: Math.round(hours100 * 100) / 100,
      amount100,
      hours150: Math.round(hours150 * 100) / 100,
      amount150,
      hours200: Math.round(hours200 * 100) / 100,
      amount200,
      total: overtimeTotal,
    },
    grossSalary: Math.round(grossSalary * 100) / 100,
    deductions,
    nssfDetail,
    netSalary,
    exchangeRate,
    netSalaryKHR: usdToKhr(netSalary, exchangeRate),
  });
}

export async function buildBreakdownForUserId(
  userId: string,
  month: string,
  options?: {
    skipFinalizationCheck?: boolean;
    lastWorkingDate?: string;
    payrollRunType?: 'MONTHLY' | 'FINAL_SETTLEMENT';
    /** Preloaded month context (payroll preview / run batch). */
    engineCache?: import('./payroll/payrollEngineCache.js').PayrollEngineCache;
    /** Skip duplicate employee + compensation lookup when batching. */
    employee?: Record<string, unknown> | null;
    /** Write unified rule evaluation rows to payroll_rule_logs (default true). */
    persistRuleLogs?: boolean;
  }
): Promise<PayrollBreakdown> {
  const { getApprovedOvertimeHoursForMonth } = await import('./overtimeRequestService.js');
  const { countApprovedUnpaidLeaveDays } = await import('./payrollLeaveDeductions.js');
  const { filterAttendanceForPayroll } = await import('./payroll/payrollPeriodService.js');
  const { calculateHybridPayrollForPortalUser } = await import('./payroll/hybridPayrollEngine.js');

  const cache = options?.engineCache;
  const monthPrefix = month.slice(0, 7);
  let compliance: import('./payrollComplianceRuleService.js').PayrollComplianceEngineConfig;
  let nssfBrackets: import('./nssfAssumedWage.js').NssfWageBracket[];
  let taxBrackets: import('./cambodiaSalaryTax.js').SalaryTaxBracketUsd[];
  let period: import('./payroll/hybridPayrollTypes.js').PayrollPeriodBounds;
  let attPeriod: { status: string };

  if (cache) {
    compliance = cache.compliance;
    nssfBrackets = cache.nssfBrackets;
    taxBrackets = cache.taxBrackets;
    period = cache.period;
    attPeriod = cache.attPeriod as { status: string };
  } else {
    const { loadPayrollEngineInputs } = await import('./payrollEngineInputs.js');
    const { resolvePayrollPeriod } = await import('./payroll/payrollPeriodService.js');
    const { getAttendancePeriod } = await import('./payroll/attendanceFinalizationService.js');
    const loaded = await loadPayrollEngineInputs();
    compliance = loaded.compliance;
    nssfBrackets = loaded.nssfBrackets;
    taxBrackets = loaded.taxBrackets;
    period = await resolvePayrollPeriod(monthPrefix);
    attPeriod = await getAttendancePeriod(monthPrefix);
  }

  if (
    !options?.skipFinalizationCheck &&
    attPeriod.status !== 'FINALIZED' &&
    attPeriod.status !== 'LOCKED'
  ) {
    const err = new Error(
      `Attendance for ${monthPrefix} must be finalized before payroll calculation.`
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const user = await User.findByPk(userId);
  if (!user) {
    const empty = calculatePayrollForPortalUser({
      user: { salary: 0, dependents: 0 },
      employee: null,
      attendance: [],
      month,
      compliance,
      nssfBrackets,
      taxBrackets,
    });
    return empty;
  }

  let employee =
    options?.employee !== undefined
      ? options.employee
      : await findEmployeeWithCompensation(userId);

  if (employee?.id) {
    const taxDepsAlreadySet = employee.tax_dependents != null && employee.tax_dependents !== '';
    if (!taxDepsAlreadySet) {
      const { resolveTaxDependentsForEmployeeRow } = await import('./employeeChildrenService.js');
      try {
        const taxDeps = await resolveTaxDependentsForEmployeeRow(employee);
        employee = { ...employee, tax_dependents: taxDeps };
      } catch (taxDepErr) {
        console.warn(
          `[payroll] Tax dependents lookup skipped for ${userId}:`,
          (taxDepErr as Error)?.message || taxDepErr
        );
      }
    }
  }
  const { resolveLastWorkingDate, filterRecordsThroughLastWorkingDate } = await import(
    './payroll/employeePayrollEligibility.js'
  );
  const { getProrationConfig } = await import('./payroll/prorationConfigService.js');
  const prorationConfigResolved = cache?.prorationConfig ?? (await getProrationConfig());

  const lwd =
    options?.lastWorkingDate?.slice(0, 10) ?? resolveLastWorkingDate(employee ?? {});

  let attEnd =
    period.attendanceCutoffDate && period.attendanceCutoffDate <= period.payPeriodEnd
      ? period.attendanceCutoffDate
      : period.payPeriodEnd;
  if (lwd && lwd < attEnd) attEnd = lwd;

  const attendanceFinalized =
    attPeriod.status === 'FINALIZED' || attPeriod.status === 'LOCKED';

  // Batch payroll reconciles once in buildPayrollRunItemsForMonth — not per employee.
  if (!cache) {
    try {
      const { reconcileAttendanceAbsences } = await import('./attendanceReconcileService.js');
      await reconcileAttendanceAbsences({
        from: period.payPeriodStart,
        to: attEnd,
      });
    } catch (reconcileErr) {
      console.warn(
        '[payroll] Attendance reconcile before calculation skipped:',
        (reconcileErr as Error)?.message || reconcileErr
      );
    }
  }

  const attendanceRows = cache?.estimateMode
    ? []
    : (cache?.attendanceGridByUserId?.get(userId) ??
      (await (async () => {
        const { loadPayrollAttendanceForUser } = await import(
          './payroll/payrollAttendanceRecordService.js'
        );
        return loadPayrollAttendanceForUser({
          userId,
          periodStart: period.payPeriodStart,
          periodEnd: attEnd,
        });
      })()));

  const { buildApprovedLeaveByDateForUsers } = await import('./approvedLeaveDayMap.js');
  const approvedOvertimeFromCache = cache?.approvedOvertimeByUserId?.get(userId);
  const unpaidLeaveFromCache = cache?.unpaidLeaveDaysByUserId?.get(userId);
  const [approvedOvertimeFetched, unpaidLeaveDays, approvedLeaveRaw] = await Promise.all([
    approvedOvertimeFromCache
      ? Promise.resolve(approvedOvertimeFromCache)
      : getApprovedOvertimeHoursForMonth(userId, monthPrefix, lwd, {
          periodStart: period.payPeriodStart,
          periodEnd: period.payPeriodEnd,
        }),
    unpaidLeaveFromCache != null
      ? Promise.resolve(unpaidLeaveFromCache)
      : countApprovedUnpaidLeaveDays(userId, monthPrefix, {
          periodStart: period.payPeriodStart,
          periodEnd: attEnd,
        }),
    cache?.approvedLeaveByDateMap
      ? Promise.resolve(cache.approvedLeaveByDateMap)
      : buildApprovedLeaveByDateForUsers([userId], period.payPeriodStart, attEnd),
  ]);
  const approvedOvertimeRaw = approvedOvertimeFetched;

  // Per-date leave map (keyed by YYYY-MM-DD) for this user + the paid-leave date set.
  const approvedLeaveByDate = new Map<string, import('./approvedLeaveDayMap.js').LeaveDayInfo>();
  const paidLeaveDates = new Set<string>();
  const unpaidLeaveDates = new Set<string>();
  const leavePrefix = `${userId}:`;
  for (const [key, info] of approvedLeaveRaw) {
    if (!key.startsWith(leavePrefix)) continue;
    const dateKey = key.slice(leavePrefix.length);
    approvedLeaveByDate.set(dateKey, info);
    if (info.isPaid) paidLeaveDates.add(dateKey);
    else unpaidLeaveDates.add(dateKey);
  }

  const { dedupeAttendanceRecordsByDate } = await import(
    './payroll/payrollAttendanceRecordService.js'
  );
  let enrichedAttendance = filterAttendanceForPayroll(
    attendanceRows,
    monthPrefix,
    period.attendanceCutoffDate,
    { periodStart: period.payPeriodStart, periodEnd: period.payPeriodEnd }
  );
  enrichedAttendance = dedupeAttendanceRecordsByDate(enrichedAttendance);
  enrichedAttendance = filterRecordsThroughLastWorkingDate(enrichedAttendance, lwd);
  if (cache?.estimateMode) {
    enrichedAttendance = [];
  }

  const attendanceStatusForEngine = cache?.estimateMode ? 'OPEN' : attPeriod.status;

  const { blocksOtAndAllowances } = await import('./payroll/employeePayrollEligibility.js');
  const approvedOvertime = blocksOtAndAllowances(employee ?? null)
    ? { hours100: 0, hours150: 0, hours200: 0 }
    : approvedOvertimeRaw;

  const userPlain = user.get({ plain: true }) as Record<string, unknown>;

  let payrollBasisAudit:
    | Awaited<
        ReturnType<
          typeof import('./payroll/payrollBasisAuditService.js').resolvePayrollBasisAuditForEmployee
        >
      >
    | undefined;
  let workDayPolicyResolved = cache?.workDayPolicy;
  if (!workDayPolicyResolved) {
    const { getPayrollWorkDayPolicy } = await import('./payroll/payrollBasisDaysService.js');
    workDayPolicyResolved = await getPayrollWorkDayPolicy(monthPrefix);
  }
  if (employee?.id) {
    const { resolvePayrollBasisAuditForEmployee } = await import(
      './payroll/payrollBasisAuditService.js'
    );
    payrollBasisAudit = await resolvePayrollBasisAuditForEmployee({
      periodStart: period.payPeriodStart,
      periodEnd: period.payPeriodEnd,
      joinDate: employee.join_date,
      lastWorkingDate: lwd,
      terminationDate: employee?.termination_date ?? employee?.resign_date ?? null,
      employeeBasisDays: employee.payroll_basis_days,
      prorationMethod: prorationConfigResolved.method,
      payrollProcessingType:
        options?.payrollRunType === 'FINAL_SETTLEMENT' ? 'FINAL_SETTLEMENT' : 'MONTHLY',
      workDayPolicy: workDayPolicyResolved,
    });
  }

  const { buildPayrollAttendanceSnapshot } = await import(
    './payroll/payrollAttendanceSnapshot.js'
  );

  let unifiedRulePipeline: Awaited<
    ReturnType<
      typeof import('./payroll/unifiedPayrollRulePipeline.js').runUnifiedPayrollRulePipeline
    >
  > | null = null;

  if (employee?.id) {
    const preRulesSnapshot = buildPayrollAttendanceSnapshot({
      attendance: enrichedAttendance,
      periodStart: period.payPeriodStart,
      periodEnd: period.payPeriodEnd,
      joinDate: employee.join_date,
      lastWorkingDate: lwd,
      payrollBasisDays: payrollBasisAudit?.payrollBasisDays ?? LEGACY_WORK_DAYS_PER_MONTH,
      eligibleBasisDays: payrollBasisAudit?.eligibleWorkingDays,
      paidLeaveDates,
      unpaidLeaveDates,
      leaveByDate: approvedLeaveByDate,
    });
    const { runUnifiedPayrollRulePipeline } = await import(
      './payroll/unifiedPayrollRulePipeline.js'
    );
    try {
      unifiedRulePipeline = await runUnifiedPayrollRulePipeline({
        month: monthPrefix,
        employeeId: String(employee.id),
        employeeDisplayId: String(employee.employee_id ?? ''),
        userId,
        employeeStatus: String(employee.status ?? 'ACTIVE'),
        accessRole: String(employee.access_role ?? userPlain.role ?? 'EMPLOYEE'),
        departmentId: employee.department_id,
        positionId: employee.position_id,
        positionTitle: employee.position_title ?? null,
        joinDate: employee.join_date,
        baseSalary: num(employee.base_salary ?? employee.salary_structure?.base_salary),
        attendance: enrichedAttendance,
        leaveByDate: approvedLeaveByDate,
        paidLeaveDates,
        unpaidLeaveDates,
        presentDays: preRulesSnapshot.presentDays,
        absentDays: preRulesSnapshot.absentDays,
        paidLeaveDays: preRulesSnapshot.paidLeaveDays,
        persistLogs: options?.persistRuleLogs !== false,
      });
      paidLeaveDates.clear();
      unpaidLeaveDates.clear();
      for (const d of unifiedRulePipeline.adjustedPaidLeaveDates) paidLeaveDates.add(d);
      for (const d of unifiedRulePipeline.adjustedUnpaidLeaveDates) unpaidLeaveDates.add(d);
    } catch (ruleErr) {
      console.warn(
        `[payroll] Unified rule pipeline skipped for ${userId}:`,
        (ruleErr as Error)?.message || ruleErr
      );
    }
  }

  const attendanceSnapshot = buildPayrollAttendanceSnapshot({
    attendance: enrichedAttendance,
    periodStart: period.payPeriodStart,
    periodEnd: period.payPeriodEnd,
    joinDate: employee?.join_date,
    lastWorkingDate: lwd,
    payrollBasisDays: payrollBasisAudit?.payrollBasisDays ?? LEGACY_WORK_DAYS_PER_MONTH,
    eligibleBasisDays: payrollBasisAudit?.eligibleWorkingDays,
    paidLeaveDates,
    unpaidLeaveDates,
    leaveByDate: approvedLeaveByDate,
    dependents: num(employee?.tax_dependents ?? userPlain.dependents),
  });

  const { calculateAllowancesForEmployee } = await import('./allowanceRuleEngine.js');
  let allowanceEngine;
  if (employee?.id) {
    try {
      const empKey = String(employee.id);
      let salesAmount = 0;
      if (cache?.salesAmountByEmployeeId) {
        salesAmount = cache.salesAmountByEmployeeId.get(empKey) ?? 0;
      } else {
        const { loadMonthlySalesMapByEmployeeId } = await import(
          './payroll/employeeMonthlySalesService.js'
        );
        const map = await loadMonthlySalesMapByEmployeeId(monthPrefix);
        salesAmount = map.get(empKey) ?? 0;
      }
      allowanceEngine = await calculateAllowancesForEmployee({
        employeeInternalId: String(employee.id),
        employeeDisplayId: String(employee.employee_id ?? ''),
        userId,
        month: monthPrefix,
        periodStart: period.payPeriodStart,
        periodEnd: period.payPeriodEnd,
        baseSalary: num(employee.base_salary ?? employee.salary_structure?.base_salary),
        joinDate: employee.join_date,
        departmentId: employee.department_id,
        positionId: employee.position_id,
        accessRole: String(employee.access_role ?? userPlain.role ?? 'EMPLOYEE'),
        attendance: enrichedAttendance,
        approvedOvertime,
        unpaidLeaveDays,
        gracePeriodMinutes: num(employee.grace_period_minutes),
        standardDailyHours: num(employee.work_hours, 8),
        salesAmount,
      });
    } catch (allowanceErr) {
      console.warn(
        `[payroll] Allowance engine skipped for ${userId}:`,
        (allowanceErr as Error)?.message || allowanceErr
      );
    }
  }

  const latePenaltyPerOccurrenceUsd = num(
    (compliance as Record<string, unknown>)?.latePenaltyPerOccurrenceUsd
  );

  const { stripSeniorityFromAllowanceEngine } = await import(
    './payroll/seniority/seniorityEngineService.js'
  );
  allowanceEngine = stripSeniorityFromAllowanceEngine(allowanceEngine);

  const { resolveSeniorityIndemnityForPayroll } = await import(
    './payroll/seniorityIndemnity/seniorityIndemnityPayroll.js'
  );
  let seniorityIndemnityResult: Awaited<
    ReturnType<typeof resolveSeniorityIndemnityForPayroll>
  > | null = null;
  if (employee?.id) {
    try {
      seniorityIndemnityResult = await resolveSeniorityIndemnityForPayroll({
        employee,
        user: userPlain,
        month: monthPrefix,
        payrollPeriodEnd: period.payPeriodEnd,
        scheduledWorkingDays:
          payrollBasisAudit?.totalScheduledWorkingDays ?? LEGACY_WORK_DAYS_PER_MONTH,
        actualWorkingDays: payrollBasisAudit?.eligibleWorkingDays,
        allowanceLegacy: allowanceEngine?.legacy,
        isFinalSettlement: options?.payrollRunType === 'FINAL_SETTLEMENT',
      });
    } catch (indemnityErr) {
      console.warn(
        `[payroll] Seniority indemnity skipped for ${userId}:`,
        (indemnityErr as Error)?.message || indemnityErr
      );
    }
  }

  const seniorityPayroll = null;

  const result = calculateHybridPayrollForPortalUser({
    user: userPlain,
    employee,
    attendance: enrichedAttendance,
    month,
    period,
    attendancePeriodStatus: attendanceStatusForEngine,
    compliance,
    nssfBrackets,
    approvedOvertime,
    taxBrackets,
    unpaidLeaveDays,
    allowanceEngine,
    seniorityEntitlement: seniorityPayroll ?? undefined,
    seniorityIndemnityResult: seniorityIndemnityResult ?? undefined,
    latePenaltyPerOccurrenceUsd,
    lastWorkingDateOverride: lwd,
    prorationConfig: {
      ...prorationConfigResolved,
      workDayMethod: workDayPolicyResolved.method,
      companyBasisDays: workDayPolicyResolved.companyBasisDays,
    },
    workDayPolicy: workDayPolicyResolved,
    payrollRunType: options?.payrollRunType,
    payrollBasisAudit,
    paidLeaveDates,
    unpaidLeaveDates,
    approvedLeaveByDate,
  });

  const { hybrid, contractBaseSalary, ...breakdown } = result;

  if (unifiedRulePipeline && allowanceEngine) {
    for (const line of unifiedRulePipeline.engineResult.allowanceLines) {
      const code = line.code.toUpperCase();
      allowanceEngine.lines.push({
        allowanceTypeId: `rule-${line.ruleId}`,
        code,
        name: line.name,
        category: 'rule',
        calculationType: 'unified_rule',
        amount: line.amount,
        taxable: true,
        ruleId: line.ruleId,
        ruleName: line.name,
        triggerType: 'unified_rule',
        priority: 50,
        appliedConditions: {},
      });
      const legacyKey =
        code === 'TRANSPORT'
          ? 'transport'
          : code === 'MEAL'
            ? 'meal'
            : code === 'POSITION'
              ? 'position'
              : null;
      if (legacyKey) {
        allowanceEngine.legacy[legacyKey] =
          (allowanceEngine.legacy[legacyKey] ?? 0) + line.amount;
      }
      allowanceEngine.total += line.amount;
    }
  }

  const hybridOut = hybrid
    ? {
        ...hybrid,
        unifiedRuleEngine: unifiedRulePipeline
          ? {
              appliedCount: unifiedRulePipeline.engineResult.appliedRules.length,
              conflicts: unifiedRulePipeline.engineResult.conflicts,
              extraAllowanceTotal: unifiedRulePipeline.extraAllowanceTotal,
              extraDeductionTotal: unifiedRulePipeline.extraDeductionTotal,
            }
          : undefined,
      }
    : hybrid;

  const taxDependents = num(
    employee?.tax_dependents ?? userPlain.dependents ?? breakdown.attendanceSummary?.dependents
  );
  const attendanceSummary = {
    ...(breakdown.attendanceSummary ?? attendanceSnapshot ?? {
      recordsInPeriod: 0,
      presentDays: 0,
      totalWorkHours: 0,
      standardHoursPerDay: 8,
      hourlyRate: 0,
      dependents: 0,
    }),
    dependents: taxDependents,
  };

  return {
    ...breakdown,
    attendanceSummary,
    contractBaseSalary,
    hybrid: hybridOut
      ? { ...hybridOut, taxDependents: hybridOut.taxDependents ?? taxDependents }
      : hybridOut,
    allowanceLines: allowanceEngine?.lines,
  };
}

function disbursementToPaymentStatus(
  disbursementStatus: unknown,
  runStatus: string | null
): import('./payroll/payrollPaymentStatusService.js').PayrollPaymentStatus | null {
  const disbursement = String(disbursementStatus ?? '').toUpperCase();
  if (disbursement === 'PAID') return 'paid';
  if (disbursement === 'HOLDING' || disbursement === 'PENDING') return 'pending';
  const status = String(runStatus ?? '').toUpperCase();
  if (['APPROVED', 'PAYMENT_PROCESSING', 'LOCKED'].includes(status)) return 'pending';
  return null;
}

export async function serializePayslipForApi(
  ps: any,
  fallbackMonth?: string,
  opts?: {
    paymentStatus?: import('./payroll/payrollPaymentStatusService.js').PayrollPaymentStatus | null;
    skipReviewHydration?: boolean;
    runStatus?: string | null;
    payrollGroupId?: string;
  }
): Promise<any> {
  const plain = ps.get ? ps.get({ plain: true }) : { ...ps };
  const month = plain.month || fallbackMonth || '';
  if (!month) {
    const employeeId = await resolvePayslipEmployeeId(plain.userId);
    return {
      id: plain.id,
      payrollRunId: plain.payrollRunId,
      userId: plain.userId,
      employeeId,
      month: '',
      status: plain.status,
      generatedAt: plain.generatedAt,
      breakdown: null,
      readOnly: false,
    };
  }

  const { loadBreakdownForPayslipId } = await import('./payslipBreakdownService.js');
  const { isPayslipViewFrozen } = await import('./payroll/payslipFreezePolicy.js');

  let runStatus: string | null = opts?.runStatus ?? null;
  if (runStatus == null && plain.payrollRunId) {
    const { PayrollRun } = await import('./db.js');
    const run = await PayrollRun.findByPk(String(plain.payrollRunId), {
      attributes: ['status'],
    });
    runStatus = run ? String(run.get('status') ?? '') : null;
  }

  const readOnly = isPayslipViewFrozen({
    payslipStatus: plain.status,
    runStatus,
  });

  /** Always use the stored snapshot — never recalculate on read (master data may have changed). */
  const rawBreakdown = await loadBreakdownForPayslipId(plain.id);
  const { hydrateStoredPayrollBreakdown } = await import('./payroll/payrollBreakdownHydration.js');
  let breakdown = rawBreakdown ? hydrateStoredPayrollBreakdown(rawBreakdown) : null;

  if (breakdown && plain.userId && month && !opts?.skipReviewHydration) {
    const { PayrollRun: PayrollRunModel } = await import('./db.js');
    let payrollGroupId = opts?.payrollGroupId ?? 'default';
    if (!opts?.payrollGroupId && plain.payrollRunId) {
      const runRow = await PayrollRunModel.findByPk(String(plain.payrollRunId), {
        attributes: ['payrollGroupId'],
      });
      payrollGroupId = String(runRow?.get('payrollGroupId') ?? 'default');
    }
    const { ensureReviewContextForPayslips } = await import(
      './payroll/payrollReviewHydrationService.js'
    );
    await ensureReviewContextForPayslips(
      [{ userId: plain.userId, breakdown }],
      month,
      payrollGroupId
    );
  }

  const employeeId = await resolvePayslipEmployeeId(plain.userId);

  return {
    id: plain.id,
    payrollRunId: plain.payrollRunId,
    userId: plain.userId,
    employeeId,
    month,
    status: plain.status,
    reviewerNote: plain.reviewerNote ?? null,
    disbursementStatus: plain.disbursementStatus
      ? String(plain.disbursementStatus).toUpperCase()
      : null,
    disbursementStatusAt: plain.disbursementStatusAt ? String(plain.disbursementStatusAt) : null,
    disbursementHoldNote: plain.disbursementHoldNote ? String(plain.disbursementHoldNote) : null,
    paymentStatus:
      opts?.paymentStatus ??
      disbursementToPaymentStatus(plain.disbursementStatus, runStatus),
    generatedAt: plain.generatedAt,
    breakdown,
    hybrid: breakdown?.hybrid ?? null,
    readOnly,
    snapshotMissing: readOnly && !breakdown,
  };
}
