import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOffboardAbsenceDailyRateUsd } from './finalSettlementService.js';

describe('resolveOffboardAbsenceDailyRateUsd', () => {
  it('uses contract base ÷ scheduled work days (exact daily rate)', () => {
    const rate = resolveOffboardAbsenceDailyRateUsd(
      {
        contractBaseSalary: 300,
        payrollAudit: { totalScheduledWorkingDays: 22 },
        hybrid: { standardDays: 22 },
        grossSalary: 0,
        netSalary: 0,
        deductions: {},
      } as Parameters<typeof resolveOffboardAbsenceDailyRateUsd>[0],
      { work_hours: 8 }
    );
    assert.ok(Math.abs(rate - 300 / 22) < 0.0001);
  });

  it('prefers breakdown contract base over employee row', () => {
    const rate = resolveOffboardAbsenceDailyRateUsd(
      {
        contractBaseSalary: 400,
        hybrid: { standardDays: 20, fixed: { contractBaseSalary: 400 } },
        grossSalary: 0,
        netSalary: 0,
        deductions: {},
      } as Parameters<typeof resolveOffboardAbsenceDailyRateUsd>[0],
      { base_salary: 999, work_hours: 8 }
    );
    assert.ok(Math.abs(rate - 20) < 0.0001);
  });
});
