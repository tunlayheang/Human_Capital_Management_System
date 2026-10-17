import L from 'leaflet';

export function fixLeafletDefaultIcons(): void {
  const proto = L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown };
  delete proto._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
}

let iconsFixed = false;

export function ensureLeafletIcons(): void {
  if (!iconsFixed) {
    fixLeafletDefaultIcons();
    iconsFixed = true;
  }
}

export function isDarkModeEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function getLeafletTileConfig(darkMode = false): {
  url: string;
  attribution: string;
  maxZoom: number;
} {
  return {
    url: darkMode
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  };
}

const USER_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20v-1a7 7 0 0 1 14 0v1"/></svg>`;

/** Person-shaped marker for employee GPS ("You are here") — not the default blue pin. */
export function createUserLocationMarkerIcon(
  inZone: boolean,
  /** When outside zone: red if rule enforced, amber if informational only. */
  outsideTone: 'danger' | 'warning' = 'danger'
): L.DivIcon {
  const tone = inZone ? 'in-zone' : outsideTone === 'warning' ? 'out-zone-warn' : 'out-zone';
  return L.divIcon({
    className: 'hcms-user-map-marker-wrap',
    html: `<div class="hcms-user-map-marker hcms-user-map-marker--${tone}" role="img" aria-label="You are here">${USER_MARKER_SVG}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    tooltipAnchor: [0, -26],
  });
}

/** Geofence bounds without calling Circle.getBounds() (requires map on layer). */
export function circleLatLngBounds(lat: number, lng: number, radiusMeters: number): L.LatLngBounds {
  const earthRadius = 6378137;
  const latRad = (lat * Math.PI) / 180;
  const deltaLat = (radiusMeters / earthRadius) * (180 / Math.PI);
  const cosLat = Math.cos(latRad) || 1e-6;
  const deltaLng = (radiusMeters / (earthRadius * cosLat)) * (180 / Math.PI);
  return L.latLngBounds([lat - deltaLat, lng - deltaLng], [lat + deltaLat, lng + deltaLng]);
}

export function isValidMapCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6);
}

export function fitMapToPointAndRadius(
  map: L.Map,
  lat: number,
  lng: number,
  radiusMeters?: number
): void {
  try {
    map.invalidateSize({ animate: false });
    let bounds = L.latLngBounds([lat, lng], [lat, lng]);
    if (radiusMeters && radiusMeters > 0) {
      bounds = bounds.extend(circleLatLngBounds(lat, lng, radiusMeters));
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: radiusMeters && radiusMeters < 80 ? 18 : 17 });
    } else {
      map.setView([lat, lng], 17);
    }
  } catch {
    map.setView([lat, lng], 17);
  }
}

/** Fit map to show both employee GPS and assigned office (when far from zone). */
export function fitMapToUserAndOffice(
  map: L.Map,
  userLat: number,
  userLng: number,
  officeLat: number,
  officeLng: number,
  zoneRadiusMeters?: number
): void {
  try {
    map.invalidateSize({ animate: false });
    let bounds = L.latLngBounds([userLat, userLng], [officeLat, officeLng]);
    if (zoneRadiusMeters && zoneRadiusMeters > 0) {
      bounds = bounds.extend(circleLatLngBounds(officeLat, officeLng, zoneRadiusMeters));
    }
    if (bounds.isValid()) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const spanM = ne.distanceTo(sw);
      const maxZoom =
        spanM > 80_000 ? 8 : spanM > 30_000 ? 10 : spanM > 8_000 ? 12 : spanM > 2_000 ? 14 : 17;
      map.fitBounds(bounds, { padding: [52, 52], maxZoom });
    } else {
      map.setView([userLat, userLng], 17);
    }
  } catch {
    map.setView([userLat, userLng], 17);
  }
}
