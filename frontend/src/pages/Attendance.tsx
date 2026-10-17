import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  createWorkspaceShellCache,
  WORKSPACE_TAB_REVALIDATE_MS,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { parseAttendanceQrToken } from '../utils/attendanceQr';
import { isManageScope, isSelfServiceScope } from '../utils/selfServiceScope';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ListIconButton } from '../components/ui/ListIconButton';
import { ResponsiveRowActions } from '../components/ui/ResponsiveRowActions';
import { StatusLabel } from '../components/ui/StatusLabel';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { resolveDepartmentDisplayName } from '../utils/localizedEntityLabel';
import { Api } from '../services/api';
import { AttendanceRecord, AttendanceStatus, Department, User } from '../types';
import {
  effectiveAttendanceStatus,
  recordMatchesStatusFilter,
} from '../utils/attendanceEffectiveStatus';
import { PERM } from '../constants/permissionKeys';
import { ShieldOff, AlertCircle, Lock } from 'lucide-react';
import { formatTime } from '../utils';
import {
  attendanceTimeHmFromIso,
  formatAttendanceClockDisplay,
} from '../utils/attendanceRecordApi';
import { dateKeyInTimeZone, addDaysToDateKey } from '../utils/attendanceWeek';
import {
  ATTENDANCE_LOCATION_TONE_CLASSES,
  DEFAULT_GEOFENCE_RADIUS_M,
  activeOfficeZonesFromList,
  assignedOfficeZones,
  formatDistanceFromOfficeLine,
  formatDistanceFromOfficeShort,
  formatDistanceMeters,
  mapsLink,
  resolveAttendanceLocationTone,
  resolveOfficeWorksite,
  type ResolvedWorksite,
} from '../utils/attendanceGeo';
import { useAttendanceGeolocation } from '../hooks/useAttendanceGeolocation';
import { resolveAttendanceListStatus } from '../utils/attendanceDisplayStatus';
import { attendanceStatusLabel } from '../utils/attendanceStatusLabels';
const EmployeeLocationMap = lazy(() =>
  import('../components/attendance/EmployeeLocationMap').then((m) => ({
    default: m.EmployeeLocationMap,
  }))
);
import {
  EmployeeListIdentityBlock,
  EmployeeListIdentityCells,
  employeeListIdentityFromUser,
} from '../components/employee/EmployeeListIdentity';
import {
  useListColumnSort,
  sortRowsByColumn,
  SortableTableHeader,
} from '../utils/listColumnSort';
import {
  type EnrichedUserLike,
  isSystemPortalAccount,
  userDisplayEmployeeCode,
  userDisplayName,
} from '../utils/userProfile';
import { isPortalUserExcludedFromPayroll } from '../utils/payrollEligibility';
import { isEmployeeAllowedSystemAccess } from '../utils/employeePortalStatus';
import { usePersonDisplayName } from '../hooks/usePersonDisplayName';
import { AttendanceMyHistory } from '../components/attendance/AttendanceMyHistory';
import { AttendanceClickClockPanel } from '../components/attendance/AttendanceClickClockPanel';

const AttendanceGeofenceSettings = lazy(
  () => import('../components/attendance/AttendanceGeofenceSettings')
);
const AttendanceLeaderboardView = lazy(() =>
  import('../components/attendance/AttendanceLeaderboardView').then((m) => ({
    default: m.AttendanceLeaderboardView,
  }))
);
import {
  DEFAULT_ATTENDANCE_RULES,
  normalizeAttendanceClockRules,
  type AttendanceClockRules,
  type EmployeeAttendanceSchedule,
} from '../types/attendance';
import { getAttendanceRulesRevision } from '../utils/workspaceTabStateStore';
import { MapPin, RefreshCw, CheckCircle, ExternalLink, Clock, Calendar, ShieldCheck, Building2, Map as MapIcon, Settings, List, Pencil, Trophy, Upload } from 'lucide-react';
import { ExportFormatMenu } from '../components/ui/ExportFormatMenu';
import type { ExportFileExt } from '../utils/export/exportDocumentStandard';
import { exportAttendanceList } from '../utils/importAttendance';
import {
  FilterMenuDateRange,
  FilterMenuSelect,
  PageFilterMenu,
} from '../components/ui/PageFilterMenu';
import { countActiveFilters } from '../utils/filterActiveCount';
import {
  EMPTY_DATE_RANGE,
  isDateRangeActive,
  recordMatchesDateRange,
  countDateRangeFilters,
} from '../utils/dateRangeFilter';
import { useToast } from '../context/ToastContext';
import { AttendanceTimesEditModal } from '../components/attendance/AttendanceTimesEditModal';
import { AttendanceImportModal } from '../components/attendance/AttendanceImportModal';
import { LoadingState, TableLoadingRow } from '../components/common/LoadingState';
import { format } from 'date-fns';
import { enUS, km as kmLocale } from 'date-fns/locale';
import { localeForLanguage } from '../utils/localizedLabels';
import { formatDateOnlyDisplay, formatDateTimeDisplay } from '../utils/formatDisplayDate';
import { ListPagination } from '../components/ui/ListPagination';
import { listToolbarIconPillClass } from '../constants/designSystem';
import {
  PageHeader,
  PageShell,
  TableScroll,
  UnderlineTabs,
  ListSearchFilterBar,
  ListToolbarIconButton,
  listToolbarGlyphClass,
} from '../components/ui/page';
import { useRoutePageMeta, useSyncDocumentTitle } from '../hooks/useRoutePageMeta';
import { useClientPagination } from '../utils/useClientPagination';
import { DEFAULT_LIST_PAGE_SIZE } from '../utils/visiblePages';
import { useAttendanceFreezePeriods } from '../hooks/useAttendanceFreezePeriods';
import {
  freezeBannerMessage,
  isAttendanceGridPlaceholder,
  isAttendanceRecordUpdateLocked,
} from '../utils/attendanceFreeze';
import { canAccessFullPayrollModule } from '../utils/payrollAccess';

const ATTENDANCE_PAGE_LIMIT = DEFAULT_LIST_PAGE_SIZE;

