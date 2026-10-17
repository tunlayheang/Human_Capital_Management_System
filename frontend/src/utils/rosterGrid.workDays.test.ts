import { describe, expect, it } from 'vitest';
import {
  applyPublicHolidaysToGrid,
  countRosterPayrollWorkDays,
  countRosterPayrollWorkDaysFromEntries,
  type RosterGrid,
} from './rosterGrid';
import { buildRosterPaintTypesWithHoliday } from './rosterPaintTypes';

describe('payroll work days from planning roster', () => {
  const paintTypes = buildRosterPaintTypesWithHoliday([]);
  const employees = [{ id: 'emp-1', name: 'Test', employeeCode: 'IROC00010' }];

  it('counts full month minus day off cells only', () => {
    const grid: RosterGrid = { 'emp-1': {} };
    for (let d = 1; d <= 30; d++) grid['emp-1'][d] = 'working';
    grid['emp-1'][15] = 'dayoff';
    expect(countRosterPayrollWorkDays(grid, 'emp-1', 30, paintTypes)).toBe(29);
  });

  it('counts planned leave as work days but excludes holiday and day off', () => {
    const grid: RosterGrid = { 'emp-1': {} };
    for (let d = 1; d <= 31; d++) grid['emp-1'][d] = 'working';
    grid['emp-1'][5] = 'holiday';
    grid['emp-1'][10] = 'leave:lt-annual';
    grid['emp-1'][20] = 'dayoff';
    expect(countRosterPayrollWorkDays(grid, 'emp-1', 31, paintTypes)).toBe(29);
  });

  it('does not overwrite manual cells when applying public holidays', () => {
    const grid: RosterGrid = { 'emp-1': { 1: 'working', 2: 'dayoff', 3: 'working' } };
    applyPublicHolidaysToGrid(grid, employees, 0, 2026, 31);
    expect(grid['emp-1'][2]).toBe('dayoff');
  });

  it('matches entry-based count for Day Off label', () => {
    const entries = [
      { employeeId: 'IROC00010', day: 3, leaveType: 'Day Off', isLocked: true },
      { employeeId: 'IROC00010', day: 8, leaveType: 'Annual Leave', isLocked: true },
    ];
    expect(
      countRosterPayrollWorkDaysFromEntries(entries, 'emp-1', employees, 30)
    ).toBe(29);
  });
});
