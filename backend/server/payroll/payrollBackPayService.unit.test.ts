import assert from 'node:assert/strict';
import {
  buildBackPayFromAdjustments,
  previousPayrollMonth,
} from './payrollBackPayService.js';

function testPreviousMonth() {
  assert.equal(previousPayrollMonth('2026-08'), '2026-07');
  assert.equal(previousPayrollMonth('2026-01'), '2025-12');
}

function testAdjustmentsOnlyBackPay() {
  const map = buildBackPayFromAdjustments(
    [
      {
        userId: 'u1',
        month: '2026-06',
        amountUsd: 40,
        description: 'Attendance correction',
      },
      {
        userId: 'u1',
        month: '2026-07',
        amountUsd: 10,
        adjustmentType: 'MANUAL',
      },
      {
        userId: 'u2',
        month: '2026-07',
        amountUsd: 0,
        description: 'zero skipped',
      },
      {
        userId: 'u3',
        month: '2026-07',
        amountUsd: -15,
        description: 'Overpayment recovery',
      },
    ],
    '2026-08'
  );

  assert.equal(map.size, 2);
  const u1 = map.get('u1')!;
  assert.equal(u1.totalUsd, 50);
  assert.equal(u1.postCutoffOtUsd, 0);
  assert.equal(u1.adjustmentUsd, 50);
  assert.equal(u1.sourceMonth, '2026-06');
  assert.ok(u1.lines.some((l) => l.includes('2026-06') && l.includes('40')));
  assert.ok(u1.lines.some((l) => l.includes('2026-07') && l.includes('10')));

  const u3 = map.get('u3')!;
  assert.equal(u3.totalUsd, -15);
  assert.equal(u3.postCutoffOtUsd, 0);
  assert.equal(map.has('u2'), false);
}

testPreviousMonth();
testAdjustmentsOnlyBackPay();
console.log('payrollBackPayService.unit.test.ts: ok');
