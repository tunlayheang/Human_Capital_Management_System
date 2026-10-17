import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProbationLegalCap,
  computedProbationEndDate,
  isInProbation,
  isProbationReviewDue,
  resolveProbationAccrualStartDate,
  validateProbationFields,
} from './probationService.js';

describe('probationService — Art. 68 acceptance', () => {
  it('A — regular worker: 4 months capped to 3', () => {
    const cap = applyProbationLegalCap(4, 'regular');
    assert.equal(cap.months, 3);
    assert.equal(cap.capped, true);
    const v = validateProbationFields({
      worker_type: 'regular',
      probation_period_months: 4,
      join_date: '2026-01-01',
    });
    assert.equal(v.ok, true);
    assert.equal(v.probationPeriodMonths, 3);
    assert.ok(v.warning?.includes('3'));
  });

  it('B — 2 months maps to specialized worker_type (Art. 68)', () => {
    const ok = validateProbationFields({
      employment_type: 'Full-Time',
      probation_period_months: 2,
      join_date: '2026-01-01',
    });
    assert.equal(ok.probationPeriodMonths, 2);
    assert.equal(ok.workerType, 'specialized');
    assert.equal(ok.capped, false);
  });

  it('C — 1 month maps to non_specialized worker_type (Art. 68)', () => {
    const ok = validateProbationFields({
      employment_type: 'Part-Time',
      probation_period_months: 1,
      join_date: '2026-01-01',
    });
    assert.equal(ok.probationPeriodMonths, 1);
    assert.equal(ok.workerType, 'non_specialized');
  });

  it('C2 — Contract period up to 24 months (Art. 67); not Art. 68 probation', () => {
    const ok = validateProbationFields({
      employment_type: 'Contract',
      probation_period_months: 12,
      join_date: '2026-01-01',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.probationPeriodMonths, 12);
    assert.equal(
      isInProbation(
        {
          status: 'active',
          employment_type: 'Contract',
          join_date: '2026-01-01',
          probation_period_months: 12,
        },
        '2026-03-01'
      ),
      false
    );

    const capped = validateProbationFields({
      employment_type: 'Intern',
      probation_period_months: 30,
      join_date: '2026-01-01',
    });
    assert.equal(capped.probationPeriodMonths, 24);
    assert.equal(capped.capped, true);
  });

  it('D — zero months: never in probation; accrual from join', () => {
    const emp = {
      status: 'active',
      join_date: '2026-01-01',
      probation_period_months: 0,
      worker_type: 'regular',
    };
    assert.equal(isInProbation(emp, '2026-06-01'), false);
    assert.equal(resolveProbationAccrualStartDate(emp), '2026-01-01');
  });

  it('E — early HR pass on 15 Feb ends probation; accrual from 16 Feb', () => {
    const base = {
      status: 'active',
      join_date: '2026-01-01',
      probation_period_months: 3,
      worker_type: 'regular',
    };
    assert.equal(isInProbation(base, '2026-02-14'), true);
    const confirmed = { ...base, probation_confirmed_at: '2026-02-15' };
    assert.equal(isInProbation(confirmed, '2026-02-15'), false);
    assert.equal(isInProbation(confirmed, '2026-03-01'), false);
    assert.equal(resolveProbationAccrualStartDate(confirmed), '2026-02-16');
  });

  it('F — no review: in probation until computed end exclusive', () => {
    const emp = {
      status: 'active',
      join_date: '2026-01-01',
      probation_period_months: 3,
      worker_type: 'regular',
    };
    assert.equal(computedProbationEndDate('2026-01-01', 3), '2026-04-01');
    assert.equal(isInProbation(emp, '2026-03-31'), true);
    assert.equal(isInProbation(emp, '2026-04-01'), false);
  });

  it('G — past end without confirmation is due for review', () => {
    const emp = {
      status: 'active',
      join_date: '2026-01-01',
      probation_period_months: 3,
      worker_type: 'regular',
    };
    assert.equal(isInProbation(emp, '2026-04-15'), false);
    assert.equal(isProbationReviewDue(emp, '2026-04-15'), true);
  });

  it('H — cannot extend probation after original end date passed', () => {
    const existing = {
      status: 'active',
      join_date: '2026-01-01',
      probation_period_months: 1,
      worker_type: 'specialized',
    };
    const blocked = validateProbationFields(
      { probation_period_months: 2, worker_type: 'specialized', join_date: '2026-01-01' },
      existing,
      '2026-05-01'
    );
    assert.equal(blocked.ok, false);
    assert.ok(blocked.error?.toLowerCase().includes('extend'));
  });
});
