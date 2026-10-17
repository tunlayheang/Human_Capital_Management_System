import React, { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../../hooks/useWorkspaceTabCache';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { LoadingState } from '../common/LoadingState';
import {
  DEFAULT_ATTENDANCE_RULES,
  normalizeAttendanceClockRules,
  newOfficeZone,
  type AttendanceClockRules,
  type AttendanceSettingsPayload,
  type OfficeLocationZone,
} from '../../types/attendance';
import { DEFAULT_GEOFENCE_RADIUS_M } from '../../utils/attendanceGeo';
import { OfficeGeofenceMapPicker } from './OfficeGeofenceMapPicker';
import {
  Building2,
  Clock,
  Crosshair,
  Edit2,
  MapPin,
  Save,
  Shield,
  MapPinned,
  X,
} from 'lucide-react';
import { NumericField } from '../ui/NumericField';
import { useAuth } from '../../context/AuthContext';
import { PERM } from '../../constants/permissionKeys';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import {
  bumpAttendanceRulesRevision,
  clearWorkspaceTabSlotAcrossTabs,
} from '../../utils/workspaceTabStateStore';
import { invalidateApiCache } from '../../services/apiCache';

const QrGenerator = lazy(() =>
  import('./QrGenerator').then((m) => ({ default: m.QrGenerator }))
);

type SettingsTab = 'rules' | 'office' | 'qr';

const STANDALONE_SETTINGS_TABS = new Set<SettingsTab>(['qr']);

function parseSettingsTab(value: string | null): SettingsTab {
  if (value === 'office' || value === 'qr') return value;
  return 'rules';
}

type AttendanceGeofenceSettingsProps = {
  /** When set (e.g. from Administration → Settings), ignore attendance URL tabs. */
  forcedTab?: SettingsTab;
};

const DEFAULT_OFFICE = newOfficeZone({ id: 'off-main', name: 'Main Office' });

function parseOfficeRow(o: unknown): OfficeLocationZone | null {
  const x = (o ?? {}) as Record<string, unknown>;
  const name = String(x.name ?? '').trim();
  if (!name) return null;
  return newOfficeZone({
    id: String(x.id ?? 'off-main').trim() || 'off-main',
    name,
    address: x.address ? String(x.address) : undefined,
    latitude: Number(x.latitude),
    longitude: Number(x.longitude),
    radiusMeters: Number(x.radiusMeters) || DEFAULT_GEOFENCE_RADIUS_M,
    workingHoursStart: String(x.workingHoursStart ?? '08:00'),
    workingHoursEnd: String(x.workingHoursEnd ?? '17:00'),
    isActive: x.isActive !== false,
  });
}

function normalizeSettings(raw: unknown): AttendanceSettingsPayload & { office: OfficeLocationZone } {
  const row = (raw ?? {}) as Record<string, unknown>;

  let office: OfficeLocationZone | null = null;

  if (Array.isArray(row.offices) && row.offices.length) {
    office = parseOfficeRow(row.offices[0]);
  }

  if (!office) {
    const legacyName = String(row.name ?? '').trim();
    if (legacyName) {
      office = newOfficeZone({
        id: String(row.officeId ?? 'off-main'),
        name: legacyName,
        address: row.address ? String(row.address) : undefined,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        radiusMeters: Number(row.radiusMeters) || DEFAULT_GEOFENCE_RADIUS_M,
        workingHoursStart: String(row.workingHoursStart ?? '08:00'),
        workingHoursEnd: String(row.workingHoursEnd ?? '17:00'),
      });
    }
  }

  if (!office) {
    office = { ...DEFAULT_OFFICE };
  }

  const rules = normalizeAttendanceClockRules(
    (row.rules as Partial<AttendanceClockRules>) || {},
    office.workingHoursStart
  );

  return { rules, offices: [office], office };
}

const AttendanceGeofenceSettings: React.FC<AttendanceGeofenceSettingsProps> = ({
  forcedTab,
}) => {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(PERM.ATTENDANCE_MANAGE);
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<AttendanceClockRules>({ ...DEFAULT_ATTENDANCE_RULES });
  const [savedRules, setSavedRules] = useState<AttendanceClockRules>({ ...DEFAULT_ATTENDANCE_RULES });
  const [office, setOffice] = useState<OfficeLocationZone>({ ...DEFAULT_OFFICE });
  const [savedOffice, setSavedOffice] = useState<OfficeLocationZone>({ ...DEFAULT_OFFICE });
  const [gpsLoading, setGpsLoading] = useState(false);
  const [editingRulesLocation, setEditingRulesLocation] = useState(false);
  const [editingRulesLateness, setEditingRulesLateness] = useState(false);
  const [editingOfficeGeofence, setEditingOfficeGeofence] = useState(false);
  const [editingOfficeMap, setEditingOfficeMap] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() =>
    forcedTab ?? parseSettingsTab(searchParams.get('settingsTab'))
  );

  const isAnyEditing =
    editingRulesLocation ||
    editingRulesLateness ||
    editingOfficeGeofence ||
    editingOfficeMap;
  const canSave = canEdit && isAnyEditing;
  const hasUnsavedEdits =
    isAnyEditing &&
    (JSON.stringify(rules) !== JSON.stringify(savedRules) ||
      JSON.stringify(office) !== JSON.stringify(savedOffice));
  const { ConfirmDialogHost: UnsavedChangesDialogHost, confirmDiscardIfDirty } =
    useUnsavedChangesGuard({
      isDirty: hasUnsavedEdits,
    });

  const clearEditModes = useCallback(() => {
    setEditingRulesLocation(false);
    setEditingRulesLateness(false);
    setEditingOfficeGeofence(false);
    setEditingOfficeMap(false);
  }, []);

  useEffect(() => {
    if (forcedTab) {
      setSettingsTab((prev) => {
        if (prev !== forcedTab) {
          setRules(savedRules);
          setOffice(savedOffice);
          clearEditModes();
        }
        return forcedTab;
      });
      return;
    }
    const parsed = parseSettingsTab(searchParams.get('settingsTab'));
    setSettingsTab((prev) => {
      if (prev !== parsed) {
        setRules(savedRules);
        setOffice(savedOffice);
        clearEditModes();
      }
      return parsed;
    });
    // Keep settingsTab in the URL so sidebar children highlight correctly.
    if (searchParams.get('settingsTab') !== parsed) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('settingsTab', parsed);
          return next;
        },
        { replace: true }
      );
    }
  }, [forcedTab, searchParams, setSearchParams, savedRules, savedOffice, clearEditModes]);

  const tabCache = useWorkspaceTabCache<{
    rules: AttendanceClockRules;
    office: OfficeLocationZone;
    settingsTab: SettingsTab;
  }>({
    slot: 'attendance-settings-v1',
    cacheKey: forcedTab ? `settings-${forcedTab}` : 'settings',
    getSnapshot: () => ({ rules, office, settingsTab }),
    applySnapshot: (cached) => {
      setRules(cached.rules);
      setSavedRules(cached.rules);
      setOffice(cached.office);
      setSavedOffice(cached.office);
      setSettingsTab(forcedTab ?? parseSettingsTab(cached.settingsTab ?? null));
      setLoading(false);
    },
    shouldPersist: (cached) => Boolean(cached.office?.name?.trim()),
    persistDeps: [rules, office, settingsTab],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const data = await Api.attendance.getSettings();
      const normalized = normalizeSettings(data);
      setRules(normalized.rules);
      setSavedRules(normalized.rules);
      setOffice(normalized.office);
      setSavedOffice(normalized.office);
    } catch (e) {
      console.error(e);
      if (!opts?.background) showToast('Failed to load attendance settings', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [showToast]);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  const patchOffice = (partial: Partial<OfficeLocationZone>) => {
    setOffice((current) => ({ ...current, ...partial }));
  };

  const useMyLocation = () => {
    if (!editingOfficeGeofence && !editingOfficeMap) return;
    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        patchOffice({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        });
        showToast('Office point set from your GPS.', 'success');
        setGpsLoading(false);
      },
      () => {
        showToast('Could not read GPS for office point.', 'error');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const cancelRulesLocation = () => {
    void (async () => {
      if (!(await confirmDiscardIfDirty())) return;
      setRules((current) =>
        normalizeAttendanceClockRules(
          {
            ...current,
            requireGps: savedRules.requireGps,
            requireInZoneToClockIn: savedRules.requireInZoneToClockIn,
            requireInZoneToClockOut: savedRules.requireInZoneToClockOut,
            requireGpsOnClockOut: savedRules.requireGpsOnClockOut,
          },
          office.workingHoursStart
        )
      );
      setEditingRulesLocation(false);
    })();
  };

  const cancelRulesLateness = () => {
    void (async () => {
      if (!(await confirmDiscardIfDirty())) return;
      setRules((current) =>
        normalizeAttendanceClockRules(
          {
            ...current,
            gracePeriodMinutes: savedRules.gracePeriodMinutes,
          },
          office.workingHoursStart
        )
      );
      setEditingRulesLateness(false);
    })();
  };

  const patchRules = (partial: Partial<AttendanceClockRules>) => {
    setRules((current) =>
      normalizeAttendanceClockRules({ ...current, ...partial }, office.workingHoursStart)
    );
  };

  const cancelOfficeGeofence = () => {
    void (async () => {
      if (!(await confirmDiscardIfDirty())) return;
      setOffice(savedOffice);
      setEditingOfficeGeofence(false);
    })();
  };

  const cancelOfficeMap = () => {
    void (async () => {
      if (!(await confirmDiscardIfDirty())) return;
      setOffice(savedOffice);
      setEditingOfficeMap(false);
    })();
  };

  const handleSave = async () => {
    if (!office.name.trim()) {
      showToast('Office name is required', 'warning');
      return;
    }
    setSaving(true);
    try {
      const rulesToSave = normalizeAttendanceClockRules(rules, office.workingHoursStart);
      const saved = await Api.attendance.updateSettings({
        rules: rulesToSave,
        offices: [
          {
            id: office.id.startsWith('new-') ? '' : office.id,
            name: office.name.trim(),
            address: office.address?.trim() || '',
            latitude: office.latitude,
            longitude: office.longitude,
            radiusMeters: office.radiusMeters,
            workingHoursStart: office.workingHoursStart,
            workingHoursEnd: office.workingHoursEnd,
            isActive: true,
          },
        ],
      });
      const normalized = normalizeSettings(saved);
      setRules(normalized.rules);
      setSavedRules(normalized.rules);
      setOffice(normalized.office);
      setSavedOffice(normalized.office);
      clearEditModes();
      // Drop stale self-service cache so CLOCK IN/OUT honor the new rules immediately.
      clearWorkspaceTabSlotAcrossTabs('attendance-self-v1');
      invalidateApiCache('/attendance');
      bumpAttendanceRulesRevision();
      showToast('Attendance location and rules saved. Changes apply to clock actions now.', 'success');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-4">
      <UnsavedChangesDialogHost />

      {loading && !STANDALONE_SETTINGS_TABS.has(settingsTab) ? (
        <LoadingState variant="panel" layout="form" label="Loading settings…" />
      ) : null}

      {!loading && settingsTab === 'rules' ? (
        <div className="space-y-6">
          <Card
            title="Clock-in / clock-out rules"
            icon={<Shield className="w-5 h-5 text-amber-600" />}
            className="shadow-sm"
            help="attendance.clockRules"
          >
            <div className="space-y-8">
              <div
                className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-4 sm:p-5 ${
                  editingRulesLocation ? 'ring-2 ring-primary-500/20' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPinned className="w-4 h-4 text-primary-600 shrink-0" aria-hidden />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Location & GPS enforcement
                    </h4>
                  </div>
                  <SettingsSectionEditControls
                    canEdit={canEdit}
                    isEditing={editingRulesLocation}
                    onEdit={() => setEditingRulesLocation(true)}
                    onCancel={cancelRulesLocation}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <RuleToggle
                    label="Require GPS to clock in"
                    description="Employee must share location when checking in."
                    checked={rules.requireGps}
                    disabled={!editingRulesLocation}
                    onChange={(v) => patchRules({ requireGps: v })}
                  />
                  <RuleToggle
                    label="Must be inside zone to clock in"
                    description="Block clock-in unless GPS is inside the office geofence."
                    checked={rules.requireInZoneToClockIn}
                    disabled={!editingRulesLocation}
                    onChange={(v) => patchRules({ requireInZoneToClockIn: v })}
                  />
                  <RuleToggle
                    label="Require GPS to clock out"
                    description="Record location when leaving."
                    checked={rules.requireGpsOnClockOut}
                    disabled={!editingRulesLocation}
                    onChange={(v) => patchRules({ requireGpsOnClockOut: v })}
                  />
                  <RuleToggle
                    label="Must be inside zone to clock out"
                    description={
                      rules.requireInZoneToClockOut
                        ? 'Block clock-out unless GPS is still inside the office geofence.'
                        : 'Off — allow clock-out when leaving the building.'
                    }
                    checked={rules.requireInZoneToClockOut}
                    disabled={!editingRulesLocation}
                    onChange={(v) => patchRules({ requireInZoneToClockOut: v })}
                  />
                </div>
              </div>

              <div
                className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-4 sm:p-5 ${
                  editingRulesLateness ? 'ring-2 ring-primary-500/20' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary-600 shrink-0" aria-hidden />
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        Lateness policy
                      </h4>
                    </div>
                  </div>
                  <SettingsSectionEditControls
                    canEdit={canEdit}
                    isEditing={editingRulesLateness}
                    onEdit={() => setEditingRulesLateness(true)}
                    onCancel={cancelRulesLateness}
                  />
                </div>
                <div className="max-w-sm">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Grace period (minutes)
                  </label>
                  <NumericField
                    kind="integer"
                    filterOptions={{ maxLength: 3 }}
                    value={rules.gracePeriodMinutes}
                    disabled={!editingRulesLateness}
                    onValueChange={(v) =>
                      setRules((r) =>
                        normalizeAttendanceClockRules(
                          {
                            ...r,
                            gracePeriodMinutes: parseInt(v, 10) || 0,
                          },
                          office.workingHoursStart
                        )
                      )
                    }
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-base font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {!loading && settingsTab === 'office' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-w-0">
            <Card
              title="Office geofence"
              icon={<Building2 className="w-5 h-5 text-primary-600" />}
              help="attendance.officeGeofence"
              className={editingOfficeGeofence ? 'ring-2 ring-primary-500/20' : ''}
              action={
                <SettingsSectionEditControls
                  canEdit={canEdit}
                  isEditing={editingOfficeGeofence}
                  onEdit={() => setEditingOfficeGeofence(true)}
                  onCancel={cancelOfficeGeofence}
                />
              }
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Office name
                  </label>
                  <input
                    value={office.name}
                    onChange={(e) => patchOffice({ name: e.target.value })}
                    disabled={!editingOfficeGeofence}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Address (optional)
                  </label>
                  <input
                    value={office.address || ''}
                    onChange={(e) => patchOffice({ address: e.target.value })}
                    disabled={!editingOfficeGeofence}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="responsive-form-grid gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Latitude
                    </label>
                    <NumericField
                      kind="decimal"
                      filterOptions={{ maxDecimals: 7 }}
                      value={office.latitude}
                      disabled={!editingOfficeGeofence}
                      onValueChange={(v) =>
                        patchOffice({
                          latitude: parseFloat(v) || 0,
                        })
                      }
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-sm font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                      Longitude
                    </label>
                    <NumericField
                      kind="decimal"
                      filterOptions={{ maxDecimals: 7 }}
                      value={office.longitude}
                      disabled={!editingOfficeGeofence}
                      onValueChange={(v) =>
                        patchOffice({
                          longitude: parseFloat(v) || 0,
                        })
                      }
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200/90 dark:border-slate-600/75 hcms-glass-input text-sm font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Zone radius
                    </label>
                    <span className="text-xs font-bold text-primary-600">{office.radiusMeters}m</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={500}
                    step={5}
                    value={office.radiusMeters}
                    disabled={!editingOfficeGeofence}
                    onChange={(e) =>
                      patchOffice({
                        radiusMeters: parseInt(e.target.value, 10),
                      })
                    }
                    className="w-full accent-primary-600 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <Button
                  variant="outline"
                  icon={<Crosshair className="w-4 h-4" />}
                  onClick={useMyLocation}
                  isLoading={gpsLoading}
                  disabled={gpsLoading || (!editingOfficeGeofence && !editingOfficeMap)}
                >
                  Use my GPS for office point
                </Button>
              </div>
            </Card>

            <Card
              title="Zone preview"
              icon={<MapPin className="w-5 h-5 text-rose-500" />}
              className={editingOfficeMap ? 'ring-2 ring-primary-500/20' : ''}
              help="attendance.zonePreview"
              action={
                <SettingsSectionEditControls
                  canEdit={canEdit}
                  isEditing={editingOfficeMap}
                  onEdit={() => setEditingOfficeMap(true)}
                  onCancel={cancelOfficeMap}
                />
              }
            >
              <OfficeGeofenceMapPicker
                key={office.id}
                latitude={office.latitude}
                longitude={office.longitude}
                radiusMeters={office.radiusMeters}
                name={office.name}
                className="h-64 min-h-[16rem]"
                interactive={editingOfficeMap}
                onLocationChange={(lat, lng) => patchOffice({ latitude: lat, longitude: lng })}
              />
            </Card>
          </div>
        </div>
      ) : null}

      {settingsTab === 'qr' ? (
        <Suspense fallback={<LoadingState variant="panel" layout="form" label="Loading QR generator…" />}>
          <QrGenerator />
        </Suspense>
      ) : null}

      {!loading && !STANDALONE_SETTINGS_TABS.has(settingsTab) ? (
      <div className="sticky bottom-0 z-10 -mx-1 px-1 pt-2 pb-1 hcms-sticky-footer rounded-t-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 surface-card px-5 py-4 shadow-lg">
          {!canSave && canEdit ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 sm:mr-auto text-center sm:text-left">
              Click Edit on a section to make changes.
            </p>
          ) : null}
          <Button
            icon={<Save className="w-4 h-4" />}
            onClick={handleSave}
            isLoading={saving}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            Save attendance settings
          </Button>
        </div>
      </div>
      ) : null}
    </div>
  );
};

function SettingsSectionEditControls({
  canEdit,
  isEditing,
  onEdit,
  onCancel,
}: {
  canEdit: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  if (!canEdit) return null;

  if (!isEditing) {
    return (
      <Button
        variant="outline"
        size="sm"
        icon={<Edit2 className="w-3.5 h-3.5" />}
        onClick={onEdit}
        className="w-auto shrink-0 self-start"
      >
        Edit
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<X className="w-3.5 h-3.5" />}
      onClick={onCancel}
      className="w-auto shrink-0 self-start"
    >
      Cancel
    </Button>
  );
}

function RuleToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 p-4 rounded-xl border-2 transition-colors ${
        disabled ? 'cursor-default opacity-80' : 'cursor-pointer'
      } ${
        checked
          ? 'border-primary-400 bg-primary-50/70 dark:border-primary-600 dark:bg-primary-950/40 shadow-sm'
          : `border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50${
              disabled ? '' : ' hover:border-slate-300 dark:hover:border-slate-600'
            }`
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 rounded-md border-slate-300 text-primary-600 focus:ring-primary-500 shrink-0 disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{label}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{description}</span>
      </span>
    </label>
  );
}

export default AttendanceGeofenceSettings;
