import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSundayFirstMonthGrid,
  leadingEmptyCount,
  weekdaySundayFirst,
} from './monthCalendarGrid.ts';

describe('monthCalendarGrid — real weekday alignment', () => {
  it('August 2026: day 1 is Saturday (column 6)', () => {
    assert.equal(weekdaySundayFirst(2026, 7, 1), 6);
    assert.equal(leadingEmptyCount(2026, 7), 6);
    assert.equal(weekdaySundayFirst(2026, 7, 31), 1); // Monday
  });

  it('January 2026: day 1 is Thursday (column 4)', () => {
    assert.equal(weekdaySundayFirst(2026, 0, 1), 4);
    assert.equal(leadingEmptyCount(2026, 0), 4);
  });

  it('buildSundayFirstMonthGrid places Aug 1 under Saturday', () => {
    const cells = buildSundayFirstMonthGrid(2026, 7);
    const aug1 = cells.findIndex((c) => c.kind === 'day' && c.day === 1);
    assert.equal(aug1 % 7, 6);
    const aug31 = cells.findIndex((c) => c.kind === 'day' && c.day === 31);
    assert.equal(aug31 % 7, 1);
  });
});
