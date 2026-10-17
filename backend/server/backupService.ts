import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDatabaseToFile } from './mysqlDumpService.js';
import { SystemSetting } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');
export const EXPORTS_DIR = path.resolve(BACKEND_ROOT, 'database/exports');
const REGISTRY_PATH = path.join(EXPORTS_DIR, '.backup-registry.json');
const LATEST_POINTER = path.join(EXPORTS_DIR, 'LATEST-LOCAL.sql');
const SETTINGS_KEY = 'backup.settings';

/** Files kept on disk but hidden from the backup list UI. */
const HIDDEN_BACKUP_FILES = new Set(['LATEST-LOCAL.sql']);

/** Always keep at least this many automatic backups during retention cleanup. */
const MIN_AUTO_BACKUPS = 2;

export type BackupType = 'manual' | 'auto';

export type BackupRecord = {
  id: string;
  fileName: string;
  type: BackupType;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
};

export type BackupSummary = {
  totalBackups: number;
  totalSizeBytes: number;
  oldestBackupAt: string | null;
  latestBackupAt: string | null;
};

export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export type BackupStorageDestination = 'local';
export type BackupRunStatus = 'successful' | 'failed' | 'never';

export type BackupSettings = {
  autoBackupEnabled: boolean;
  retentionDays: number;
  autoBackupHour: number;
  frequency: BackupFrequency;
  weeklyDays: number[];
  monthlyDay: number;
  notifyOnFailure: boolean;
  storageDestination: BackupStorageDestination;
  /** Owning department for settings/notifications; does not scope backup content. */
  departmentId: string | null;
};

export type BackupStatus = {
  lastAutomaticBackupAt: string | null;
  lastAutomaticBackupStatus: BackupRunStatus;
  nextScheduledBackupAt: string | null;
  automaticBackupsStored: number;
  currentStorage: BackupStorageDestination;
  storageLabel: string;
};

const DEFAULT_SETTINGS: BackupSettings = {
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

const LAST_RUN_SLOT_KEY = 'backup.lastAutoRunSlot';
const LAST_RUN_AT_KEY = 'backup.lastAutoRunAt';
const LAST_RUN_STATUS_KEY = 'backup.lastAutoRunStatus';
const LAST_RUN_ERROR_KEY = 'backup.lastAutoRunError';

const VALID_WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

type RegistryFile = {
  entries: Record<
    string,
    {
      type: BackupType;
      /** Display label (Name (ID) for portal users; Scheduled / System for auto). */
      createdBy: string;
      /** Portal user id when a person created the backup — used to refresh the label. */
      createdByUserId?: string | null;
      createdAt: string;
    }
  >;
};

let operationInProgress: 'backup' | 'restore' | null = null;

export class BackupOperationBusyError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'BackupOperationBusyError';
  }
}

export function getBackupOperationInProgress(): 'backup' | 'restore' | null {
  return operationInProgress;
}

async function withBackupOperationLock<T>(
  kind: 'backup' | 'restore',
  fn: () => Promise<T>
): Promise<T> {
  if (operationInProgress) {
    throw new BackupOperationBusyError(
      operationInProgress === 'restore'
        ? 'A database restore is in progress. Please wait and try again.'
        : 'Another backup operation is in progress. Please wait and try again.'
    );
  }
  operationInProgress = kind;
  try {
    return await fn();
  } finally {
    operationInProgress = null;
  }
}

