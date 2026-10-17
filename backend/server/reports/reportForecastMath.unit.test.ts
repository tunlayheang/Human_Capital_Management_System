import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMonthsKey,
  linearFit,
  movingAverage,
  projectNext,
  riskBand,
  trendLabel,
} from './reportForecastMath.js';

describe('reportForecastMath', () => {
  it('fits a rising linear series', () => {
    const { slope } = linearFit([1, 2, 3, 4, 5]);
    assert.ok(slope > 0.9 && slope < 1.1);
  });

  it('projects non-negative next steps', () => {
    const next = projectNext([10, 12, 11, 13], 3);
    assert.equal(next.length, 3);
    assert.ok(next.every((n) => n >= 0));
  });

  it('moving average uses trailing window', () => {
    assert.equal(movingAverage([1, 2, 3, 9], 3), 14 / 3);
  });

  it('adds months across year boundary', () => {
    assert.equal(addMonthsKey('2025-11', 2), '2026-01');
  });

  it('labels trends and risk bands', () => {
    assert.equal(trendLabel(0), 'Stable');
    assert.equal(trendLabel(1), 'Rising');
    assert.equal(riskBand(80), 'High');
    assert.equal(riskBand(50), 'Medium');
    assert.equal(riskBand(10), 'Low');
  });
});
