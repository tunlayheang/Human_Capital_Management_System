/**
 * Run: npx tsx --test server/payroll/payrollAttendanceRecordService.unit.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dedupeAttendanceRecordsByDate,
  normalizeAttendanceStatusKey,
} from './payrollAttendanceRecordService.js';
import { computePayrollAttendanceMetrics } from './payrollAttendanceMetrics.js';

describe('normalizeAttendanceStatusKey', () => {
  it('normalizes Day off to DAY_OFF', () => {
    assert.equal(normalizeAttendanceStatusKey('Day off'), 'DAY_OFF');
  });
});

describe('computePayrollAttendanceMetrics saved rows', () => {
  it('matches attendance list counts: present, absent, day off excluded', () => {
    const present = ['03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'].map(
      (day) => ({
        date: `2026-05-${day}`,
        status: 'PRESENT',
        clockIn: `2026-05-${day}T07:55:00`,
        clockOut: `2026-05-${day}T17:25:00`,
      })
    );
    const absent = ['01', '14', '15', '16', '26', '27', '28', '29', '30', '31'].map((day) => ({
      date: `2026-05-${day}`,
      status: 'ABSENT',
    }));
    const dayOff = [
      { date: '2026-05-02', status: 'DAY_OFF' },
      { date: '2026-05-21', status: 'DAY_OFF' },
    ];
    const metrics = computePayrollAttendanceMetrics({
      attendance: dedupeAttendanceRecordsByDate([...present, ...absent, ...dayOff]),
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      workDaysCap: 26,
    });
    assert.equal(metrics.presentDays, 11);
    assert.equal(metrics.absentDays, 10);
    assert.equal(metrics.recordsInPeriod, 23);
    assert.equal(metrics.paidLeaveDays, 0);
    assert.ok(metrics.totalWorkHours > 0);
  });

  it('counts grid-resolved statuses (Attendance module), not raw DB labels', () => {
    const rows = [
      { date: '2026-05-07', status: 'PAID_LEAVE', clockIn: '2026-05-07T08:00:00', clockOut: '2026-05-07T17:00:00' },
      { date: '2026-05-01', status: 'ABSENT' },
      { date: '2026-05-02', status: 'DAY_OFF' },
      ...['03', '04', '05', '06'].map((day) => ({
        date: `2026-05-${day}`,
        status: 'PRESENT',
        clockIn: `2026-05-${day}T08:00:00`,
        clockOut: `2026-05-${day}T17:00:00`,
      })),
    ];
    const metrics = computePayrollAttendanceMetrics({
      attendance: dedupeAttendanceRecordsByDate(rows),
      periodStart: '2026-05-01',
      periodEnd: '2026-05-07',
      workDaysCap: 26,
    });
    assert.equal(metrics.presentDays, 4);
    assert.equal(metrics.paidLeaveDays, 1);
    assert.equal(metrics.absentDays, 1);
  });
});