function ensureExportsDir(): void {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

function loadRegistry(): RegistryFile {
  ensureExportsDir();
  if (!fs.existsSync(REGISTRY_PATH)) return { entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as RegistryFile;
    return parsed?.entries ? parsed : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

function saveRegistry(registry: RegistryFile): void {
  ensureExportsDir();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
}

function encodeBackupId(fileName: string): string {
  return Buffer.from(fileName, 'utf8').toString('base64url');
}

function decodeBackupId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

function isSafeSqlFileName(fileName: string): boolean {
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return false;
  }
  return fileName.toLowerCase().endsWith('.sql');
}

function isListableBackupFile(fileName: string): boolean {
  return isSafeSqlFileName(fileName) && !HIDDEN_BACKUP_FILES.has(fileName);
}

export function resolveBackupFilePath(id: string): string {
  const fileName = decodeBackupId(id);
  if (!isSafeSqlFileName(fileName)) {
    throw new Error('Invalid backup id');
  }
  const root = path.resolve(EXPORTS_DIR);
  const resolved = path.resolve(root, fileName);
  // Block path-prefix tricks (EXPORTS_DIR vs EXPORTS_DIR_evil).
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid backup path');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('Backup file not found');
  }
  return resolved;
}

function inferBackupType(fileName: string, registry: RegistryFile): BackupType {
  if (registry.entries[fileName]?.type) return registry.entries[fileName].type;
  if (/^backup_/i.test(fileName)) return 'manual';
  if (/^auto-backup-manual/i.test(fileName)) return 'manual';
  if (/^auto-backup-/i.test(fileName)) return 'auto';
  return 'manual';
}

function inferCreatedBy(fileName: string, registry: RegistryFile): string {
  if (registry.entries[fileName]?.createdBy) return registry.entries[fileName].createdBy;
  if (/^auto-backup-pre-restore/i.test(fileName)) return 'Safety backup';
  if (/^auto-backup-scheduled/i.test(fileName)) return 'Scheduled';
  if (/^auto-backup-manual/i.test(fileName)) return 'CLI';
  if (/^auto-backup-/i.test(fileName)) return 'System';
  return 'System';
}

function formatTimestampFileSuffix(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}_${m}_${d}_${hh}${mm}${ss}`;
}

function formatManualFileName(date = new Date()): string {
  return `backup_${formatTimestampFileSuffix(date)}.sql`;
}

function formatScheduledFileName(date = new Date()): string {
  return `auto-backup-scheduled-${formatTimestampFileSuffix(date)}.sql`;
}

function formatSafetyFileName(label: string, date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeLabel = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `auto-backup-${safeLabel}-${stamp}.sql`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBackupSize(bytes: number): string {
  return formatBytes(bytes);
}

function registerBackupFile(
  fileName: string,
  type: BackupType,
  createdBy: string,
  createdAt = new Date().toISOString(),
  createdByUserId?: string | null
): void {
  const registry = loadRegistry();
  registry.entries[fileName] = {
    type,
    createdBy,
    createdAt,
    ...(createdByUserId ? { createdByUserId: String(createdByUserId) } : {}),
  };
  saveRegistry(registry);
}

/** User ids recorded on backup registry entries (for name + ID enrichment). */
export function listBackupCreatorUserIds(): string[] {
  const registry = loadRegistry();
  return Array.from(
    new Set(
      Object.values(registry.entries)
        .map((e) => String(e.createdByUserId || '').trim())
        .filter(Boolean)
    )
  );
}

export function applyBackupCreatorLabels(
  backups: BackupRecord[],
  labelByUserId: Map<string, string>
): BackupRecord[] {
  const registry = loadRegistry();
  return backups.map((b) => {
    const userId = String(registry.entries[b.fileName]?.createdByUserId || '').trim();
    if (userId && labelByUserId.has(userId)) {
      return { ...b, createdBy: labelByUserId.get(userId)! };
    }
    return b;
  });
}

export async function listBackups(): Promise<BackupRecord[]> {
  ensureExportsDir();
  const registry = loadRegistry();
  const files = fs
    .readdirSync(EXPORTS_DIR)
    .filter(isListableBackupFile)
    .sort((a, b) => {
      const aTime = fs.statSync(path.join(EXPORTS_DIR, a)).mtimeMs;
      const bTime = fs.statSync(path.join(EXPORTS_DIR, b)).mtimeMs;
      return bTime - aTime;
    });

  return files.map((fileName) => {
    const stat = fs.statSync(path.join(EXPORTS_DIR, fileName));
    const reg = registry.entries[fileName];
    return {
      id: encodeBackupId(fileName),
      fileName,
      type: inferBackupType(fileName, registry),
      sizeBytes: stat.size,
      createdBy: inferCreatedBy(fileName, registry),
      createdAt: reg?.createdAt ?? stat.mtime.toISOString(),
    };
  });
}

export function summarizeBackups(backups: BackupRecord[]): BackupSummary {
  if (backups.length === 0) {
    return {
      totalBackups: 0,
      totalSizeBytes: 0,
      oldestBackupAt: null,
      latestBackupAt: null,
    };
  }
  const times = backups.map((b) => new Date(b.createdAt).getTime()).filter((t) => Number.isFinite(t));
  return {
    totalBackups: backups.length,
    totalSizeBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    oldestBackupAt: new Date(Math.min(...times)).toISOString(),
    latestBackupAt: new Date(Math.max(...times)).toISOString(),
  };
}

function normalizeWeeklyDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.weeklyDays];
  const days = [...new Set(value.map((d) => Number(d)).filter((d) => VALID_WEEKDAYS.has(d)))].sort(
    (a, b) => a - b
  );
  return days.length > 0 ? days : [...DEFAULT_SETTINGS.weeklyDays];
}

export function normalizeBackupSettings(input: Partial<BackupSettings>): BackupSettings {
  const frequency: BackupFrequency =
    input.frequency === 'weekly' || input.frequency === 'monthly' ? input.frequency : 'daily';
  return {
    autoBackupEnabled: Boolean(input.autoBackupEnabled),
    retentionDays: Math.max(
      7,
      Math.min(365, Number(input.retentionDays) || DEFAULT_SETTINGS.retentionDays)
    ),
    autoBackupHour: Math.min(
      23,
      Math.max(0, Number(input.autoBackupHour) ?? DEFAULT_SETTINGS.autoBackupHour)
    ),
    frequency,
    weeklyDays: frequency === 'weekly' ? normalizeWeeklyDays(input.weeklyDays) : [...DEFAULT_SETTINGS.weeklyDays],
    monthlyDay:
      frequency === 'monthly'
        ? Math.min(28, Math.max(1, Number(input.monthlyDay) || DEFAULT_SETTINGS.monthlyDay))
        : DEFAULT_SETTINGS.monthlyDay,
    notifyOnFailure: input.notifyOnFailure !== false,
    storageDestination: 'local',
    departmentId: normalizeDepartmentId(input.departmentId),
  };
}

function normalizeDepartmentId(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateBackupSettings(settings: BackupSettings): void {
  if (settings.retentionDays < 7 || settings.retentionDays > 365) {
    throw new Error('Retention must be between 7 and 365 days');
  }
  if (settings.autoBackupHour < 0 || settings.autoBackupHour > 23) {
    throw new Error('Preferred time hour must be between 0 and 23');
  }
  if (settings.frequency === 'weekly' && settings.weeklyDays.length === 0) {
    throw new Error('Select at least one weekday for weekly backups');
  }
  if (settings.frequency === 'monthly' && (settings.monthlyDay < 1 || settings.monthlyDay > 28)) {
    throw new Error('Monthly backup day must be between 1 and 28');
  }
}

export function shouldRunBackupOnDate(settings: BackupSettings, date: Date): boolean {
  if (settings.frequency === 'daily') return true;
  if (settings.frequency === 'weekly') return settings.weeklyDays.includes(date.getDay());
  return date.getDate() === settings.monthlyDay;
}

export function getBackupRunSlot(settings: BackupSettings, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (settings.frequency === 'monthly') return `${y}-${m}`;
  return `${y}-${m}-${d}`;
}

export function computeNextScheduledBackup(
  settings: BackupSettings,
  from = new Date()
): Date | null {
  if (!settings.autoBackupEnabled) return null;

  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(0);
  cursor.setHours(settings.autoBackupHour);

  if (cursor <= from) {
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(settings.autoBackupHour, 0, 0, 0);
  }

  for (let i = 0; i < 370; i += 1) {
    if (shouldRunBackupOnDate(settings, cursor)) {
      const runAt = new Date(cursor);
      runAt.setHours(settings.autoBackupHour, 0, 0, 0);
      if (runAt > from) return runAt;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(settings.autoBackupHour, 0, 0, 0);
  }
  return null;
}

async function readSystemSettingValue(key: string): Promise<string | null> {
  const row = await SystemSetting.findOne({ where: { key } });
  const value = String(row?.value ?? '').trim();
  return value || null;
}

async function writeSystemSettingValue(key: string, value: string, description: string): Promise<void> {
  const existing = await SystemSetting.findOne({ where: { key } });
  if (existing) {
    existing.value = value;
    await existing.save();
    return;
  }
  await SystemSetting.create({
    id: `ss-backup-${key.replace(/\./g, '-')}-${Date.now()}`,
    key,
    value,
    category: 'backup',
    description,
  });
}

export async function recordAutomaticBackupResult(
  success: boolean,
  slot: string,
  errorMessage?: string
): Promise<void> {
  await writeSystemSettingValue(LAST_RUN_SLOT_KEY, slot, 'Last auto-backup dedupe slot');
  await writeSystemSettingValue(LAST_RUN_AT_KEY, new Date().toISOString(), 'Last auto-backup timestamp');
  await writeSystemSettingValue(
    LAST_RUN_STATUS_KEY,
    success ? 'successful' : 'failed',
    'Last auto-backup result'
  );
  if (success) {
    const existing = await SystemSetting.findOne({ where: { key: LAST_RUN_ERROR_KEY } });
    if (existing) await existing.destroy();
  } else if (errorMessage) {
    await writeSystemSettingValue(LAST_RUN_ERROR_KEY, errorMessage.slice(0, 500), 'Last auto-backup error');
  }
}

export async function getLastAutomaticBackupRunSlot(): Promise<string | null> {
  return readSystemSettingValue(LAST_RUN_SLOT_KEY);
}

export async function getBackupStatus(settings: BackupSettings): Promise<BackupStatus> {
  const backups = await listBackups();
  const automaticBackups = backups.filter((b) => b.type === 'auto');
  const latestAuto = automaticBackups[0] ?? null;

  const lastRunAt = await readSystemSettingValue(LAST_RUN_AT_KEY);
  const lastRunStatusRaw = await readSystemSettingValue(LAST_RUN_STATUS_KEY);
  const lastRunStatus: BackupRunStatus =
    lastRunStatusRaw === 'successful' || lastRunStatusRaw === 'failed' ? lastRunStatusRaw : 'never';

  const lastAutomaticBackupAt = lastRunAt ?? latestAuto?.createdAt ?? null;
  const lastAutomaticBackupStatus =
    lastRunStatus !== 'never' ? lastRunStatus : latestAuto ? 'successful' : 'never';

  return {
    lastAutomaticBackupAt,
    lastAutomaticBackupStatus,
    nextScheduledBackupAt: computeNextScheduledBackup(settings)?.toISOString() ?? null,
    automaticBackupsStored: automaticBackups.length,
    currentStorage: 'local',
    storageLabel: 'Local Server',
  };
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const row = await SystemSetting.findOne({ where: { key: SETTINGS_KEY } });
  if (!row?.value) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(String(row.value)) as Partial<BackupSettings>;
    return normalizeBackupSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveBackupSettings(input: Partial<BackupSettings>): Promise<BackupSettings> {
  const rawRetention = input.retentionDays;
  if (
    rawRetention === null ||
    rawRetention === undefined ||
    rawRetention === '' ||
    (typeof rawRetention === 'number' && !Number.isFinite(rawRetention))
  ) {
    throw new Error('Retention days is required');
  }
  const normalized = normalizeBackupSettings(input);
  validateBackupSettings(normalized);

  const existing = await SystemSetting.findOne({ where: { key: SETTINGS_KEY } });
  const payload = JSON.stringify(normalized);
  if (existing) {
    existing.value = payload;
    await existing.save();
  } else {
    await SystemSetting.create({
      id: `ss-backup-${Date.now()}`,
      key: SETTINGS_KEY,
      value: payload,
      category: 'backup',
      description: 'Database backup automation settings',
    });
  }

  await applyRetentionPolicy(normalized.retentionDays);
  return normalized;
}

/** Deletes automatic backups older than retentionDays. Manual backups are kept until explicitly deleted. */
export async function applyRetentionPolicy(retentionDays: number): Promise<void> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const backups = await listBackups();
  const registry = loadRegistry();
  let changed = false;

  const autoBackups = backups
    .filter((b) => b.type === 'auto')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const protectedAutoIds = new Set(autoBackups.slice(0, MIN_AUTO_BACKUPS).map((b) => b.id));

  for (const backup of autoBackups) {
    if (protectedAutoIds.has(backup.id)) continue;
    const created = new Date(backup.createdAt).getTime();
    if (created >= cutoff) continue;
    try {
      fs.unlinkSync(resolveBackupFilePath(backup.id));
      delete registry.entries[backup.fileName];
      changed = true;
    } catch {
      /* ignore missing files */
    }
  }

  if (changed) saveRegistry(registry);
}

async function writeBackupFile(
  fileName: string,
  type: BackupType,
  createdBy: string,
  createdByUserId?: string | null
): Promise<BackupRecord> {
  ensureExportsDir();
  const outputPath = path.join(EXPORTS_DIR, fileName);
  await exportDatabaseToFile(outputPath);

  if (type === 'manual') {
    try {
      fs.copyFileSync(outputPath, LATEST_POINTER);
    } catch {
      /* non-fatal */
    }
  }

  const createdAt = new Date().toISOString();
  registerBackupFile(fileName, type, createdBy, createdAt, createdByUserId);

  const stat = fs.statSync(outputPath);
  return {
    id: encodeBackupId(fileName),
    fileName,
    type,
    sizeBytes: stat.size,
    createdBy,
    createdAt,
  };
}

export async function createManualBackup(
  createdBy: string,
  createdByUserId?: string | null
): Promise<BackupRecord> {
  return withBackupOperationLock('backup', async () => {
    const backup = await writeBackupFile(
      formatManualFileName(),
      'manual',
      createdBy,
      createdByUserId
    );
    const settings = await getBackupSettings();
    await applyRetentionPolicy(settings.retentionDays);
    return backup;
  });
}

export async function createAutoBackup(): Promise<BackupRecord> {
  return withBackupOperationLock('backup', async () => {
    const backup = await writeBackupFile(formatScheduledFileName(), 'auto', 'Scheduled');
    const settings = await getBackupSettings();
    await applyRetentionPolicy(settings.retentionDays);
    return backup;
  });
}

/** Safety snapshot before destructive restore — uses the same export path as manual backups. */
export async function createSafetyBackup(label: string): Promise<BackupRecord> {
  const write = () => writeBackupFile(formatSafetyFileName(label), 'auto', 'Safety backup');
  if (operationInProgress === 'restore') {
    return write();
  }
  return withBackupOperationLock('backup', write);
}

export async function deleteBackup(id: string): Promise<void> {
  const filePath = resolveBackupFilePath(id);
  const fileName = path.basename(filePath);
  fs.unlinkSync(filePath);

  const registry = loadRegistry();
  if (registry.entries[fileName]) {
    delete registry.entries[fileName];
    saveRegistry(registry);
  }
}

export async function restoreBackup(id: string, force: boolean): Promise<{ statementsExecuted: number; safetyBackupFileName?: string }> {
  return withBackupOperationLock('restore', async () => {
    const filePath = resolveBackupFilePath(id);
    const { importDatabaseFromFile } = await import('./mysqlImportService.js');
    return importDatabaseFromFile(filePath, { force: force === true });
  });
}

export async function restoreUploadedBackup(
  filePath: string,
  force: boolean
): Promise<{ statementsExecuted: number; safetyBackupFileName?: string }> {
  return withBackupOperationLock('restore', async () => {
    const { importDatabaseFromFile } = await import('./mysqlImportService.js');
    return importDatabaseFromFile(filePath, { force: force === true });
  });
}

export function getBackupDownloadName(id: string): string {
  const fileName = decodeBackupId(id);
  if (!isSafeSqlFileName(fileName)) throw new Error('Invalid backup id');
  return fileName;
}
