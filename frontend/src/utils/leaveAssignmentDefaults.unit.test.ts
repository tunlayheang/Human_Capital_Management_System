import { describe, expect, it } from 'vitest';
import { mergeLeaveAssignmentsWithTypes } from './leaveAssignmentDefaults';

const types = [
  { leaveTypeId: 'lt-annual', name: 'Annual Leave', code: 'ANNUAL', assigned: false },
  { leaveTypeId: 'lt-maternity', name: 'Maternity Leave', code: 'MATERNITY', assigned: false },
  { leaveTypeId: 'lt-sick', name: 'Sick Leave', code: 'SICK', assigned: false },
] as const;

describe('mergeLeaveAssignmentsWithTypes', () => {
  it('applies gender-aware defaults when nothing is saved', () => {
    const male = mergeLeaveAssignmentsWithTypes([...types], {}, 'Male');
    expect(male['lt-annual']).toBe(true);
    expect(male['lt-maternity']).toBe(false);
    expect(male['lt-sick']).toBe(true);

    const female = mergeLeaveAssignmentsWithTypes([...types], null, 'Female');
    expect(female['lt-maternity']).toBe(true);
  });

  it('keeps explicit saved toggles including disabled ones', () => {
    const saved = {
      'lt-annual': true,
      'lt-maternity': false,
      'lt-sick': false,
    };
    const merged = mergeLeaveAssignmentsWithTypes([...types], saved, 'Male');
    expect(merged).toEqual(saved);
  });
});
