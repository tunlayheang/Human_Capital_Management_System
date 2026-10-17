import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Api } from '../services/api';
import { AttendanceRecord } from '../types';
import {
  DEFAULT_ATTENDANCE_RULES,
  normalizeAttendanceClockRules,
  type AttendanceClockRules,
  type EmployeeAttendanceSchedule,
} from '../types/attendance';
import { AttendanceClickClockPanel } from '../components/attendance/AttendanceClickClockPanel';
import { Logo } from '../components/ui/Logo';
import { parseAttendanceQrToken } from '../utils/attendanceQr';
import { dateKeyInTimeZone } from '../utils/attendanceWeek';
import {
  activeOfficeZonesFromList,
  assignedOfficeZones,
  checkLocationAgainstOffices,
  checkLocationAgainstWorksite,
  DEFAULT_GEOFENCE_RADIUS_M,
  GEO_PERMISSION_DENIED_MESSAGE,
  resolveAttendanceLocationTone,
  resolveOfficeWorksite,
  type ResolvedWorksite,
} from '../utils/attendanceGeo';
import { resolveAttendanceDisplayStatus } from '../utils/attendanceDisplayStatus';

export const AttendanceScanPage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const locErrorShown = useRef(false);
  const geoDeniedRef = useRef(false);

  const qrToken = parseAttendanceQrToken(searchParams.get('t') || searchParams.get('token') || '');

  const isLocalDevHost =
    import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname);

  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [inZone, setInZone] = useState(false);
  const [loadingLoc, setLoadingLoc] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [worksite, setWorksite] = useState<ResolvedWorksite | null>(null);
  const [officeZones, setOfficeZones] = useState<
    Array<{ name?: string; latitude: number; longitude: number; radiusMeters: number }>
  >([]);
  const [clockRules, setClockRules] = useState<AttendanceClockRules>(DEFAULT_ATTENDANCE_RULES);
  const [employeeSchedule, setEmployeeSchedule] = useState<EmployeeAttendanceSchedule | null>(null);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [clockAction, setClockAction] = useState<'in' | 'out' | null>(null);

  const applyZoneCheck = useCallback(
    (lat: number, lng: number, site: ResolvedWorksite | null, zones = officeZones) => {
      if (zones.length > 1) {
        const multi = checkLocationAgainstOffices(lat, lng, zones);
        setInZone(multi.inZone);
        return;
      }
      const assigned = site ?? worksite;
      if (assigned) {
        if (!assigned.enforceGeofence) {
          setInZone(true);
          return;
        }
        const check = checkLocationAgainstWorksite(lat, lng, assigned);
        setInZone(check.inZone);
        return;
      }
      setInZone(false);
    },
    [worksite, officeZones]
  );

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const [records, worksiteRes] = await Promise.all([
          Api.attendance.getForUser(user.id, { historyDays: 30 }),
          Api.attendance.getWorksite(user.id),
        ]);

        const worksiteOffices = Array.isArray(worksiteRes?.offices) ? worksiteRes.offices : [];
        let resolved: ResolvedWorksite | null = worksiteRes?.worksite ?? null;
        if (worksiteRes?.rules) {
          setClockRules(normalizeAttendanceClockRules(worksiteRes.rules));
        }
        if (worksiteRes?.schedule) {
          setEmployeeSchedule(worksiteRes.schedule as EmployeeAttendanceSchedule);
        }
        if (!resolved && worksiteOffices.length) {
          const first = worksiteOffices[0] as Record<string, unknown>;
          resolved = resolveOfficeWorksite({
            name: String(first.name ?? 'Office'),
            latitude: Number(first.latitude),
            longitude: Number(first.longitude),
            radiusMeters: Number(first.radiusMeters),
          });
        }
        if (!resolved) {
          const settings = await Api.attendance.getSettings();
          if (settings) {
            const s = settings as Record<string, unknown>;
            const firstOffice =
              Array.isArray(s.offices) && s.offices.length
                ? (s.offices[0] as Record<string, unknown>)
                : s;
            resolved = resolveOfficeWorksite({
              name: String(firstOffice.name ?? 'Office'),
              latitude: Number(firstOffice.latitude),
              longitude: Number(firstOffice.longitude),
              radiusMeters: Number(firstOffice.radiusMeters),
            });
          }
        }
        setWorksite(resolved);
        const zones = activeOfficeZonesFromList(worksiteOffices as Record<string, unknown>[]);
        setOfficeZones(zones.length ? zones : assignedOfficeZones(resolved));

        const list = (Array.isArray(records) ? records : []).map((rec) => ({
          ...rec,
          status: resolveAttendanceDisplayStatus(rec, user.shiftStart),
        }));
        const currentDay = dateKeyInTimeZone(new Date());
        setTodayRecord(list.find((r) => r.date?.slice(0, 10) === currentDay) || null);
      } catch (e) {
        console.error(e);
      }
    };
    void load();
  }, [user]);

  const getLocation = useCallback(
    (force = false) => {
      if (geoDeniedRef.current && !force) {
        setLocError(GEO_PERMISSION_DENIED_MESSAGE);
        setLoadingLoc(false);
        return;
      }
      if (!navigator.geolocation) {
        setLocError('Geolocation is not supported in this browser.');
        setLoadingLoc(false);
        return;
      }
      setLoadingLoc(true);
      setLocError(null);
      locErrorShown.current = false;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setCurrentLocation({ lat, lng });
          geoDeniedRef.current = false;
          applyZoneCheck(lat, lng, worksite);
          setLoadingLoc(false);
        },
        (error) => {
          if (isLocalDevHost && worksite) {
            setCurrentLocation({ lat: worksite.latitude, lng: worksite.longitude });
            applyZoneCheck(worksite.latitude, worksite.longitude, worksite);
            setLoadingLoc(false);
            return;
          }
          const denied = error.code === error.PERMISSION_DENIED;
          if (denied) geoDeniedRef.current = true;
          const msg = denied
            ? GEO_PERMISSION_DENIED_MESSAGE
            : 'Enable location to record attendance.';
          setLocError(msg);
          setCurrentLocation(null);
          setInZone(false);
          setLoadingLoc(false);
          if (!locErrorShown.current) {
            showToast(msg, 'error');
            locErrorShown.current = true;
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    },
    [applyZoneCheck, isLocalDevHost, worksite, showToast]
  );

  useEffect(() => {
    if (worksite) getLocation();
  }, [worksite, getLocation]);

  const geofenceActive = !!worksite?.enforceGeofence;

  const canClockIn =
    !!qrToken &&
    !todayRecord?.clockIn &&
    !clockAction &&
    !loadingLoc &&
    (!clockRules.requireInZoneToClockIn || !geofenceActive || inZone || isLocalDevHost) &&
    (!clockRules.requireGps || !!currentLocation || isLocalDevHost);

  const canClockOut =
    !!qrToken &&
    !!todayRecord?.clockIn &&
    !todayRecord?.clockOut &&
    !clockAction &&
    !loadingLoc &&
    (!clockRules.requireInZoneToClockOut || !geofenceActive || inZone || isLocalDevHost) &&
    (!clockRules.requireGpsOnClockOut || !!currentLocation || isLocalDevHost);

  const shiftRange =
    employeeSchedule?.timeIn && employeeSchedule?.timeOut
      ? `${employeeSchedule.timeIn} – ${employeeSchedule.timeOut}`
      : user?.shiftStart && user?.shiftEnd
        ? `${user.shiftStart} – ${user.shiftEnd}`
        : null;

  const zoneLabel = loadingLoc
    ? t('attendance.locating') || 'Locating…'
    : geofenceActive && !inZone
      ? t('attendance.outOfZone') || 'Out of Zone'
      : inZone
        ? t('attendance.inZone') || 'In Zone'
        : t('attendance.inZone') || 'Ready';

  const zoneRequiredForAction = todayRecord?.clockIn
    ? clockRules.requireInZoneToClockOut
    : clockRules.requireInZoneToClockIn;
  const gpsRequiredForAction = todayRecord?.clockIn
    ? clockRules.requireGpsOnClockOut
    : clockRules.requireGps;
  const zoneRuleEnforced = zoneRequiredForAction && geofenceActive;
  const locationTone = resolveAttendanceLocationTone({
    loading: loadingLoc,
    inZone,
    geofenceActive,
    zoneRuleEnforced,
  });

  const statusHint = !qrToken
    ? 'Invalid or missing QR link. Scan the entrance display again.'
    : locError
      ? locError
      : todayRecord?.clockOut
        ? t('attendance.recordedToday') || 'Attendance recorded for today.'
        : zoneRequiredForAction && geofenceActive && !inZone && !isLocalDevHost
          ? t('attendance.outOfZone') || 'Move within the office zone to record attendance.'
          : gpsRequiredForAction && !currentLocation
            ? 'Allow location access, then tap Clock In or Clock Out.'
            : undefined;

  const runScan = async (action: 'in' | 'out') => {
    if (!qrToken) return;
    const needsGps = action === 'in' ? clockRules.requireGps : clockRules.requireGpsOnClockOut;
    if (needsGps && !currentLocation) {
      getLocation(true);
      return;
    }
    if (
      action === 'in' &&
      clockRules.requireInZoneToClockIn &&
      geofenceActive &&
      !inZone &&
      !isLocalDevHost
    ) {
      showToast(
        t('attendance.outOfZone') || 'Move within the office zone to clock in.',
        'error'
      );
      return;
    }
    if (
      action === 'out' &&
      clockRules.requireInZoneToClockOut &&
      geofenceActive &&
      !inZone &&
      !isLocalDevHost
    ) {
      showToast(
        t('attendance.outOfZone') || 'Move within the office zone to clock out.',
        'error'
      );
      return;
    }
    setClockAction(action);
    try {
      const result = await Api.attendance.scanQr(
        qrToken,
        currentLocation?.lat ?? worksite?.latitude ?? 0,
        currentLocation?.lng ?? worksite?.longitude ?? 0,
        action
      );
      if (result?.record) setTodayRecord(result.record as AttendanceRecord);
      showToast(
        result?.action === 'clock-out'
          ? 'Clocked out successfully.'
          : 'Clocked in successfully.',
        'success'
      );
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Attendance failed', 'error');
    } finally {
      setClockAction(null);
    }
  };

  return (
    <div className="hcms-min-viewport bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur">
        <Link
          to="/attendance?scope=self"
          className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back') || 'Back'}
        </Link>
        <Logo size="sm" showSubtitle={false} variant="color" className="opacity-90" />
        <span className="w-14" aria-hidden />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-xl">
          {!qrToken ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-6 text-center text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold mb-2">QR link not valid</p>
              <p className="text-amber-800/90 dark:text-amber-200/80">
                Scan the live entrance QR code on the display, or ask HR to refresh it.
              </p>
              <button
                type="button"
                onClick={() => navigate('/attendance?scope=self')}
                className="mt-4 text-primary-700 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300 text-sm font-medium"
              >
                Open full attendance
              </button>
            </div>
          ) : (
            <>
              <AttendanceClickClockPanel
                todayRecord={todayRecord}
                loadingAction={clockAction}
                loadingLoc={loadingLoc}
                canClockIn={canClockIn}
                canClockOut={canClockOut}
                onClockIn={() => void runScan('in')}
                onClockOut={() => void runScan('out')}
                shiftRange={shiftRange}
                statusHint={statusHint !== zoneLabel ? statusHint : undefined}
                zoneLabel={worksite?.name ? `${zoneLabel} · ${worksite.name}` : zoneLabel}
                zoneTone={locationTone}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
};
