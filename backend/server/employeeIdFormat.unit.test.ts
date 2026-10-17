import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import {
  formatEmployeeDisplayId,
  parseEmployeeDisplayIdSuffix,
  toCanonicalEmployeeDisplayId,
  isEmployeeBadgeDisplayId,
  employeeDisplayIdLookupVariants,
  employeeLookupWhere,
} from './employeeIdFormat.js';

describe('employeeIdFormat — ROC##### canonicalization', () => {
  it('formatEmployeeDisplayId pads to 5 digits', () => {
    assert.equal(formatEmployeeDisplayId(1), 'ROC00001');
    assert.equal(formatEmployeeDisplayId(4), 'ROC00004');
    assert.equal(formatEmployeeDisplayId(12), 'ROC00012');
  });

  it('toCanonicalEmployeeDisplayId rewrites IROC/EMP/ROC and pads', () => {
    assert.equal(toCanonicalEmployeeDisplayId('iroc4'), 'ROC00004');
    assert.equal(toCanonicalEmployeeDisplayId('IROC00004'), 'ROC00004');
    assert.equal(toCanonicalEmployeeDisplayId('EMP4'), 'ROC00004');
    assert.equal(toCanonicalEmployeeDisplayId('ROC4'), 'ROC00004');
    assert.equal(toCanonicalEmployeeDisplayId('ROC00035'), 'ROC00035');
    assert.equal(toCanonicalEmployeeDisplayId('adm1'), 'ADM00001');
  });

  it('parseEmployeeDisplayIdSuffix reads ROC/IROC/EMP', () => {
    assert.equal(parseEmployeeDisplayIdSuffix('ROC00004'), 4);
    assert.equal(parseEmployeeDisplayIdSuffix('IROC00004'), 4);
    assert.equal(parseEmployeeDisplayIdSuffix('EMP4'), 4);
    assert.equal(parseEmployeeDisplayIdSuffix('junk'), null);
  });

  it('isEmployeeBadgeDisplayId detects staff badges only', () => {
    assert.equal(isEmployeeBadgeDisplayId('ROC00001'), true);
    assert.equal(isEmployeeBadgeDisplayId('IROC00001'), true);
    assert.equal(isEmployeeBadgeDisplayId('EMP00001'), true);
    assert.equal(isEmployeeBadgeDisplayId('ADM00001'), false);
    assert.equal(isEmployeeBadgeDisplayId('hello'), false);
  });

  it('employeeDisplayIdLookupVariants includes ROC/IROC/EMP padded forms', () => {
    const variants = employeeDisplayIdLookupVariants('iroc4');
    assert.ok(variants.includes('IROC4') || variants.includes('iroc4'.toUpperCase()));
    assert.ok(variants.includes('ROC00004'));
    assert.ok(variants.includes('IROC00004'));
    assert.ok(variants.includes('EMP00004'));
  });

  it('employeeLookupWhere matches badge variants or internal PK', () => {
    const where = employeeLookupWhere('IROC00004') as {
      [key: symbol]: Array<Record<string, unknown>>;
    };
    const orKey = Op.or;
    const clauses = where[orKey];
    assert.ok(Array.isArray(clauses));
    assert.ok(clauses.some((c) => c.id === 'IROC00004'));
    const badgeClause = clauses.find((c) => c.employee_id) as {
      employee_id: { [key: symbol]: string[] };
    };
    assert.ok(badgeClause);
    const list = badgeClause.employee_id[Op.in];
    assert.ok(Array.isArray(list));
    assert.ok(list.includes('ROC00004'));
  });

  it('employeeLookupWhere empty input uses sentinel', () => {
    assert.deepEqual(employeeLookupWhere(''), { employee_id: '__missing__' });
  });
});
