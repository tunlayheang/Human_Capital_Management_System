import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG } from './annualLeaveAccrualConfig.js';
import {
  accrualAmountForMonth,
  firstAccrualMonthInYear,
  isAccrualMonthOnOrAfterJoin,
  isJoinMonth,
  isJoinCalendarYear,
  normalizeJoinDateOnly,
  proratedYearEntitlementDays,
  sumEligibleAccrualThroughMonth,
} from './leaveAccrualRules.js';

const TIERS = DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.joinDateTiers;
const RATE = DEFAULT_ANNUAL_LEAVE_ACCRUAL_CONFIG.monthlyRate;

describe('leaveAccrualRules — Cambodian tiered first month', () => {
  it('first accrual month is join month for mid-year joiners', () => {
    assert.equal(firstAccrualMonthInYear('2026-06-01', 2026), '2026-06');
    assert.equal(firstAccrualMonthInYear('2026-06-01', 2027), '2027-01');
  });

  it('rejects accrual months before join date', () => {
    assert.equal(isAccrualMonthOnOrAfterJoin('2026-06-01', '2026-05'), false);
    assert.equal(isAccrualMonthOnOrAfterJoin('2026-06-01', '2026-06'), true);
  });

  it('applies join-day tiers in the first accrual month only', () => {
    assert.equal(accrualAmountForMonth('2026-01-01', '2026-01', RATE, TIERS), 1.5);
    assert.equal(accrualAmountForMonth('2026-01-05', '2026-01', RATE, TIERS), 1.5);
    assert.equal(accrualAmountForMonth('2026-01-09', '2026-01', RATE, TIERS), 1.5);
    assert.equal(accrualAmountForMonth('2026-01-10', '2026-01', RATE, TIERS), 1.0);
    assert.equal(accrualAmountForMonth('2026-01-15', '2026-01', RATE, TIERS), 1.0);
    assert.equal(accrualAmountForMonth('2026-01-19', '2026-01', RATE, TIERS), 1.0);
    assert.equal(accrualAmountForMonth('2026-01-20', '2026-01', RATE, TIERS), 0.5);
    assert.equal(accrualAmountForMonth('2026-01-25', '2026-01', RATE, TIERS), 0.5);
    assert.equal(accrualAmountForMonth('2026-01-31', '2026-01', RATE, TIERS), 0.5);
  });

  it('uses standard monthly rate after join month', () => {
    assert.equal(isJoinMonth('2026-01-15', '2026-01'), true);
    assert.equal(isJoinMonth('2026-01-15', '2026-02'), false);
    assert.equal(accrualAmountForMonth('2026-01-15', '2026-02', RATE, TIERS), 1.5);
    assert.equal(accrualAmountForMonth('2026-01-25', '2026-02', RATE, TIERS), 1.5);
  });

  it('January join examples from policy spec', () => {
    const { accrued: janOnly } = sumEligibleAccrualThroughMonth(
      '2026-01-15',
      2026,
      '2026-01',
      RATE,
      18,
      TIERS
    );
    assert.equal(janOnly, 1.0);

    const { accrued: throughApr } = sumEligibleAccrualThroughMonth(
      '2026-01-15',
      2026,
      '2026-04',
      RATE,
      18,
      TIERS
    );
    assert.equal(throughApr, 5.5);
  });

  it('June joiner through June accrues tier amount only', () => {
    const { accrued } = sumEligibleAccrualThroughMonth(
      '2026-06-01',
      2026,
      '2026-06',
      RATE,
      18,
      TIERS
    );
    assert.equal(accrued, 1.5);
  });

  it('does not use daily proration for mid-month join', () => {
    const amount = accrualAmountForMonth('2026-06-15', '2026-06', RATE, TIERS);
    assert.equal(amount, 1.0);
    assert.notEqual(amount, 0.75);
  });

  it('June 2 joiner earns 1.5 in join month (tier 1–9)', () => {
    assert.equal(accrualAmountForMonth('2026-06-02', '2026-06', RATE, TIERS), 1.5);
    const { accrued } = sumEligibleAccrualThroughMonth(
      '2026-06-02',
      2026,
      '2026-06',
      RATE,
      18,
      TIERS
    );
    assert.equal(accrued, 1.5);
  });

  it('normalizes Sequelize DATE objects (String(date).slice bug)', () => {
    const join = new Date('2026-06-02T00:00:00.000Z');
    assert.equal(normalizeJoinDateOnly(join), '2026-06-02');
    assert.equal(accrualAmountForMonth(join, '2026-06', RATE, TIERS), 1.5);
    assert.equal(proratedYearEntitlementDays(join, 2026, 18), 10.5);
  });

  it('normalizes local-midnight Date without ISO day shift', () => {
    // Local June 2 00:00 — toISOString() would often become June 1 in UTC+7.
    const localMidnight = new Date(2026, 5, 2, 0, 0, 0, 0);
    assert.equal(normalizeJoinDateOnly(localMidnight), '2026-06-02');
  });

  it('year cap: prorated in join year, full 18 from next calendar year', () => {
    const join = '2026-06-02';
    assert.equal(isJoinCalendarYear(join, 2026), true);
    assert.equal(isJoinCalendarYear(join, 2027), false);
    assert.equal(proratedYearEntitlementDays(join, 2026, 18), 10.5);
    assert.equal(proratedYearEntitlementDays(join, 2027, 18), 18);
  });

  it('year cap is 0 until the join date', () => {
    assert.equal(proratedYearEntitlementDays('2026-07-25', 2026, 18, '2026-07-19'), 0);
    // Join day 25 → 0.5 in July + 5 × 1.5 (Aug–Dec) = 8.0 (not months/12 × 18 = 9)
    assert.equal(proratedYearEntitlementDays('2026-07-25', 2026, 18, '2026-07-25'), 8);
  });

  it('July join-year entitlement respects join-day tiers (not months/12)', () => {
    // 1–9 Jul → 1.5 + 5×1.5 = 9
    assert.equal(proratedYearEntitlementDays('2026-07-01', 2026, 18), 9);
    assert.equal(proratedYearEntitlementDays('2026-07-09', 2026, 18), 9);
    // 10–19 Jul → 1.0 + 5×1.5 = 8.5
    assert.equal(proratedYearEntitlementDays('2026-07-10', 2026, 18), 8.5);
    assert.equal(proratedYearEntitlementDays('2026-07-15', 2026, 18), 8.5);
    assert.equal(proratedYearEntitlementDays('2026-07-19', 2026, 18), 8.5);
    // 20–end Jul → 0.5 + 5×1.5 = 8.0
    assert.equal(proratedYearEntitlementDays('2026-07-20', 2026, 18), 8);
    assert.equal(proratedYearEntitlementDays('2026-07-31', 2026, 18), 8);
  });

  it('July 15 joiner through July has accrued 1.0 under year cap 8.5', () => {
    const { accrued } = sumEligibleAccrualThroughMonth(
      '2026-07-15',
      2026,
      '2026-07',
      RATE,
      18,
      TIERS
    );
    assert.equal(accrued, 1);
    assert.equal(proratedYearEntitlementDays('2026-07-15', 2026, 18), 8.5);
  });

  it('join-year accrual through December capped at prorated 10.5', () => {
    const { accrued } = sumEligibleAccrualThroughMonth(
      '2026-06-02',
      2026,
      '2026-12',
      RATE,
      18,
      TIERS
    );
    assert.equal(accrued, 10.5);
  });

  it('second calendar year accrues 1.5/month from January capped at 18', () => {
    const { accrued } = sumEligibleAccrualThroughMonth(
      '2026-06-02',
      2027,
      '2027-12',
      RATE,
      18,
      TIERS
    );
    assert.equal(accrued, 18);
  });

  it('join-day tiers only produce 0.5 / 1 / 1.5 (never 1.2 or 0.4)', () => {
    for (let day = 1; day <= 31; day += 1) {
      const join = `2026-03-${String(day).padStart(2, '0')}`;
      const amount = accrualAmountForMonth(join, '2026-03', RATE, TIERS);
      assert.ok([0.5, 1, 1.5].includes(amount), `day ${day} → ${amount}`);
    }
  });

  it('odd monthly rates snap to half-day steps after join month', () => {
    assert.equal(accrualAmountForMonth('2026-01-01', '2026-02', 1.2, TIERS), 1);
    assert.equal(accrualAmountForMonth('2026-01-01', '2026-02', 0.4, TIERS), 0.5);
  });
});
