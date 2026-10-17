/**
 * Run: npx tsx --test server/payroll/payrollCalendarMigrate.unit.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PAYROLL_GROUP,
  buildMonthlyCycleForMonth,
  periodBoundsFromCutoffs,
  syncGroupCyclePeriodBounds,
} from './payrollCalendarMigrate.js';

describe('cutoff-to-cutoff payroll periods', () => {
  it('builds July as day after June cutoff through July cutoff', () => {
    const juneCutoff = '2026-06-25';
    const july = buildMonthlyCycleForMonth(2026, 6, DEFAULT_PAYROLL_GROUP, {
      cutoffDate: '2026-07-25',
      previousCutoffDate: juneCutoff,
    });
    assert.equal(july.periodStart, '2026-06-26');
    assert.equal(july.periodEnd, '2026-07-25');
    assert.equal(july.attendanceCutoffDate, '2026-07-25');
  });

  it('syncs a full year from consecutive painted cutoffs', () => {
    const cycles = syncGroupCyclePeriodBounds(2026, DEFAULT_PAYROLL_GROUP, {
      '2026-06': {
        month: '2026-06',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        attendanceCutoffDate: '2026-06-25',
        payrollCalculationDate: '2026-06-28',
        payrollApprovalDate: '2026-06-29',
        paymentDate: '2026-06-30',
      },
      '2026-07': {
        month: '2026-07',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        attendanceCutoffDate: '2026-07-25',
        payrollCalculationDate: '2026-07-28',
        payrollApprovalDate: '2026-07-29',
        paymentDate: '2026-07-31',
      },
    });
    assert.equal(cycles['2026-07'].periodStart, '2026-06-26');
    assert.equal(cycles['2026-07'].periodEnd, '2026-07-25');
  });

  it('periodBoundsFromCutoffs rejects inverted windows', () => {
    const bounds = periodBoundsFromCutoffs('2026-07-28', '2026-07-25');
    assert.equal(bounds.periodStart, '2026-07-25');
    assert.equal(bounds.periodEnd, '2026-07-25');
  });
});
