/**
 * Package amounts apply only when a package is assigned explicitly.
 * Department/role never auto-match packages.
 */
import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import dotenv from 'dotenv';

dotenv.config();

describe('allowance package position amount', () => {
  after(async () => {
    const { sequelize } = await import('../db.js');
    await sequelize.close();
  });

  it('Manager package pays Position $100 for non-MANAGER role when package is explicit', async () => {
    const { previewAllowancePackage } = await import('../allowanceRuleService.js');

    const result = await previewAllowancePackage({
      allowanceTemplateId: 'atpl-manager',
      baseSalary: 940,
      accessRole: 'EMPLOYEE',
      departmentId: null,
      positionId: null,
      joinDate: '2024-01-01',
      workHours: 8,
      month: '2026-07',
    });

    const position = result.lines.find((l) => String(l.code).toUpperCase() === 'POSITION');
    const meal = result.lines.find((l) => String(l.code).toUpperCase() === 'MEAL');
    const transport = result.lines.find((l) => String(l.code).toUpperCase() === 'TRANSPORT');

    assert.ok(position, 'POSITION line missing');
    assert.equal(position.amount, 100);
    assert.equal(meal?.amount, 50);
    assert.equal(transport?.amount, 30);
    assert.equal(result.legacy.position, 100);
    assert.ok(result.total >= 180);
  });

  it('without a package, catalog rules do not auto-pay allowances', async () => {
    const { calculateAllowancesForEmployee } = await import('../allowanceRuleEngine.js');

    const result = await calculateAllowancesForEmployee({
      employeeInternalId: 'preview',
      baseSalary: 940,
      accessRole: 'MANAGER',
      departmentId: 'dep-1',
      positionId: null,
      positionTitle: null,
      joinDate: '2024-01-01',
      workHours: 8,
      month: '2026-07',
      attendance: [],
      approvedOvertime: { hours100: 0, hours150: 0, hours200: 0 },
      explicitTemplateId: null,
    });

    assert.equal(result.total, 0);
    assert.equal(result.legacy.position, 0);
    assert.equal(result.legacy.meal, 0);
    assert.equal(result.legacy.transport, 0);
  });
});
