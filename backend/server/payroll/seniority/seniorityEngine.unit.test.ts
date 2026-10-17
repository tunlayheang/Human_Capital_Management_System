/**
 * Run: npm run test:seniority  (from backend/)
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySeniorityProration,
  computeFullMonthSeniorityAccrual,
  serviceYearsFromJoin,
} from './seniorityAccrualEngine.js';
import {
  evaluateSeniorityEligibility,
  ruleAppliesToEmployee,
} from './seniorityEligibilityEngine.js';
import { computeSeniorityPayoutForCycle } from './seniorityPayoutEngine.js';
import { pickSeniorityRuleForMonth, stripSeniorityFromAllowanceEngine } from './seniorityEngineService.js';
import type { SeniorityRuleRow } from './seniorityTypes.js';

function rule(partial: Partial<SeniorityRuleRow> & Pick<SeniorityRuleRow, 'id' | 'name' | 'effective_from'>): SeniorityRuleRow {
  return {
    description: null,
    effective_to: null,
    accrual_type: 'service_tiers',
    accrual_config: {
      tiers: [
        { yearsMin: 1, yearsMax: 2, amountUsd: 10 },
        { yearsMin: 3, yearsMax: 99, amountUsd: 25 },
      ],
    },
    calculation_base: 'basic_salary',
    eligibility_rules: { employeeStatuses: ['active'], excludeProbation: false },
    proration_rules: { enabled: true },
    payment_frequency: 'monthly',
    applicable_groups: { allEmployees: true },
    priority: 100,
    active: true,
    ...partial,
  };
}

describe('seniority accrual', () => {
  it('uses highest qualifying tier (years >= yearsMin)', () => {
    const amount = computeFullMonthSeniorityAccrual({
      accrualType: 'service_tiers',
      accrualConfig: {
        tiers: [
          { yearsMin: 0, yearsMax: 0, amountUsd: 0 },
          { yearsMin: 1, yearsMax: 2, amountUsd: 10 },
          { yearsMin: 5, yearsMax: 99, amountUsd: 40 },
        ],
      },
      baseSalary: 500,
      serviceYears: 6.2,
    });
    assert.equal(amount, 40);
  });

  it('picks tier by years of service', () => {
    const join = new Date();
    join.setFullYear(join.getFullYear() - 4);
    const years = serviceYearsFromJoin(join.toISOString().slice(0, 10));
    const amount = computeFullMonthSeniorityAccrual({
      accrualType: 'service_tiers',
      accrualConfig: {
        tiers: [
          { yearsMin: 1, yearsMax: 2, amountUsd: 10 },
          { yearsMin: 3, yearsMax: 99, amountUsd: 25 },
        ],
      },
      baseSalary: 500,
      serviceYears: years,
    });
    assert.equal(amount, 25);
  });

  it('prorates by eligible payroll days', () => {
    const { proratedUsd, factor } = applySeniorityProration({
      fullMonthAccrualUsd: 40,
      prorationEnabled: true,
      eligiblePayrollDays: 13,
      totalPayrollDays: 26,
    });
    assert.equal(proratedUsd, 20);
    assert.equal(factor, 0.5);
  });
});

describe('seniority eligibility', () => {
  it('accepts ACTIVE status (normalized)', () => {
    const r = evaluateSeniorityEligibility(
      { employeeStatuses: ['active'], excludeProbation: false },
      { employeeStatus: 'ACTIVE', joinDate: '2020-01-01' }
    );
    assert.equal(r.eligible, true);
  });

  it('blocks probation when configured', () => {
    const join = new Date();
    join.setMonth(join.getMonth() - 1);
    const r = evaluateSeniorityEligibility(
      { employeeStatuses: ['active'], excludeProbation: true },
      { employeeStatus: 'active', joinDate: join.toISOString().slice(0, 10), probationPeriodMonths: 3 }
    );
    assert.equal(r.eligible, false);
    assert.equal(r.reason, 'probation');
  });
});

describe('policy resolution', () => {
  it('prefers lower priority number', () => {
    const picked = pickSeniorityRuleForMonth(
      [
        rule({ id: 'a', name: 'A', effective_from: '2020-01-01', priority: 200 }),
        rule({ id: 'b', name: 'B', effective_from: '2020-01-01', priority: 100 }),
      ],
      '2026-06',
      {}
    );
    assert.equal(picked?.id, 'b');
  });

  it('breaks priority ties by newer effective_from', () => {
    const picked = pickSeniorityRuleForMonth(
      [
        rule({ id: 'old', name: 'Old', effective_from: '2020-01-01', priority: 100 }),
        rule({ id: 'new', name: 'New', effective_from: '2026-06-01', priority: 100 }),
      ],
      '2026-06',
      {}
    );
    assert.equal(picked?.id, 'new');
  });

  it('respects department filter', () => {
    const picked = pickSeniorityRuleForMonth(
      [
        rule({
          id: 'dept',
          name: 'Dept only',
          effective_from: '2020-01-01',
          applicable_groups: { allEmployees: false, departmentIds: ['d-1'] },
        }),
      ],
      '2026-06',
      { departmentId: 'd-2' }
    );
    assert.equal(picked, null);
    const match = pickSeniorityRuleForMonth(
      [
        rule({
          id: 'dept',
          name: 'Dept only',
          effective_from: '2020-01-01',
          applicable_groups: { allEmployees: false, departmentIds: ['d-1'] },
        }),
      ],
      '2026-06',
      { departmentId: 'd-1' }
    );
    assert.equal(match?.id, 'dept');
  });
});

describe('monthly payout', () => {
  it('pays prorated accrual each month', () => {
    const plan = computeSeniorityPayoutForCycle({
      paymentFrequency: 'monthly',
      proratedAccrualUsd: 18.5,
      ledgerBalanceUsd: 0,
    });
    assert.equal(plan.payoutUsd, 18.5);
    assert.equal(plan.accrueOnly, false);
  });
});

describe('allowance strip', () => {
  it('removes SENIORITY lines from allowance engine output', () => {
    const out = stripSeniorityFromAllowanceEngine({
      lines: [
        {
          allowanceTypeId: 'at-seniority',
          code: 'SENIORITY',
          name: 'Seniority Payment',
          category: 'seniority',
          calculationType: 'seniority_based',
          amount: 25,
          taxable: true,
          ruleId: 'ar-seniority-1-2',
          ruleName: '1–2 years',
          triggerType: 'seniority',
          priority: 200,
          appliedConditions: {},
          formula: null,
        },
        {
          allowanceTypeId: 'at-meal',
          code: 'MEAL',
          name: 'Meal',
          category: 'fixed',
          calculationType: 'fixed',
          amount: 50,
          taxable: true,
          ruleId: 'ar-meal',
          ruleName: 'Meal',
          triggerType: 'fixed',
          priority: 100,
          appliedConditions: {},
          formula: null,
        },
      ],
      legacy: { transport: 0, attendance: 0, meal: 50, seniority: 25, position: 0, commission: 0, otMeal: 0 },
      total: 75,
      audit: [],
    });
    assert.ok(out);
    assert.equal(out!.lines.length, 1);
    assert.equal(out!.lines[0]!.code, 'MEAL');
    assert.equal(out!.legacy.seniority, 0);
    assert.equal(out!.total, 50);
  });
});

describe('applicable groups', () => {
  it('defaults to all employees when groups empty', () => {
    assert.equal(ruleAppliesToEmployee({}, {}), true);
    assert.equal(ruleAppliesToEmployee({ allEmployees: true }, {}), true);
  });
});
