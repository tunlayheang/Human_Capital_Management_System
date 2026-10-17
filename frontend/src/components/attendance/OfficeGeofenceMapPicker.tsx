import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapPin, MousePointerClick } from 'lucide-react';
import { formatCoordinates, mapsLink } from '../../utils/attendanceGeo';
import {
  ensureLeafletIcons,
  fitMapToPointAndRadius,
  getLeafletTileConfig,
  isValidMapCoord,
} from '../../utils/leafletHelpers';
import 'leaflet/dist/leaflet.css';

export type OfficeGeofenceMapPickerProps = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  name?: string;
  className?: string;
  onLocationChange: (lat: number, lng: number) => void;
  /** When false, map is view-only (no drag / click to move pin). */
  interactive?: boolean;
};

export const OfficeGeofenceMapPicker: React.FC<OfficeGeofenceMapPickerProps> = ({
  latitude,
  longitude,
  radiusMeters,
  name,
  className = '',
  onLocationChange,
  interactive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onLocationChange);
  const skipEmitRef = useRef(false);
  const prevRadiusRef = useRef(radiusMeters);
  const mapClickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);

  onChangeRef.current = onLocationChange;

  const emitLocation = (lat: number, lng: number) => {
    if (skipEmitRef.current) return;
    onChangeRef.current(
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6))
    );
  };

  useEffect(() => {
    if (!containerRef.current || !isValidMapCoord(latitude, longitude)) return;

    ensureLeafletIcons();

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      });
      // Always light basemap — zone preview stays readable in app dark mode.
      const tileConfig = getLeafletTileConfig(false);

      L.tileLayer(tileConfig.url, {
        maxZoom: tileConfig.maxZoom,
        attribution: tileConfig.attribution,
      }).addTo(map);

      const marker = L.marker([latitude, longitude], {
        draggable: interactive,
        title: name || 'Office location',
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        emitLocation(pos.lat, pos.lng);
      });

      const circle = L.circle([latitude, longitude], {
        radius: radiusMeters,
        color: '#0078C1',
        weight: 3,
        opacity: 0.95,
        fillColor: '#0078C1',
        fillOpacity: 0.15,
      }).addTo(map);

      const handleMapClick = (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        skipEmitRef.current = true;
        marker.setLatLng([lat, lng]);
        circle.setLatLng([lat, lng]);
        skipEmitRef.current = false;
        emitLocation(lat, lng);
        fitMapToPointAndRadius(map, lat, lng, radiusMeters);
      };
      mapClickHandlerRef.current = handleMapClick;
      if (interactive) {
        map.on('click', handleMapClick);
      }

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;

      requestAnimationFrame(() => {
        if (mapRef.current) fitMapToPointAndRadius(mapRef.current, latitude, longitude, radiusMeters);
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        circleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    if (interactive) {
      marker.dragging?.enable();
      if (mapClickHandlerRef.current) {
        map.on('click', mapClickHandlerRef.current);
      }
    } else {
      marker.dragging?.disable();
      if (mapClickHandlerRef.current) {
        map.off('click', mapClickHandlerRef.current);
      }
    }

    return () => {
      if (mapClickHandlerRef.current) {
        map.off('click', mapClickHandlerRef.current);
      }
    };
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle || !isValidMapCoord(latitude, longitude)) return;

    skipEmitRef.current = true;
    const latLng: L.LatLngExpression = [latitude, longitude];
    marker.setLatLng(latLng);
    circle.setLatLng(latLng);
    circle.setRadius(radiusMeters);
    skipEmitRef.current = false;

    const frameId = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      if (prevRadiusRef.current !== radiusMeters) {
        prevRadiusRef.current = radiusMeters;
        fitMapToPointAndRadius(map, latitude, longitude, radiusMeters);
      } else {
        map.panTo([latitude, longitude], { animate: true });
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [latitude, longitude, radiusMeters]);

  if (!isValidMapCoord(latitude, longitude)) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white ${className}`}
      >
        <p className="text-sm text-slate-500 p-6 text-center">Set valid coordinates or click “Use my GPS”.</p>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}>
      <div
        ref={containerRef}
        className="hcms-leaflet-skin hcms-leaflet-skin--light absolute inset-0 z-0 h-full w-full min-h-[16rem]"
        aria-label="Office zone map"
      />

      <div className="pointer-events-none absolute top-3 left-3 right-3 z-[500] flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/85 text-white text-[11px] font-semibold px-3 py-1.5 shadow-md backdrop-blur">
          <MousePointerClick className="w-3.5 h-3.5 text-primary-300" />
          {interactive ? 'Click map to set office point' : 'View only — click Edit to change location'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-600/90 text-white text-[11px] font-semibold px-3 py-1.5 shadow-md">
          {radiusMeters}m zone
        </span>
      </div>

      <div className="absolute bottom-2 left-2 right-2 z-[500] flex items-center justify-between gap-2 rounded-lg bg-white/95 backdrop-blur px-3 py-1.5 text-xs shadow-sm border border-slate-200/80">
        <span className="flex items-center gap-1.5 font-mono text-slate-700 truncate">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-primary-600" />
          {formatCoordinates(latitude, longitude)}
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
};

export default OfficeGeofenceMapPicker;
