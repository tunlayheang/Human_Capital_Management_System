import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attendanceRecordHasPersistedData, dateInInclusiveRange } from './attendanceFreezeGuard.js';
import { isAttendanceCutoffReached } from './payrollAttendanceCutoff.js';

describe('attendance freeze range + midnight gate', () => {
  it('detects meaningful attendance rows', () => {
    assert.equal(attendanceRecordHasPersistedData(null), false);
    assert.equal(attendanceRecordHasPersistedData({}), false);
    assert.equal(attendanceRecordHasPersistedData({ status: 'ABSENT' }), true);
    assert.equal(
      attendanceRecordHasPersistedData({ clockIn: '2026-05-02T08:00:00.000Z' }),
      true
    );
    assert.equal(
      attendanceRecordHasPersistedData({ correctionAt: '2026-05-02T10:00:00.000Z' }),
      true
    );
  });

  it('includes salary window through cutoff and excludes the day after', () => {
    const start = '2026-06-26';
    const cutoff = '2026-07-25';
    assert.equal(dateInInclusiveRange('2026-06-26', start, cutoff), true);
    assert.equal(dateInInclusiveRange('2026-07-25', start, cutoff), true);
    assert.equal(dateInInclusiveRange('2026-07-26', start, cutoff), false);
    assert.equal(dateInInclusiveRange('2026-06-25', start, cutoff), false);
  });

  it('midnight gate: before cutoff midnight stays unlocked by time', () => {
    const before = new Date('2026-07-24T16:59:59.000Z'); // 23:59:59 ICT Jul 24
    assert.equal(isAttendanceCutoffReached('2026-07-25', before), false);
  });

  it('midnight gate: at/after cutoff midnight is reached', () => {
    const at = new Date('2026-07-24T17:00:00.000Z'); // 00:00 ICT Jul 25
    assert.equal(isAttendanceCutoffReached('2026-07-25', at), true);
  });
});
