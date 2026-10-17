/**
 * Run: npm run test:payroll-deductions  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeAbsenceDeductionUsd,
  resolveAbsenceDeductionDayCounts,
} from './payrollAbsenceDeductions.js';

describe('resolveAbsenceDeductionDayCounts', () => {
  it('uses attendance ABSENT record count only', () => {
    const counts = resolveAbsenceDeductionDayCounts({
      unpaidLeaveDaysParam: 1,
      paidDaysDetail: { unpaidLeaveDays: 1, absentDays: 3 },
      lateOccurrences: 0,
      rawAbsentRecordCount: 3,
    });
    assert.equal(counts.unpaidLeaveDays, 1);
    assert.equal(counts.unexcusedAbsentDays, 3);
  });

  it('uses leave-module unpaid days when param is zero', () => {
    const counts = resolveAbsenceDeductionDayCounts({
      unpaidLeaveDaysParam: 0,
      paidDaysDetail: { unpaidLeaveDays: 3, absentDays: 0 },
      lateOccurrences: 0,
    });
    assert.equal(counts.unpaidLeaveDays, 3);
  });

  it('uses the higher of leave-module and param unpaid days', () => {
    const counts = resolveAbsenceDeductionDayCounts({
      unpaidLeaveDaysParam: 2,
      paidDaysDetail: { unpaidLeaveDays: 5, absentDays: 0 },
      lateOccurrences: 0,
    });
    assert.equal(counts.unpaidLeaveDays, 5);
  });
});

describe('computeAbsenceDeductionUsd', () => {
  it('deducts unexcused absent days via daily rate', () => {
    const counts = resolveAbsenceDeductionDayCounts({
      unpaidLeaveDaysParam: 2,
      paidDaysDetail: { unpaidLeaveDays: 2, absentDays: 3 },
      lateOccurrences: 1,
      rawAbsentRecordCount: 3,
    });
    const dailyRate = 812.33 / 26;
    const parts = computeAbsenceDeductionUsd({
      dailyRate,
      counts,
      latePenaltyPerOccurrenceUsd: 5,
      active: true,
    });
    assert.equal(
      parts.unexcusedAbsence,
      Math.round(dailyRate * counts.unexcusedAbsentDays * 100) / 100
    );
    assert.equal(
      parts.unpaidLeave,
      Math.round(dailyRate * counts.unpaidLeaveDays * 100) / 100
    );
    assert.equal(parts.latePenalty, 5);
    assert.equal(
      parts.total,
      Math.round((parts.unpaidLeave + parts.unexcusedAbsence + parts.latePenalty) * 100) / 100
    );
  });

  it('returns zero when inactive', () => {
    const counts = resolveAbsenceDeductionDayCounts({
      unpaidLeaveDaysParam: 2,
      paidDaysDetail: { unpaidLeaveDays: 2, absentDays: 10 },
      lateOccurrences: 2,
      rawAbsentRecordCount: 10,
    });
    const parts = computeAbsenceDeductionUsd({
      dailyRate: 812.33 / 26,
      counts,
      latePenaltyPerOccurrenceUsd: 5,
      active: false,
    });
    assert.equal(parts.total, 0);
  });
});
