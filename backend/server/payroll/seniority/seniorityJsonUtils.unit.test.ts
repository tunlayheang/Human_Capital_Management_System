import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAccrualConfigForType,
  parseJsonColumn,
} from './seniorityJsonUtils.js';

describe('seniorityJsonUtils', () => {
  it('repairs character-index corrupted JSON objects', () => {
    const corrupt = {
      '0': '{',
      '1': '"',
      '2': 'p',
      '3': 'e',
      '4': 'r',
      '5': 'c',
      '6': 'e',
      '7': 'n',
      '8': 't',
      '9': '"',
      '10': ':',
      '11': '1',
      '12': '0',
      '13': '0',
      '14': '}',
      percent: 100,
    };
    const parsed = buildAccrualConfigForType('percent_salary', corrupt);
    assert.equal(parsed.percent, 100);
    assert.equal('tiers' in parsed, false);
  });

  it('parses JSON strings', () => {
    const parsed = parseJsonColumn('{"amountUsd":5}', {});
    assert.equal(parsed.amountUsd, 5);
  });
});
