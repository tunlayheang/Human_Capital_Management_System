import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateDistance } from '../utils';
import {
  checkLocationAgainstOffices,
  checkLocationAgainstWorksite,
  GEO_PERMISSION_DENIED_MESSAGE,
  type ResolvedWorksite,
} from '../utils/attendanceGeo';

const MIN_WATCH_MOVE_M = 8;
const WATCH_THROTTLE_MS = 3000;
const WATCH_IGNORE_MS = 4000;
const MAX_REFRESH_ATTEMPTS = 3;

type OfficeZone = {
  name?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

type GeoT = (path: string, vars?: Record<string, string | number>) => string;

type UseAttendanceGeolocationOptions = {
  enabled: boolean;
  worksite: ResolvedWorksite | null;
  officeZones: OfficeZone[];
  /** Only true on localhost — never use Vite DEV alone (mobile LAN testing needs real GPS). */
  isLocalDevHost: boolean;
  onToast?: (message: string, type: 'error' | 'info' | 'success') => void;
  t?: GeoT;
};

type PositionMeta = {
  force?: boolean;
  source?: 'watch' | 'refresh' | 'initial';
  timestamp?: number;
  accuracy?: number | null;
};

function positionOptionsForAttempt(attempt: number, force: boolean): PositionOptions {
  if (force) {
    return {
      enableHighAccuracy: attempt < 2,
      timeout: attempt === 0 ? 25000 : attempt === 1 ? 20000 : 15000,
      maximumAge: 0,
    };
  }
  return {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0,
  };
}

export function useAttendanceGeolocation({
  enabled,
  worksite,
  officeZones,
  isLocalDevHost,
  onToast,
  t,
}: UseAttendanceGeolocationOptions) {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [inZone, setInZone] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [isInitialLocating, setIsInitialLocating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [matchedWorksite, setMatchedWorksite] = useState<ResolvedWorksite | null>(null);

  const geoDeniedRef = useRef(false);
  const locErrorShownRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const refreshRequestRef = useRef(0);
  const lastAppliedRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastAcceptedTimestampRef = useRef(0);
  const lastWatchEmitRef = useRef(0);
  const ignoreWatchUntilRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const worksiteRef = useRef(worksite);
  const officeZonesRef = useRef(officeZones);

  worksiteRef.current = worksite;
  officeZonesRef.current = officeZones;

  const applyZoneCheck = useCallback((lat: number, lng: number, site: ResolvedWorksite | null) => {
    const assigned = site ?? worksiteRef.current;
    if (assigned) {
      setMatchedWorksite(assigned);
      if (!assigned.enforceGeofence) {
        setDistance(null);
        setInZone(true);
        return;
      }
      const check = checkLocationAgainstWorksite(lat, lng, assigned);
      setDistance(check.distanceMeters);
      setInZone(check.inZone);
      return;
    }

    const zones = officeZonesRef.current;
    if (zones.length > 0) {
      const check = checkLocationAgainstOffices(lat, lng, zones);
      setMatchedWorksite(check.worksite);
      setDistance(check.distanceMeters);
      setInZone(check.inZone);
      return;
    }

    setMatchedWorksite(null);
    setDistance(null);
    setInZone(false);
  }, []);

  const applyGeolocationError = useCallback(
    (error: GeolocationPositionError, opts?: { fromRefresh?: boolean }) => {
      const site = worksiteRef.current;
      const denied = error.code === error.PERMISSION_DENIED;
      if (denied) geoDeniedRef.current = true;

      // Localhost only: optional office coords when permission blocked (not on timeout/unavailable).
      if (isLocalDevHost && site && denied) {
        setCurrentLocation({ lat: site.latitude, lng: site.longitude });
        applyZoneCheck(site.latitude, site.longitude, site);
        setLocError(
          t?.('attendance.geo.localDevGpsBlocked') ??
            'GPS blocked in browser. Using worksite coordinates for local testing — allow Location for real GPS.'
        );
        geoDeniedRef.current = true;
        setLastUpdated(new Date());
        if (!locErrorShownRef.current) {
          onToast?.(
            t?.('attendance.geo.localDevGpsToast') ??
              'Local dev: allow Location in the browser for real GPS.',
            'info'
          );
          locErrorShownRef.current = true;
        }
        return;
      }

      const msg = denied
        ? t?.('attendance.geo.permissionDenied') ?? GEO_PERMISSION_DENIED_MESSAGE
        : error.code === error.POSITION_UNAVAILABLE
          ? t?.('attendance.geo.gpsUnavailable') ??
            'GPS signal unavailable. Move near a window or outdoors, then tap Refresh GPS.'
          : t?.('attendance.geo.gpsTimeout') ??
            'Location request timed out. Tap Refresh GPS to try again.';

      setLocError(msg);
      if (!lastAppliedRef.current) {
        setCurrentLocation(null);
        setDistance(null);
        setInZone(false);
      }
      if (!locErrorShownRef.current || opts?.fromRefresh) {
        onToast?.(msg, 'error');
        locErrorShownRef.current = true;
      }
    },
    [applyZoneCheck, isLocalDevHost, onToast, t]
  );

  const commitPosition = useCallback(
    (lat: number, lng: number, meta?: PositionMeta) => {
      const roundedLat = Number(lat.toFixed(6));
      const roundedLng = Number(lng.toFixed(6));
      const last = lastAppliedRef.current;
      const source = meta?.source ?? 'watch';
      const ts = meta?.timestamp ?? Date.now();

      if (
        !meta?.force &&
        lastAcceptedTimestampRef.current > 0 &&
        ts < lastAcceptedTimestampRef.current - 500
      ) {
        return false;
      }

      if (!meta?.force && last && source === 'watch') {
        const moved = calculateDistance(last.lat, last.lng, roundedLat, roundedLng);
        if (moved < MIN_WATCH_MOVE_M) return false;
      }

      lastAcceptedTimestampRef.current = ts;
      lastAppliedRef.current = { lat: roundedLat, lng: roundedLng };
      setCurrentLocation({ lat: roundedLat, lng: roundedLng });
      geoDeniedRef.current = false;
      setLocError(null);
      locErrorShownRef.current = false;
      setLastUpdated(new Date());
      applyZoneCheck(roundedLat, roundedLng, worksiteRef.current);
      return true;
    },
    [applyZoneCheck]
  );

  const finishLocating = useCallback(() => {
    isRefreshingRef.current = false;
    setIsRefreshing(false);
    setIsInitialLocating(false);
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current != null || geoDeniedRef.current) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (Date.now() < ignoreWatchUntilRef.current) return;

        const now = Date.now();
        if (now - lastWatchEmitRef.current < WATCH_THROTTLE_MS) return;

        const updated = commitPosition(position.coords.latitude, position.coords.longitude, {
          source: 'watch',
          timestamp: position.timestamp,
          accuracy: position.coords.accuracy,
        });
        if (updated) lastWatchEmitRef.current = now;
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          geoDeniedRef.current = true;
          stopWatch();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }
    );
  }, [commitPosition, stopWatch]);

  const readPosition = useCallback(
    (force: boolean) => {
      if (!navigator.geolocation) {
        setLocError('Geolocation is not supported in this browser.');
        finishLocating();
        return;
      }

      if (force) {
        ignoreWatchUntilRef.current = Date.now() + WATCH_IGNORE_MS;
        stopWatch();
      }

      refreshRequestRef.current += 1;
      const requestId = refreshRequestRef.current;

      const runAttempt = (attempt: number) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (requestId !== refreshRequestRef.current) return;

            commitPosition(position.coords.latitude, position.coords.longitude, {
              force: true,
              source: force ? 'refresh' : 'initial',
              timestamp: position.timestamp,
              accuracy: position.coords.accuracy,
            });
            finishLocating();
            if (force) startWatch();
          },
          (error) => {
            if (requestId !== refreshRequestRef.current) return;

            const retriable =
              force &&
              attempt < MAX_REFRESH_ATTEMPTS - 1 &&
              (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE);

            if (retriable) {
              window.setTimeout(() => runAttempt(attempt + 1), 350);
              return;
            }

            applyGeolocationError(error, { fromRefresh: force });
            finishLocating();
            if (force) startWatch();
          },
          positionOptionsForAttempt(attempt, force)
        );
      };

      runAttempt(0);
    },
    [applyGeolocationError, commitPosition, finishLocating, startWatch, stopWatch]
  );

  const refreshLocation = useCallback(() => {
    if (isRefreshingRef.current) {
      onToast?.('GPS refresh already in progress…', 'info');
      return;
    }

    geoDeniedRef.current = false;
    locErrorShownRef.current = false;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setLocError(null);
    readPosition(true);
  }, [onToast, readPosition]);

  useEffect(() => {
    if (!enabled || !worksite) return;

    let cancelled = false;

    const start = async () => {
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' });
          if (cancelled) return;
          if (status.state === 'denied') {
            geoDeniedRef.current = true;
            setLocError(GEO_PERMISSION_DENIED_MESSAGE);
            setIsInitialLocating(false);
            if (isLocalDevHost) {
              setCurrentLocation({ lat: worksite.latitude, lng: worksite.longitude });
              applyZoneCheck(worksite.latitude, worksite.longitude, worksite);
              setLastUpdated(new Date());
              setLocError(
                'GPS blocked in browser. Using worksite coordinates for local testing — allow Location for real GPS.'
              );
            }
            return;
          }
          status.onchange = () => {
            if (status.state === 'granted') {
              geoDeniedRef.current = false;
              readPosition(true);
              startWatch();
            } else if (status.state === 'denied') {
              geoDeniedRef.current = true;
              setLocError(GEO_PERMISSION_DENIED_MESSAGE);
              stopWatch();
            }
          };
        } catch {
          /* Permissions API unsupported */
        }
      }

      if (cancelled || geoDeniedRef.current) return;

      setIsInitialLocating(true);
      readPosition(false);
      startWatch();
    };

    void start();

    return () => {
      cancelled = true;
      stopWatch();
    };
  }, [enabled, worksite, applyZoneCheck, isLocalDevHost, readPosition, startWatch, stopWatch]);

  useEffect(() => {
    if (currentLocation && worksite) {
      applyZoneCheck(currentLocation.lat, currentLocation.lng, worksite);
    }
  }, [officeZones, worksite, currentLocation, applyZoneCheck]);

  return {
    currentLocation,
    distance,
    inZone,
    locError,
    isInitialLocating,
    isRefreshing,
    lastUpdated,
    matchedWorksite,
    refreshLocation,
  };
}
