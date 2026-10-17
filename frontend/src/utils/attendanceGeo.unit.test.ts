import { describe, expect, it } from 'vitest';
import { resolveAttendanceLocationTone } from './attendanceGeo';

describe('resolveAttendanceLocationTone', () => {
  it('returns warning while locating', () => {
    expect(
      resolveAttendanceLocationTone({
        loading: true,
        inZone: false,
        geofenceActive: true,
        zoneRuleEnforced: true,
      })
    ).toBe('warning');
  });

  it('returns success when inside zone or geofence inactive', () => {
    expect(
      resolveAttendanceLocationTone({
        inZone: true,
        geofenceActive: true,
        zoneRuleEnforced: true,
      })
    ).toBe('success');
    expect(
      resolveAttendanceLocationTone({
        inZone: false,
        geofenceActive: false,
        zoneRuleEnforced: false,
      })
    ).toBe('success');
  });

  it('returns danger when outside and zone rule is enforced', () => {
    expect(
      resolveAttendanceLocationTone({
        inZone: false,
        geofenceActive: true,
        zoneRuleEnforced: true,
      })
    ).toBe('danger');
  });

  it('returns warning (yellow) when outside but zone rule is disabled', () => {
    expect(
      resolveAttendanceLocationTone({
        inZone: false,
        geofenceActive: true,
        zoneRuleEnforced: false,
      })
    ).toBe('warning');
  });
});
