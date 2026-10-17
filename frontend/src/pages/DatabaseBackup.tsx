import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useWorkspaceTabCache,
  useWorkspaceTabMountLoad,
  type WorkspaceLoadOptions,
} from '../hooks/useWorkspaceTabCache';
import { useUrlSyncedTab } from '../hooks/useUrlSyncedTab';
import { useRoutePageMeta, useSyncDocumentTitle } from '../hooks/useRoutePageMeta';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLanguage } from '../context/LanguageContext';
import { Api } from '../services/api';
import { clearPortalSessionStorage } from '../utils/portalSession';
import { isAdminRole } from '../utils/adminNavScope';
import { PageShell, PageHeader, UnderlineTabs } from '../components/ui/page';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingState } from '../components/common/LoadingState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CloudUpload,
  Clock,
  DatabaseBackup,
  Download,
  FileText,
  HardDrive,
  HardDriveDownload,
  Loader2,
  Mail,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { NumericField } from '../components/ui/NumericField';
import { todayYmdInCompanyTz } from '../utils/companyCalendar';
import { useStickyActionBarActive } from '../hooks/useStickyActionBarActive';
import { ensureWizardFooterRoot } from '../utils/overlayPortal';
import { Department } from '../types';
import { WizardField, WIZARD_SELECT_CLASS } from '../components/employee-wizard/wizardLayout';
import { resolveDepartmentDisplayName } from '../utils/localizedEntityLabel';
import {
  sortRowsByColumn,
  SortableTableHeader,
  useListColumnSort,
} from '../utils/listColumnSort';

type BackupRow = {
  id: string;
  fileName: string;
  type: 'manual' | 'auto';
  sizeBytes: number;
  sizeLabel: string;
  createdBy: string;
  createdAt: string;
};

type BackupSummary = {
  totalBackups: number;
  totalSizeBytes: number;
  totalSizeLabel: string;
  oldestBackupAt: string | null;
  latestBackupAt: string | null;
};

type BackupFrequency = 'daily' | 'weekly' | 'monthly';
type BackupRunStatus = 'successful' | 'failed' | 'never';

type BackupSettings = {
  autoBackupEnabled: boolean;
  retentionDays: number;
  autoBackupHour: number;
  frequency: BackupFrequency;
  weeklyDays: number[];
  monthlyDay: number;
  notifyOnFailure: boolean;
  storageDestination: 'local';
  departmentId: string | null;
};

type BackupStatus = {
  lastAutomaticBackupAt: string | null;
  lastAutomaticBackupStatus: BackupRunStatus;
  nextScheduledBackupAt: string | null;
  automaticBackupsStored: number;
  currentStorage: 'local';
  storageLabel: string;
};

type BackupPayload = {
  backups: BackupRow[];
  summary: BackupSummary;
  settings: BackupSettings;
  status?: BackupStatus;
};

const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  autoBackupEnabled: false,
  retentionDays: 30,
  autoBackupHour: 18,
  frequency: 'daily',
  weeklyDays: [1],
  monthlyDay: 1,
  notifyOnFailure: true,
  storageDestination: 'local',
  departmentId: null,
};

const WEEKDAY_OPTIONS = [
  { value: 0, key: 'weekdaySun', fallback: 'Sun' },
  { value: 1, key: 'weekdayMon', fallback: 'Mon' },
  { value: 2, key: 'weekdayTue', fallback: 'Tue' },
  { value: 3, key: 'weekdayWed', fallback: 'Wed' },
  { value: 4, key: 'weekdayThu', fallback: 'Thu' },
  { value: 5, key: 'weekdayFri', fallback: 'Fri' },
  { value: 6, key: 'weekdaySat', fallback: 'Sat' },
] as const;

const formatPreferredHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const parseRetentionDaysInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const settingsEqual = (a: BackupSettings, b: BackupSettings): boolean =>
  a.autoBackupEnabled === b.autoBackupEnabled &&
  a.retentionDays === b.retentionDays &&
  a.autoBackupHour === b.autoBackupHour &&
  a.frequency === b.frequency &&
  a.monthlyDay === b.monthlyDay &&
  a.notifyOnFailure === b.notifyOnFailure &&
  a.departmentId === b.departmentId &&
  a.weeklyDays.length === b.weeklyDays.length &&
  a.weeklyDays.every((day, index) => day === b.weeklyDays[index]);

const ReadOnlySettingRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,10rem)_1fr] gap-1 sm:gap-4 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
    <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="text-sm font-medium text-slate-900 dark:text-white">{value}</dd>
  </div>
);

const TAB_VALUES = ['backup', 'settings'] as const;
type BackupTab = (typeof TAB_VALUES)[number];
type BackupSortCol = 'fileName' | 'type' | 'size' | 'createdBy' | 'createdAt';

const backupListThClass =
  'px-2 py-2 sm:px-3 text-[10px] uppercase tracking-wide text-slate-500 font-semibold';

