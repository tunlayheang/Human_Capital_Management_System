import { describe, expect, it } from 'vitest';
import {
  buildRosterPaintableTypes,
  buildRosterPaintTypesWithHoliday,
  buildRosterViewOnlyLeaveTypes,
  isRosterPaintableType,
  resolveEntryToRosterTypeId,
} from './rosterPaintTypes';

describe('rosterPaintTypes', () => {
  const leaveTypes = [
    { id: 'lt-ph', name: 'Public Holiday', code: 'PUBLIC_HOLIDAY', isPaid: true, daysAllowed: 0 },
    { id: 'lt-al', name: 'Annual Leave', code: 'AL', isPaid: true, daysAllowed: 18 },
    { id: 'lt-sick', name: 'Sick Leave', code: 'SICK', isPaid: true, daysAllowed: 14 },
  ];

  it('includes Public Holiday as a paintable staffing type', () => {
    const paintable = buildRosterPaintableTypes();
    const ph = paintable.find((t) => t.id === 'holiday');
    expect(ph?.name).toBe('Public Holiday');
    expect(ph?.code).toBe('PH');
    expect(ph?.paintable).toBe(true);
    expect(isRosterPaintableType('holiday', buildRosterPaintTypesWithHoliday(leaveTypes))).toBe(true);
  });

  it('excludes configured Public Holiday from view-only leave list', () => {
    const viewOnly = buildRosterViewOnlyLeaveTypes(leaveTypes);
    expect(viewOnly.some((t) => t.name === 'Public Holiday')).toBe(false);
    expect(viewOnly.some((t) => t.name === 'Annual Leave')).toBe(true);
  });

  it('includes Mission as a paintable staffing type', () => {
    const paintable = buildRosterPaintableTypes();
    const mission = paintable.find((t) => t.id === 'mission');
    expect(mission?.name).toBe('Mission');
    expect(mission?.code).toBe('M');
    expect(mission?.paintable).toBe(true);
    expect(isRosterPaintableType('mission', buildRosterPaintTypesWithHoliday(leaveTypes))).toBe(true);
  });

  it('resolves saved Mission labels to mission id', () => {
    const paintTypes = buildRosterPaintTypesWithHoliday(leaveTypes);
    expect(resolveEntryToRosterTypeId('Mission', paintTypes)).toBe('mission');
    expect(resolveEntryToRosterTypeId('M', paintTypes)).toBe('mission');
  });
});
