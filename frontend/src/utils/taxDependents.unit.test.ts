import { describe, expect, it } from 'vitest';
import { computeTaxDependents } from './taxDependents';
import { computeTaxOnSalary, taxableSalaryBaseUsd } from './payrollTaxRate';

describe('computeTaxDependents', () => {
  it('counts non-working children for married employees', () => {
    const n = computeTaxDependents('married', [{ name: 'Sam', hasJob: 'no' }], 'yes');
    expect(n).toBe(1);
  });

  it('includes non-working spouse', () => {
    const n = computeTaxDependents(
      'married',
      [{ name: 'Sam', hasJob: 'no' }],
      'no'
    );
    expect(n).toBe(2);
  });

  it('returns zero for single marital status', () => {
    const n = computeTaxDependents('single', [{ name: 'Sam', hasJob: 'no' }], undefined);
    expect(n).toBe(0);
  });
});

describe('payroll tax preview', () => {
  it('reduces taxable base and tax when dependents are present', () => {
    const gross = 1875;
    const exchangeRate = 4100;
    const taxNoDeps = computeTaxOnSalary(gross, 0, { exchangeRateKhrPerUsd: exchangeRate });
    const taxOneDep = computeTaxOnSalary(gross, 1, { exchangeRateKhrPerUsd: exchangeRate });
    const baseOneDep = taxableSalaryBaseUsd(gross, 1, exchangeRate);

    expect(baseOneDep).toBeLessThan(gross);
    expect(taxOneDep).toBeLessThan(taxNoDeps);
  });
});
