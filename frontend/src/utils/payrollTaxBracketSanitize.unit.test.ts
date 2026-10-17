import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseKhrBracketField,
  sanitizePayrollTaxBrackets,
  validatePayrollTaxBrackets,
} from './payrollTaxBracketSanitize.js';

test('parseKhrBracketField keeps previous value for empty input', () => {
  assert.equal(parseKhrBracketField('', 12_500_000), 12_500_000);
  assert.equal(parseKhrBracketField('.', 8_500_001), 8_500_001);
});

test('sanitizePayrollTaxBrackets repairs corrupt GDT top brackets', () => {
  const repaired = sanitizePayrollTaxBrackets([
    { min: 0, max: 1_500_000, rate: 0, deduction: 0, range: '', currency: 'KHR' },
    { min: 1_500_001, max: 2_000_000, rate: 5, deduction: 75_000, range: '', currency: 'KHR' },
    { min: 2_000_001, max: 8_500_000, rate: 10, deduction: 175_000, range: '', currency: 'KHR' },
    { min: 8_500_001, max: 0, rate: 15, deduction: 599_994, range: '', currency: 'KHR' },
    { min: 12_499_998, max: 9_999_999_999, rate: 20, deduction: 1_224_998, range: '', currency: 'KHR' },
  ]);

  assert.equal(repaired[3]?.max, 12_500_000);
  assert.equal(repaired[3]?.deduction, 600_000);
  assert.equal(repaired[4]?.min, 12_500_001);
  assert.equal(repaired[4]?.deduction, 1_225_000);
  assert.equal(validatePayrollTaxBrackets(repaired).length, 0);
});
