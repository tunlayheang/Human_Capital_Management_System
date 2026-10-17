import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isEmployeeEligibleForAccrualMonth } from './leaveAccrualEligibility.js';

describe('leaveAccrualEligibility', () => {
  it('does not accrue for legacy profile_incomplete employees', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'profile_incomplete', join_date: '2026-06-02' },
      '2026-06'
    );
    assert.equal(result.eligible, false);
  });

  it('blocks draft placeholder employees', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'draft', join_date: '2026-06-02' },
      '2026-06'
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'draft');
  });

  it('accepts joinDate camelCase from accrual service context for active employees', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'active', joinDate: '2026-06-02' },
      '2026-06',
      { asOfDate: '2026-06-02' }
    );
    assert.equal(result.eligible, true);
  });

  it('blocks months before join date', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'active', join_date: '2026-06-02' },
      '2026-05'
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'not_yet_joined');
  });

  it('blocks join-month accrual before the join day', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'active', join_date: '2026-07-25' },
      '2026-07',
      { asOfDate: '2026-07-19' }
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'not_yet_joined');
  });

  it('allows join-month accrual on/after the join day', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { status: 'active', join_date: '2026-07-25' },
      '2026-07',
      { asOfDate: '2026-07-25' }
    );
    assert.equal(result.eligible, true);
  });

  it('does not treat missing status as Active', () => {
    const result = isEmployeeEligibleForAccrualMonth(
      { join_date: '2026-06-02' },
      '2026-06'
    );
    assert.equal(result.eligible, false);
  });
});
