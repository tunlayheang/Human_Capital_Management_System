import { describe, expect, it } from 'vitest';
import {
  parseMasterDataEffectiveFrom,
  MasterDataEffectiveDateRequiredError,
} from './payrollMasterDataGuard.js';

describe('payrollMasterDataGuard', () => {
  it('parseMasterDataEffectiveFrom accepts ISO date', () => {
    expect(parseMasterDataEffectiveFrom('2026-08-01')).toBe('2026-08-01');
    expect(parseMasterDataEffectiveFrom('2026-08-01T00:00:00Z')).toBe('2026-08-01');
  });

  it('parseMasterDataEffectiveFrom rejects missing or invalid dates', () => {
    expect(() => parseMasterDataEffectiveFrom('')).toThrow(MasterDataEffectiveDateRequiredError);
    expect(() => parseMasterDataEffectiveFrom('08/01/2026')).toThrow(
      MasterDataEffectiveDateRequiredError
    );
  });
});