const formatDisplayDate = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatBackupSizeClient = (bytes: number): string => {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const backupTypeLabel = (
  backup: BackupRow,
  t: (key: string) => string | undefined
): { label: string; variant: 'success' | 'info' | 'warning' } => {
  if (/pre-restore/i.test(backup.fileName)) {
    return { label: t('settingsBackup.typeSafety') || 'Safety', variant: 'warning' };
  }
  if (/scheduled/i.test(backup.fileName) || backup.createdBy === 'Scheduled') {
    return { label: t('settingsBackup.typeScheduled') || 'Scheduled', variant: 'info' };
  }
  if (backup.type === 'manual') {
    return { label: t('settingsBackup.typeManual') || 'Manual', variant: 'success' };
  }
  return { label: t('settingsBackup.typeAuto') || 'Auto', variant: 'info' };
};

const ActivityStatusIcon: React.FC<{ status?: BackupRunStatus }> = ({ status }) => {
  if (status === 'successful') {
    return <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === 'failed') {
    return <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
  }
  return <DatabaseBackup className="w-5 h-5 text-primary-600" />;
};

const DatabaseBackupPage: React.FC = () => {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { user } = useAuth();
  const canEdit = isAdminRole(user?.role);
  const routeMeta = useRoutePageMeta();
  useSyncDocumentTitle(routeMeta?.title);

  const [activeTab, setActiveTab] = useUrlSyncedTab<BackupTab>({
    values: TAB_VALUES,
    defaultValue: 'backup',
    param: 'section',
  });

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [data, setData] = useState<BackupPayload | null>(null);
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [footerRoot, setFooterRoot] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? ensureWizardFooterRoot() : null
  );
  const settingsFooterRef = useStickyActionBarActive(activeTab === 'settings');
  const [settingsDraft, setSettingsDraft] = useState<BackupSettings | null>(null);
  const [retentionDaysInput, setRetentionDaysInput] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleting, setDeleting] = useState(false);
  const [confirmState, setConfirmState] = useState<
    | { kind: 'create' }
    | { kind: 'restore-existing'; backup: BackupRow }
    | { kind: 'restore-upload' }
    | { kind: 'delete'; backup: BackupRow }
    | null
  >(null);

  const tabCache = useWorkspaceTabCache<BackupPayload>({
    slot: 'settings-backup-v2',
    getSnapshot: () =>
      data ?? {
        backups: [],
        summary: {
          totalBackups: 0,
          totalSizeBytes: 0,
          totalSizeLabel: '0 B',
          oldestBackupAt: null,
          latestBackupAt: null,
        },
        settings: settingsDraft ?? DEFAULT_BACKUP_SETTINGS,
      },
    applySnapshot: (cached) => {
      setData(cached);
      setSettingsDraft(cached.settings);
      setRetentionDaysInput(String(cached.settings.retentionDays));
      setLoading(false);
    },
    shouldPersist: (cached) => cached.backups.length > 0,
    persistDeps: [data, settingsDraft],
  });

  const load = useCallback(async (opts?: WorkspaceLoadOptions) => {
    if (!opts?.background) setLoading(true);
    try {
      const payload = (await Api.system.getBackups()) as BackupPayload;
      setData(payload);
      if (!settingsEditing) {
        const nextSettings = {
          ...DEFAULT_BACKUP_SETTINGS,
          ...payload.settings,
          departmentId: payload.settings?.departmentId ?? null,
        };
        setSettingsDraft(nextSettings);
        setRetentionDaysInput(String(nextSettings.retentionDays));
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load backups', 'error');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [showToast, settingsEditing]);

  useWorkspaceTabMountLoad(load, [load], tabCache);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    let cancelled = false;
    void (async () => {
      try {
        const list = (await Api.departments.getAll({ activeOnly: true })) as Department[];
        if (!cancelled) setDepartments(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setDepartments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useLayoutEffect(() => {
    setFooterRoot(ensureWizardFooterRoot());
  }, []);

  const handleCreateBackup = async (effectiveFrom?: string) => {
    setCreating(true);
    try {
      await Api.system.createBackup(
        effectiveFrom ? { effectiveFrom: effectiveFrom.trim().slice(0, 10) } : undefined
      );
      showToast(t('settingsBackup.createSuccess') || 'Backup created successfully', 'success');
      setConfirmState(null);
      await load({ background: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Backup failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (backup: BackupRow) => {
    try {
      const blob = await Api.system.downloadBackup(backup.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backup.fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast(t('settingsBackup.downloadSuccess') || 'Download started', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Download failed', 'error');
    }
  };

  const handleDelete = async (backup: BackupRow) => {
    setDeleting(true);
    try {
      await Api.system.deleteBackup(backup.id);
      showToast(t('settingsBackup.deleteSuccess') || 'Backup deleted', 'success');
      setConfirmState(null);
      await load({ background: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreExisting = async (backup: BackupRow) => {
    setRestoring(true);
    showToast(t('settingsBackup.restoreInProgress'), 'info');
    try {
      const result = (await Api.system.restoreBackup(backup.id)) as {
        safetyBackupFileName?: string;
      };
      const safetyName = result?.safetyBackupFileName;
      showToast(
        safetyName
          ? t('settingsBackup.restoreSuccessWithSafety', { name: safetyName })
          : t('settingsBackup.restoreSuccess'),
        'success'
      );
      setConfirmState(null);
      clearPortalSessionStorage();
      window.location.replace(`${window.location.pathname}${window.location.search}#/login`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Restore failed', 'error');
      setConfirmState(null);
    } finally {
      setRestoring(false);
    }
  };

  const handleRestoreUpload = async () => {
    if (!uploadFile) return;
    const name = uploadFile.name.toLowerCase();
    if (!name.endsWith('.sql')) {
      showToast(
        t('settingsBackup.restoreSqlOnly') || 'Please choose a .sql backup file.',
        'error'
      );
      return;
    }
    if (uploadFile.size < 64) {
      showToast(
        t('settingsBackup.restoreFileTooSmall') || 'Backup file is empty or too small.',
        'error'
      );
      return;
    }
    setRestoring(true);
    showToast(t('settingsBackup.restoreInProgress'), 'info');
    try {
      const result = (await Api.system.restoreBackupUpload(uploadFile)) as {
        safetyBackupFileName?: string;
      };
      const safetyName = result?.safetyBackupFileName;
      showToast(
        safetyName
          ? t('settingsBackup.restoreSuccessWithSafety', { name: safetyName })
          : t('settingsBackup.restoreSuccess'),
        'success'
      );
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setConfirmState(null);
      clearPortalSessionStorage();
      window.location.replace(`${window.location.pathname}${window.location.search}#/login`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Restore failed', 'error');
      setConfirmState(null);
    } finally {
      setRestoring(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settingsDraft) return;

    const parsedRetention = parseRetentionDaysInput(retentionDaysInput);
    if (parsedRetention === null) {
      showToast(
        t('settingsBackup.retentionRequired') || 'Retention days is required',
        'error'
      );
      return;
    }
    if (parsedRetention < 7 || parsedRetention > 365) {
      showToast(
        t('settingsBackup.retentionRangeError') || 'Retention must be between 7 and 365 days',
        'error'
      );
      return;
    }
    if (settingsDraft.frequency === 'weekly' && settingsDraft.weeklyDays.length === 0) {
      showToast(
        t('settingsBackup.weeklyDaysRequired') || 'Select at least one weekday for weekly backups',
        'error'
      );
      return;
    }
    if (
      settingsDraft.frequency === 'monthly' &&
      (settingsDraft.monthlyDay < 1 || settingsDraft.monthlyDay > 28)
    ) {
      showToast(
        t('settingsBackup.monthlyDayRangeError') || 'Monthly backup day must be between 1 and 28',
        'error'
      );
      return;
    }

    setSavingSettings(true);
    try {
      const res = (await Api.system.saveBackupSettings({
        ...settingsDraft,
        retentionDays: parsedRetention,
      })) as {
        settings: BackupSettings;
      };
      setSettingsDraft(res.settings);
      setRetentionDaysInput(String(res.settings.retentionDays));
      setSettingsEditing(false);
      showToast(
        t('settingsBackup.settingsUpdated') || 'Backup settings updated successfully.',
        'success'
      );
      await load({ background: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleWeeklyDay = (day: number) => {
    setSettingsDraft((prev) => {
      if (!prev) return prev;
      const selected = prev.weeklyDays.includes(day)
        ? prev.weeklyDays.filter((d) => d !== day)
        : [...prev.weeklyDays, day].sort((a, b) => a - b);
      return { ...prev, weeklyDays: selected };
    });
  };

  const savedSettings: BackupSettings = {
    ...DEFAULT_BACKUP_SETTINGS,
    ...(data?.settings ?? {}),
    departmentId: data?.settings?.departmentId ?? null,
  };
  const displaySettings = settingsEditing ? settingsDraft : savedSettings;
  const hasUnsavedSettings =
    settingsEditing &&
    settingsDraft != null &&
    (!settingsEqual(settingsDraft, savedSettings) ||
      retentionDaysInput.trim() !== String(savedSettings.retentionDays));

  const exitSettingsEditMode = () => {
    setSettingsDraft(savedSettings);
    setRetentionDaysInput(String(savedSettings.retentionDays));
    setSettingsEditing(false);
  };

  const formatFrequencyLabel = (frequency: BackupFrequency) => {
    if (frequency === 'weekly') return t('settingsBackup.frequencyWeekly') || 'Weekly';
    if (frequency === 'monthly') return t('settingsBackup.frequencyMonthly') || 'Monthly';
    return t('settingsBackup.frequencyDaily') || 'Daily';
  };

  const formatWeeklyDaysLabel = (days: number[]) =>
    days.length === 0
      ? '—'
      : days
          .map((day) => {
            const match = WEEKDAY_OPTIONS.find((option) => option.value === day);
            return match ? t(`settingsBackup.${match.key}`) || match.fallback : String(day);
          })
          .join(', ');

  const formatDepartmentLabel = (departmentId: string | null | undefined) => {
    if (!departmentId) return t('settingsBackup.departmentNotSet') || 'Not set';
    const dept = departments.find((d) => d.id === departmentId);
    return dept ? resolveDepartmentDisplayName(dept, language) : departmentId;
  };

  const scheduleDisabled = !settingsDraft?.autoBackupEnabled || !settingsEditing || !canEdit;
  const backupStatus = data?.status ?? null;
  const statusLabel =
    backupStatus?.lastAutomaticBackupStatus === 'successful'
      ? t('settingsBackup.statusSuccessful') || 'Successful'
      : backupStatus?.lastAutomaticBackupStatus === 'failed'
        ? t('settingsBackup.statusFailed') || 'Failed'
        : t('settingsBackup.statusNever') || 'Never run';

  const settingsFooterBar = (
    <div
      ref={settingsFooterRef}
      className="hcms-action-sticky-footer hcms-sticky-footer max-lg:rounded-none max-lg:rounded-t-2xl max-lg:border-x-0 lg:rounded-t-2xl lg:rounded-b-none p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500 dark:text-slate-400 min-w-0">
          {!canEdit ? (
            <span>{t('settingsBackup.viewOnly') || 'View only — edit permission required.'}</span>
          ) : !settingsEditing ? (
            <span className="inline-flex items-center gap-1">
              {t('settingsBackup.editFooterHint') || 'Select'}{' '}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {t('common.edit') || 'Edit'}
              </span>{' '}
              {t('settingsBackup.editFooterHintSuffix') || 'to update backup settings.'}
            </span>
          ) : hasUnsavedSettings ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <Loader2 className="w-3.5 h-3.5" />
              {t('settingsBackup.unsavedChanges') || 'Unsaved changes'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {t('settingsBackup.allChangesSaved') || 'All changes saved'}
            </span>
          )}
        </div>
        {canEdit ? (
          <div className="flex justify-end gap-2 shrink-0">
            {!settingsEditing ? (
              <button
                type="button"
                onClick={() => {
                  setSettingsDraft(savedSettings);
                  setRetentionDaysInput(String(savedSettings.retentionDays));
                  setSettingsEditing(true);
                }}
                className="px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 flex items-center gap-2 text-sm font-medium"
              >
                <Pencil className="w-4 h-4" />
                <span>{t('common.edit') || 'Edit'}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={exitSettingsEditMode}
                  disabled={savingSettings}
                  className="px-4 py-2 text-slate-700 bg-slate-100 dark:bg-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-2 text-sm"
                >
                  <X className="w-4 h-4" />
                  <span>{t('common.cancel') || 'Cancel'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsDraft(savedSettings)}
                  disabled={!hasUnsavedSettings || savingSettings}
                  className="px-4 py-2 text-slate-700 bg-slate-100 dark:bg-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 text-sm"
                >
                  {t('common.reset') || 'Reset'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveSettings()}
                  disabled={!hasUnsavedSettings || savingSettings}
                  className="px-4 py-2 text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
                >
                  {savingSettings ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('settingsBackup.saveChanges') || 'Save changes'}</span>
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  const summary = data?.summary;
  const backups = data?.backups ?? [];
  const { sortBy, sortOrder, toggleSort } = useListColumnSort<BackupSortCol>();
  const sortedBackups = useMemo(() => {
    const getSortValue = (backup: BackupRow, col: BackupSortCol): string | number => {
      switch (col) {
        case 'fileName':
          return backup.fileName;
        case 'type':
          return backupTypeLabel(backup, t).label;
        case 'size':
          return backup.sizeBytes;
        case 'createdBy':
          return backup.createdBy;
        case 'createdAt':
          return backup.createdAt;
        default:
          return '';
      }
    };
    const applyDefaultSort = (rows: BackupRow[]) =>
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sortRowsByColumn(backups, sortBy, sortOrder, getSortValue, applyDefaultSort);
  }, [backups, sortBy, sortOrder, t]);

  return (
    <PageShell className={`space-y-6 ${activeTab === 'settings' ? 'hcms-wizard-mobile-scroll-pad lg:pb-8' : ''}`}>
      {routeMeta && (
        <PageHeader
          title={routeMeta.title}
          subtitle={routeMeta.subtitle}
          iconComponent={routeMeta.icon}
          actions={
            canEdit && activeTab === 'backup' ? (
              <Button
                onClick={() => setConfirmState({ kind: 'create' })}
                isLoading={creating}
                icon={<CloudUpload className="w-4 h-4" />}
                className="shadow-lg shadow-primary-500/20"
              >
                {t('settingsBackup.backupNow') || 'Backup Now'}
              </Button>
            ) : undefined
          }
        />
      )}

      <UnderlineTabs
        value={activeTab}
        onChange={(id) => setActiveTab(id as BackupTab)}
        ariaLabel={t('settingsBackup.tabBackup') || 'Backup sections'}
        tabs={[
          { id: 'backup', label: t('settingsBackup.tabBackup') || 'Backup', icon: DatabaseBackup },
          { id: 'settings', label: t('settingsBackup.tabSettings') || 'Backup Settings', icon: Settings2 },
        ]}
      />

      {loading && !data ? (
        <LoadingState variant="panel" layout="form" label="Loading backups…" />
      ) : activeTab === 'settings' ? (
        <div className="min-w-0 w-full space-y-4">
          <div className="rounded-xl border border-primary-200/80 bg-gradient-to-br from-primary-50/90 to-white dark:from-primary-950/40 dark:to-slate-900 dark:border-primary-900/50 p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-3">
              <ActivityStatusIcon status={backupStatus?.lastAutomaticBackupStatus} />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('settingsBackup.statusTitle') || 'Backup status'}
              </h3>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('settingsBackup.lastBackup') || 'Last automatic backup'}
                </dt>
                <dd className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {formatDisplayDate(backupStatus?.lastAutomaticBackupAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('settingsBackup.nextBackup') || 'Next scheduled backup'}
                </dt>
                <dd className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {savedSettings.autoBackupEnabled
                    ? formatDisplayDate(backupStatus?.nextScheduledBackupAt)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('settingsBackup.statusLabel') || 'Last backup status'}
                </dt>
                <dd className="mt-0.5">
                  <Badge
                    variant={
                      backupStatus?.lastAutomaticBackupStatus === 'successful'
                        ? 'success'
                        : backupStatus?.lastAutomaticBackupStatus === 'failed'
                          ? 'danger'
                          : 'info'
                    }
                  >
                    {statusLabel}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('settingsBackup.storedAutomatic') || 'Automatic backups stored'}
                </dt>
                <dd className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {backupStatus?.automaticBackupsStored ?? 0}
                </dd>
              </div>
            </dl>
          </div>

          <div
            className={`rounded-lg border px-4 py-3 flex gap-3 items-start ${
              savedSettings.autoBackupEnabled
                ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100'
                : 'border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
            }`}
          >
            {savedSettings.autoBackupEnabled ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <p className="text-sm leading-relaxed">
              {savedSettings.autoBackupEnabled
                ? t('settingsBackup.bannerEnabled') ||
                  'Automatic backups are active and will run according to the configured schedule.'
                : t('settingsBackup.bannerDisabled') ||
                  'Automatic backups are currently disabled. Your database will only be backed up manually.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-800">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  settingsEditing
                    ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600'
                }`}
              >
                {settingsEditing ? (
                  <>
                    <Pencil className="w-3 h-3" aria-hidden />
                    {t('settingsBackup.editingBadge') || 'Editing'}
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3" aria-hidden />
                    {t('settingsBackup.viewOnlyBadge') || 'View only'}
                  </>
                )}
              </span>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {!settingsEditing ? (
                <>
                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {t('settingsBackup.scheduleTitle') || 'Backup schedule'}
                    </h4>
                    <dl className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 sm:px-4">
                      <ReadOnlySettingRow
                        label={t('settingsBackup.autoEnabled') || 'Enable scheduled backup'}
                        value={displaySettings?.autoBackupEnabled ? t('settingsBackup.valueYes') || 'Yes' : t('settingsBackup.valueNo') || 'No'}
                      />
                      <ReadOnlySettingRow
                        label={t('settingsBackup.frequency') || 'Backup frequency'}
                        value={formatFrequencyLabel(displaySettings?.frequency ?? 'daily')}
                      />
                      <ReadOnlySettingRow
                        label={t('settingsBackup.preferredTime') || 'Preferred time'}
                        value={formatPreferredHour(displaySettings?.autoBackupHour ?? 18)}
                      />
                      {displaySettings?.frequency === 'weekly' ? (
                        <ReadOnlySettingRow
                          label={t('settingsBackup.weeklyDays') || 'Run on weekdays'}
                          value={formatWeeklyDaysLabel(displaySettings.weeklyDays)}
                        />
                      ) : null}
                      {displaySettings?.frequency === 'monthly' ? (
                        <ReadOnlySettingRow
                          label={t('settingsBackup.monthlyDay') || 'Day of month'}
                          value={String(displaySettings.monthlyDay)}
                        />
                      ) : null}
                    </dl>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      {t('settingsBackup.retentionTitle') || 'Retention policy'}
                    </h4>
                    <dl className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 sm:px-4">
                      <ReadOnlySettingRow
                        label={t('settingsBackup.retentionDays') || 'Retention (days)'}
                        value={String(displaySettings?.retentionDays ?? 30)}
                      />
                    </dl>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {t('settingsBackup.retentionHint') ||
                        'Automatic backups older than the retention period will be deleted automatically. Manual backups are never deleted automatically.'}
                    </p>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5" />
                      {t('settingsBackup.storageTitle') || 'Backup destination'}
                    </h4>
                    <dl className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 sm:px-4">
                      <ReadOnlySettingRow
                        label={t('settingsBackup.currentStorage') || 'Current storage'}
                        value={backupStatus?.storageLabel || t('settingsBackup.storageLocal') || 'Local Server'}
                      />
                    </dl>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {t('settingsBackup.organizationTitle') || 'Organization'}
                    </h4>
                    <dl className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 sm:px-4">
                      <ReadOnlySettingRow
                        label={t('settingsBackup.department') || 'Department'}
                        value={formatDepartmentLabel(displaySettings?.departmentId)}
                      />
                    </dl>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {t('settingsBackup.departmentHint') ||
                        'Backups always include the full database. The department is used for ownership and notifications only.'}
                    </p>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      {t('settingsBackup.notificationsTitle') || 'Email notification'}
                    </h4>
                    <dl className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 sm:px-4">
                      <ReadOnlySettingRow
                        label={t('settingsBackup.notifyOnFailure') || 'Notify on backup failure'}
                        value={displaySettings?.notifyOnFailure ? t('settingsBackup.valueEnabled') || 'Enabled' : t('settingsBackup.valueDisabled') || 'Disabled'}
                      />
                    </dl>
                  </section>
                </>
              ) : (
                <>
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {t('settingsBackup.scheduleTitle') || 'Backup schedule'}
                    </h4>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                        checked={settingsDraft?.autoBackupEnabled ?? false}
                        onChange={(e) =>
                          setSettingsDraft((prev) =>
                            prev ? { ...prev, autoBackupEnabled: e.target.checked } : prev
                          )
                        }
                      />
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {t('settingsBackup.autoEnabled') || 'Enable scheduled backup'}
                      </span>
                    </label>

                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${scheduleDisabled ? 'opacity-60' : ''}`}>
                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('settingsBackup.frequency') || 'Backup frequency'}
                        </span>
                        <select
                          disabled={scheduleDisabled}
                          value={settingsDraft?.frequency ?? 'daily'}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-base bg-white dark:bg-slate-900"
                          onChange={(e) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? { ...prev, frequency: e.target.value as BackupFrequency }
                                : prev
                            )
                          }
                        >
                          <option value="daily">{t('settingsBackup.frequencyDaily') || 'Daily'}</option>
                          <option value="weekly">{t('settingsBackup.frequencyWeekly') || 'Weekly'}</option>
                          <option value="monthly">{t('settingsBackup.frequencyMonthly') || 'Monthly'}</option>
                        </select>
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {t('settingsBackup.preferredTime') || 'Preferred time'}
                        </span>
                        <NumericField
                          kind="integer"
                          value={String(settingsDraft?.autoBackupHour ?? 18)}
                          disabled={scheduleDisabled}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-base"
                          onValueChange={(v) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    autoBackupHour: Math.min(23, Math.max(0, Number(v) || 0)),
                                  }
                                : prev
                            )
                          }
                        />
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {(t('settingsBackup.preferredTimeHint') || 'Hour (0–23). Runs at {time}.').replace(
                            '{time}',
                            formatPreferredHour(settingsDraft?.autoBackupHour ?? 18)
                          )}
                        </span>
                      </label>
                    </div>

                    {settingsDraft?.frequency === 'weekly' ? (
                      <div className={scheduleDisabled ? 'opacity-60' : ''}>
                        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                          {t('settingsBackup.weeklyDays') || 'Run on weekdays'}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_OPTIONS.map((day) => {
                            const selected = settingsDraft.weeklyDays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                disabled={scheduleDisabled}
                                onClick={() => toggleWeeklyDay(day.value)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                  selected
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary-300'
                                }`}
                              >
                                {t(`settingsBackup.${day.key}`) || day.fallback}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {settingsDraft?.frequency === 'monthly' ? (
                      <label className={`block space-y-1.5 max-w-xs ${scheduleDisabled ? 'opacity-60' : ''}`}>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          {t('settingsBackup.monthlyDay') || 'Day of month'}
                        </span>
                        <NumericField
                          kind="integer"
                          value={String(settingsDraft?.monthlyDay ?? 1)}
                          disabled={scheduleDisabled}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-base"
                          onValueChange={(v) =>
                            setSettingsDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    monthlyDay: Math.min(28, Math.max(1, Number(v) || 1)),
                                  }
                                : prev
                            )
                          }
                        />
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {t('settingsBackup.monthlyDayHint') || 'Runs on this day each month (1–28).'}
                        </span>
                      </label>
                    ) : null}
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                      <HardDriveDownload className="w-3.5 h-3.5" />
                      {t('settingsBackup.retentionTitle') || 'Retention policy'}
                    </h4>
                    <label className="block space-y-1.5 max-w-xs">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t('settingsBackup.retentionDays') || 'Retention (days)'}
                      </span>
                      <NumericField
                        kind="integer"
                        value={retentionDaysInput}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-base"
                        onValueChange={setRetentionDaysInput}
                      />
                      <span className="block text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {t('settingsBackup.retentionHint') ||
                          'Automatic backups older than the retention period will be deleted automatically. Manual backups are never deleted automatically.'}
                      </span>
                    </label>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5" />
                      {t('settingsBackup.storageTitle') || 'Backup destination'}
                    </h4>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {backupStatus?.storageLabel || t('settingsBackup.storageLocal') || 'Local Server'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('settingsBackup.storageReadOnlyHint') || 'Cloud destinations will be available in a future update.'}
                    </p>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      {t('settingsBackup.organizationTitle') || 'Organization'}
                    </h4>
                    <WizardField
                      label={t('settingsBackup.department') || 'Department'}
                      hint={
                        t('settingsBackup.departmentHint') ||
                        'Backups always include the full database. The department is used for ownership and notifications only.'
                      }
                      className="max-w-md"
                    >
                      <select
                        value={settingsDraft?.departmentId ?? ''}
                        className={WIZARD_SELECT_CLASS}
                        onChange={(e) =>
                          setSettingsDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  departmentId: e.target.value.trim() || null,
                                }
                              : prev
                          )
                        }
                      >
                        <option value="">
                          {t('settingsBackup.departmentPlaceholder') || 'Select Department'}
                        </option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {resolveDepartmentDisplayName(dept, language)}
                          </option>
                        ))}
                      </select>
                    </WizardField>
                  </section>

                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" />
                      {t('settingsBackup.notificationsTitle') || 'Email notification'}
                    </h4>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                        checked={settingsDraft?.notifyOnFailure ?? true}
                        onChange={(e) =>
                          setSettingsDraft((prev) =>
                            prev ? { ...prev, notifyOnFailure: e.target.checked } : prev
                          )
                        }
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                        {t('settingsBackup.notifyOnFailure') ||
                          'Notify administrators when automatic backup fails'}
                      </span>
                    </label>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <Card
            title={t('settingsBackup.listTitle') || 'Backup list'}
            icon={<HardDriveDownload className="w-5 h-5 text-primary-600" />}
            action={
              <Button
                variant="outline"
                size="sm"
                icon={<RefreshCw className="w-4 h-4" />}
                iconOnly
                title="Refresh"
                aria-label="Refresh"
                onClick={() => void load({ background: true })}
              />
            }
          >
            {backups.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                {t('settingsBackup.empty') || 'No backups yet. Click Backup Now to create one.'}
              </p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
                      <SortableTableHeader
                        label={t('settingsBackup.colName') || 'Backup name'}
                        column="fileName"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={backupListThClass}
                      />
                      <SortableTableHeader
                        label={t('settingsBackup.colType') || 'Type'}
                        column="type"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={backupListThClass}
                      />
                      <SortableTableHeader
                        label={t('settingsBackup.colSize') || 'Size'}
                        column="size"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={backupListThClass}
                      />
                      <SortableTableHeader
                        label={t('settingsBackup.colCreatedBy') || 'Created by'}
                        column="createdBy"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={backupListThClass}
                      />
                      <SortableTableHeader
                        label={t('settingsBackup.colDate') || 'Date'}
                        column="createdAt"
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onToggle={toggleSort}
                        className={backupListThClass}
                      />
                      <th className={`${backupListThClass} text-right`}>
                        {t('settingsBackup.colActions') || 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBackups.map((backup) => {
                      const typeMeta = backupTypeLabel(backup, t);
                      return (
                      <tr
                        key={backup.id}
                        className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                      >
                        <td className="px-2 py-2 sm:px-3 font-medium text-slate-900 dark:text-white">
                          {backup.fileName}
                        </td>
                        <td className="px-2 py-2 sm:px-3">
                          <Badge variant={typeMeta.variant}>
                            {typeMeta.label}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 sm:px-3 text-slate-600 dark:text-slate-300">
                          {backup.sizeLabel}
                        </td>
                        <td className="px-2 py-2 sm:px-3 text-slate-600 dark:text-slate-300">
                          <span className="font-medium text-slate-800 dark:text-slate-100">
                            {backup.createdBy}
                          </span>
                        </td>
                        <td className="px-2 py-2 sm:px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {formatDisplayDate(backup.createdAt)}
                        </td>
                        <td className="px-2 py-2 sm:px-3">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {canEdit ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handleDownload(backup)}
                                icon={<Download className="w-3.5 h-3.5" />}
                              >
                                {t('settingsBackup.download') || 'Download'}
                              </Button>
                            ) : null}
                            {canEdit ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200"
                                  onClick={() => setConfirmState({ kind: 'restore-existing', backup })}
                                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                                >
                                  {t('settingsBackup.restore') || 'Restore'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
                                  onClick={() => setConfirmState({ kind: 'delete', backup })}
                                  icon={<Trash2 className="w-3.5 h-3.5" />}
                                >
                                  {t('settingsBackup.delete') || 'Delete'}
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title={t('settingsBackup.restoreTitle') || 'Restore backup'} icon={<RotateCcw className="w-5 h-5 text-emerald-600" />}>
              <div className="relative space-y-4">
                {restoring ? (
                  <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/90 px-4 text-center dark:bg-slate-900/90"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {t('settingsBackup.restoreInProgress')}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('settingsBackup.restoreStayOnPage') ||
                        'Do not close or refresh this page until restore finishes.'}
                    </p>
                  </div>
                ) : null}
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('settingsBackup.restoreHint') ||
                    'Upload a .sql backup file to restore the database. A safety backup is created automatically before overwrite.'}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sql,text/plain,application/sql"
                    disabled={!canEdit || restoring}
                    className="min-w-0 flex-1 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-700"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file && !file.name.toLowerCase().endsWith('.sql')) {
                        showToast(
                          t('settingsBackup.restoreSqlOnly') || 'Please choose a .sql backup file.',
                          'error'
                        );
                        e.target.value = '';
                        setUploadFile(null);
                        return;
                      }
                      setUploadFile(file);
                    }}
                  />
                  <Button
                    disabled={!canEdit || !uploadFile || restoring}
                    onClick={() => setConfirmState({ kind: 'restore-upload' })}
                    className="w-full bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
                    icon={restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                  >
                    {t('settingsBackup.restore') || 'Restore'}
                  </Button>
                </div>
                {uploadFile ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium">{uploadFile.name}</span>
                    <span className="text-slate-400">
                      {' '}
                      ({formatBackupSizeClient(uploadFile.size)})
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    {t('settingsBackup.restoreNoFile') || 'No file chosen'}
                  </p>
                )}
              </div>
            </Card>

            <Card title={t('settingsBackup.summaryTitle') || 'Backup summary'} icon={<DatabaseBackup className="w-5 h-5 text-primary-600" />}>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('settingsBackup.totalBackups') || 'Total backups'}</dt>
                  <dd className="text-lg font-bold text-slate-900 dark:text-white">{summary?.totalBackups ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('settingsBackup.totalSize') || 'Total size'}</dt>
                  <dd className="text-lg font-bold text-slate-900 dark:text-white">{summary?.totalSizeLabel ?? '0 B'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('settingsBackup.oldest') || 'Oldest backup'}</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{formatDisplayDate(summary?.oldestBackupAt)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">{t('settingsBackup.latest') || 'Latest backup'}</dt>
                  <dd className="font-medium text-slate-800 dark:text-slate-200">{formatDisplayDate(summary?.latestBackupAt)}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmState?.kind === 'create'}
        onClose={() => setConfirmState(null)}
        title={t('settingsBackup.createConfirmTitle') || 'Create database backup?'}
        description={
          t('settingsBackup.createConfirmBody') ||
          'This will snapshot the current database. Choose the effective date when this backup takes effect in the system.'
        }
        confirmLabel={t('settingsBackup.backupNow') || 'Backup Now'}
        confirmIcon={<CloudUpload className="w-4 h-4" />}
        variant="success"
        showEffectiveDateInput
        effectiveDateLabel={t('settingsBackup.effectiveDateLabel') || 'Effective date'}
        defaultEffectiveDate={todayYmdInCompanyTz()}
        loading={creating}
        onConfirm={(payload) => {
          void handleCreateBackup(payload?.effectiveFrom);
        }}
      />

      <ConfirmDialog
        open={confirmState?.kind === 'delete'}
        onClose={() => setConfirmState(null)}
        title={t('settingsBackup.deleteConfirmTitle') || 'Delete backup?'}
        description={
          confirmState?.kind === 'delete'
            ? (t('settingsBackup.deleteConfirmBody') || 'Permanently delete {name}?').replace(
                '{name}',
                confirmState.backup.fileName
              )
            : ''
        }
        confirmLabel={t('settingsBackup.delete') || 'Delete'}
        confirmIcon={<Trash2 className="w-4 h-4" />}
        variant="danger"
        loading={deleting}
        onConfirm={() => {
          if (confirmState?.kind === 'delete') void handleDelete(confirmState.backup);
        }}
      />

      <ConfirmDialog
        open={confirmState?.kind === 'restore-existing' || confirmState?.kind === 'restore-upload'}
        onClose={() => {
          if (!restoring) setConfirmState(null);
        }}
        title={t('settingsBackup.restoreConfirmTitle') || 'Restore database?'}
        description={
          confirmState?.kind === 'restore-existing'
            ? (t('settingsBackup.restoreConfirmBody') ||
                'This will replace the current database with {name}. A safety backup will be created first.').replace(
                '{name}',
                confirmState.backup.fileName
              )
            : t('settingsBackup.restoreUploadConfirmBody') ||
              'This will replace the current database with the uploaded file. A safety backup will be created first.'
        }
        confirmLabel={t('settingsBackup.restore') || 'Restore'}
        confirmIcon={<RotateCcw className="w-4 h-4" />}
        variant="danger"
        loading={restoring}
        onConfirm={() => {
          if (confirmState?.kind === 'restore-existing') void handleRestoreExisting(confirmState.backup);
          else if (confirmState?.kind === 'restore-upload') void handleRestoreUpload();
        }}
      />

      {activeTab === 'settings' && footerRoot ? createPortal(settingsFooterBar, footerRoot) : null}
    </PageShell>
  );
};

export default DatabaseBackupPage;
