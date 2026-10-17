import assert from 'node:assert/strict';

/** Mirrors commission_based amount math in allowanceRuleEngine.evaluateRuleAmount. */
export function computeSalesCommissionUsd(input: {
  sales: number;
  threshold: number;
  commissionPct: number;
  fixedAmount?: number;
  perUnit?: number;
}): number | null {
  const sales = Number(input.sales) || 0;
  const threshold = Number(input.threshold) || 0;
  const commissionPct = Number(input.commissionPct) || 0;
  const perUnit = Number(input.perUnit) || 0;
  const fixed = Number(input.fixedAmount) || 0;

  if (sales < threshold) {
    if (fixed > 0) return Math.round(fixed * 100) / 100;
    return null;
  }

  let amount = (sales * commissionPct) / 100;
  if (perUnit > 0) amount += perUnit;
  if (amount === 0 && fixed > 0) amount = fixed;
  return Math.round(amount * 100) / 100;
}

function run() {
  assert.equal(
    computeSalesCommissionUsd({ sales: 7000, threshold: 5000, commissionPct: 3 }),
    210
  );
  assert.equal(
    computeSalesCommissionUsd({
      sales: 7000,
      threshold: 5000,
      commissionPct: 3,
      fixedAmount: 60,
    }),
    210,
    'above threshold uses % not fixed'
  );
  assert.equal(
    computeSalesCommissionUsd({
      sales: 300,
      threshold: 5000,
      commissionPct: 3,
      fixedAmount: 60,
    }),
    60,
    'below threshold uses fixed fallback'
  );
  assert.equal(
    computeSalesCommissionUsd({ sales: 4000, threshold: 5000, commissionPct: 3 }),
    null,
    'below threshold with no fixed → no pay'
  );
  assert.equal(
    computeSalesCommissionUsd({
      sales: 0,
      threshold: 0,
      commissionPct: 3,
      fixedAmount: 60,
    }),
    60,
    'met gate but %×sales is $0 → fixed fallback'
  );
  assert.equal(
    computeSalesCommissionUsd({
      sales: 0,
      threshold: 0,
      commissionPct: 0,
      fixedAmount: 60,
    }),
    60,
    'met gate, no % → fixed'
  );
  console.log('commissionSalesMath.unit.test.ts: ok');
}

run();
