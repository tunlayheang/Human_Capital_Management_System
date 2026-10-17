/**
 * Run: npm run test:payroll-daily-rate  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePayrollContractRates } from './payrollContractRates.js';

describe('resolvePayrollContractRates', () => {
  it('daily display equals hourly × standard hours (Sopheap-like contract)', () => {
    const contract = 939.9;
    const r = resolvePayrollContractRates({
      contractBaseSalary: contract,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
    });
    assert.equal(r.hourlyRate, 4.52);
    assert.equal(r.dailyRate, 36.16);
    assert.equal(r.dailyRate, Math.round(r.hourlyRate * 8 * 100) / 100);
    assert.ok(Math.abs(r.dailyRateExact - contract / 26) < 0.01);
  });

  it('Kunthea-like: 16 paid days × daily ≈ prorated base', () => {
    const contract = 1320.02;
    const r = resolvePayrollContractRates({
      contractBaseSalary: contract,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
    });
    assert.equal(r.hourlyRate, 6.35);
    assert.equal(r.dailyRate, 50.8);
    const proratedBase = Math.round(16 * r.dailyRate * 100) / 100;
    assert.ok(Math.abs(proratedBase - 812.8) < 1);
    assert.equal(
      Math.round(r.dailyRateExact * 9 * 100) / 100,
      Math.round((contract / 26) * 9 * 100) / 100
    );
  });
});
