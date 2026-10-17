/**
 * Run: npm run test:payroll-tax-dependents  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dependentDeductionUsd } from '../cambodiaSalaryTax.js';
import { computeTaxDependentsForFamily } from '../employeeChildrenService.js';

describe('dependentDeductionUsd', () => {
  it('matches Employee Pay: 2 dependents at 4100 FX', () => {
    const relief = dependentDeductionUsd(2, 4100);
    assert.equal(relief, Math.round(((2 * 150_000) / 4100) * 100) / 100);
  });

  it('single employee has zero relief', () => {
    assert.equal(dependentDeductionUsd(0, 4100), 0);
  });
});

describe('computeTaxDependentsForFamily', () => {
  it('counts non-working spouse and children', () => {
    const n = computeTaxDependentsForFamily('married', 'no', [
      { name: 'A', hasJob: 'no' },
      { name: 'B', hasJob: 'yes' },
      { name: 'C', hasJob: 'no' },
    ]);
    assert.equal(n, 3);
  });
});
