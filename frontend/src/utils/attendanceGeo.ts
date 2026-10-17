import { calculateDistance } from './index';

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

function hasValidCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}

export function resolveOfficeWorksite(
  office: {
    name?: string;
    latitude?: number | string;
    longitude?: number | string;
    radiusMeters?: number | string;
  },
  source: WorksiteSource = 'office'
): ResolvedWorksite | null {
  const lat = Number(office.latitude);
  const lng = Number(office.longitude);
  if (!hasValidCoordinates(lat, lng)) return null;

  const configured = Number(office.radiusMeters);
  const radius =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_GEOFENCE_RADIUS_M;

  return {
    source,
    name: String(office.name || 'Office'),
    latitude: lat,
    longitude: lng,
    radius,
    enforceGeofence: true,
  };
}

export type OfficeZoneRow = {
  id?: string;
  name?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/** Geofence rows for map display from all active attendance offices. */
export function activeOfficeZonesFromList(
  offices: Array<Record<string, unknown>>
): OfficeZoneRow[] {
  const rows: OfficeZoneRow[] = [];
  for (const office of offices) {
    const worksite = resolveOfficeWorksite(office);
    if (!worksite) continue;
    rows.push({
      id: office.id != null ? String(office.id) : undefined,
      name: worksite.name,
      latitude: worksite.latitude,
      longitude: worksite.longitude,
      radiusMeters: worksite.radius,
    });
  }
  return rows;
}

/** Single pin when only one office is configured (legacy display). */
export function assignedOfficeZones(worksite: ResolvedWorksite | null): OfficeZoneRow[] {
  if (!worksite) return [];
  return [
    {
      name: worksite.name,
      latitude: worksite.latitude,
      longitude: worksite.longitude,
      radiusMeters: worksite.radius,
    },
  ];
}

export function checkLocationAgainstWorksite(
  userLat: number,
  userLng: number,
  worksite: ResolvedWorksite
): { inZone: boolean; distanceMeters: number } {
  const distanceMeters = Math.round(
    calculateDistance(userLat, userLng, worksite.latitude, worksite.longitude)
  );
  const inZone = !worksite.enforceGeofence || distanceMeters <= worksite.radius;
  return { inZone, distanceMeters };
}

export function checkLocationAgainstOffices(
  userLat: number,
  userLng: number,
  offices: Array<{
    id?: string;
    name?: string;
    latitude?: number | string;
    longitude?: number | string;
    radiusMeters?: number | string;
  }>
): {
  inZone: boolean;
  worksite: ResolvedWorksite | null;
  distanceMeters: number;
} {
  let bestInZone: { worksite: ResolvedWorksite; distanceMeters: number } | null = null;
  let nearestOut: { worksite: ResolvedWorksite; distanceMeters: number } | null = null;

  for (const office of offices) {
    const worksite = resolveOfficeWorksite(office);
    if (!worksite) continue;
    const check = checkLocationAgainstWorksite(userLat, userLng, worksite);
    if (check.inZone) {
      if (!bestInZone || check.distanceMeters < bestInZone.distanceMeters) {
        bestInZone = { worksite, distanceMeters: check.distanceMeters };
      }
    } else if (!nearestOut || check.distanceMeters < nearestOut.distanceMeters) {
      nearestOut = { worksite, distanceMeters: check.distanceMeters };
    }
  }

  if (bestInZone) {
    return { inZone: true, worksite: bestInZone.worksite, distanceMeters: bestInZone.distanceMeters };
  }
  if (nearestOut) {
    return { inZone: false, worksite: nearestOut.worksite, distanceMeters: nearestOut.distanceMeters };
  }
  return { inZone: false, worksite: null, distanceMeters: 0 };
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Google Maps embed without API key (stable for lightweight previews). */
export function googleMapsEmbedUrl(lat: number, lng: number, zoom = 15): string {
  return `https://www.google.com/maps?q=${lat},${lng}&z=${zoom}&hl=en&output=embed`;
}

/** OpenStreetMap embed (www.openstreetmap.org) — avoids dead staticmap.openstreetmap.de host. */
export function osmEmbedUrl(lat: number, lng: number, paddingDeg = 0.012): string {
  const minLon = lng - paddingDeg;
  const minLat = lat - paddingDeg;
  const maxLon = lng + paddingDeg;
  const maxLat = lat + paddingDeg;
  const bbox = `${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Human-readable straight-line distance (meters → m or km). */
export function formatDistanceMeters(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '—';
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `${m.toLocaleString()} m`;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

type GeoT = (path: string, vars?: Record<string, string | number>) => string;

export function formatDistanceFromOfficeLine(
  options: {
    distanceMeters: number | null | undefined;
    inZone: boolean;
    zoneRadiusMeters?: number;
    officeName?: string;
  },
  t?: GeoT
): string {
  const { distanceMeters, inZone, zoneRadiusMeters, officeName } = options;
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return '—';
  const dist = formatDistanceMeters(distanceMeters);
  const office = officeName?.trim() || (t ? t('attendance.officeLocation') : 'office');
  if (inZone) {
    if (zoneRadiusMeters && zoneRadiusMeters > 0) {
      const zone = formatDistanceMeters(zoneRadiusMeters);
      return t
        ? t('attendance.geo.fromOfficeInZone', { distance: dist, office, zone })
        : `${dist} from ${office} · within ${zone} zone`;
    }
    return t
      ? t('attendance.geo.fromOfficeInRange', { distance: dist, office })
      : `${dist} from ${office} · In range`;
  }
  const over =
    zoneRadiusMeters != null && Number.isFinite(zoneRadiusMeters)
      ? Math.max(0, Math.round(distanceMeters) - zoneRadiusMeters)
      : 0;
  if (over > 50) {
    const overStr = formatDistanceMeters(over);
    return t
      ? t('attendance.geo.pastZoneEdge', { distance: dist, office, over: overStr })
      : `${dist} from ${office} · ${overStr} past zone edge`;
  }
  return t
    ? t('attendance.geo.outsideZoneLine', { distance: dist, office })
    : `${dist} from ${office} · Outside zone`;
}

/** Short label for map badge / clock panel footer. */
export function formatDistanceFromOfficeShort(
  distanceMeters: number | null | undefined,
  inZone: boolean,
  t?: GeoT
): string {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
    return t
      ? inZone
        ? t('attendance.geo.shortInRange')
        : t('attendance.geo.shortOutside')
      : inZone
        ? 'In range'
        : 'Outside zone';
  }
  const dist = formatDistanceMeters(distanceMeters);
  return inZone
    ? t
      ? t('attendance.geo.shortFromOfficeInRange', { distance: dist })
      : `${dist} from office · In range`
    : t
      ? t('attendance.geo.shortFromOffice', { distance: dist })
      : `${dist} from office`;
}

/**
 * Color for out-of-zone / GPS distance UI on Attendance.
 * - In zone / no geofence → success (green)
 * - Outside zone while "must be in zone" is enforced → danger (red)
 * - Outside zone while zone rule is disabled → warning (yellow) — informational only
 */
export type AttendanceLocationTone = 'success' | 'warning' | 'danger';

export function resolveAttendanceLocationTone(opts: {
  loading?: boolean;
  inZone: boolean;
  geofenceActive: boolean;
  /** True when clock rules require the user inside the zone for the current action. */
  zoneRuleEnforced: boolean;
}): AttendanceLocationTone {
  if (opts.loading) return 'warning';
  if (opts.inZone || !opts.geofenceActive) return 'success';
  return opts.zoneRuleEnforced ? 'danger' : 'warning';
}

/** Tailwind classes for location distance pills / status text (Attendance only). */
export const ATTENDANCE_LOCATION_TONE_CLASSES: Record<
  AttendanceLocationTone,
  { pill: string; text: string; iconBox: string }
> = {
  success: {
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    iconBox: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    pill: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    iconBox: 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300',
  },
  danger: {
    pill: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    text: 'text-rose-600 dark:text-rose-400',
    iconBox: 'bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
  },
};

/** @deprecated Use t('attendance.geo.permissionDenied') at call sites. */
export const GEO_PERMISSION_DENIED_MESSAGE =
  'Location is blocked for this site. Click the lock or site-settings icon next to the address bar, set Location to Allow, reload the page, then tap Refresh GPS.';
