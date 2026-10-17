/**
 * Run: npx tsx --test server/payrollCalendarService.unit.test.ts
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

after(async () => {
  const { sequelize } = await import('./db.js');
  await sequelize.close();
});

describe('payroll calendar config parsing', () => {
  it('reads autoFreezeAttendanceOnCutoff from JSON string config', async () => {
    const { getPayrollCalendar, savePayrollCalendar } = await import('./payrollCalendarService.js');
    const year = 2099;
    await savePayrollCalendar(year, { autoFreezeAttendanceOnCutoff: false });
    const loaded = await getPayrollCalendar(year);
    assert.equal(loaded.autoFreezeAttendanceOnCutoff, false);
    await savePayrollCalendar(year, { autoFreezeAttendanceOnCutoff: true });
  });
});
