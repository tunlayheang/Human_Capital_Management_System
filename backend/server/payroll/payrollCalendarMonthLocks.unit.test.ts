/**
 * Run: npx tsx --test server/payroll/payrollCalendarMonthLocks.unit.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('payroll calendar month lock helpers', () => {
  it('exports buildPayrollCalendarMonthLocks', async () => {
    const { buildPayrollCalendarMonthLocks } = await import('./payrollCalendarCycleService.js');
    assert.equal(typeof buildPayrollCalendarMonthLocks, 'function');
  });

  it('PayrollPeriodFrozenError uses 409 / PAYROLL_PERIOD_FROZEN', async () => {
    const { PayrollPeriodFrozenError } = await import('./payrollPeriodFreezeService.js');
    const err = new PayrollPeriodFrozenError('Payroll for 2026-01 is already approved (APPROVED).');
    assert.equal(err.statusCode, 409);
    assert.equal(err.code, 'PAYROLL_PERIOD_FROZEN');
    assert.match(err.message, /2026-01/);
  });
});
