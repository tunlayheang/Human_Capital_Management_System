import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcilePayrollBreakdown } from '../payrollCalculation.js';

const EX = 4100;

describe('reconcilePayrollBreakdown USD/KHR coerce', () => {
  it('leaves correct USD breakdown unchanged', () => {
    const r = reconcilePayrollBreakdown({
      baseSalary: 77.35,
      proratedDays: 26,
      allowances: { transport: 0, attendance: 0, meal: 0, seniority: 0 },
      overtime: { hours150: 0, amount150: 0, hours200: 0, amount200: 0, total: 0 },
      grossSalary: 77.35,
      deductions: { nssf: 1.61, taxOnSalary: 0, absences: 0, advances: 0, total: 1.61 },
      netSalary: 75.74,
      exchangeRate: EX,
      netSalaryKHR: 310_534,
    });
    assert.equal(r.grossSalary, 77.35);
    assert.equal(r.deductions.nssf, 1.61);
    assert.equal(r.netSalary, 75.74);
  });

  it('converts KHR-scale gross/tax/absences so totals stay in USD', () => {
    const r = reconcilePayrollBreakdown({
      baseSalary: 317_135,
      proratedDays: 26,
      allowances: { transport: 0, attendance: 0, meal: 0, seniority: 0 },
      overtime: { hours150: 0, amount150: 0, hours200: 0, amount200: 0, total: 0 },
      grossSalary: 317_135,
      deductions: {
        nssf: 1.61,
        taxOnSalary: 64_000,
        absences: 215_000,
        advances: 0,
        total: 279_001.61,
      },
      netSalary: 38_133.39,
      exchangeRate: EX,
      netSalaryKHR: 38_133,
      taxAmountUsd: Math.round((64_000 / EX) * 100) / 100,
      taxAmountKhr: 64_000,
    });
    assert.equal(r.grossSalary, Math.round((317_135 / EX) * 100) / 100);
    assert.equal(r.deductions.taxOnSalary, Math.round((64_000 / EX) * 100) / 100);
    assert.equal(r.deductions.absences, Math.round((215_000 / EX) * 100) / 100);
    assert.equal(r.deductions.nssf, 1.61);
    assert.ok(r.grossSalary < 1000);
    assert.ok(r.netSalary < 1000);
    assert.equal(
      r.netSalary,
      Math.round((r.grossSalary - r.deductions.total) * 100) / 100
    );
  });
});
