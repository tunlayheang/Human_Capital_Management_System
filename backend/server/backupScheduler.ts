import {
  applyRetentionPolicy,
  createAutoBackup,
  getBackupRunSlot,
  getBackupSettings,
  getLastAutomaticBackupRunSlot,
  recordAutomaticBackupResult,
  shouldRunBackupOnDate,
} from './backupService.js';
import { AuditLog } from './db.js';

/** Polls backup settings and runs scheduled auto-backup when due. */
export function startBackupScheduler(): void {
  const tick = async () => {
    try {
      const settings = await getBackupSettings();
      await applyRetentionPolicy(settings.retentionDays);

      if (!settings.autoBackupEnabled) return;

      const now = new Date();
      if (now.getHours() !== settings.autoBackupHour) return;
      if (!shouldRunBackupOnDate(settings, now)) return;

      const slot = getBackupRunSlot(settings, now);
      const lastRun = await getLastAutomaticBackupRunSlot();
      if (lastRun === slot) return;

      try {
        const backup = await createAutoBackup();
        await recordAutomaticBackupResult(true, slot);
        try {
          await AuditLog.create({
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            entityType: 'database_backup',
            entityId: backup.id,
            action: 'CREATE',
            performedBy: 'system',
            newValue: { fileName: backup.fileName, type: backup.type, source: 'scheduled' },
            reason: 'Scheduled automatic database backup',
            metadata: { page: 'Settings', tab: 'Backup', section: 'Backup Settings' },
          } as any);
        } catch {
          /* audit failure must not block backup */
        }
        console.info(`[backup] Scheduled backup created: ${backup.fileName}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordAutomaticBackupResult(false, slot, message);
        console.error('[backup] Scheduled backup failed:', message);
      }
    } catch (err) {
      console.error('[backup] Scheduler tick failed:', err instanceof Error ? err.message : err);
    }
  };

  void tick();
  setInterval(() => void tick(), 60_000);
  console.info('[backup] Scheduler started (checks every minute when auto-backup is enabled).');
}
