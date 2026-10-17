import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canBypassAdminPinEmailRecovery,
  isAdminPinSelfRecoveryRole,
} from './pinRecoveryService.js';
import { resolvePinSecurity } from './pinSecurity.js';
import { isEmailConfigured } from './services/OtpDeliveryService.js';

describe('PIN lockout recovery policy', () => {
  it('only Admin / Super Admin may self-recover via OTP', () => {
    assert.equal(isAdminPinSelfRecoveryRole('ADMIN'), true);
    assert.equal(isAdminPinSelfRecoveryRole('SUPER_ADMIN'), true);
    assert.equal(isAdminPinSelfRecoveryRole('HR'), false);
    assert.equal(isAdminPinSelfRecoveryRole('MANAGER'), false);
    assert.equal(isAdminPinSelfRecoveryRole('EMPLOYEE'), false);
  });

  it('exposes admin-reset lockout so non-admins cannot create a PIN', () => {
    const s = resolvePinSecurity({
      role: 'EMPLOYEE',
      securityPinHash: null,
      pinLockedRequiresOtp: false,
      pinLockedRequiresAdminReset: true,
      pinFailedAttempts: 0,
      pinAutoLockMinutes: 15,
    });
    assert.equal(s.pinRequiresAdminReset, true);
    assert.equal(s.needsPinSetup, false);
    assert.equal(s.pinRequiresOtpRecovery, false);
  });

  it('exposes OTP recovery for locked Admin accounts when email is configured', () => {
    const s = resolvePinSecurity({
      role: 'ADMIN',
      securityPinHash: null,
      pinLockedRequiresOtp: true,
      pinLockedRequiresAdminReset: false,
      pinFailedAttempts: 0,
      pinAutoLockMinutes: 15,
    });
    if (isEmailConfigured()) {
      assert.equal(s.pinRequiresOtpRecovery, true);
      assert.equal(s.pinRecoveryReady, false);
      assert.equal(s.needsPinSetup, false);
    } else {
      // Misconfigured deploys must not hard-lock admins behind email OTP.
      assert.equal(canBypassAdminPinEmailRecovery({ role: 'ADMIN', pinLockedRequiresOtp: true }), true);
      assert.equal(s.pinRequiresOtpRecovery, false);
      assert.equal(s.pinRecoveryReady, true);
      assert.equal(s.pinMustReset, true);
    }
    assert.equal(s.pinRequiresAdminReset, false);
  });
});
