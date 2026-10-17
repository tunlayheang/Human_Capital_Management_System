import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ownerEmployeeNamePatch } from './ownerAccountIdentity.js';

describe('owner account identity restore', () => {
  it('sets seed names only when creating the employee row', () => {
    assert.deepEqual(
      ownerEmployeeNamePatch({
        created: true,
        seedFirst: 'Layheang',
        seedLast: 'Tun',
      }),
      { first_name: 'Layheang', last_name: 'Tun' }
    );
  });

  it('does not overwrite a customized HR name on boot', () => {
    assert.deepEqual(
      ownerEmployeeNamePatch({
        created: false,
        currentFirst: 'Layheang',
        currentLast: 'Tun',
        seedFirst: 'HR',
        seedLast: 'Officer',
      }),
      {}
    );
  });

  it('upgrades the old HR Officer placeholder once from seed', () => {
    assert.deepEqual(
      ownerEmployeeNamePatch({
        created: false,
        currentFirst: 'HR',
        currentLast: 'Officer',
        seedFirst: 'Layheang',
        seedLast: 'Tun',
      }),
      { first_name: 'Layheang', last_name: 'Tun' }
    );
  });
});
