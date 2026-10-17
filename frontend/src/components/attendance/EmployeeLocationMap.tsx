import React, { memo, useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapPin, User, Building2 } from 'lucide-react';
import { formatCoordinates, formatDistanceFromOfficeShort, mapsLink } from '../../utils/attendanceGeo';
import { calculateDistance } from '../../utils';
import {
  createUserLocationMarkerIcon,
  ensureLeafletIcons,
  fitMapToPointAndRadius,
  fitMapToUserAndOffice,
  getLeafletTileConfig,
  isValidMapCoord,
  isDarkModeEnabled,
} from '../../utils/leafletHelpers';
import 'leaflet/dist/leaflet.css';

export type EmployeeLocationMapProps = {
  latitude: number;
  longitude: number;
  loading?: boolean;
  className?: string;
  zoneCenter?: { lat: number; lng: number } | null;
  zoneRadiusMeters?: number;
  inZone?: boolean;
  /**
   * When outside the zone: `'danger'` (red) if zone rule is enforced,
   * `'warning'` (amber) when zone rules are informational only.
   */
  outsideTone?: 'danger' | 'warning';
  zoneName?: string;
  /** Straight-line distance from zone center (office) in meters. */
  distanceFromOfficeMeters?: number | null;
  youAreHereLabel?: string;
  /** When set, distance badges use localized strings. */
  geoT?: (path: string, vars?: Record<string, string | number>) => string;
};

const OUTSIDE_HEX = { danger: '#f43f5e', warning: '#f59e0b' } as const;

function applyZoneStyle(
  circle: L.Circle,
  inZone: boolean,
  outsideTone: 'danger' | 'warning' = 'danger'
): void {
  const zoneColor = inZone ? '#10b981' : OUTSIDE_HEX[outsideTone];
  circle.setStyle({
    color: zoneColor,
    fillColor: zoneColor,
    fillOpacity: inZone ? 0.14 : 0.1,
    dashArray: inZone ? undefined : '10 8',
  });
}