function formatLastGpsUpdate(
  at: Date,
  t: (path: string, vars?: Record<string, string | number>) => string,
  dateLocale: string
): string {
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 8) return t('attendance.geo.timeJustNow');
  if (seconds < 60) return t('attendance.geo.timeSecondsAgo', { seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('attendance.geo.timeMinutesAgo', { minutes });
  return at.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' });
}

type MyAttendanceTab = 'my' | 'history';

const MyAttendance: React.FC<{ tab?: MyAttendanceTab }> = ({ tab = 'my' }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const displayName = usePersonDisplayName();
  const dateLocale = localeForLanguage(language);
  const dateFnsLocale = language === 'km' ? kmLocale : enUS;

  const isLocalDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  const [worksite, setWorksite] = useState<ResolvedWorksite | null>(null);
  const [officeZones, setOfficeZones] = useState<
    Array<{ name?: string; latitude: number; longitude: number; radiusMeters: number }>
  >([]);
  const [clockRules, setClockRules] = useState<AttendanceClockRules>(DEFAULT_ATTENDANCE_RULES);
  const [employeeSchedule, setEmployeeSchedule] = useState<EmployeeAttendanceSchedule | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [userRecords, setUserRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [clockAction, setClockAction] = useState<'in' | 'out' | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const selfTabCache = useWorkspaceTabCache<{
    worksite: ResolvedWorksite | null;
    officeZones: Array<{ name?: string; latitude: number; longitude: number; radiusMeters: number }>;
    clockRules: AttendanceClockRules;
    employeeSchedule: EmployeeAttendanceSchedule | null;
    department: Department | null;
    userRecords: AttendanceRecord[];
    todayRecord: AttendanceRecord | null;
  }>({
    slot: 'attendance-self-v1',
    cacheKey: user?.id ?? '',
    getSnapshot: () => ({
      worksite,
      officeZones,
      clockRules,
      employeeSchedule,
      department,
      userRecords,
      todayRecord,
    }),
    applySnapshot: (cached) => {
      setWorksite(cached.worksite);
      setOfficeZones(cached.officeZones);
      setClockRules(cached.clockRules);
      setEmployeeSchedule(cached.employeeSchedule);
      setDepartment(cached.department);
      setUserRecords(cached.userRecords);
      setTodayRecord(cached.todayRecord);
      setRecordsLoading(false);
    },
    shouldPersist: (cached) => cached.userRecords.length > 0,
    persistDeps: [
      worksite,
      officeZones,
      clockRules,
      employeeSchedule,
      department,
      userRecords,
      todayRecord,
      user?.id,
    ],
  });

  const reloadRecords = useCallback(async () => {
    if (!user) return;
    setRecordsLoading(true);
    try {
      const recs = await Api.attendance.getForUser(user.id, { historyDays: 90 });
      const list = (Array.isArray(recs) ? recs : []).map((rec) => ({
        ...rec,
        status: resolveAttendanceListStatus(rec, user.shiftStart),
      }));
      setUserRecords(list);
      const currentDay = dateKeyInTimeZone(new Date());
      const today = list.find((r) => r.date?.slice(0, 10) === currentDay) || null;
      setTodayRecord(today);
    } catch (e) {
      console.error(e);
      showToast('Failed to load attendance records', 'error');
    } finally {
      setRecordsLoading(false);
    }
  }, [user, showToast]);

  useEffect(() => {
    const fetchMeta = async (background = false) => {
      if (!user) return;
      if (!background) setRecordsLoading(true);
      try {
        const [depts, records, worksiteRes, offices] = await Promise.all([
          Api.departments.getAll(),
          Api.attendance.getForUser(user.id, { historyDays: 90 }),
          Api.attendance.getWorksite(user.id),
          Api.attendance.getOffices().catch(() => []),
        ]);
        const officeList = Array.isArray(offices) ? offices : [];
        const worksiteOffices = Array.isArray(worksiteRes?.offices) && worksiteRes.offices.length
          ? worksiteRes.offices
          : officeList;
        const myDept = depts.find((d) => d.id === user.departmentId);
        setDepartment(myDept || null);

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
            const firstOffice = Array.isArray(s.offices) && s.offices.length
              ? (s.offices[0] as Record<string, unknown>)
              : s;
            resolved = resolveOfficeWorksite({
              name: String(firstOffice.name ?? 'Office'),
              latitude: Number(firstOffice.latitude),
              longitude: Number(firstOffice.longitude),
              radiusMeters: Number(firstOffice.radiusMeters),
            });
            if (s.rules && typeof s.rules === 'object') {
              setClockRules(
                normalizeAttendanceClockRules(s.rules as Partial<AttendanceClockRules>)
              );
            }
          }
        }
        setWorksite(resolved);
        const zones = activeOfficeZonesFromList(worksiteOffices as Record<string, unknown>[]);
        setOfficeZones(zones.length ? zones : assignedOfficeZones(resolved));

        const list = (Array.isArray(records) ? records : []).map((rec) => ({
          ...rec,
          status: resolveAttendanceListStatus(rec, user.shiftStart),
        }));
        setUserRecords(list);
        const currentDay = dateKeyInTimeZone(new Date());
        const today = list.find((r) => r.date?.slice(0, 10) === currentDay) || null;
        setTodayRecord(today);
      } catch (e) {
        console.error('Failed to load attendance context', e);
        if (!background) showToast('Failed to load attendance records', 'error');
      } finally {
        if (!background) setRecordsLoading(false);
      }
    };
    const restored = selfTabCache.isRestored();
    const ageMs = selfTabCache.getCacheAgeMs();
    if (restored && ageMs != null && ageMs < WORKSPACE_TAB_REVALIDATE_MS) {
      selfTabCache.consumeRestored();
      // Still refresh rules so Clock rules edits apply without waiting for cache expiry.
      void (async () => {
        try {
          const worksiteRes = await Api.attendance.getWorksite(user.id);
          if (worksiteRes?.rules) {
            setClockRules(normalizeAttendanceClockRules(worksiteRes.rules));
          }
          if (worksiteRes?.worksite) setWorksite(worksiteRes.worksite);
        } catch {
          /* keep cached */
        }
      })();
      return;
    }
    if (selfTabCache.consumeRestored()) {
      void fetchMeta(true);
      return;
    }
    void fetchMeta(false);
  }, [user, showToast]);

  // Re-sync GPS/zone rules when admin saves Clock rules (same session / tab switch).
  useEffect(() => {
    if (!user) return;
    let lastRev = getAttendanceRulesRevision();
    const syncRules = () => {
      const next = getAttendanceRulesRevision();
      if (next === lastRev) return;
      lastRev = next;
      void Api.attendance
        .getWorksite(user.id)
        .then((worksiteRes) => {
          if (worksiteRes?.rules) {
            setClockRules(normalizeAttendanceClockRules(worksiteRes.rules));
          }
          if (worksiteRes?.worksite) setWorksite(worksiteRes.worksite);
        })
        .catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncRules();
    };
    window.addEventListener('hcms-attendance-rules-changed', syncRules);
    window.addEventListener('focus', syncRules);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('hcms-attendance-rules-changed', syncRules);
      window.removeEventListener('focus', syncRules);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  const {
    currentLocation,
    distance,
    inZone,
    locError,
    isInitialLocating,
    isRefreshing,
    lastUpdated,
    refreshLocation,
  } = useAttendanceGeolocation({
    enabled: !!worksite,
    worksite,
    officeZones,
    isLocalDevHost,
    onToast: showToast,
    t,
  });

  const displayWorksite = worksite;
  const loadingLoc = isInitialLocating;
  const refreshingLoc = isRefreshing;

  const resolveClockLocation = (): { lat: number; lng: number } | null => {
    if (currentLocation) return currentLocation;
    if (worksite && !clockRules.requireGps) {
      return { lat: worksite.latitude, lng: worksite.longitude };
    }
    return null;
  };

  const performDirectClock = async (action: 'in' | 'out') => {
    if (!user) return;
    if (action === 'in') {
      if (clockRules.requireGps && !currentLocation) {
        refreshLocation();
        return;
      }
      if (clockRules.requireInZoneToClockIn && geofenceActive && !inZone) {
        showToast(`You must be within ${displayRadius}m of ${displayWorksite?.name || 'the office'} to clock in.`, 'error');
        return;
      }
      const loc = resolveClockLocation();
      if (clockRules.requireGps && !loc) {
        refreshLocation();
        return;
      }
    } else {
      if (!todayRecord) return;
      if (clockRules.requireGpsOnClockOut && !currentLocation) {
        refreshLocation();
        return;
      }
      if (clockRules.requireInZoneToClockOut && geofenceActive && !inZone) {
        showToast(`You must be within ${displayRadius}m to clock out.`, 'error');
        return;
      }
      const loc = resolveClockLocation();
      if (clockRules.requireGpsOnClockOut && !loc) {
        refreshLocation();
        return;
      }
    }

    const loc = resolveClockLocation();
    setClockAction(action);
    try {
      const rec =
        action === 'in'
          ? await Api.attendance.clockIn(user.id, loc)
          : await Api.attendance.clockOut(todayRecord!.id, loc);
      applyAttendanceRecord(rec);
      const successMsg =
        action === 'in'
          ? t('attendance.clockInSuccess') || 'Clocked in successfully.'
          : t('attendance.clockOutSuccess') || 'Clocked out successfully.';
      if (action === 'in') {
        if (rec.workedOnDayOff || rec.status === AttendanceStatus.DAY_OFF) {
          showToast(t('attendance.dayOffWorkedClockedIn'), 'info');
        } else {
          showToast(successMsg, 'success');
        }
      } else if (rec.workedOnDayOff || rec.requiresOvertimeRequest) {
        const hours =
          rec.otEligibleHours != null && Number.isFinite(rec.otEligibleHours)
            ? String(rec.otEligibleHours)
            : rec.workHours != null
              ? String(rec.workHours)
              : '—';
        showToast(t('attendance.dayOffWorkedComplete', { hours }), 'info');
      } else {
        showToast(successMsg, 'success');
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Attendance failed', 'error');
    } finally {
      setClockAction(null);
    }
  };

  const handleClockIn = () => {
    void performDirectClock('in');
  };
  const handleClockOut = () => {
    void performDirectClock('out');
  };

  const applyAttendanceRecord = (rec: AttendanceRecord) => {
    setTodayRecord(rec);
    setUserRecords((prev) => {
      const key = rec.date?.slice(0, 10);
      const idx = prev.findIndex((r) => r.date?.slice(0, 10) === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = rec;
        return next;
      }
      return [...prev, rec];
    });
  };

  const isCheckedIn = !!todayRecord?.clockIn && !todayRecord?.clockOut;
  const isCheckedOut = !!todayRecord?.clockOut;
  const geofenceActive = !!displayWorksite?.enforceGeofence;
  const displayRadius = displayWorksite?.radius ?? DEFAULT_GEOFENCE_RADIUS_M;

  const canClockIn =
    !todayRecord?.clockIn &&
    !clockAction &&
    (!clockRules.requireGps || !loadingLoc) &&
    (!clockRules.requireInZoneToClockIn || !geofenceActive || inZone) &&
    (!clockRules.requireGps || !!currentLocation);

  const canClockOut =
    !!todayRecord?.clockIn &&
    !todayRecord?.clockOut &&
    !clockAction &&
    (!clockRules.requireGpsOnClockOut || !loadingLoc) &&
    (!clockRules.requireInZoneToClockOut || !geofenceActive || inZone) &&
    (!clockRules.requireGpsOnClockOut || !!currentLocation);

  const shiftRange =
    employeeSchedule?.timeIn && employeeSchedule?.timeOut
      ? `${employeeSchedule.timeIn} – ${employeeSchedule.timeOut}`
      : user?.shiftStart && user?.shiftEnd
        ? `${user.shiftStart} – ${user.shiftEnd}`
        : null;

  const zoneRequiredForCurrentAction = isCheckedIn
    ? clockRules.requireInZoneToClockOut
    : clockRules.requireInZoneToClockIn;
  const gpsRequiredForCurrentAction = isCheckedIn
    ? clockRules.requireGpsOnClockOut
    : clockRules.requireGps;
  /** Outside-zone UI is red only while "must be in zone" is enforced for this action. */
  const zoneRuleEnforced = zoneRequiredForCurrentAction && geofenceActive;
  const locationTone = resolveAttendanceLocationTone({
    loading: loadingLoc,
    inZone,
    geofenceActive,
    zoneRuleEnforced,
  });
  const locationToneClasses = ATTENDANCE_LOCATION_TONE_CLASSES[locationTone];

  const clockStatusHint = isCheckedOut
    ? t('attendance.recordedToday')
    : isCheckedIn
      ? t('attendance.forgetClockOut')
      : loadingLoc
        ? t('attendance.locating')
        : zoneRequiredForCurrentAction && geofenceActive && !inZone
          ? distance != null && displayWorksite
            ? t('attendance.geo.moveWithinZone', {
                distance: formatDistanceMeters(distance),
                office: displayWorksite.name,
                radius: formatDistanceMeters(displayRadius),
              })
            : t('attendance.outOfZone')
          : !currentLocation && gpsRequiredForCurrentAction
            ? t('attendance.enableLocationClockIn')
            : zoneRequiredForCurrentAction && geofenceActive
              ? t('attendance.geo.tapClockInWithin', {
                  radius: displayRadius,
                  worksite: displayWorksite?.name || t('attendance.officeLocation'),
                })
              : t('attendance.tapClockInStart');

  const todayLabel = format(new Date(), 'EEEE, dd/MM/yyyy', { locale: dateFnsLocale });
  const dayStatusLabel = isCheckedOut
    ? t('attendance.dayComplete')
    : isCheckedIn
      ? t('attendance.currentlyWorking')
      : t('attendance.notClockedIn');
  const dayStatusTone = isCheckedOut ? 'emerald' : isCheckedIn ? 'primary' : 'slate';

  const panelZoneLabel = loadingLoc
    ? t('attendance.locating')
    : geofenceActive && distance != null
      ? formatDistanceFromOfficeShort(distance, inZone, t)
      : geofenceActive && !inZone
        ? t('attendance.outOfZone')
        : t('attendance.inZone');
  const panelZoneTone: 'success' | 'warning' | 'danger' = locationTone;
  const panelExtraHint =
    clockStatusHint && clockStatusHint !== panelZoneLabel ? clockStatusHint : undefined;

  const workedOnDayOffToday =
    todayRecord?.workedOnDayOff ||
    (todayRecord?.status === AttendanceStatus.DAY_OFF && !!todayRecord?.clockIn);

  const sectionTabs = useMemo(
    () => [
      { id: 'my' as const, label: t('attendance.myAttendance') || 'Attendance', icon: Calendar },
      { id: 'history' as const, label: t('attendance.history') || 'Attendance History', icon: List },
    ],
    [t]
  );

  const onSectionTabChange = useCallback(
    (next: MyAttendanceTab) => {
      if (next === 'history') {
        navigate('/attendance?scope=self&tab=history');
        return;
      }
      navigate('/attendance?scope=self');
    },
    [navigate]
  );

  return (
    <PageShell>
      <PageHeader
        title={t('attendance.myAttendance') || 'Attendance'}
        subtitle={
          user
            ? `${userDisplayName(user, language)}${
                department
                  ? ` · ${resolveDepartmentDisplayName(department, language)}`
                  : ''
              }`
            : undefined
        }
        iconComponent={Calendar}
        eyebrow={
          tab === 'my' ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-[0.12em] mb-2">
              <Calendar className="w-3.5 h-3.5" aria-hidden />
              <span>{todayLabel}</span>
            </div>
          ) : undefined
        }
        badges={
          tab === 'my' ? (
            <>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  dayStatusTone === 'emerald'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
                    : dayStatusTone === 'primary'
                      ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-500/15 dark:text-primary-200 dark:border-primary-500/30'
                      : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15'
                }`}
              >
                {isCheckedOut ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                {dayStatusLabel}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                  loadingLoc
                    ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/10 dark:text-slate-300 dark:border-white/15'
                    : locationToneClasses.pill
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                {loadingLoc
                  ? t('attendance.locating') || 'Locating…'
                  : inZone || !geofenceActive
                    ? distance != null
                      ? formatDistanceFromOfficeShort(distance, true)
                      : t('attendance.inZone') || 'In zone'
                    : distance != null
                      ? formatDistanceFromOfficeShort(distance, false)
                      : t('attendance.outOfZone') || 'Out of zone'}
              </span>
            </>
          ) : undefined
        }
      />

      <UnderlineTabs
        value={tab}
        onChange={onSectionTabChange}
        tabs={sectionTabs}
        ariaLabel={t('attendance.myAttendance') || 'Attendance'}
      />

      {tab === 'history' ? (
        <AttendanceMyHistory
          records={userRecords}
          loading={recordsLoading}
          onRefresh={() => void reloadRecords()}
        />
      ) : (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-5 min-w-0">
        <div className="lg:col-span-3 min-w-0">
          <AttendanceClickClockPanel
            todayRecord={todayRecord}
            loadingAction={clockAction}
            loadingLoc={loadingLoc}
            canClockIn={canClockIn}
            canClockOut={canClockOut}
            onClockIn={handleClockIn}
            onClockOut={handleClockOut}
            shiftRange={shiftRange}
            statusHint={panelExtraHint}
            zoneLabel={panelZoneLabel}
            zoneTone={panelZoneTone}
            clickToRecordLabel={
              t('attendance.clickToRecordNoFace') || 'Click to record attendance'
            }
            className="max-w-none"
          />
          {workedOnDayOffToday ? (
            <div className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">{t('attendance.dayOffWorkedTitle')}</p>
              <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                {t('attendance.dayOffWorkedHint')}
              </p>
              {todayRecord?.clockOut ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate('/overtime?scope=self')}
                >
                  {t('attendance.dayOffWorkedRequestOt')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className="lg:col-span-2 min-w-0 flex flex-col rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-lg shadow-slate-200/40 dark:shadow-black/20 overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${locationToneClasses.iconBox}`}
              >
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  {t('attendance.yourLocation') || 'Location'}
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {displayWorksite?.name || department?.name || t('common.unknown')}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={refreshLocation} isLoading={refreshingLoc} disabled={refreshingLoc} className="shrink-0 h-8 px-2.5" title={t('attendance.refreshLocation') || 'Refresh GPS'}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="px-5 py-3 grid grid-cols-2 gap-2 border-b border-slate-100 dark:border-slate-800">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{t('attendance.officeLocation') || 'Office'}</p>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5">{displayWorksite?.name || '—'}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {geofenceActive
                  ? t('attendance.geo.zoneMeters', { meters: displayRadius })
                  : t('attendance.geo.noGeofence')}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-950/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{t('common.status') || 'Status'}</p>
              <p className={`text-xs font-bold mt-0.5 ${locationToneClasses.text}`}>
                {loadingLoc
                  ? '…'
                  : distance != null
                    ? formatDistanceFromOfficeLine(
                        {
                          distanceMeters: distance,
                          inZone: inZone || !geofenceActive,
                          zoneRadiusMeters: geofenceActive ? displayRadius : undefined,
                          officeName: displayWorksite?.name,
                        },
                        t
                      )
                    : inZone || !geofenceActive
                      ? t('attendance.inZone')
                      : t('attendance.outOfZone')}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {distance !== null && !loadingLoc ? (
                  <span className="block">{t('attendance.geo.straightLineDistance')}</span>
                ) : null}
                {lastUpdated && !refreshingLoc && (
                  <span className="block mt-0.5">
                    {t('attendance.geo.updated', {
                      time: formatLastGpsUpdate(lastUpdated, t, dateLocale),
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>

          {locError && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{locError}</p>
            </div>
          )}

          <div className="relative flex-1 min-h-[12rem] sm:min-h-[14rem] lg:min-h-[16rem] bg-slate-100 dark:bg-slate-950">
                    {currentLocation ? (
                      <Suspense
                        fallback={
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-xs text-slate-500">
                            {t('attendance.geo.loadingMap') || 'Loading map…'}
                          </div>
                        }
                      >
                        <EmployeeLocationMap
                          latitude={currentLocation.lat}
                          longitude={currentLocation.lng}
                          loading={refreshingLoc}
                          className="h-full min-h-[14rem]"
                          zoneCenter={
                            displayWorksite && geofenceActive
                              ? { lat: displayWorksite.latitude, lng: displayWorksite.longitude }
                              : null
                          }
                          zoneRadiusMeters={geofenceActive ? displayRadius : undefined}
                          inZone={inZone}
                          outsideTone={zoneRuleEnforced ? 'danger' : 'warning'}
                          zoneName={displayWorksite?.name}
                          distanceFromOfficeMeters={distance}
                          youAreHereLabel={t('attendance.geo.youAreHere')}
                          geoT={t}
                        />
                      </Suspense>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 dark:bg-slate-900 text-sm text-slate-500 p-6 text-center">
                        <MapPin className="w-10 h-10 opacity-40" />
                        <p>{t('attendance.geo.allowLocationMap')}</p>
                        <Button variant="outline" size="sm" onClick={refreshLocation} isLoading={refreshingLoc} disabled={refreshingLoc}>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {t('attendance.geo.enableGps')}
                        </Button>
                      </div>
                    )}
                    {currentLocation && (
                      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={refreshLocation}
                          isLoading={refreshingLoc}
                          disabled={refreshingLoc}
                          className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-lg font-bold text-xs sm:text-sm px-2 sm:px-3"
                        >
                          <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 sm:mr-2" />
                          <span className="hidden xs:inline">{t('attendance.refreshLocation') || 'Refresh GPS'}</span>
                        </Button>
                      </div>
                    )}
          </div>
        </div>
      </div>
      </>
      )}
    </PageShell>
  );
};

const ATTENDANCE_LIST_CACHE_SLOT = 'attendance-manage-list-v1';
const attendanceUsersShellCache = createWorkspaceShellCache<User[]>();

type AttendanceListTabCache = {
  records: AttendanceRecord[];
  users: (User & EnrichedUserLike)[];
  search: string;
  dateFilter: 'today' | 'week' | 'all';
  dateRange: typeof EMPTY_DATE_RANGE;
  statusFilter: 'all' | AttendanceStatus;
};

type AttendanceListSortCol =
  | 'id'
  | 'employee'
  | 'date'
  | 'checkIn'
  | 'checkOut'
  | 'hours'
  | 'location'
  | 'status';

const attendanceListThClass =
  'px-2 py-1.5 sm:px-3 sm:py-2 font-bold uppercase tracking-wider text-[10px] text-slate-500 dark:text-slate-400';

// --- Administrative: team attendance list (read-only status from clock-in rules) ---
const AttendanceManagement: React.FC<{
  onFreezeNotice?: (message: string | null) => void;
  /** Matrix `attendance.manage` — edit/import times. View-only when false. */
  canEditRecords?: boolean;
}> = ({ onFreezeNotice, canEditRecords = false }) => {
    const { t, language } = useLanguage();
    const { user: currentUser, hasPermission } = useAuth();
    const { showToast } = useToast();
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [users, setUsers] = useState<(User & EnrichedUserLike)[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'all'>('today');
    const [dateRange, setDateRange] = useState(EMPTY_DATE_RANGE);
    const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
    const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [viewDayKey, setViewDayKey] = useState(() => dateKeyInTimeZone(new Date()));
    const { sortBy, sortOrder, toggleSort, resetSort } = useListColumnSort<AttendanceListSortCol>();

    const tabCache = useWorkspaceTabCache<AttendanceListTabCache>({
      slot: ATTENDANCE_LIST_CACHE_SLOT,
      getSnapshot: () => ({
        records,
        users,
        search,
        dateFilter,
        dateRange,
        statusFilter,
      }),
      applySnapshot: (cached) => {
        setRecords(cached.records);
        setUsers(cached.users);
        setSearch(cached.search);
        setDateFilter(cached.dateFilter);
        setDateRange(cached.dateRange);
        setStatusFilter(cached.statusFilter);
        setLoading(false);
      },
      shouldPersist: (cached) => cached.records.length > 0,
      persistDeps: [records, users, search, dateFilter, dateRange, statusFilter],
    });

    const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
        if (!opts?.background) setLoading(true);
        try {
            const today = dateKeyInTimeZone(new Date());
            const useTodayGrid =
              dateFilter === 'today' && !isDateRangeActive(dateRange);
            const useCustomRangeGrid = isDateRangeActive(dateRange);
            const attendanceQuery = useTodayGrid
              ? { date: 'today' as const }
              : useCustomRangeGrid
                ? (() => {
                    const from = dateRange.from?.trim() || addDaysToDateKey(today, -6);
                    const to = dateRange.to?.trim() || today;
                    const daySpan =
                      Math.max(
                        0,
                        Math.round(
                          (new Date(`${to}T12:00:00`).getTime() -
                            new Date(`${from}T12:00:00`).getTime()) /
                            86_400_000
                        )
                      ) + 1;
                    return daySpan <= 14
                      ? { gridRange: { from, to } }
                      : { historyRange: { from, to } };
                  })()
                : dateFilter === 'week'
                  ? { gridRangeDays: 7 }
                  : { historyDays: 90 };
            const [recs, usrs] = await Promise.all([
                Api.attendance.getAll(attendanceQuery),
                (async () => {
                  const cached = attendanceUsersShellCache.get();
                  if (cached?.length) return cached;
                  const fresh = await Api.users.getDirectory();
                  const userList = Array.isArray(fresh) ? fresh : [];
                  if (userList.length) attendanceUsersShellCache.set(userList);
                  return userList;
                })(),
            ]);
            const list = Array.isArray(recs) ? recs : [];
            const userList = Array.isArray(usrs) ? usrs : [];
            setUsers(userList);
            setRecords(list);
        } catch (e) {
            console.error(e);
            if (!opts?.background) {
              showToast('Failed to load attendance records from server', 'error');
            }
        } finally {
            if (!opts?.background) setLoading(false);
        }
    }, [showToast, dateFilter, dateRange]);

    const handleRefresh = useCallback(async () => {
        setLoading(true);
        try {
            const today = dateKeyInTimeZone(new Date());
            const useTodayGrid =
              dateFilter === 'today' && !isDateRangeActive(dateRange);
            const useCustomRangeGrid = isDateRangeActive(dateRange);
            const attendanceQuery = useTodayGrid
              ? { date: 'today' as const, reconcile: true }
              : useCustomRangeGrid
                ? (() => {
                    const from = dateRange.from?.trim() || addDaysToDateKey(today, -6);
                    const to = dateRange.to?.trim() || today;
                    const daySpan =
                      Math.max(
                        0,
                        Math.round(
                          (new Date(`${to}T12:00:00`).getTime() -
                            new Date(`${from}T12:00:00`).getTime()) /
                            86_400_000
                        )
                      ) + 1;
                    return daySpan <= 14
                      ? { gridRange: { from, to }, refresh: true }
                      : { historyRange: { from, to }, refresh: true };
                  })()
                : dateFilter === 'week'
                  ? { gridRangeDays: 7, refresh: true }
                  : { historyDays: 90, refresh: true };
            const [recs, usrs] = await Promise.all([
                Api.attendance.getAll(attendanceQuery),
                (async () => {
                  const cached = attendanceUsersShellCache.get();
                  if (cached?.length) return cached;
                  const fresh = await Api.users.getDirectory();
                  const userList = Array.isArray(fresh) ? fresh : [];
                  if (userList.length) attendanceUsersShellCache.set(userList);
                  return userList;
                })(),
            ]);
            setUsers(Array.isArray(usrs) ? usrs : []);
            setRecords(Array.isArray(recs) ? recs : []);
            showToast(
              dateFilter === 'today' && !isDateRangeActive(dateRange)
                ? "Today's attendance roster refreshed (ICT)."
                : dateFilter === 'week' || isDateRangeActive(dateRange)
                  ? 'Attendance list refreshed — all days through today (ICT).'
                  : 'Attendance list updated.',
              'success'
            );
        } catch (e) {
            console.error(e);
            showToast('Failed to refresh attendance records', 'error');
        } finally {
            setLoading(false);
        }
    }, [load, showToast, dateFilter, dateRange]);

    useEffect(() => {
        const id = window.setInterval(() => {
            const dk = dateKeyInTimeZone(new Date());
            setViewDayKey((prev) => (prev !== dk ? dk : prev));
        }, 60_000);
        return () => window.clearInterval(id);
    }, []);

    useWorkspaceTabMountLoad(load, [load], tabCache);

    useEffect(() => {
        if (dateFilter !== 'today' || isDateRangeActive(dateRange)) return;
        void load({ background: records.length > 0 });
    }, [viewDayKey, dateFilter, dateRange, load, records.length]);

    const getUser = useCallback((id: string) => users.find((u) => u.id === id), [users]);

    const todayGridActive = dateFilter === 'today' && !isDateRangeActive(dateRange);

    const filteredRecords = useMemo(() => {
        const today = viewDayKey;
        const weekFrom = addDaysToDateKey(today, -6);
        const q = search.trim().toLowerCase();
        const weekGridActive =
          dateFilter === 'week' && !isDateRangeActive(dateRange);

        return records
            .filter((rec) => {
                const u = getUser(rec.userId);
                // Attendance is employee-only — never show system admins / non-employee portal accounts.
                if (isSystemPortalAccount(u) || isPortalUserExcludedFromPayroll(u?.role)) {
                  return false;
                }
                // Defense in depth: hide non-Active HR employees if status is on the user shell.
                const hrStatus = u?.employee?.status;
                if (
                  hrStatus != null &&
                  String(hrStatus).trim() !== '' &&
                  !isEmployeeAllowedSystemAccess(hrStatus)
                ) {
                  return false;
                }
                if (isDateRangeActive(dateRange)) {
                  if (!recordMatchesDateRange(rec.date, dateRange)) return false;
                } else {
                  if (todayGridActive && rec.date !== today) return false;
                  if (weekGridActive && (rec.date < weekFrom || rec.date > today)) return false;
                }
                if (!recordMatchesStatusFilter(rec, statusFilter)) return false;
                if (!q) return true;
                return (
                    userDisplayName(u, language).toLowerCase().includes(q) ||
                    u?.email?.toLowerCase().includes(q) ||
                    userDisplayEmployeeCode(u).toLowerCase().includes(q) ||
                    rec.date.includes(q)
                );
            });
    }, [records, search, dateFilter, dateRange, statusFilter, users, getUser, viewDayKey, todayGridActive, language]);

    const sortedRecords = useMemo(() => {
        const getSortValue = (rec: AttendanceRecord, col: AttendanceListSortCol): string | number => {
            const u = getUser(rec.userId);
            switch (col) {
                case 'id':
                    return userDisplayEmployeeCode(u);
                case 'employee':
                    return userDisplayName(u, language);
                case 'date':
                    return rec.date;
                case 'checkIn':
                    return rec.clockIn ?? '';
                case 'checkOut':
                    return rec.clockOut ?? '';
                case 'hours':
                    return rec.workHours ?? 0;
                case 'location':
                    return rec.locationIn?.address?.trim() || '';
                case 'status':
                    return attendanceStatusLabel(effectiveAttendanceStatus(rec), t);
                default:
                    return '';
            }
        };
        const applyDefaultSort = (rows: AttendanceRecord[]) => {
            if (todayGridActive) {
                return rows.sort((a, b) =>
                    userDisplayName(getUser(a.userId), language).localeCompare(
                        userDisplayName(getUser(b.userId), language)
                    )
                );
            }
            return rows.sort((a, b) =>
                (b.date + (b.clockIn || '')).localeCompare(a.date + (a.clockIn || ''))
            );
        };
        return sortRowsByColumn(filteredRecords, sortBy, sortOrder, getSortValue, applyDefaultSort);
    }, [filteredRecords, sortBy, sortOrder, getUser, language, t, todayGridActive]);

    const storageSummary = useMemo(() => {
        let stored = 0;
        let preview = 0;
        for (const rec of filteredRecords) {
            if (isAttendanceGridPlaceholder(rec) || rec.persistedInDatabase === false) preview += 1;
            else stored += 1;
        }
        return { stored, preview, total: filteredRecords.length };
    }, [filteredRecords]);

    const listFilterActiveCount = useMemo(
        () =>
            countActiveFilters([
                { value: isDateRangeActive(dateRange) ? 'custom' : dateFilter, defaultValue: 'today' },
                { value: statusFilter, defaultValue: 'all' },
            ]) + countDateRangeFilters(dateRange),
        [dateFilter, dateRange, statusFilter]
    );

    const clearListFilters = useCallback(() => {
        setDateFilter('today');
        setDateRange(EMPTY_DATE_RANGE);
        setStatusFilter('all');
        resetSort();
    }, [resetSort]);

    const freezeMonthKeys = useMemo(
      () => records.map((rec) => rec.date.slice(0, 7)),
      [records]
    );
    const canLoadPayrollFreeze = canAccessFullPayrollModule(hasPermission, currentUser?.role);
    const { periodByMonth, anyReviewFrozen } = useAttendanceFreezePeriods(
      freezeMonthKeys,
      canLoadPayrollFreeze
    );

    const listFilterKey = `${search}|${dateFilter}|${dateRange.from}|${dateRange.to}|${statusFilter}|${sortBy}|${sortOrder}`;
    const {
        pageItems: paginatedRecords,
        currentPage,
        setCurrentPage,
        totalCount,
        totalPages,
        showingFrom,
        showingTo,
        pagesWindow,
    } = useClientPagination(sortedRecords, ATTENDANCE_PAGE_LIMIT, listFilterKey);

    const openMap = (loc?: { lat: number; lng: number }) => {
        if (!loc) return;
        window.open(mapsLink(loc.lat, loc.lng), '_blank');
    };

    const handleTimesSaved = useCallback(async () => {
        showToast('Attendance times updated', 'success');
        await load();
    }, [load, showToast]);

    const handleExport = useCallback(
      async (format: ExportFileExt) => {
        if (format !== 'csv' && format !== 'xlsx') return;
        const rows = filteredRecords
          .filter((rec) => !isAttendanceGridPlaceholder(rec) && rec.persistedInDatabase !== false)
          .map((rec) => {
            const code = userDisplayEmployeeCode(getUser(rec.userId));
            return {
              employeeId: code === '—' ? '' : code,
              employeeName: userDisplayName(getUser(rec.userId), language),
              date: String(rec.date ?? '').slice(0, 10),
              checkIn: attendanceTimeHmFromIso(rec.clockIn),
              checkOut: attendanceTimeHmFromIso(rec.clockOut),
              hours: rec.workHours != null && rec.workHours > 0 ? rec.workHours.toFixed(2) : '',
              location: rec.locationIn?.address?.trim() || '',
              status: String(effectiveAttendanceStatus(rec) ?? '').toUpperCase(),
              statusLabel: attendanceStatusLabel(effectiveAttendanceStatus(rec), t),
            };
          })
          .filter((row) => row.employeeId && row.date);

        try {
          await exportAttendanceList(format, rows, {
            reportTitle: t('attendance.list') || 'Attendance List',
            filters: [
              { label: 'Search', value: search.trim() || 'All employees' },
              {
                label: 'Date filter',
                value: isDateRangeActive(dateRange)
                  ? `${dateRange.from || '—'} to ${dateRange.to || '—'}`
                  : dateFilter,
              },
              {
                label: 'Status',
                value: statusFilter === 'all' ? 'All statuses' : statusFilter,
              },
            ],
          });
          showToast(t('attendance.exportSuccess', { count: rows.length }), 'success');
        } catch (e) {
          console.error(e);
          showToast(t('attendance.exportFailed'), 'error');
        }
      },
      [dateFilter, dateRange, filteredRecords, getUser, language, search, showToast, statusFilter, t]
    );

    const correctorDisplayName = useCallback(
        (userId?: string) => {
            if (!userId) return undefined;
            if (currentUser?.id === userId) return userDisplayName(currentUser, language);
            return userDisplayName(getUser(userId), language);
        },
        [currentUser, getUser]
    );

    const correctionMarkTitle = useCallback(
        (rec: AttendanceRecord) => {
            if (!rec.correctionAt) return '';
            const when = formatDateTimeDisplay(rec.correctionAt, rec.correctionAt);
            const by = correctorDisplayName(rec.correctionBy) || 'HR';
            const reason = rec.correctionReason?.trim();
            const summary = rec.correctionSummary?.trim();
            const parts = [`Corrected ${when} by ${by}`];
            if (summary) parts.push(summary.replace(/\s*\|\s*/g, '\n'));
            if (reason) parts.push(`Why: ${reason}`);
            return parts.join('\n');
        },
        [correctorDisplayName]
    );

    const frozenBannerPeriod = useMemo(() => {
      for (const period of periodByMonth.values()) {
        if (!period) continue;
        if (period.reviewFrozen || period.status === 'FINALIZED' || period.status === 'LOCKED') {
          return period;
        }
      }
      return null;
    }, [periodByMonth]);

    useEffect(() => {
      if (!onFreezeNotice) return;
      const message =
        anyReviewFrozen && frozenBannerPeriod ? freezeBannerMessage(frozenBannerPeriod) : null;
      onFreezeNotice(message);
      return () => onFreezeNotice(null);
    }, [anyReviewFrozen, frozenBannerPeriod, onFreezeNotice]);

    const tryEditRecord = useCallback(
      (rec: AttendanceRecord) => {
        if (isAttendanceRecordUpdateLocked(rec, periodByMonth)) {
          const month = rec.date.slice(0, 7);
          const period = periodByMonth.get(month);
          showToast(
            period
              ? freezeBannerMessage(period)
              : 'This attendance record is frozen for payroll review.',
            'info'
          );
          return;
        }
        setEditRecord(rec);
      },
      [periodByMonth, showToast]
    );

    return (
        <div className="space-y-4">
            <Card title={t('attendance.list') || 'Attendance List'} icon={<Clock className="w-5 h-5 text-blue-500" />} className="overflow-hidden border-slate-200 dark:border-slate-700 shadow-sm" help="attendance.adminList">
            <div className="px-6 pt-4 pb-2 border-b border-slate-100 dark:border-slate-700">
                <ListSearchFilterBar
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Search employee or date…"
                    leading={
                      <div className="flex items-center gap-2">
                        {canEditRecords ? (
                          <ListToolbarIconButton
                            onClick={() => setImportOpen(true)}
                            icon={<Upload className={listToolbarGlyphClass} />}
                            title={t('attendance.importAction')}
                            aria-label={t('attendance.importAction')}
                          />
                        ) : null}
                        <ExportFormatMenu
                          formats={['csv', 'xlsx']}
                          disabled={loading || filteredRecords.length === 0}
                          onExport={handleExport}
                          className={listToolbarIconPillClass}
                        />
                      </div>
                    }
                    filter={
                <PageFilterMenu activeCount={listFilterActiveCount} onClear={clearListFilters}>
                    <FilterMenuDateRange
                      from={dateRange.from}
                      to={dateRange.to}
                      onChange={setDateRange}
                      hint="Custom range overrides the presets below."
                    />
                    <FilterMenuSelect
                        label="Date range"
                        value={dateFilter}
                        onChange={(v) => setDateFilter(v as typeof dateFilter)}
                        options={[
                            { value: 'today', label: 'Today' },
                            { value: 'week', label: 'Last 7 days' },
                            { value: 'all', label: 'All records' },
                        ]}
                    />
                    <FilterMenuSelect
                        label="Status"
                        value={statusFilter}
                        onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                        options={[
                            { value: 'all', label: 'All statuses' },
                            { value: AttendanceStatus.PRESENT, label: 'Present' },
                            { value: AttendanceStatus.LATE, label: 'Late' },
                            { value: AttendanceStatus.ABSENT, label: 'Absent' },
                            { value: AttendanceStatus.DAY_OFF, label: 'Day off' },
                            { value: AttendanceStatus.PH, label: 'Public Holiday' },
                            { value: AttendanceStatus.MISSION, label: 'Mission' },
                            { value: AttendanceStatus.PAID_LEAVE, label: 'Paid leave' },
                            { value: AttendanceStatus.UNPAID_LEAVE, label: 'Unpaid leave' },
                        ]}
                    />
                </PageFilterMenu>
                    }
                    trailing={
                      <ListToolbarIconButton
                        onClick={() => void handleRefresh()}
                        icon={<RefreshCw className={listToolbarGlyphClass} />}
                        title={t('common.refresh') || 'Refresh'}
                        aria-label={t('common.refresh') || 'Refresh'}
                      />
                    }
                />
            </div>
            <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-700">
                {loading ? (
                    <LoadingState
                      variant="panel"
                      layout="list"
                      rows={5}
                      label={t('common.retrievingData')}
                    />
                ) : filteredRecords.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-slate-500">
                        No records match your filters.
                    </div>
                ) : (
                    paginatedRecords.map((rec) => {
                        const updateLocked = isAttendanceRecordUpdateLocked(rec, periodByMonth);
                        const canEdit =
                            !isAttendanceGridPlaceholder(rec) ||
                            effectiveAttendanceStatus(rec) === AttendanceStatus.ABSENT;
                        return (
                            <div
                                key={rec.id}
                                className={`p-3 space-y-2.5 ${
                                    rec.correctionAt
                                        ? 'bg-amber-50/50 dark:bg-amber-900/10 border-l-2 border-l-amber-400'
                                        : ''
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <EmployeeListIdentityBlock
                                        className="flex-1 min-w-0"
                                        data={employeeListIdentityFromUser(getUser(rec.userId))}
                                        compactOnMobile
                                    />
                                    {canEditRecords && canEdit ? (
                                        <ResponsiveRowActions
                                            mode="menu"
                                            menuLabel="Attendance actions"
                                            actions={[
                                                {
                                                    key: 'edit',
                                                    label: updateLocked
                                                        ? 'Frozen for payroll review'
                                                        : 'Edit',
                                                    icon: updateLocked ? (
                                                        <Lock className="w-4 h-4" />
                                                    ) : (
                                                        <Pencil className="w-4 h-4" />
                                                    ),
                                                    disabled: updateLocked,
                                                    onClick: () => tryEditRecord(rec),
                                                },
                                            ]}
                                        />
                                    ) : null}
                                </div>
                                <div className="min-w-0">
                                    <StatusLabel
                                        status={effectiveAttendanceStatus(rec) as AttendanceStatus}
                                        context="attendance"
                                        label={attendanceStatusLabel(effectiveAttendanceStatus(rec), t)}
                                        size="sm"
                                    />
                                </div>
                                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                                    <div>
                                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                            {t('attendance.date') || 'Date'}
                                        </dt>
                                        <dd className="mt-0.5 text-slate-700 dark:text-slate-200 tabular-nums">
                                            {formatDateOnlyDisplay(rec.date, rec.date)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                            Hours
                                        </dt>
                                        <dd className="mt-0.5 font-mono text-slate-700 dark:text-slate-200 tabular-nums">
                                            {rec.workHours != null && rec.workHours > 0
                                                ? rec.workHours.toFixed(2)
                                                : '—'}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                            {t('attendance.checkIn') || 'Check In'}
                                        </dt>
                                        <dd className="mt-0.5 font-mono text-slate-700 dark:text-slate-200">
                                            {formatAttendanceClockDisplay(rec.clockIn)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                            {t('attendance.checkOut') || 'Check Out'}
                                        </dt>
                                        <dd className="mt-0.5 font-mono text-slate-700 dark:text-slate-200">
                                            {rec.clockOut
                                                ? formatAttendanceClockDisplay(rec.clockOut)
                                                : '—'}
                                        </dd>
                                    </div>
                                </dl>
                                {rec.leaveTypeLabel ? (
                                    <p
                                        className={`text-[10px] font-semibold ${
                                            rec.leaveIsPaid === false
                                                ? 'text-amber-700 dark:text-amber-400'
                                                : 'text-sky-700 dark:text-sky-400'
                                        }`}
                                    >
                                        {rec.leaveTypeCode
                                            ? `${rec.leaveTypeCode} · ${rec.leaveTypeLabel}`
                                            : rec.leaveTypeLabel}
                                    </p>
                                ) : null}
                            </div>
                        );
                    })
                )}
            </div>

            <div className="hidden lg:block">
            <TableScroll>
                <table className="w-full text-sm text-left min-w-[36rem]">
                    <thead className="bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                            <SortableTableHeader
                              label="ID"
                              column="id"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('employees.table.employee') || 'Employee'}
                              column="employee"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('attendance.date') || 'Date'}
                              column="date"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('attendance.checkIn') || 'Check In'}
                              column="checkIn"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('attendance.checkOut') || 'Check Out'}
                              column="checkOut"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label="Hours"
                              column="hours"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('attendance.location') || 'Location'}
                              column="location"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <SortableTableHeader
                              label={t('common.status') || 'Status'}
                              column="status"
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onToggle={toggleSort}
                              className={attendanceListThClass}
                            />
                            <th className={`${attendanceListThClass} text-right`}>{t('common.actions') || 'Action'}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {loading ? (
                            <TableLoadingRow colSpan={9} label={t('common.retrievingData')} />
                        ) : filteredRecords.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                                    No records match your filters.
                                </td>
                            </tr>
                        ) : paginatedRecords.map(rec => (
                            <tr
                                key={rec.id}
                                className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${
                                    rec.correctionAt
                                      ? 'bg-amber-50/50 dark:bg-amber-900/10 border-l-2 border-l-amber-400'
                                      : ''
                                }`}
                            >
                                <EmployeeListIdentityCells
                                    data={employeeListIdentityFromUser(getUser(rec.userId))}
                                    idCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-xs sm:text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap"
                                    identityCellClassName="px-2 py-1.5 sm:px-3 sm:py-2 min-w-0 sm:min-w-[12rem]"
                                />
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">
                                  {formatDateOnlyDisplay(rec.date, rec.date)}
                                </td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-xs sm:text-sm text-slate-700 dark:text-slate-300" title={rec.clockIn ?? undefined}>
                                  <span className="inline-block bg-slate-50 dark:bg-slate-800/50 rounded-md px-1.5 py-0.5 border border-slate-100 dark:border-slate-700">
                                    {formatAttendanceClockDisplay(rec.clockIn)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-xs sm:text-sm text-slate-700 dark:text-slate-300">{rec.clockOut ? <span className="bg-slate-50 dark:bg-slate-800/50 rounded-md px-1.5 py-0.5 border border-slate-100 dark:border-slate-700" title={rec.clockOut}>{formatAttendanceClockDisplay(rec.clockOut)}</span> : '-'}</td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2 font-mono text-xs sm:text-sm text-slate-600 dark:text-slate-400 tabular-nums">
                                    {rec.workHours != null && rec.workHours > 0 ? rec.workHours.toFixed(2) : '—'}
                                </td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                                    {rec.locationIn ? (
                                        <ListIconButton
                                            label={t('common.viewMap') || 'View Map'}
                                            icon={<MapIcon className="w-4 h-4" />}
                                            onClick={() => openMap(rec.locationIn)}
                                        />
                                    ) : (
                                        <span className="text-slate-400 text-xs italic flex items-center gap-1"><MapPin className="w-3 h-3" /> {t('common.noData') || 'No Data'}</span>
                                    )}
                                </td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2">
                                    <div className="flex flex-col gap-1 items-start">
                                      <StatusLabel
                                        status={effectiveAttendanceStatus(rec) as AttendanceStatus}
                                        context="attendance"
                                        label={attendanceStatusLabel(effectiveAttendanceStatus(rec), t)}
                                        size="sm"
                                      />
                                      {rec.leaveTypeLabel ? (
                                        <span
                                          className={`text-[10px] font-semibold leading-tight ${
                                            rec.leaveIsPaid === false
                                              ? 'text-amber-700 dark:text-amber-400'
                                              : 'text-sky-700 dark:text-sky-400'
                                          }`}
                                          title={
                                            rec.leaveIsPaid === false
                                              ? t('attendance.leave.unpaidHint')
                                              : t('attendance.leave.paidHint')
                                          }
                                        >
                                          {rec.leaveTypeCode
                                            ? `${rec.leaveTypeCode} · ${rec.leaveTypeLabel}`
                                            : rec.leaveTypeLabel}
                                          {rec.leaveIsPaid === false
                                            ? ` (${t('attendance.leave.unpaid')})`
                                            : ` (${t('attendance.leave.paid')})`}
                                        </span>
                                      ) : null}
                                    </div>
                                </td>
                                <td className="px-2 py-1.5 sm:px-3 sm:py-2 text-right">
                                    <div className="inline-flex items-center justify-end gap-2">
                                        {rec.correctionAt ? (
                                            <span
                                                className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-700"
                                                title={correctionMarkTitle(rec)}
                                                aria-label="Times manually corrected"
                                            />
                                        ) : null}
                                        {!isAttendanceGridPlaceholder(rec) ||
                                        effectiveAttendanceStatus(rec) === AttendanceStatus.ABSENT ? (
                                        (() => {
                                          if (!canEditRecords) {
                                            return (
                                              <span className="text-xs text-slate-400 px-2" title="View only">
                                                —
                                              </span>
                                            );
                                          }
                                          const updateLocked = isAttendanceRecordUpdateLocked(rec, periodByMonth);
                                          return (
                                        <ResponsiveRowActions
                                            menuLabel="Attendance actions"
                                            actions={[
                                              {
                                                key: 'edit',
                                                label: updateLocked
                                                  ? 'Frozen for payroll review'
                                                  : 'Edit',
                                                icon: updateLocked ? (
                                                  <Lock className="w-4 h-4" />
                                                ) : (
                                                  <Pencil className="w-4 h-4" />
                                                ),
                                                disabled: updateLocked,
                                                onClick: () => tryEditRecord(rec),
                                              },
                                            ]}
                                        />
                                          );
                                        })()
                                        ) : (
                                            <span className="text-xs text-slate-400 px-2" title="Clock in creates the record; then times can be edited">
                                                —
                                            </span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableScroll>
            </div>
            {!loading && storageSummary.total > 0 ? (
                <p className="px-4 sm:px-6 pb-2 text-xs text-slate-500 dark:text-slate-400">
                    {storageSummary.stored} saved in database
                    {storageSummary.preview > 0
                      ? ` · ${storageSummary.preview} unsaved placeholder row(s)`
                      : ''}
                </p>
            ) : null}
            {!loading && (
                <ListPagination
                    from={showingFrom}
                    to={showingTo}
                    total={totalCount}
                    itemLabel="records"
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pagesWindow={pagesWindow}
                    onPageChange={setCurrentPage}
                    className="px-4 sm:px-6"
                    hideWhenEmpty={false}
                />
            )}
        </Card>

            <AttendanceTimesEditModal
                isOpen={!!editRecord && canEditRecords}
                onClose={() => setEditRecord(null)}
                record={editRecord}
                employeeName={userDisplayName(getUser(editRecord?.userId ?? ''), language)}
                correctorName={correctorDisplayName(editRecord?.correctionBy)}
                onSaved={handleTimesSaved}
            />
            {canEditRecords ? (
              <AttendanceImportModal
                isOpen={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={handleRefresh}
              />
            ) : null}
        </div>
    );
};

export const Attendance: React.FC = () => {
    const routeMeta = useRoutePageMeta();
    useSyncDocumentTitle(routeMeta?.title);
    const { hasPermission } = useAuth();
    const { t } = useLanguage();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const selfService = isSelfServiceScope(searchParams);
    const manageScope = isManageScope(searchParams);
    const [freezeNotice, setFreezeNotice] = useState<string | null>(null);
    const handleFreezeNotice = useCallback((message: string | null) => {
      setFreezeNotice(message);
    }, []);

    /** Matrix Grant/Deny — do not OR with hasRole (Admin always matches hasRole). */
    const canManage = hasPermission(PERM.ATTENDANCE_MANAGE);
    const canViewTeam =
      hasPermission(PERM.ATTENDANCE_VIEW) || canManage;
    const canView = canViewTeam || selfService;
    const isTeamView = manageScope && canViewTeam;

    type ViewMode = 'my' | 'history' | 'list' | 'tracking' | 'settings';
    const [viewMode, setViewMode] = useState<ViewMode>(manageScope ? 'list' : 'my');

    useEffect(() => {
        const tab = searchParams.get('tab');
        const qrToken = parseAttendanceQrToken(
          searchParams.get('t') || searchParams.get('token') || ''
        );
        if (qrToken) {
          navigate(`/attendance/scan?t=${encodeURIComponent(qrToken)}`, { replace: true });
          return;
        }
        if (selfService) {
          if (tab === 'record') {
            navigate('/attendance/scan', { replace: true });
            return;
          }
          if (tab === 'register') {
            navigate('/attendance?scope=manage&tab=settings&settingsTab=rules', {
              replace: true,
            });
            return;
          }
          if (tab === 'history') {
            setViewMode('history');
            return;
          }
          if (tab && tab !== 'my') {
            navigate('/attendance?scope=self', { replace: true });
            return;
          }
          setViewMode('my');
          return;
        }
        if (manageScope && canViewTeam) {
          if (tab === 'qr') {
            navigate('/settings?tab=qr', { replace: true });
            return;
          }
          if (tab === 'register') {
            if (!canManage) {
              navigate('/attendance?scope=manage&tab=list', { replace: true });
              return;
            }
            navigate('/attendance?scope=manage&tab=settings&settingsTab=rules', {
              replace: true,
            });
            return;
          }
          if (tab === 'settings') {
            if (!canManage) {
              navigate('/attendance?scope=manage&tab=list', { replace: true });
              return;
            }
            const settingsTab = searchParams.get('settingsTab');
            if (settingsTab === 'office' || settingsTab === 'qr') {
              navigate(`/settings?tab=${settingsTab}`, { replace: true });
              return;
            }
          }
          const valid = canManage
            ? ['list', 'tracking', 'settings']
            : ['list', 'tracking'];
          if (!tab || !valid.includes(tab)) {
            navigate('/attendance?scope=manage&tab=list', { replace: true });
            return;
          }
          setViewMode(tab as ViewMode);
        }
    }, [selfService, manageScope, canViewTeam, canManage, searchParams, navigate]);

    if (!canView) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
                <ShieldOff className="w-14 h-14 text-slate-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Access restricted</h2>
                <p className="text-slate-500 dark:text-slate-400 mt-2">You do not have permission to view attendance.</p>
            </div>
        );
    }

    if (manageScope && !canViewTeam) {
        return <Navigate to="/attendance?scope=self" replace />;
    }

    const managePageHeader = manageScope && canViewTeam && !selfService ? routeMeta : null;

    return (
        <PageShell className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            {managePageHeader && (
              <PageHeader
                title={managePageHeader.title}
                subtitle={managePageHeader.subtitle}
                iconComponent={managePageHeader.icon}
                notice={viewMode === 'list' ? freezeNotice : null}
              />
            )}
            {selfService && (viewMode === 'my' || viewMode === 'history') && (
              <MyAttendance tab={viewMode === 'history' ? 'history' : 'my'} />
            )}
            {isTeamView && viewMode === 'list' && (
              <AttendanceManagement
                onFreezeNotice={handleFreezeNotice}
                canEditRecords={canManage}
              />
            )}
            {isTeamView && viewMode === 'tracking' && (
              <Suspense fallback={null}>
                <AttendanceLeaderboardView />
              </Suspense>
            )}
            {isTeamView && canManage && viewMode === 'settings' && (
              <Suspense fallback={null}>
                <AttendanceGeofenceSettings />
              </Suspense>
            )}
        </PageShell>
    );
};