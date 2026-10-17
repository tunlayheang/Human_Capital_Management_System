import { describe, expect, it } from 'vitest';
import type { SalaryBreakdown } from '../../types';
import {
  coercePayrollUsdAmount,
  reconcilePayrollBreakdown,
  roundUsd,
} from './payrollBreakdownReconcile';
import { sumPayrollRows, type PayrollItemRow } from './payrollItemRows';

const EX = 4100;

function baseBreakdown(over: Partial<SalaryBreakdown> = {}): SalaryBreakdown {
  return {
    baseSalary: 77.35,
    proratedDays: 26,
    allowances: { transport: 0, attendance: 0, meal: 0, seniority: 0 },
    overtime: { hours150: 0, amount150: 0, hours200: 0, amount200: 0, total: 0 },
    grossSalary: 77.35,
    deductions: { nssf: 1.61, taxOnSalary: 0, absences: 0, advances: 0, total: 1.61 },
    netSalary: 75.74,
    exchangeRate: EX,
    netSalaryKHR: 310_534,
    ...over,
  };
}

function moneyRow(over: Partial<PayrollItemRow>): PayrollItemRow {
  return {
    id: 'r',
    userId: 'u',
    employeeName: 'E',
    jobTitle: '',
    bankDisplay: '',
    base: 0,
    proratedPay: 0,
    proratedDays: 0,
    scheduledWorkingDays: 0,
    payrollBasisDays: 0,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    totalPaidDays: 0,
    totalWorkHours: 0,
    standardHoursPerDay: 0,
    hourlyRate: 0,
    dailyRate: 0,
    dependents: 0,
    dependentRelief: 0,
    taxableBase: 0,
    transport: 0,
    meal: 0,
    attendanceBonus: 0,
    seniority: 0,
    position: 0,
    commission: 0,
    otMeal: 0,
    seniorityIndemnity: 0,
    backPayment: 0,
    allowanceTotal: 0,
    otHours150: 0,
    otHours200: 0,
    otAmount150: 0,
    otAmount200: 0,
    otTotal: 0,
    gross: 0,
    taxRatePct: 0,
    employerNssf: 0,
    nssf: 0,
    tax: 0,
    absences: 0,
    advances: 0,
    otherDeductions: 0,
    deductionsTotal: 0,
    net: 0,
    netKhr: 0,
    exchangeRate: EX,
    departmentId: '',
    departmentName: '',
    taxId: '',
    nssfId: '',
    nssfAssumedWageKhr: null,
    totalEmployerCostUsd: 0,
    paymentStatus: null,
    prorationLabel: '',
    prorationPct: 0,
    employmentFlags: [],
    priorMonthNetUsd: null,
    netChangeVsPriorMonthUsd: null,
    netChangeVsPriorMonthPct: null,
    netChangedSincePreviousRun: false,
    attendanceFinalized: true,
    ...over,
  };
}

describe('coercePayrollUsdAmount', () => {
  it('leaves normal USD wages unchanged', () => {
    expect(coercePayrollUsdAmount(77.35, EX)).toBe(77.35);
    expect(coercePayrollUsdAmount(1_875, EX)).toBe(1_875);
  });

  it('converts KHR-scale amounts to USD', () => {
    expect(coercePayrollUsdAmount(317_135, EX)).toBe(roundUsd(317_135 / EX));
    expect(coercePayrollUsdAmount(64_000, EX)).toBe(roundUsd(64_000 / EX));
  });
});

describe('reconcilePayrollBreakdown', () => {
  it('keeps a correct USD payslip intact', () => {
    const r = reconcilePayrollBreakdown(baseBreakdown());
    expect(r.grossSalary).toBe(77.35);
    expect(r.deductions.nssf).toBe(1.61);
    expect(r.netSalary).toBe(75.74);
  });

  it('converts KHR stored in gross/tax/absences USD slots', () => {
    const r = reconcilePayrollBreakdown(
      baseBreakdown({
        grossSalary: 317_135,
        deductions: {
          nssf: 1.61,
          taxOnSalary: 64_000,
          absences: 215_000,
          advances: 0,
          total: 279_001.61,
        },
        netSalary: 38_133.39,
        taxAmountUsd: roundUsd(64_000 / EX),
        taxAmountKhr: 64_000,
      })
    );
    expect(r.grossSalary).toBe(roundUsd(317_135 / EX));
    expect(r.deductions.taxOnSalary).toBe(roundUsd(64_000 / EX));
    expect(r.deductions.absences).toBe(roundUsd(215_000 / EX));
    expect(r.deductions.nssf).toBe(1.61);
    expect(r.netSalary).toBe(
      roundUsd(r.grossSalary - r.deductions.nssf - r.deductions.taxOnSalary - r.deductions.absences)
    );
  });

  it('prefers taxAmountUsd when taxOnSalary holds KHR', () => {
    const r = reconcilePayrollBreakdown(
      baseBreakdown({
        deductions: {
          nssf: 1.61,
          taxOnSalary: 75_000,
          absences: 0,
          advances: 0,
          total: 76_601.61,
        },
        taxAmountUsd: 18.29,
        taxAmountKhr: 75_000,
        netSalary: 57.45,
      })
    );
    expect(r.deductions.taxOnSalary).toBe(18.29);
  });
});

describe('sumPayrollRows', () => {
  it('sums real USD and does not inflate from KHR-scale leftovers', () => {
    const rows = [
      moneyRow({
        id: '1',
        gross: 77.35,
        nssf: 1.61,
        tax: 0,
        absences: 0,
        advances: 0,
        deductionsTotal: 1.61,
        net: 75.74,
        netKhr: 310_534,
      }),
      moneyRow({
        id: '2',
        // Simulate a row that slipped past display with KHR still in money fields
        gross: 317_135,
        nssf: 1.61,
        tax: 64_000,
        absences: 215_000,
        advances: 0,
        deductionsTotal: 279_001.61,
        net: 38_133.39,
        netKhr: 38_133,
      }),
    ];
    const t = sumPayrollRows(rows);
    const g1 = 77.35;
    const g2 = roundUsd(317_135 / EX);
    const tax2 = roundUsd(64_000 / EX);
    const abs2 = roundUsd(215_000 / EX);
    expect(t.gross).toBe(roundUsd(g1 + g2));
    expect(t.nssf).toBe(roundUsd(1.61 + 1.61));
    expect(t.tax).toBe(tax2);
    expect(t.absences).toBe(abs2);
    expect(t.deductionsTotal).toBe(roundUsd(1.61 + 1.61 + tax2 + abs2));
    expect(t.net).toBe(roundUsd(Math.max(0, t.gross - t.deductionsTotal)));
    // Must stay in typical payroll USD range — not tens of millions
    expect(t.gross).toBeLessThan(1_000);
    expect(t.net).toBeLessThan(1_000);
  });
});