export const EmployeeLocationMap: React.FC<EmployeeLocationMapProps> = memo(({
  latitude,
  longitude,
  loading = false,
  className = '',
  zoneCenter,
  zoneRadiusMeters,
  inZone = false,
  outsideTone = 'danger',
  zoneName,
  distanceFromOfficeMeters = null,
  youAreHereLabel = 'You are here',
  geoT,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const zoneCircleRef = useRef<L.Circle | null>(null);
  const officeMarkerRef = useRef<L.CircleMarker | null>(null);
  const prevUserPosRef = useRef<{ lat: number; lng: number } | null>(null);

  const showZone =
    zoneCenter &&
    isValidMapCoord(zoneCenter.lat, zoneCenter.lng) &&
    (zoneRadiusMeters ?? 0) > 0;

  useEffect(() => {
    if (!containerRef.current || !isValidMapCoord(latitude, longitude)) return;

    ensureLeafletIcons();

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      });
      const tileConfig = getLeafletTileConfig(isDarkModeEnabled());

      L.tileLayer(tileConfig.url, {
        maxZoom: tileConfig.maxZoom,
        attribution: tileConfig.attribution,
      }).addTo(map);

      const userMarker = L.marker([latitude, longitude], {
        title: 'Your location',
        icon: createUserLocationMarkerIcon(inZone, outsideTone),
        zIndexOffset: 1000,
      })
        .bindTooltip(youAreHereLabel, { direction: 'top', offset: [0, -26], className: 'hcms-user-map-tooltip' })
        .addTo(map);

      mapRef.current = map;
      userMarkerRef.current = userMarker;

      requestAnimationFrame(() => {
        if (mapRef.current) {
          fitMapToPointAndRadius(
            mapRef.current,
            latitude,
            longitude,
            showZone ? zoneRadiusMeters : undefined
          );
        }
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        userMarkerRef.current = null;
        zoneCircleRef.current = null;
        officeMarkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const userMarker = userMarkerRef.current;
    if (!map || !userMarker || !isValidMapCoord(latitude, longitude)) return;

    userMarker.setLatLng([latitude, longitude]);

    const prev = prevUserPosRef.current;
    prevUserPosRef.current = { lat: latitude, lng: longitude };

    const frameId = requestAnimationFrame(() => {
      if (!mapRef.current) return;
      const fitUserAndOffice =
        showZone &&
        zoneCenter &&
        isValidMapCoord(zoneCenter.lat, zoneCenter.lng) &&
        calculateDistance(zoneCenter.lat, zoneCenter.lng, latitude, longitude) >
          Math.max(25, (zoneRadiusMeters ?? 0) * 0.5);

      if (!prev) {
        if (fitUserAndOffice) {
          fitMapToUserAndOffice(
            map,
            latitude,
            longitude,
            zoneCenter!.lat,
            zoneCenter!.lng,
            zoneRadiusMeters
          );
        } else {
          fitMapToPointAndRadius(map, latitude, longitude, showZone ? zoneRadiusMeters : undefined);
        }
        return;
      }
      const moved = calculateDistance(prev.lat, prev.lng, latitude, longitude);
      const refitThreshold = Math.max(25, (zoneRadiusMeters ?? 0) * 0.25);
      if (moved >= refitThreshold) {
        if (fitUserAndOffice) {
          fitMapToUserAndOffice(
            map,
            latitude,
            longitude,
            zoneCenter!.lat,
            zoneCenter!.lng,
            zoneRadiusMeters
          );
        } else {
          fitMapToPointAndRadius(map, latitude, longitude, showZone ? zoneRadiusMeters : undefined);
        }
      } else {
        map.panTo([latitude, longitude], { animate: true, duration: 0.35 });
      }
    });

    return () => cancelAnimationFrame(frameId);
  }, [latitude, longitude, showZone, zoneRadiusMeters, zoneCenter?.lat, zoneCenter?.lng]);

  useEffect(() => {
    userMarkerRef.current?.setTooltipContent(youAreHereLabel);
  }, [youAreHereLabel]);

  const zoneBadgeText =
    showZone && distanceFromOfficeMeters != null
      ? formatDistanceFromOfficeShort(distanceFromOfficeMeters, inZone, geoT)
      : showZone
        ? geoT
          ? `${geoT('attendance.geo.zoneMeters', { meters: zoneRadiusMeters ?? 0 })} ${inZone ? `· ${geoT('attendance.geo.inRange')}` : `· ${geoT('attendance.geo.shortOutside')}`}`
          : `${zoneRadiusMeters}m zone ${inZone ? '· In range' : '· Outside'}`
        : null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showZone || !zoneCenter || !zoneRadiusMeters) {
      zoneCircleRef.current?.remove();
      officeMarkerRef.current?.remove();
      zoneCircleRef.current = null;
      officeMarkerRef.current = null;
      return;
    }

    const center: L.LatLngExpression = [zoneCenter.lat, zoneCenter.lng];
    const zoneColor = inZone ? '#10b981' : OUTSIDE_HEX[outsideTone];

    if (!zoneCircleRef.current) {
      const circle = L.circle(center, {
        radius: zoneRadiusMeters,
        color: zoneColor,
        weight: 3,
        opacity: 0.95,
        fillColor: zoneColor,
        fillOpacity: inZone ? 0.14 : 0.1,
        dashArray: inZone ? undefined : '10 8',
      });
      circle.bindTooltip(
        distanceFromOfficeMeters != null
          ? zoneName
            ? `${zoneName} · ${formatDistanceFromOfficeShort(distanceFromOfficeMeters, inZone)}`
            : formatDistanceFromOfficeShort(distanceFromOfficeMeters, inZone)
          : zoneName
            ? `${zoneName} · ${zoneRadiusMeters}m zone`
            : `${zoneRadiusMeters}m attendance zone`,
        { permanent: false, direction: 'top', className: 'attendance-zone-tooltip' }
      );
      circle.addTo(map);
      zoneCircleRef.current = circle;
    } else {
      zoneCircleRef.current.setLatLng(center);
      zoneCircleRef.current.setRadius(zoneRadiusMeters);
      applyZoneStyle(zoneCircleRef.current, inZone, outsideTone);
    }

    if (!officeMarkerRef.current) {
      officeMarkerRef.current = L.circleMarker(center, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#6366f1',
        fillOpacity: 1,
      })
        .bindTooltip(zoneName || 'Office', { direction: 'top' })
        .addTo(map);
    } else {
      officeMarkerRef.current.setLatLng(center);
    }
  }, [showZone, zoneCenter?.lat, zoneCenter?.lng, zoneRadiusMeters, zoneName, inZone, outsideTone, distanceFromOfficeMeters]);

  useEffect(() => {
    if (zoneCircleRef.current) {
      applyZoneStyle(zoneCircleRef.current, inZone, outsideTone);
    }
    userMarkerRef.current?.setIcon(createUserLocationMarkerIcon(inZone, outsideTone));
  }, [inZone, outsideTone]);

  if (!isValidMapCoord(latitude, longitude)) {
    return (
      <div className={`relative flex items-center justify-center bg-slate-100 dark:bg-slate-900 ${className}`}>
        <p className="text-sm text-slate-500 p-6 text-center">Waiting for GPS coordinates…</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-slate-100 dark:bg-slate-900 ${className}`}>
      <div
        ref={containerRef}
        className="hcms-leaflet-skin absolute inset-0 z-0 h-full w-full min-h-[14rem]"
        aria-label="Map"
      />

      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-slate-900/10 via-transparent to-transparent dark:from-slate-900/25" />

      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <div
          className={`flex items-center gap-1.5 rounded-full text-white text-xs font-bold px-3 py-1 shadow-md ${
            inZone
              ? 'bg-emerald-600'
              : outsideTone === 'warning'
                ? 'bg-amber-500'
                : 'bg-rose-600'
          }`}
        >
          <User className="w-3.5 h-3.5" aria-hidden />
          {youAreHereLabel}
        </div>
        {showZone && (
          <div
            className={`flex items-center gap-1.5 rounded-full text-xs font-bold px-3 py-1 shadow-md border ${
              inZone
                ? 'bg-emerald-600/95 text-white border-emerald-400/40'
                : outsideTone === 'warning'
                  ? 'bg-amber-500/95 text-white border-amber-300/40'
                  : 'bg-rose-600/95 text-white border-rose-400/40'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[14rem] sm:max-w-[18rem]">{zoneBadgeText}</span>
          </div>
        )}
      </div>

      <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between gap-2 rounded-lg bg-white/95 dark:bg-slate-900/95 backdrop-blur px-3 py-1.5 text-xs shadow-sm">
        <span className="flex items-center gap-1.5 font-mono text-slate-700 dark:text-slate-200 truncate">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          {loading ? 'Updating GPS…' : formatCoordinates(latitude, longitude)}
        </span>
        <a
          href={mapsLink(latitude, longitude)}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto shrink-0 font-semibold text-primary-600 hover:underline"
        >
          Open in Maps
        </a>
      </div>
    </div>
  );
});

EmployeeLocationMap.displayName = 'EmployeeLocationMap';

export default EmployeeLocationMap;
