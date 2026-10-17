import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toYmd } from './reportFilterUtils.js';

describe('toYmd', () => {
  it('formats Date objects without using String().slice(0,10)', () => {
    const d = new Date(2021, 0, 15, 10, 30, 0); // local Jan 15 2021
    assert.equal(toYmd(d), '2021-01-15');
  });

  it('keeps ISO date prefixes', () => {
    assert.equal(toYmd('2022-06-01T00:00:00.000Z'), '2022-06-01');
  });

  it('returns empty for null', () => {
    assert.equal(toYmd(null), '');
  });
});
