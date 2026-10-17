import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coerceDefaultPasswordEnabled,
  defaultPortalPasswordDisabledMessage,
} from './defaultPortalPassword.js';

describe('defaultPortalPassword', () => {
  it('exposes a clear disabled-provisioning message for new accounts', () => {
    const msg = defaultPortalPasswordDisabledMessage();
    assert.match(msg, /disabled/i);
    assert.match(msg, /Settings/i);
  });

  it('coerces enable/disable flags from common storage forms', () => {
    assert.equal(coerceDefaultPasswordEnabled(true), true);
    assert.equal(coerceDefaultPasswordEnabled(1), true);
    assert.equal(coerceDefaultPasswordEnabled('1'), true);
    assert.equal(coerceDefaultPasswordEnabled('true'), true);
    assert.equal(coerceDefaultPasswordEnabled(undefined), true);
    assert.equal(coerceDefaultPasswordEnabled(null), true);

    assert.equal(coerceDefaultPasswordEnabled(false), false);
    assert.equal(coerceDefaultPasswordEnabled(0), false);
    assert.equal(coerceDefaultPasswordEnabled('0'), false);
    assert.equal(coerceDefaultPasswordEnabled('false'), false);
    assert.equal(coerceDefaultPasswordEnabled('off'), false);
    assert.equal(coerceDefaultPasswordEnabled(Buffer.from([0])), false);
    assert.equal(coerceDefaultPasswordEnabled(Buffer.from([1])), true);
  });
});
