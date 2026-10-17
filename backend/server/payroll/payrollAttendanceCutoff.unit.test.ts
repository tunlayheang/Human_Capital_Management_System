import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attendanceCutoffFreezeInstant,
  formatAttendanceCutoffFreezeLabel,
  isAttendanceCutoffReached,
} from './payrollAttendanceCutoff.js';

describe('payrollAttendanceCutoff', () => {
  it('freeze instant is midnight ICT on the cutoff date', () => {
    const instant = attendanceCutoffFreezeInstant('2026-01-25');
    // 2026-01-25 00:00 +07:00 = 2026-01-24 17:00 UTC
    assert.equal(instant.toISOString(), '2026-01-24T17:00:00.000Z');
  });

  it('is not reached just before midnight ICT', () => {
    const before = new Date('2026-01-24T16:59:59.000Z'); // 23:59:59 ICT on Jan 24
    assert.equal(isAttendanceCutoffReached('2026-01-25', before), false);
  });

  it('is reached at exactly midnight ICT', () => {
    const at = new Date('2026-01-24T17:00:00.000Z'); // 00:00 ICT Jan 25
    assert.equal(isAttendanceCutoffReached('2026-01-25', at), true);
  });

  it('is reached after midnight ICT', () => {
    const after = new Date('2026-01-25T01:00:00.000Z'); // 08:00 ICT Jan 25
    assert.equal(isAttendanceCutoffReached('2026-01-25', after), true);
  });

  it('formats a clear midnight label', () => {
    const label = formatAttendanceCutoffFreezeLabel('2026-01-25');
    assert.match(label, /2026-01-25/);
    assert.match(label, /midnight/i);
  });
});
