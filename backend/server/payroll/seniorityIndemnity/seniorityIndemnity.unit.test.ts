import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SENIORITY_INDEMNITY_CONFIG } from './seniorityIndemnityConfig.js';
import {
  calculateSeniorityIndemnity,
  computeServiceLength,
  evaluateSeniorityIndemnityEligibility,
} from './seniorityIndemnityService.js';
import type { SeniorityIndemnitySemesterMonthInput } from './seniorityIndemnityTypes.js';

const cfg = { ...DEFAULT_SENIORITY_INDEMNITY_CONFIG, inclusionRule: 'after_probation' as const };

function s1Months(
  year: number,
  wages: Array<{ month: number; gross: number; days?: number }>
): SeniorityIndemnitySemesterMonthInput[] {
  return wages.map(({ month, gross, days }) => ({
    month: `${year}-${String(month).padStart(2, '0')}`,
    grossWagesUsd: gross,
    basisWagesUsd: gross,
    daysWorked: days ?? 26,
  }));
}

describe('seniorityIndemnityService Art. 89 semester model', () => {
  it('computes service length with years, months, days', () => {
    const sl = computeServiceLength('2022-01-15', '2026-06-30');
    assert.ok(sl);
    assert.equal(sl!.years, 4);
  });

  it('rejects FDC and flags severance rule', () => {
    const e = evaluateSeniorityIndemnityEligibility({
      joinDate: '2020-01-01',
      contractType: 'FDC',
      employmentType: 'Contract',
      payrollPeriodEnd: '2026-06-30',
      config: cfg,
    });
    assert.equal(e.eligible, false);
    assert.equal(e.reason, 'fdc_severance_required');
    assert.equal(e.fdcSeveranceRequired, true);
  });

  it('A — full-year UDC $520/mo, divisor 26, S1 all months', () => {
    const months = s1Months(2026, [
      { month: 1, gross: 520 },
      { month: 2, gross: 520 },
      { month: 3, gross: 520 },
      { month: 4, gross: 520 },
      { month: 5, gross: 520 },
      { month: 6, gross: 520 },
    ]);
    const june = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-30',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 520,
      scheduledWorkingDays: 26,
      config: { ...cfg, workingDaysDivisor: 26 },
      semesterMonthlyInputs: months,
      employedOnPayoutDate: true,
    });
    assert.equal(june.payoutDays, 7.5);
    assert.equal(june.avgMonthlyUsd, 520);
    assert.equal(june.dailyRateUsd, 20);
    assert.equal(june.payoutUsd, 150);

    const dec = calculateSeniorityIndemnity({
      payrollMonth: '2026-12',
      payrollPeriodEnd: '2026-12-31',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 520,
      scheduledWorkingDays: 26,
      config: { ...cfg, workingDaysDivisor: 26 },
      semesterMonthlyInputs: s1Months(2026, [
        { month: 7, gross: 520 },
        { month: 8, gross: 520 },
        { month: 9, gross: 520 },
        { month: 10, gross: 520 },
        { month: 11, gross: 520 },
        { month: 12, gross: 520 },
      ]),
      employedOnPayoutDate: true,
    });
    assert.equal(dec.payoutUsd, 150);
  });

  it('B — Apr join, 1-mo probation, May+Jun post-probation full 7.5 days', () => {
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-30',
      joinDate: '2026-04-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 1,
      salaryBasisUsd: 780,
      scheduledWorkingDays: 26,
      config: { ...cfg, workingDaysDivisor: 26 },
      semesterMonthlyInputs: s1Months(2026, [
        { month: 4, gross: 780, days: 26 },
        { month: 5, gross: 780, days: 26 },
        { month: 6, gross: 780, days: 26 },
      ]),
      employedOnPayoutDate: true,
    });
    assert.equal(result.payoutDays, 7.5);
    assert.equal(result.avgMonthlyUsd, 780);
    assert.equal(result.dailyRateUsd, 30);
    assert.equal(result.payoutUsd, 225);
  });

  it('C — mid-semester salary change uses semester average', () => {
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-30',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 720,
      scheduledWorkingDays: 26,
      config: { ...cfg, workingDaysDivisor: 26 },
      semesterMonthlyInputs: s1Months(2026, [
        { month: 1, gross: 600 },
        { month: 2, gross: 600 },
        { month: 3, gross: 600 },
        { month: 4, gross: 720 },
        { month: 5, gross: 720 },
        { month: 6, gross: 720 },
      ]),
      employedOnPayoutDate: true,
    });
    assert.equal(result.avgMonthlyUsd, 660);
    assert.equal(result.dailyRateUsd, 25.38);
    assert.equal(result.payoutUsd, 190.38);
  });

  it('D — employer termination, 3 seniority months, 7 days not 7.5', () => {
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-15',
      joinDate: '2026-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 780,
      scheduledWorkingDays: 26,
      config: { ...cfg, workingDaysDivisor: 26 },
      isFinalSettlement: true,
      semesterMonthlyInputs: s1Months(2026, [
        { month: 1, gross: 780 },
        { month: 2, gross: 780 },
        { month: 3, gross: 780 },
      ]),
      termination: { reason: 'employer', seriousMisconduct: false },
    });
    assert.equal(result.payoutDays, 7);
    assert.equal(result.dailyRateUsd, 30);
    assert.equal(result.payoutUsd, 210);
  });

  it('E — serious misconduct termination pays $0', () => {
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-15',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 780,
      scheduledWorkingDays: 26,
      config: cfg,
      isFinalSettlement: true,
      semesterMonthlyInputs: s1Months(2026, [
        { month: 1, gross: 780 },
        { month: 2, gross: 780 },
        { month: 3, gross: 780 },
        { month: 4, gross: 780 },
        { month: 5, gross: 780 },
        { month: 6, gross: 780 },
      ]),
      termination: { reason: 'employer', seriousMisconduct: true },
    });
    assert.equal(result.payoutUsd, 0);
    assert.equal(result.ineligibleReason, 'serious_misconduct');
  });

  it('returns zero outside June/December for regular payroll', () => {
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-03',
      payrollPeriodEnd: '2026-03-31',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      salaryBasisUsd: 520,
      scheduledWorkingDays: 26,
      config: cfg,
    });
    assert.equal(result.payoutUsd, 0);
    assert.equal(result.ineligibleReason, 'not_payout_month');
  });

  it('excludes intern employment type', () => {
    const e = evaluateSeniorityIndemnityEligibility({
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Intern',
      payrollPeriodEnd: '2026-06-30',
      config: cfg,
    });
    assert.equal(e.eligible, false);
  });

  it('treats Permanent employment as UDC-eligible', () => {
    const e = evaluateSeniorityIndemnityEligibility({
      joinDate: '2020-01-01',
      contractType: null,
      employmentType: 'Permanent',
      payrollPeriodEnd: '2026-06-30',
      config: cfg,
    });
    assert.equal(e.eligible, true);
  });

  it('rejects Fixed-Term Contract as FDC', () => {
    const e = evaluateSeniorityIndemnityEligibility({
      joinDate: '2020-01-01',
      contractType: 'Fixed-Term Contract',
      employmentType: 'Full-Time',
      payrollPeriodEnd: '2026-06-30',
      config: cfg,
    });
    assert.equal(e.eligible, false);
    assert.equal(e.reason, 'fdc_severance_required');
  });

  it('honors after_months inclusion waiting period', () => {
    const waiting = evaluateSeniorityIndemnityEligibility({
      joinDate: '2026-01-15',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      payrollPeriodEnd: '2026-03-31',
      config: { ...cfg, inclusionRule: 'after_months', inclusionMonths: 6 },
    });
    assert.equal(waiting.eligible, false);
    assert.equal(waiting.reason, 'inclusion_waiting_period');

    const ready = evaluateSeniorityIndemnityEligibility({
      joinDate: '2026-01-15',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      payrollPeriodEnd: '2026-07-31',
      config: { ...cfg, inclusionRule: 'after_months', inclusionMonths: 6 },
    });
    assert.equal(ready.eligible, true);
  });

  it('uses actual working days when dailyRateMethod is actual_working_days', () => {
    const months = s1Months(2026, [
      { month: 1, gross: 520 },
      { month: 2, gross: 520 },
      { month: 3, gross: 520 },
      { month: 4, gross: 520 },
      { month: 5, gross: 520 },
      { month: 6, gross: 520 },
    ]);
    const result = calculateSeniorityIndemnity({
      payrollMonth: '2026-06',
      payrollPeriodEnd: '2026-06-30',
      joinDate: '2020-01-01',
      contractType: 'UDC',
      employmentType: 'Full-Time',
      probationPeriodMonths: 0,
      salaryBasisUsd: 520,
      scheduledWorkingDays: 26,
      actualWorkingDays: 22,
      config: {
        ...cfg,
        workingDaysDivisor: 26,
        dailyRateMethod: 'actual_working_days',
      },
      semesterMonthlyInputs: months,
      employedOnPayoutDate: true,
    });
    assert.equal(result.avgMonthlyUsd, 520);
    assert.equal(result.dailyRateUsd, Math.round((520 / 22) * 100) / 100);
    assert.equal(result.payoutUsd, Math.round((520 / 22) * 7.5 * 100) / 100);
  });
});
