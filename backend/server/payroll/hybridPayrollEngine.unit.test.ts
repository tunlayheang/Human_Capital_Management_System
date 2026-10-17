/**
 * Run: npm run test:payroll-hybrid  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateHybridPayrollForPortalUser } from './hybridPayrollEngine.js';
import { reconcilePayrollBreakdown } from '../payrollCalculation.js';
import { validatePayrollBreakdownBalance } from './payrollRunItemsService.js';
import { computeGdtSalaryTaxUsd, marginalTaxRateForTaxableBaseUsd } from '../cambodiaSalaryTax.js';

const EX = 4100;
const compliance = {
  exchangeRate: EX,
  minimumWageUsd: 0,
  otMultiplierNormal: 1.5,
  otMultiplierPremium: 2,
  nssfPensionEmployeePct: 2,
  nssfPensionEmployeeCapKhr: 24_000,
  nssfOccupationalRiskEmployeePct: 0,
  nssfOccupationalRiskEmployerPct: 0.8,
  nssfHealthcareEmployeePct: 0,
  nssfHealthcareEmployerPct: 2.6,
  nssfPensionEmployerPct: 2,
  seniorityPayoutJuneDays: 7.5,
  seniorityPayoutDecemberDays: 7.5,
} as const;

const period = {
  payPeriodStart: '2024-07-01',
  payPeriodEnd: '2024-07-31',
  attendanceCutoffDate: '2024-07-31',
};

function baseEmployee(overrides: Record<string, unknown> = {}) {
  return {
    base_salary: 2000,
    join_date: '2020-01-01',
    work_hours: 8,
    work_days: 5,
    payroll_basis_days: 26,
    nssf_enrolled: true,
    tax_dependents: 0,
    ...overrides,
  };
}

describe('calculateHybridPayrollForPortalUser', () => {
  it('balances gross − deductions = net for a full-month employee', () => {
    const result = calculateHybridPayrollForPortalUser({
      user: { salary: 2000, dependents: 0 },
      employee: baseEmployee(),
      attendance: [],
      month: '2024-07',
      period,
      attendancePeriodStatus: 'FINALIZED',
      compliance,
      allowanceEngine: {
        legacy: {
          transport: 0,
          meal: 0,
          attendance: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        },
        lines: [],
        audit: [],
        total: 0,
      },
    });

    const breakdown = reconcilePayrollBreakdown(result);
    assert.equal(validatePayrollBreakdownBalance(breakdown), null);
    assert.equal(breakdown.grossSalary, 2000);
    assert.equal(
      breakdown.netSalary,
      Math.round((breakdown.grossSalary - breakdown.deductions.total) * 100) / 100
    );
  });

  it('applies GDT tax on gross with zero dependents', () => {
    const result = calculateHybridPayrollForPortalUser({
      user: { salary: 2000, dependents: 0 },
      employee: baseEmployee(),
      attendance: [],
      month: '2024-07',
      period,
      attendancePeriodStatus: 'FINALIZED',
      compliance,
      allowanceEngine: {
        legacy: {
          transport: 0,
          meal: 0,
          attendance: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        },
        lines: [],
        audit: [],
        total: 0,
      },
    });

    const expectedTax = computeGdtSalaryTaxUsd(2000, 0, EX);
    assert.equal(result.deductions.taxOnSalary, expectedTax);
    assert.equal(result.taxableBaseUsd, 2000);
    assert.equal(
      marginalTaxRateForTaxableBaseUsd(result.taxableBaseUsd ?? 0, undefined, EX),
      10
    );
  });

  it('prorates base pay for mid-month join without breaking balance', () => {
    const result = calculateHybridPayrollForPortalUser({
      user: { salary: 2000, dependents: 0, joinDate: '2024-07-16' },
      employee: baseEmployee({ join_date: '2024-07-16' }),
      attendance: [],
      month: '2024-07',
      period,
      attendancePeriodStatus: 'FINALIZED',
      compliance,
      allowanceEngine: {
        legacy: {
          transport: 0,
          meal: 0,
          attendance: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        },
        lines: [],
        audit: [],
        total: 0,
      },
    });

    const breakdown = reconcilePayrollBreakdown(result);
    assert.equal(validatePayrollBreakdownBalance(breakdown), null);
    assert.ok(breakdown.baseSalary < 2000);
    assert.ok(breakdown.baseSalary > 0);
    assert.equal(breakdown.contractBaseSalary, 2000);
  });

  it('deducts absences only when attendance is finalized', () => {
    const absent = {
      date: '2024-07-10',
      status: 'ABSENT',
      userId: 'u1',
      workHours: 0,
    };
    const open = calculateHybridPayrollForPortalUser({
      user: { salary: 2000, dependents: 0 },
      employee: baseEmployee(),
      attendance: [absent],
      month: '2024-07',
      period,
      attendancePeriodStatus: 'OPEN',
      compliance,
      allowanceEngine: {
        legacy: {
          transport: 0,
          meal: 0,
          attendance: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        },
        lines: [],
        audit: [],
        total: 0,
      },
    });
    const finalized = calculateHybridPayrollForPortalUser({
      user: { salary: 2000, dependents: 0 },
      employee: baseEmployee(),
      attendance: [absent],
      month: '2024-07',
      period,
      attendancePeriodStatus: 'FINALIZED',
      compliance,
      allowanceEngine: {
        legacy: {
          transport: 0,
          meal: 0,
          attendance: 0,
          position: 0,
          commission: 0,
          otMeal: 0,
        },
        lines: [],
        audit: [],
        total: 0,
      },
    });

    assert.equal(open.deductions.absences, 0);
    assert.ok(finalized.deductions.absences > 0);
    assert.equal(validatePayrollBreakdownBalance(reconcilePayrollBreakdown(finalized)), null);
  });
});
