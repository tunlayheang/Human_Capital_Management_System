/** Shared geofence rules for attendance clock-in/out. */

export const DEFAULT_GEOFENCE_RADIUS_M = 20;

export type GeoFencePoint = {
  latitude: number;
  longitude: number;
  radius: number;
};

export type WorksiteSource = 'office' | 'none';

export type ResolvedWorksite = {
  source: WorksiteSource;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  enforceGeofence: boolean;
};

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Valid lat/lng with a point set (not 0,0 placeholder). */
function hasValidCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

export function resolveOfficeWorksite(office: {
  name?: string;
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
}): ResolvedWorksite | null {
  const lat = Number(office.latitude);
  const lng = Number(office.longitude);
  if (!hasValidCoordinates(lat, lng)) return null;

  const configured = Number(office.radiusMeters);
  const radius =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GEOFENCE_RADIUS_M;

  return {
    source: 'office',
    name: String(office.name || 'Office'),
    latitude: lat,
    longitude: lng,
    radius,
    enforceGeofence: true,
  };
}

export function checkLocationAgainstWorksite(
  userLat: number,
  userLng: number,
  worksite: ResolvedWorksite
): { inZone: boolean; distanceMeters: number } {
  const distanceMeters = haversineMeters(userLat, userLng, worksite.latitude, worksite.longitude);
  const inZone = !worksite.enforceGeofence || distanceMeters <= worksite.radius;
  return { inZone, distanceMeters: Math.round(distanceMeters) };
}

export function pickNearestOffice<T extends { latitude?: unknown; longitude?: unknown }>(
  userLat: number,
  userLng: number,
  offices: T[]
): T | null {
  let nearest: T | null = null;
  let min = Infinity;
  for (const office of offices) {
    const lat = Number(office.latitude);
    const lng = Number(office.longitude);
    if (!hasValidCoordinates(lat, lng)) continue;
    const d = haversineMeters(userLat, userLng, lat, lng);
    if (d < min) {
      min = d;
      nearest = office;
    }
  }
  return nearest;
}

export type OfficeGeofenceRow = {
  id?: string;
  name?: string;
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
};

/** True if user coordinates fall inside at least one office radius. */
export function checkLocationAgainstOffices(
  userLat: number,
  userLng: number,
  offices: OfficeGeofenceRow[]
): {
  inZone: boolean;
  worksite: ResolvedWorksite | null;
  distanceMeters: number;
  matchedOfficeId?: string;
} {
  let bestInZone: { worksite: ResolvedWorksite; distanceMeters: number; id?: string } | null = null;
  let nearestOut: { worksite: ResolvedWorksite; distanceMeters: number; id?: string } | null = null;

  for (const office of offices) {
    const worksite = resolveOfficeWorksite(office);
    if (!worksite) continue;
    const check = checkLocationAgainstWorksite(userLat, userLng, worksite);
    const id = office.id != null ? String(office.id) : undefined;
    if (check.inZone) {
      if (!bestInZone || check.distanceMeters < bestInZone.distanceMeters) {
        bestInZone = { worksite, distanceMeters: check.distanceMeters, id };
      }
    } else if (!nearestOut || check.distanceMeters < nearestOut.distanceMeters) {
      nearestOut = { worksite, distanceMeters: check.distanceMeters, id };
    }
  }

  if (bestInZone) {
    return {
      inZone: true,
      worksite: bestInZone.worksite,
      distanceMeters: bestInZone.distanceMeters,
      matchedOfficeId: bestInZone.id,
    };
  }

  if (nearestOut) {
    return {
      inZone: false,
      worksite: nearestOut.worksite,
      distanceMeters: nearestOut.distanceMeters,
      matchedOfficeId: nearestOut.id,
    };
  }

  return { inZone: false, worksite: null, distanceMeters: 0 };
}
