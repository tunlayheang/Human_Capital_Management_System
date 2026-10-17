import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { applyEmployeeTextSearch, normalizeEmployeeSearchQuery } from './employeeSearch.js';

describe('employeeSearch', () => {
  it('normalizes whitespace in queries', () => {
    assert.equal(normalizeEmployeeSearchQuery('  Sokha   Chan  '), 'Sokha Chan');
  });

  it('builds OR conditions for full name, Khmer, phone, and EmpID', () => {
    const where: Record<string, unknown> = {};
    applyEmployeeTextSearch(where, 'Sokha Chan');
    const and = where[Op.and] as unknown[];
    assert.ok(Array.isArray(and) && and.length >= 1);
    const orBlock = and[0] as { [key: symbol]: unknown[] };
    const ors = orBlock[Op.or];
    assert.ok(Array.isArray(ors) && ors.length >= 8);
    const keys = ors
      .filter((c) => c && typeof c === 'object' && !Array.isArray(c))
      .flatMap((c) => Object.keys(c as object));
    assert.ok(keys.includes('first_name'));
    assert.ok(keys.includes('last_name'));
    assert.ok(keys.includes('first_name_kh'));
    assert.ok(keys.includes('last_name_kh'));
    assert.ok(keys.includes('employee_id'));
    assert.ok(keys.includes('phone'));
    assert.ok(keys.includes('email'));
  });

  it('ignores empty search', () => {
    const where: Record<string, unknown> = {};
    applyEmployeeTextSearch(where, '   ');
    assert.equal(where[Op.and], undefined);
  });
});
