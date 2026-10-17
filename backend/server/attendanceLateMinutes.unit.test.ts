import { describe, expect, it } from 'vitest';
import { computeLateMinutes, resolveLateAttendanceFields } from './attendanceLateMinutes.js';
import { attendanceLateStatusForClockIn } from './employeeAttendanceSchedule.js';

const schedule = {
  workDays: 5,
  timeIn: '08:00',
  timeOut: '17:00',
  workHours: 8,
  breakDurationMinutes: 60,
  gracePeriodMinutes: 15,
};

describe('attendance late status (ICT)', () => {
  it('marks early ICT check-in as PRESENT (not LATE)', () => {
    // 04:52 ICT — previously misclassified LATE when server used UTC getHours()
    const clockIn = new Date('2026-08-09T04:52:00+07:00');
    expect(computeLateMinutes(clockIn, schedule)).toBe(0);
    expect(attendanceLateStatusForClockIn(clockIn, schedule)).toBe('PRESENT');
    expect(resolveLateAttendanceFields(clockIn, schedule).status).toBe('PRESENT');
  });

  it('marks on-time ICT check-in as PRESENT', () => {
    const clockIn = new Date('2026-08-09T08:00:00+07:00');
    expect(computeLateMinutes(clockIn, schedule)).toBe(0);
    expect(resolveLateAttendanceFields(clockIn, schedule).status).toBe('PRESENT');
  });

  it('marks after grace as LATE with correct minutes', () => {
    // 08:30 ICT with 08:00 + 15 grace → 15 minutes late
    const clockIn = new Date('2026-08-09T08:30:00+07:00');
    expect(computeLateMinutes(clockIn, schedule)).toBe(15);
    expect(resolveLateAttendanceFields(clockIn, schedule)).toEqual({
      status: 'LATE',
      lateMinutes: 15,
    });
  });

  it('still Present within grace', () => {
    const clockIn = new Date('2026-08-09T08:15:00+07:00');
    expect(computeLateMinutes(clockIn, schedule)).toBe(0);
    expect(resolveLateAttendanceFields(clockIn, schedule).status).toBe('PRESENT');
  });
});
