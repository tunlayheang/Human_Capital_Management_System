import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addOneCalendarMonthIct,
  resolvePayrollPaymentUpdateWindow,
  assertPayrollPaymentUpdatesAllowed,
  PayrollPaymentUpdateWindowClosedError,
} from './payrollPaymentUpdateWindow.js';

describe('payrollPaymentUpdateWindow', () => {
  it('adds one calendar month including month-end clamp', () => {
    assert.equal(addOneCalendarMonthIct('2026-01-15'), '2026-02-15');
    assert.equal(addOneCalendarMonthIct('2026-01-31'), '2026-02-28');
    assert.equal(addOneCalendarMonthIct('2026-12-10'), '2027-01-10');
  });

  it('allows updates within one month of lockedAt', () => {
    const window = resolvePayrollPaymentUpdateWindow(
      { lockedAt: '2026-08-10T04:00:00.000Z', month: '2026-07' },
      new Date('2026-09-10T01:00:00.000Z') // still on editable-until day in ICT
    );
    assert.equal(window.paymentUpdateAnchorDate, '2026-08-10');
    assert.equal(window.paymentEditableUntil, '2026-09-10');
    assert.equal(window.paymentUpdatesAllowed, true);
  });

  it('blocks updates after the one-month grace window', () => {
    const window = resolvePayrollPaymentUpdateWindow(
      { lockedAt: '2026-08-10T04:00:00.000Z', month: '2026-07' },
      new Date('2026-09-11T01:00:00.000Z') // day after editable-until in ICT
    );
    assert.equal(window.paymentUpdatesAllowed, false);
    assert.throws(
      () =>
        assertPayrollPaymentUpdatesAllowed(
          { lockedAt: '2026-08-10T04:00:00.000Z', month: '2026-07' },
          new Date('2026-09-11T01:00:00.000Z')
        ),
      (err: unknown) => err instanceof PayrollPaymentUpdateWindowClosedError
    );
  });

  it('falls back to calculatedAt when lockedAt is missing', () => {
    const window = resolvePayrollPaymentUpdateWindow(
      { calculatedAt: '2026-06-01T10:00:00.000Z', month: '2026-05' },
      new Date('2026-06-15T00:00:00.000Z')
    );
    assert.equal(window.paymentUpdatesAllowed, true);
    assert.ok(window.paymentEditableUntil);
  });
});
