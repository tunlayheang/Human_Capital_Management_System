import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLeaveRemaining,
  roundLeaveDaysToHalf,
} from './leaveBalanceCalc.js';

describe('leaveBalanceCalc — join_date_based remaining', () => {
  it('snaps to half-day steps', () => {
    assert.equal(roundLeaveDaysToHalf(1.2), 1);
    assert.equal(roundLeaveDaysToHalf(0.4), 0.5);
    assert.equal(roundLeaveDaysToHalf(1.5), 1.5);
    assert.equal(roundLeaveDaysToHalf(1.0), 1);
  });

  it('accrual_based remaining is limited to accrued-to-date', () => {
    const remaining = computeLeaveRemaining(
      {
        openingBalance: 0,
        accrued: 1.5,
        entitlement: 18,
        carriedOver: 0,
        used: 0,
      },
      'accrual_based'
    );
    assert.equal(remaining, 1.5);
  });

  it('join_date_based remaining uses yearly entitlement (not monthly accrual cap)', () => {
    const remaining = computeLeaveRemaining(
      {
        openingBalance: 0,
        accrued: 1.5,
        entitlement: 18,
        carriedOver: 0,
        used: 3,
      },
      'join_date_based'
    );
    assert.equal(remaining, 15);
  });

  it('join_date_based allows request above accrued when yearly balance remains', () => {
    const remaining = computeLeaveRemaining(
      {
        openingBalance: 0,
        accrued: 1.5,
        entitlement: 10.5,
        carriedOver: 0,
        used: 0,
      },
      'join_date_based'
    );
    assert.equal(remaining, 10.5);
    assert.ok(remaining > 1.5);
  });
});
