/**
 * Run: npm run test:payroll-overtime  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bucketOvertimeHoursByRateTier,
  computeOvertimePayUsd,
  roundOvertimeHours,
} from './payrollOvertimePay.js';

describe('bucketOvertimeHoursByRateTier', () => {
  it('splits regular / daytime / rest-holiday-night tiers', () => {
    const b = { hours100: 0, hours150: 0, hours200: 0 };
    bucketOvertimeHoursByRateTier('regular_100', 2, b);
    bucketOvertimeHoursByRateTier('daytime_150', 4, b);
    bucketOvertimeHoursByRateTier('rest_holiday_200', 1.5, b);
    bucketOvertimeHoursByRateTier('night_200', 3, b);
    assert.equal(b.hours100, 2);
    assert.equal(b.hours150, 4);
    assert.equal(b.hours200, 4.5);
  });
});

describe('computeOvertimePayUsd', () => {
  it('uses contract base and roster divisor for hourly rate', () => {
    const pay = computeOvertimePayUsd({
      hours100: 0,
      hours150: 4,
      hours200: 0,
      contractBaseSalary: 812.33,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
      multiplier150: 1.5,
      multiplier200: 2,
    });
    assert.equal(pay.hourlyRate, 3.91);
    assert.equal(pay.amount150, 23.46);
    assert.equal(pay.amount200, 0);
    assert.equal(pay.total, 23.46);
  });

  it('pays regular 100% at 1× hourly rate', () => {
    const pay = computeOvertimePayUsd({
      hours100: 4,
      hours150: 0,
      hours200: 0,
      contractBaseSalary: 812.33,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
    });
    assert.equal(pay.amount100, Math.round(4 * pay.hourlyRate * 100) / 100);
    assert.equal(pay.total, pay.amount100);
  });

  it('matches 2× pay when effective hours are equal (4×1.5 = 3×2)', () => {
    const pay150 = computeOvertimePayUsd({
      hours150: 4,
      hours200: 0,
      contractBaseSalary: 812.33,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
    });
    const pay200 = computeOvertimePayUsd({
      hours150: 0,
      hours200: 3,
      contractBaseSalary: 812.33,
      scheduledWorkingDays: 26,
      standardHoursPerDay: 8,
    });
    assert.equal(4 * 1.5, 3 * 2);
    assert.equal(pay150.amount150, pay200.amount200);
    assert.equal(pay150.amount150, Math.round(4 * pay150.hourlyRate * 1.5 * 100) / 100);
  });
});

describe('roundOvertimeHours', () => {
  it('rounds to two decimals', () => {
    const r = roundOvertimeHours({ hours100: 1.111, hours150: 3.333, hours200: 1.666 });
    assert.equal(r.hours100, 1.11);
    assert.equal(r.hours150, 3.33);
    assert.equal(r.hours200, 1.67);
  });
});
