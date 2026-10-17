import type { SalaryBreakdown } from '../../types';
import { resolveExchangeRateKhrPerUsd } from '../../utils/payrollExchangeRateCache';
import { PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD } from '../../constants/payrollExchangeRate';
import { usdToKhr } from '../../utils/payrollRulesCurrency';

export const DEFAULT_PAYROLL_EXCHANGE_RATE = PAYROLL_EXCHANGE_RATE_FALLBACK_KHR_PER_USD;

/**
 * Monthly amounts at or above this are treated as KHR mistakenly stored in a USD field.
 * Matches legacy net-salary repair; well above normal Cambodia SME USD wages.
 */
export const PAYROLL_USD_KHR_MIX_THRESHOLD = 25_000;

export function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Ensure a payroll money field is USD. Legacy/import rows sometimes store whole riels
 * in USD columns (e.g. 317_135 instead of 77.35), which inflates register TOTALS.
 */
export function coercePayrollUsdAmount(
  amount: number,
  exchangeRate: number = DEFAULT_PAYROLL_EXCHANGE_RATE
): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return 0;
  const ex =
    Number.isFinite(exchangeRate) && exchangeRate > 0
      ? exchangeRate
      : DEFAULT_PAYROLL_EXCHANGE_RATE;
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

/**
 * Correct USD/KHR mix-ups and ensure net = gross − total deductions.
 * Payroll exports and payslips must never show KHR amounts in USD columns.
 */
