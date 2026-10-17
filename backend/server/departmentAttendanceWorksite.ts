import { getPrimaryOfficeWorksite, listActiveOfficeLocations } from './attendanceSettings.js';
import {
  checkLocationAgainstOffices,
  checkLocationAgainstWorksite,
  type ResolvedWorksite,
} from './attendanceGeo.js';

/** Display / legacy single pin — primary attendance office (not tied to department). */
export async function getRequiredWorksiteForUser(_userId: string): Promise<ResolvedWorksite | null> {
  const fallback = await getPrimaryOfficeWorksite();
  return fallback ? { ...fallback, source: 'office' as const } : null;
}

/** Clock-in/out geofence: user must be inside any active office from Attendance settings. */
export async function checkUserRequiredZone(
  _userId: string,
  userLat: number,
  userLng: number
): Promise<{
  inZone: boolean;
  worksite: ResolvedWorksite | null;
  distanceMeters: number;
}> {
  const offices = await listActiveOfficeLocations();
  if (!offices.length) {
    return { inZone: true, worksite: null, distanceMeters: 0 };
  }

  const check = checkLocationAgainstOffices(userLat, userLng, offices);
  if (check.worksite) {
    return {
      inZone: check.inZone,
      worksite: { ...check.worksite, source: 'office' as const },
      distanceMeters: check.distanceMeters,
    };
  }

  const primary = await getPrimaryOfficeWorksite();
  if (primary) {
    const single = checkLocationAgainstWorksite(userLat, userLng, primary);
    return {
      inZone: single.inZone,
      worksite: { ...primary, source: 'office' as const },
      distanceMeters: single.distanceMeters,
    };
  }

  return { inZone: true, worksite: null, distanceMeters: 0 };
}
