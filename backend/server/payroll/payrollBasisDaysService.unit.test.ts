/**
 * Run: npx tsx --test server/payroll/payrollBasisDaysService.unit.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPayrollBasisAuditExtras,
  normalizePayrollBasisDays,
  resolveDailyRateDivisor,
  resolveEmployeePayrollBasisDays,
} from './payrollBasisDaysService.js';

describe('payrollBasisDaysService', () => {
  it('defaults invalid employee basis to 26', () => {
    assert.equal(normalizePayrollBasisDays(null), 26);
    assert.equal(normalizePayrollBasisDays(99), 26);
    assert.equal(normalizePayrollBasisDays(22), 22);
  });

  it('uses employee basis under fixed_employee_basis', () => {
    const days = resolveEmployeePayrollBasisDays({
      policy: { method: 'fixed_employee_basis', companyBasisDays: 24 },
      employeeBasisDays: 22,
    });
    assert.equal(days, 22);
  });

  it('uses company basis under fixed_company_basis', () => {
    const days = resolveEmployeePayrollBasisDays({
      policy: { method: 'fixed_company_basis', companyBasisDays: 24 },
      employeeBasisDays: 22,
    });
    assert.equal(days, 24);
  });

  it('builds audit with basis divisor', () => {
    const audit = buildPayrollBasisAuditExtras({
      policy: { method: 'fixed_employee_basis', companyBasisDays: 26 },
      payrollBasisDays: 22,
    });
    assert.equal(audit.dailyRateDivisor, 22);
    assert.equal(audit.dailyRateSource, 'employee_basis');
  });

  it('always uses payroll basis days for daily rate divisor', () => {
    const divisor = resolveDailyRateDivisor({ payrollBasisDays: 24 });
    assert.equal(divisor, 24);
  });
});