export function reconcilePayrollBreakdown(b: SalaryBreakdown): SalaryBreakdown {
  const exchangeRate = resolveExchangeRateKhrPerUsd(b.exchangeRate, 'active');

  const baseSalary = coercePayrollUsdAmount(Number(b.baseSalary) || 0, exchangeRate);
  const contractBaseSalary =
    b.contractBaseSalary != null
      ? coercePayrollUsdAmount(Number(b.contractBaseSalary) || 0, exchangeRate)
      : b.contractBaseSalary;
  const seniorityIndemnity = coercePayrollUsdAmount(
    Number(b.seniorityIndemnity) || 0,
    exchangeRate
  );
  const backPayment = coercePayrollUsdAmount(Number(b.backPayment) || 0, exchangeRate);

  const a = b.allowances ?? { transport: 0, attendance: 0, meal: 0, seniority: 0 };
  const allowances = {
    ...a,
    transport: coercePayrollUsdAmount(Number(a.transport) || 0, exchangeRate),
    attendance: coercePayrollUsdAmount(Number(a.attendance) || 0, exchangeRate),
    meal: coercePayrollUsdAmount(Number(a.meal) || 0, exchangeRate),
    seniority: coercePayrollUsdAmount(Number(a.seniority) || 0, exchangeRate),
    position: coercePayrollUsdAmount(Number(a.position) || 0, exchangeRate),
    commission: coercePayrollUsdAmount(Number(a.commission) || 0, exchangeRate),
    otMeal: coercePayrollUsdAmount(Number(a.otMeal) || 0, exchangeRate),
  };

  const ot = b.overtime ?? {
    hours150: 0,
    amount150: 0,
    hours200: 0,
    amount200: 0,
    total: 0,
  };
  const amount150 = coercePayrollUsdAmount(Number(ot.amount150) || 0, exchangeRate);
  const amount200 = coercePayrollUsdAmount(Number(ot.amount200) || 0, exchangeRate);
  const amount100 = coercePayrollUsdAmount(Number(ot.amount100) || 0, exchangeRate);
  const overtime = {
    ...ot,
    amount100: ot.amount100 != null ? amount100 : ot.amount100,
    amount150,
    amount200,
    total: coercePayrollUsdAmount(
      Number(ot.total) || amount150 + amount200 + amount100,
      exchangeRate
    ),
  };

  let gross = coercePayrollUsdAmount(Number(b.grossSalary) || 0, exchangeRate);

  const d = b.deductions ?? {
    nssf: 0,
    taxOnSalary: 0,
    absences: 0,
    advances: 0,
    total: 0,
  };
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
  // Absence deduction larger than gross (after USD coerce) is almost always leftover KHR.
  if (gross > 0 && absences > gross * 2 && exchangeRate > 0) {
    absences = roundUsd(absences / exchangeRate);
  }
  const advances = coercePayrollUsdAmount(Number(d.advances) || 0, exchangeRate);
  const dedTotal = roundUsd(nssf + taxOnSalary + absences + advances);

  const taxDependentReliefUsd =
    b.taxDependentReliefUsd != null
      ? coercePayrollUsdAmount(Number(b.taxDependentReliefUsd) || 0, exchangeRate)
      : b.taxDependentReliefUsd;
  const taxableBaseUsd =
    b.taxableBaseUsd != null
      ? coercePayrollUsdAmount(Number(b.taxableBaseUsd) || 0, exchangeRate)
      : b.taxableBaseUsd;
  const taxableIncomeUsd =
    b.taxableIncomeUsd != null
      ? coercePayrollUsdAmount(Number(b.taxableIncomeUsd) || 0, exchangeRate)
      : b.taxableIncomeUsd;
  const allowanceTotalUsd =
    b.allowanceTotalUsd != null
      ? coercePayrollUsdAmount(Number(b.allowanceTotalUsd) || 0, exchangeRate)
      : b.allowanceTotalUsd;
  const otherDeductionsUsd =
    b.otherDeductionsUsd != null
      ? coercePayrollUsdAmount(Number(b.otherDeductionsUsd) || 0, exchangeRate)
      : b.otherDeductionsUsd;

  const allowanceLines = Array.isArray(b.allowanceLines)
    ? b.allowanceLines.map((line) => ({
        ...line,
        amount: coercePayrollUsdAmount(Number(line.amount) || 0, exchangeRate),
      }))
    : b.allowanceLines;

  let hybrid = b.hybrid;
  if (hybrid?.variableDeductions) {
    const vd = hybrid.variableDeductions;
    hybrid = {
      ...hybrid,
      variableDeductions: {
        ...vd,
        unpaidLeave: coercePayrollUsdAmount(Number(vd.unpaidLeave) || 0, exchangeRate),
        unexcusedAbsence: coercePayrollUsdAmount(
          Number(vd.unexcusedAbsence) || 0,
          exchangeRate
        ),
        latePenalty: coercePayrollUsdAmount(Number(vd.latePenalty) || 0, exchangeRate),
        advances: coercePayrollUsdAmount(Number(vd.advances) || 0, exchangeRate),
        other: coercePayrollUsdAmount(Number(vd.other) || 0, exchangeRate),
        total: coercePayrollUsdAmount(Number(vd.total) || 0, exchangeRate),
      },
    };
  }

  let netUsd = coercePayrollUsdAmount(Number(b.netSalary) || 0, exchangeRate);
  let netKhr = Number(b.netSalaryKHR) || 0;

  // KHR amount still sitting in netSalary after coerce threshold miss (edge FX).
  if (netUsd > Math.max(gross * 1.5, PAYROLL_USD_KHR_MIX_THRESHOLD) && exchangeRate > 0) {
    if (netKhr <= netUsd) netKhr = netUsd;
    netUsd = roundUsd(netKhr / exchangeRate);
  }

  // USD and KHR columns swapped.
  if (
    netKhr > 0 &&
    netKhr < gross * 2 &&
    netUsd > gross * 3 &&
    exchangeRate > 0
  ) {
    const usdFromKhr = roundUsd(netKhr);
    netKhr = Math.round(netUsd);
    netUsd = usdFromKhr;
  }

  const expectedNet = roundUsd(Math.max(0, gross - dedTotal));
  // After coercing USD fields, net must follow gross − deductions (real money identity).
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
    baseSalary,
    contractBaseSalary,
    seniorityIndemnity,
    backPayment: b.backPayment != null ? backPayment : b.backPayment,
    allowances,
    allowanceLines,
    overtime,
    hybrid,
    taxDependentReliefUsd,
    taxableBaseUsd,
    taxableIncomeUsd,
    allowanceTotalUsd,
    otherDeductionsUsd,
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
  };
}
