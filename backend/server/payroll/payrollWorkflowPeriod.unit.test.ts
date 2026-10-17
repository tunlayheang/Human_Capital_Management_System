import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodBoundsFromCutoffs } from './payrollCalendarMigrate.js';

/**
 * Mirrors allowanceRuleEngine.isAttendanceDateInScope period logic —
 * spillover days in a cutoff window must count toward attendance allowances.
 */
function isAttendanceDateInScope(
  date: string,
  periodStart?: string | null,
  periodEnd?: string | null
): boolean {
  const d = date.slice(0, 10);
  if (!d) return false;
  const start = periodStart?.slice(0, 10) || null;
  const end = periodEnd?.slice(0, 10) || null;
  if (start && end) return d >= start && d <= end;
  return true;
}

describe('payroll workflow period accuracy', () => {
  it('July salary window includes late-June spillover for attendance allowances', () => {
    const { periodStart, periodEnd } = periodBoundsFromCutoffs('2026-06-25', '2026-07-25');
    assert.equal(periodStart, '2026-06-26');
    assert.equal(periodEnd, '2026-07-25');

    assert.equal(isAttendanceDateInScope('2026-06-26', periodStart, periodEnd), true);
    assert.equal(isAttendanceDateInScope('2026-06-30', periodStart, periodEnd), true);
    assert.equal(isAttendanceDateInScope('2026-07-01', periodStart, periodEnd), true);
    assert.equal(isAttendanceDateInScope('2026-07-25', periodStart, periodEnd), true);
    assert.equal(isAttendanceDateInScope('2026-06-25', periodStart, periodEnd), false);
    assert.equal(isAttendanceDateInScope('2026-07-26', periodStart, periodEnd), false);
  });

  it('without period bounds, provided attendance rows are trusted (no calendar-month drop)', () => {
    assert.equal(isAttendanceDateInScope('2026-06-28'), true);
    assert.equal(isAttendanceDateInScope('2026-07-15'), true);
  });
});
