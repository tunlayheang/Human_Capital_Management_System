import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actorMayAccessAttendanceUser } from './attendanceManagerScope.js';

describe('manager attendance roster scope', () => {
  it('allows Admin/HR unrestricted (undefined scope)', () => {
    assert.equal(actorMayAccessAttendanceUser(undefined, 'u-anyone'), true);
  });

  it('allows only team members when scope is set', () => {
    assert.equal(actorMayAccessAttendanceUser(['u-1', 'u-2'], 'u-2'), true);
    assert.equal(actorMayAccessAttendanceUser(['u-1', 'u-2'], 'u-99'), false);
  });

  it('denies everyone when manager has an empty team', () => {
    assert.equal(actorMayAccessAttendanceUser([], 'u-1'), false);
  });
});
